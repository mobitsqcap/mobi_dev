'use strict';

const { getDestination } = require('@sap-cloud-sdk/connectivity');
const Constants = require('../constants/ReversalConstants');

class S4ReversalClient {
  constructor({ destinationName = Constants.DESTINATION_NAME } = {}) {
    this.destinationName = destinationName;
  }

  async getReversals(range) {
    const destination = await getDestination({ destinationName: this.destinationName });
    if (!destination?.url) {
      throw new Error(`Destination ${this.destinationName} has no URL`);
    }

    const reversals = [];
    let nextUrl = this._buildInitialUrl(destination.url, range);
    let page = 0;

    while (nextUrl) {
      page += 1;
      const payload = await this._getJson(nextUrl, destination);
      const rows = payload?.d?.results || payload?.value || payload?.d || [];
      if (!Array.isArray(rows)) {
        throw new Error(`Unexpected SAP reversal response on page ${page}`);
      }
      reversals.push(...rows);

      const next = payload?.d?.__next || payload?.['@odata.nextLink'] || payload?.d?.['@odata.nextLink'];
      nextUrl = next ? this._normalizeNextUrl(next, destination.url) : null;
    }
    const unique = new Map();
    for (const row of reversals) {
      const key = [row.CompanyCode, row.FiscalYear, row.AccountingDocument]
        .map((value) => String(value ?? '').trim())
        .join('|');
      if (key !== '||') unique.set(key, row);
    }
    return [...unique.values()];
  }

  _buildInitialUrl(destinationUrl, range) {
    const base = new URL(`${String(destinationUrl).replace(/\/+$/, '')}/`);
    const path = Constants.ENTITY_PATH.replace(/^\//, '');
    const url = new URL(path, base);

    const filter = [
      'IsReversal eq true',
      `LastChangeDate ge datetime'${range.fromLiteral}'`,
      `LastChangeDate lt datetime'${range.toLiteral}'`
    ].join(' and ');

    url.search = new URLSearchParams({
      '$format': 'json',
      '$filter': filter,
      '$orderby': 'LastChangeDate asc,CompanyCode asc,FiscalYear asc,AccountingDocument asc',
      '$top': String(Constants.PAGE_SIZE)
    }).toString();

    return url.toString();
  }

  _normalizeNextUrl(next, destinationUrl) {
    const nextUrl = new URL(next, destinationUrl);
    const destination = new URL(destinationUrl);
    nextUrl.protocol = destination.protocol;
    nextUrl.host = destination.host;
    return nextUrl.toString();
  }

  async _getJson(url, destination) {
    const headers = {
      Accept: 'application/json',
      'sap-language': 'EN'
    };

    const authToken = destination.authTokens?.[0];
    if (authToken?.value) {
      headers.Authorization = `${authToken.type || 'Bearer'} ${authToken.value}`;
    } else {
      const username = destination.username || destination.originalProperties?.User;
      const password = destination.password || destination.originalProperties?.Password;
      if (username && password) {
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }
    }

    const response = await fetch(url, { method: 'GET', headers });
    const body = await response.text();
    let payload;
    try {
      payload = body ? JSON.parse(body) : {};
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      const sapMessage = payload?.error?.message?.value || payload?.error?.message || body;
      throw new Error(`SAP reversal OData request failed (${response.status}): ${String(sapMessage).slice(0, 800)}`);
    }
    if (!payload) {
      throw new Error('SAP reversal OData response was not JSON. Check the destination URL and Accept header.');
    }
    return payload;
  }
}

module.exports = S4ReversalClient;
