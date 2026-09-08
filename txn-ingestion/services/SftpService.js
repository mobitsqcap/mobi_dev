'use strict';

const path = require('path');
const SftpClient = require('ssh2-sftp-client');

const { getSFTPDestination } = require('../utils/SftpDestination');

class SftpService {
  constructor() {
    this.config = null;
    this.maxRetries = Number(process.env.SFTP_MAX_RETRIES || 5);
    this.client = null;
    this.connected = false;
    this.traceLogs = [];
  }

  clearTrace() { this.traceLogs = []; }
  getTrace() { return [...this.traceLogs]; }
  _log(message) { this.traceLogs.push(`[SftpService] ${message}`); }

  async _loadConfig() {
    if (!this.config) {
      this.config = await getSFTPDestination();
      this._log('Destination loaded');
    }
    return this.config;
  }

  async resolvePath(remotePath) {
    await this._loadConfig();
    return this._resolvePath(remotePath);
  }

  _resolvePath(remotePath) {
    if (!remotePath) return this.config?.remotePath || '/';
    if (remotePath.startsWith('/')) return path.posix.normalize(remotePath);
    return path.posix.normalize(path.posix.join(this.config?.remotePath || '', remotePath));
  }

  async connect(forceReconnect = false) {
    if (forceReconnect) await this.disconnect();
    if (this.client && this.connected) return this.client;

    const config = await this._loadConfig();
    const client = new SftpClient();

    client.on('error', (error) => this._log(`Error: ${error.message}`));
    client.on('close', () => { this._log('Close'); this.connected = false; });
    client.on('end', () => { this._log('End'); this.connected = false; });

    await client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: config.readyTimeout || 60000,
      keepaliveInterval: config.keepaliveInterval || 15000,
      keepaliveCountMax: config.keepaliveCountMax || 10
    });

    this.client = client;
    this.connected = true;
    return client;
  }

  async disconnect() {
    if (!this.client) return;
    try {
      await this.client.end();
    } catch (error) {
      this._log(`Disconnect: ${error.message}`);
    } finally {
      this.client = null;
      this.connected = false;
    }
  }

  async listFiles(directory) {
    return this._withRetry(`list ${directory}`, async (client) => {
      const resolved = this._resolvePath(directory);
      const entries = await client.list(resolved);
      return entries
        .filter((entry) => entry?.name && entry.name !== '.' && entry.name !== '..' && entry.type !== 'd')
        .map((entry) => ({
          name: entry.name,
          path: path.posix.join(resolved, entry.name),
          sizeBytes: Number(entry.size || 0)
        }));
    });
  }

  async downloadFile(remotePath) {
    return this._withRetry(`get ${remotePath}`, (client) => client.get(this._resolvePath(remotePath)));
  }

  async moveFile(from, to) {
    return this._withRetry(`move ${from} -> ${to}`, async (client) => {
      const resolvedFrom = this._resolvePath(from);
      const resolvedTo = this._resolvePath(to);
      if (resolvedFrom === resolvedTo) return;

      const exists = await client.exists(resolvedFrom);
      if (!exists || exists === 'd') throw new Error(`Source not found: ${resolvedFrom}`);

      await this._ensureDir(client, path.posix.dirname(resolvedTo));

      const targetExists = await client.exists(resolvedTo);
      if (targetExists && targetExists !== 'd') await client.delete(resolvedTo);

      await client.rename(resolvedFrom, resolvedTo);
    });
  }

  async uploadFile(remotePath, buffer) {
    return this._withRetry(`upload ${remotePath}`, async (client) => {
      const resolved = this._resolvePath(remotePath);
      await this._ensureDir(client, path.posix.dirname(resolved));
      await client.put(buffer, resolved);
    });
  }

  async deleteFile(remotePath) {
    return this._withRetry(`delete ${remotePath}`, async (client) => {
      const resolved = this._resolvePath(remotePath);
      const exists = await client.exists(resolved);
      if (exists && exists !== 'd') await client.delete(resolved);
    });
  }

  isTransientError(error) { return this._isRetryable(error); }

  async _ensureDir(client, directory) {
    if (!directory || directory === '.' || directory === '/') return;
    const exists = await client.exists(directory);
    if (!exists) await client.mkdir(directory, true);
    else if (exists !== 'd') throw new Error(`Remote path is not a directory: ${directory}`);
  }

  async _withRetry(label, operation) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        const client = await this.connect(attempt > 1);
        return await operation(client);
      } catch (error) {
        lastError = error;
        this.connected = false;
        await this.disconnect();
        this._log(`${label} failed attempt ${attempt}/${this.maxRetries}: ${error.message}`);
        if (!this._isRetryable(error) || attempt === this.maxRetries) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
    throw lastError;
  }

  _isRetryable(error) {
    const message = String(error?.message || '').toLowerCase();
    return [
      'no response from server', 'timed out', 'timeout', 'econnreset', 'connection lost',
      'end event', 'connect', 'failure', 'socket closed', 'before handshake'
    ].some((token) => message.includes(token));
  }
}

module.exports = SftpService;
