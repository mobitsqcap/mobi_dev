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
  getTrace()   { return [...this.traceLogs]; }
  _log(m)      { this.traceLogs.push(`[SftpService] ${m}`); }

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

  /** Ensure a remote directory exists (recursive mkdir). Safe if it already exists. */
  async ensureDir(remotePath) {
    return this._withRetry(`mkdir ${remotePath}`, async (c) => {
      const dir = this._resolvePath(remotePath);
      await this._ensureDir(c, dir);
      return dir;
    });
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
    client.on('error', (err) => this._log(`Error: ${err.message}`));
    client.on('close', () => { this._log('Close'); this.connected = false; });
    client.on('end',   () => { this._log('End'); this.connected = false; });

    await client.connect({
      host: config.host, port: config.port, username: config.username, password: config.password,
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
    catch (e) { this._log(`Disconnect: ${e.message}`); }
    finally { this.client = null; this.connected = false; }
  }

  async listFiles(directory) {
    return this._withRetry(`list ${directory}`, async (c) => {
      const resolved = this._resolvePath(directory);
      const entries = await c.list(resolved);
      return entries
        .filter((e) => e && e.name && e.name !== '.' && e.name !== '..' && e.type !== 'd')
        .map((e) => ({ name: e.name, path: `${resolved}/${e.name}`, sizeBytes: Number(e.size || 0) }));
    });
  }

  async downloadFile(remotePath) {
    return this._withRetry(`get ${remotePath}`, (c) => c.get(this._resolvePath(remotePath)));
  }

  async moveFile(from, to) {
    return this._withRetry(`move ${from} -> ${to}`, async (c) => {
      const rFrom = this._resolvePath(from);
      const rTo   = this._resolvePath(to);
      if (rFrom === rTo) return;

      const exists = await c.exists(rFrom);
      if (!exists || exists === 'd') throw new Error(`Source not found: ${rFrom}`);

      await this._ensureDir(c, path.posix.dirname(rTo));
      if (await c.exists(rTo)) {
        if ((await c.exists(rTo)) !== 'd') await c.delete(rTo);
      }
      await c.rename(rFrom, rTo);
    });
  }

  async uploadFile(remotePath, buffer) {
    return this._withRetry(`upload ${remotePath}`, async (c) => {
      const resolved = this._resolvePath(remotePath);
      await this._ensureDir(c, path.posix.dirname(resolved));
      await c.put(buffer, resolved);
    });
  }

  async deleteFile(remotePath) {
    return this._withRetry(`delete ${remotePath}`, async (c) => {
      const resolved = this._resolvePath(remotePath);
      const exists = await c.exists(resolved);
      if (!exists || exists === 'd') return;
      await c.delete(resolved);
    });
  }

  isTransientError(error) { return this._isRetryable(error); }

  async _ensureDir(c, dir) {
    if (!dir || dir === '.' || dir === '/') return;
    try { await c.mkdir(dir, true); }
    catch (e) {
      const m = String(e.message || '').toLowerCase();
      if (!m.includes('failure') && !m.includes('exists')) throw e;
    }
  }

  async _withRetry(label, operation) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation(await this.connect(attempt > 1));
      } catch (error) {
        lastError = error;
        this.connected = false;
        await this.disconnect();
        this._log(`${label} failed attempt ${attempt}/${this.maxRetries}: ${error.message}`);
        if (!this._isRetryable(error) || attempt === this.maxRetries) throw error;
        await this._sleep(attempt * 1500);
      }
    }
    throw lastError;
  }

  _isRetryable(error) {
    const m = String(error?.message || '').toLowerCase();
    return ['no response from server', 'timed out', 'timeout', 'econnreset', 'connection lost',
      'end event', 'connect', 'failure', 'socket closed', 'before handshake'].some((t) => m.includes(t));
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

module.exports = SftpService;
