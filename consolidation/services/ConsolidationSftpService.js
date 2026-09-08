'use strict';

/**
 * Lightweight SFTP client used by the consolidation module to publish the
 * consolidation error report (Requirement #5). Reuses the same SFTP_MOBI
 * destination as ingestion.
 */

const path = require('path');
const SftpClient = require('ssh2-sftp-client');

const { getSFTPDestination } = require('../utils/SftpDestination');

class ConsolidationSftpService {
  constructor() {
    this.config = null;
    this.maxRetries = Number(process.env.SFTP_MAX_RETRIES || 5);
    this.client = null;
    this.connected = false;
  }

  async _loadConfig() {
    if (!this.config) this.config = await getSFTPDestination();
    return this.config;
  }

  _resolvePath(remotePath) {
    if (!remotePath) return this.config?.remotePath || '/';
    if (remotePath.startsWith('/')) return path.posix.normalize(remotePath);
    return path.posix.normalize(path.posix.join(this.config?.remotePath || '', remotePath));
  }

  async resolvePath(remotePath) {
    await this._loadConfig();
    return this._resolvePath(remotePath);
  }

  async connect(forceReconnect = false) {
    if (forceReconnect) await this.disconnect();
    if (this.client && this.connected) return this.client;

    const config = await this._loadConfig();
    const client = new SftpClient();

    client.on('error', () => { /* handled by operation retry */ });
    client.on('close', () => { this.connected = false; });
    client.on('end', () => { this.connected = false; });

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
    try { await this.client.end(); }
    catch (_) { /* ignore */ }
    finally {
      this.client = null;
      this.connected = false;
    }
  }

  async uploadFile(remotePath, buffer) {
    return this._withRetry(`upload ${remotePath}`, async (client) => {
      const resolved = this._resolvePath(remotePath);
      await this._ensureDir(client, path.posix.dirname(resolved));
      await client.put(buffer, resolved);
      return resolved;
    });
  }

  async exists(remotePath) {
    return this._withRetry(`exists ${remotePath}`, async (client) =>
      client.exists(this._resolvePath(remotePath))
    );
  }

  async renameFile(from, to) {
    return this._withRetry(`rename ${from} -> ${to}`, async (client) => {
      const resolvedFrom = this._resolvePath(from);
      const resolvedTo = this._resolvePath(to);
      const fromExists = await client.exists(resolvedFrom);
      if (!fromExists || fromExists === 'd') return false;
      const toExists = await client.exists(resolvedTo);
      if (toExists && toExists !== 'd') await client.delete(resolvedTo);
      await client.rename(resolvedFrom, resolvedTo);
      return true;
    });
  }

  async deleteFile(remotePath) {
    return this._withRetry(`delete ${remotePath}`, async (client) => {
      const resolved = this._resolvePath(remotePath);
      const exists = await client.exists(resolved);
      if (exists && exists !== 'd') await client.delete(resolved);
    });
  }

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

module.exports = ConsolidationSftpService;
