'use strict';

/*
 * The only code that talks to a Toon (ADR-0003): one GET at a time through an injected `fetch`, with
 *  - the URL built from a validated host (never by concatenating user text), plain http only;
 *  - Connection: close and Accept-Encoding: identity [HW-H4], so no socket outlives its request;
 *  - redirects refused, the answer capped at maxBytes, the body released on every path that does not read it;
 *  - one timeout for the whole request on the injected timers, and the caller's signal wired through a listener
 *    that is removed again, so a long-lived signal collects nothing;
 *  - JSON.parse of the text (the Toon says text/javascript), no retries and no user-readable text.
 * Retry and back-off belong to the poller; the texts to errors.js.
 */

const { ToonError } = require('./errors');
const { normalizeAddress } = require('./address');

const REQUEST_HEADERS = Object.freeze({ 'Accept-Encoding': 'identity', Connection: 'close' });

/** Lets go of a body that will not be read, so the connection is released. */
async function discard(response) {
  try {
    if (response.body) await response.body.cancel();
  } catch {
    // the stream is already closed or broken: nothing is held any more
  }
}

function parseBody(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ToonError('bad_body'); // the SyntaxError would quote the answer
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ToonError('bad_body');
  if (Object.hasOwn(body, 'result') && body.result === 'error') throw new ToonError('toon_error');
  return body;
}

const isParameter = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

class ToonClient {
  /**
   * @param {object} options
   * @param {string} options.host a normalized address: "host" or "host:port"
   * @param {typeof fetch} options.fetch
   * @param {{setTimeout: Function, clearTimeout: Function}} options.timers plain functions that need no `this`
   *   (Homey's, bound); a fake clock drives them in tests
   * @param {number} [options.timeoutMs] budget for one request including its body
   * @param {number} [options.maxBytes] size cap of the answer
   */
  constructor({
    host, fetch, timers, timeoutMs = 5000, maxBytes = 2 * 1024 * 1024,
  }) {
    const address = normalizeAddress(host);
    this.host = address.ok ? address.host : null;
    this.fetch = fetch;
    this.arm = timers.setTimeout;
    this.disarm = timers.clearTimeout;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  /**
   * @param {{path: string, query?: Record<string, string | number>}} endpoint
   * @param {{signal?: AbortSignal}} [options] `signal` cancels the request (device removed, address changed)
   * @returns {Promise<object>} the parsed answer, an object
   * @throws {ToonError}
   */
  async get(endpoint, { signal } = {}) {
    const url = this._url(endpoint);
    if (signal && signal.aborted) throw new ToonError('aborted');

    const { arm, disarm } = this;
    const request = new AbortController();
    let stoppedBy = null;
    const stop = (kind) => {
      if (stoppedBy === null) {
        stoppedBy = kind;
        request.abort();
      }
    };
    const onAbort = () => stop('aborted');
    const timer = arm(() => stop('timeout'), this.timeoutMs);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      return await this._exchange(url, request.signal);
    } catch (error) {
      if (error instanceof ToonError) throw error;
      throw new ToonError(stoppedBy === null ? 'network' : stoppedBy, { cause: error });
    } finally {
      disarm(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  _url(endpoint) {
    const query = endpoint && endpoint.query ? Object.entries(endpoint.query) : [];
    const valid = this.host !== null && endpoint && typeof endpoint.path === 'string' && endpoint.path.startsWith('/')
      && query.every(([, value]) => isParameter(value));
    if (!valid) throw new ToonError('config');
    const url = new URL(`http://${this.host}`);
    url.pathname = endpoint.path;
    query.forEach(([name, value]) => url.searchParams.set(name, String(value)));
    return url;
  }

  async _exchange(url, signal) {
    const response = await this.fetch(url.href, {
      method: 'GET', redirect: 'manual', headers: REQUEST_HEADERS, signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await discard(response);
      throw new ToonError('redirect', { status: response.status });
    }
    if (!response.ok) {
      await discard(response);
      throw new ToonError('http', { status: response.status });
    }
    return parseBody(await this._read(response));
  }

  async _read(response) {
    if (Number(response.headers.get('content-length')) > this.maxBytes) {
      await discard(response);
      throw new ToonError('too_large');
    }
    if (!response.body) return '';
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > this.maxBytes) throw new ToonError('too_large'); // leaving the loop cancels the stream
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  }
}

/**
 * The timers of a Homey device or driver, the ones that Homey clears when it is torn down. `owner.homey` is read when a
 * timer is set, not here: a device has no `homey` yet while its constructor runs.
 * @param {{homey: {setTimeout: Function, clearTimeout: Function}}} owner
 * @returns {{setTimeout: Function, clearTimeout: Function}}
 */
const homeyTimers = (owner) => ({
  setTimeout: (callback, ms) => owner.homey.setTimeout(callback, ms),
  clearTimeout: (handle) => owner.homey.clearTimeout(handle),
});

module.exports = { ToonClient, homeyTimers };
