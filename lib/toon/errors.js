'use strict';

/*
 * How a request to the Toon can fail, and the words a user reads about it (NFR-16). The error carries a kind and
 * nothing a user could read: toUserMessage turns every kind, and addressMessage every address problem, into one
 * localized sentence. The texts live in locales/en.json and locales/nl.json; they name the cause in plain words
 * and what to do next. Nothing of the error itself (library names, error codes, stack traces, response bodies)
 * is ever put into a message, and no response body ever ends up in an error (NFR-04 AC5).
 */

const KINDS = Object.freeze([
  'timeout', // no complete answer within the request budget
  'network', // refused, unreachable, reset, DNS failure
  'http', // the Toon answered with a non-2xx status
  'redirect', // the Toon answered with a 3xx; redirects are never followed
  'too_large', // the answer is longer than the size cap
  'bad_body', // the answer is not a JSON object
  'toon_error', // the answer is {"result":"error"}
  'aborted', // the caller cancelled: device removed or address changed
  'config', // the address or a value is invalid; no request was sent
]);

class ToonError extends Error {
  /**
   * @param {string} kind one of KINDS
   * @param {{status?: number, cause?: unknown}} [details] `status` for http and redirect, `cause` for the underlying error
   */
  constructor(kind, { status, cause } = {}) {
    if (!KINDS.includes(kind)) throw new TypeError(`Unknown ToonError kind: ${String(kind)}`);
    super(status === undefined ? kind : `${kind} ${status}`, cause === undefined ? undefined : { cause });
    this.name = 'ToonError';
    this.kind = kind;
    this.status = status;
  }
}

/** True for an HTTP 404 from the Toon (a missing add-on file is not an error). */
function isNotFound(error) {
  return error instanceof ToonError && error.kind === 'http' && error.status === 404;
}

/** True when the request was cancelled by the caller. */
function isAborted(error) {
  return error instanceof ToonError && error.kind === 'aborted';
}

const KIND_KEYS = Object.freeze({
  timeout: 'error.timeout',
  network: 'error.network',
  http: 'error.http',
  redirect: 'error.bad_body',
  too_large: 'error.bad_body',
  bad_body: 'error.bad_body',
  toon_error: 'error.toon_error',
  aborted: 'error.aborted',
  config: 'error.invalid_value',
});

const ADDRESS_KEYS = Object.freeze({
  invalid: 'error.address_invalid',
  https: 'error.address_https',
  ipv6: 'error.address_ipv6',
});

const UNKNOWN_KEY = 'error.unknown';

/**
 * @param {{__: (key: string, tokens?: object) => string}} homey the Homey instance of the app, driver or device
 * @param {unknown} error whatever was caught; only a ToonError gets a specific message
 * @returns {string} localized text
 */
function toUserMessage(homey, error) {
  const kind = error instanceof ToonError ? error.kind : undefined;
  if (kind === 'http') {
    return homey.__(KIND_KEYS.http, { status: Number.isInteger(error.status) ? String(error.status) : '?' });
  }
  return homey.__(Object.hasOwn(KIND_KEYS, kind) ? KIND_KEYS[kind] : UNKNOWN_KEY);
}

/**
 * @param {{__: (key: string, tokens?: object) => string}} homey
 * @param {string} reason the `reason` of a failed normalizeAddress
 * @returns {string} localized text
 */
function addressMessage(homey, reason) {
  return homey.__(Object.hasOwn(ADDRESS_KEYS, reason) ? ADDRESS_KEYS[reason] : ADDRESS_KEYS.invalid);
}

module.exports = {
  KINDS, ToonError, isNotFound, isAborted, KIND_KEYS, ADDRESS_KEYS, toUserMessage, addressMessage,
};
