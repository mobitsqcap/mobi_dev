'use strict';

const { getDestination } = require('@sap-cloud-sdk/connectivity');

function normalizeRemotePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '/') return '/';
  return raw.replace(/\/+$/, '');
}

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^sftp:\/\//i, '')
    .replace(/\/+$/, '');
}

async function getSFTPDestination() {
  const destination = await getDestination({ destinationName: 'SFTP_MOBI' });
  if (!destination) throw new Error('Destination SFTP_MOBI not found');

  const properties = destination.originalProperties || {};
  const config = {
    host: normalizeHost(properties.sftpHost || properties.URL || properties.url || destination.url),
    port: Number(properties.sftpPort || 22),
    username: properties.sftpUser || destination.username,
    password: properties.sftpPassword || destination.password,
    remotePath: normalizeRemotePath(properties.remotePath),
    readyTimeout: Number(properties.sftpReadyTimeout || 60000),
    keepaliveInterval: Number(properties.sftpKeepaliveInterval || 15000),
    keepaliveCountMax: Number(properties.sftpKeepaliveCountMax || 10)
  };

  const missing = ['host', 'username', 'password'].filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`Destination SFTP_MOBI missing properties: ${missing.join(', ')}`);
  }
  return config;
}

module.exports = { getSFTPDestination };
