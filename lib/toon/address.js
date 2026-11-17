'use strict';

/*
 * The address a user types for a Toon (FR-03, NFR-04 AC1). normalizeAddress never throws; it accepts only
 * "host" or "host:port" for an IPv4 address or a DNS name, so nothing but a host can reach a URL.
 */

const REASONS = Object.freeze(['invalid', 'https', 'ipv6']);

const MAX_LENGTH = 253;
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const IPV6_CHARACTERS = /^[0-9a-f:.]+$/i;
const HOST_AND_PORT = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const OCTET = /^(?:0|[1-9]\d{0,2})$/;
const DIGITS_AND_DOTS = /^[0-9.]+$/;
const NUMBER_LABEL = /^(?:\d+|0x[0-9a-f]*)$/i;

const fail = (reason) => ({ ok: false, reason });

/** A dotted quad without leading zeros (which URL parsers read as octal). 0.x.x.x is not a host. */
function isIpv4(host) {
  const parts = host.split('.');
  return parts.length === 4
    && parts.every((part) => OCTET.test(part) && Number(part) <= 255)
    && Number(parts[0]) !== 0;
}

/** A DNS name: labels of letters, digits and hyphens; a last label that is a number (12, 0x32) would read as an IP number. */
function isHostname(host) {
  const labels = host.split('.');
  return labels.every((label) => label.length <= 63 && LABEL.test(label)) && !NUMBER_LABEL.test(labels[labels.length - 1]);
}

function looksLikeIpv6(text) {
  return /[[\]]/.test(text) || (IPV6_CHARACTERS.test(text) && text.split(':').length > 2);
}

/**
 * @param {unknown} input what the user typed or what a setting holds
 * @returns {{ok: true, host: string} | {ok: false, reason: 'invalid' | 'https' | 'ipv6'}}
 */
function normalizeAddress(input) {
  if (typeof input !== 'string') return fail('invalid');
  let text = input.trim();
  if (text === '' || text.length > MAX_LENGTH) return fail('invalid');

  const scheme = SCHEME.exec(text);
  if (scheme) {
    const protocol = scheme[1].toLowerCase();
    if (protocol === 'https') return fail('https');
    if (protocol !== 'http') return fail('invalid');
    text = text.slice(scheme[0].length);
  }
  if (text.endsWith('/')) text = text.slice(0, -1);
  if (looksLikeIpv6(text)) return fail('ipv6');

  const match = HOST_AND_PORT.exec(text);
  if (!match) return fail('invalid');
  const host = match[1].toLowerCase();
  const port = match[2] === undefined ? undefined : Number(match[2]);
  if (port !== undefined && (port < 1 || port > 65535)) return fail('invalid');
  if (!(DIGITS_AND_DOTS.test(host) ? isIpv4(host) : isHostname(host))) return fail('invalid');

  return { ok: true, host: port === undefined ? host : `${host}:${port}` };
}

module.exports = { REASONS, normalizeAddress };
