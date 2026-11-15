'use strict';

/*
 * toon-probe: a read-only look at one Toon, for the hardware tests of docs/sdlc/10-hardware-test-plan.md.
 *
 *   node scripts/toon-probe.js <address of the Toon> [options]
 *
 * It asks the Toon the questions that Open-Toon asks (and nothing else), one request at a time, leaves out or masks
 * everything that could be personal, and writes one timestamped JSON file that can be pasted into a GitHub issue or a
 * chat. Needs Node.js 22 or newer and no packages: the file can be copied on its own to any computer on the same network
 * as the Toon. It is a development tool and not part of the Homey app (.homeyignore leaves scripts/ out of the package).
 *
 * Read only, by construction: the request table below is the only thing that is ever sent, every request is a GET, the
 * address is the only input that reaches a URL (as a host and a port, never as a path) and redirects are not followed.
 *
 * What is masked (the file says so under "redaction"): the address of the Toon; every text that is not a plain number,
 * "NaN", true/false or the value of a "type"/"result" field; every value whose field name says it is an identity (name,
 * uuid, serial, mac, ssid, password, e-mail, address, host, ...); anything that looks like an IP address, a MAC address,
 * a UUID, an e-mail address or a ".local" host name, also inside field names. Numbers (temperatures, meter readings, flows)
 * are kept on purpose: they are what is compared with the Toon's screen. The tool cannot know what is personal in a field
 * it has never seen, so read the file before you share it.
 */

const fs = require('fs');
const path = require('path');
const { setTimeout: pause } = require('timers/promises');

const SCHEMA = 'open-toon-probe/1';
const REDACTED = '<redacted>';

/** The only requests that are ever sent. Same paths and queries as lib/toon/commands.js and lib/features/toonwater.js (a test compares them). */
const ENDPOINTS = Object.freeze([
  Object.freeze({
    id: 'thermostat', label: 'Thermostat status', path: '/happ_thermstat', query: Object.freeze({ action: 'getThermostatInfo' }),
  }),
  Object.freeze({
    id: 'power', label: 'Current power', path: '/happ_pwrusage', query: Object.freeze({ action: 'GetCurrentUsage' }),
  }),
  Object.freeze({
    id: 'meters', label: 'Meter totals', path: '/hdrv_zwave', query: Object.freeze({ action: 'getDevices.json' }),
  }),
  Object.freeze({
    id: 'water', label: 'ToonWater page (only exists when the add-on is installed)', path: '/water.html', query: Object.freeze({}), optional: true,
  }),
]);

/** The fields of the answers whose values are the open questions of the test plan; the watch mode follows their changes. */
const WATCHED_FIELDS = Object.freeze({
  thermostat: ['activeState', 'programState', 'burnerInfo', 'errorFound', 'currentSetpoint'],
});
/** Numbers whose lowest and highest value are kept in the watch mode: [endpoint, path in the answer]. */
const WATCHED_RANGES = Object.freeze([
  ['thermostat', ['currentTemp']],
  ['thermostat', ['currentModulationLevel']],
  ['power', ['powerUsage', 'value']],
  ['power', ['powerProduction', 'value']],
  ['water', ['water', 'flow']],
]);
/** The meter keys that the app reads first on every Toon (lib/toon/parse.js METER_RULES; a test compares them). */
const LEGACY_METER_KEYS = Object.freeze(['dev_2.1', 'dev_2.4', 'dev_2.6', 'dev_2.2']);
const QUANTITY_FIELDS = Object.freeze(['CurrentGasQuantity', 'CurrentElectricityQuantity']);

const LIMITS = Object.freeze({
  timeoutMs: { min: 500, max: 30000, default: 5000 },
  samples: { min: 1, max: 5000, default: 1 },
  everySeconds: { min: 10, max: 3600, default: 30 },
  labelLength: 80,
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 12,
  maxNodes: 5000,
  maxArray: 200,
  maxKeyLength: 60,
  maxSnippet: 120,
  maxTransitions: 200,
});

const REQUEST_HEADERS = Object.freeze({ 'Accept-Encoding': 'identity', Connection: 'close' });

const USAGE = `Usage: node scripts/toon-probe.js <address of the Toon> [options]

Reads the Toon (GET only), masks personal data and writes toon-probe-<UTC time>.json.

  <address>           IPv4 address or host name of the Toon, for example 192.168.1.50 (a port is allowed: 192.168.1.50:8080)
  --out <path>        a folder or a file name for the result (default: the current folder)
  --stdout            print the result on the screen and write no file
  --label <text>      what the Toon is doing right now, for example "heating on" (max ${LIMITS.labelLength} characters, no names)
  --no-water          do not ask for the ToonWater page
  --timeout <ms>      time allowed for one request, ${LIMITS.timeoutMs.min} to ${LIMITS.timeoutMs.max} (default ${LIMITS.timeoutMs.default})
  --samples <n>       ask n times, ${LIMITS.samples.min} to ${LIMITS.samples.max} (default 1); n > 1 keeps a summary of latencies and of the
                      fields that change (activeState, programState, burnerInfo, ...). Ctrl+C stops early and still writes the file
  --every <seconds>   wait between two samples, ${LIMITS.everySeconds.min} to ${LIMITS.everySeconds.max} (default ${LIMITS.everySeconds.default})
  --help              this text

Exit code: 0 when the thermostat answered, 1 when it did not, 2 for a wrong command line or a file that cannot be written.
`;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/* ---------------------------------------------------------------------------------------------------------------------
 * The command line
 * ------------------------------------------------------------------------------------------------------------------- */

/**
 * A host or host:port as typed by a person: "192.168.1.50", " http://192.168.1.50/ ", "toon.local:8080".
 * Only a host and a port can come out, so nothing typed can become a path, a query or credentials.
 * @param {unknown} input
 * @returns {{ok: true, host: string, port: number | null} | {ok: false, message: string}}
 */
function normalizeAddress(input) {
  const invalid = { ok: false, message: 'This is not a valid address. Use the IPv4 address of the Toon, for example 192.168.1.50.' };
  if (typeof input !== 'string') return invalid;
  let text = input.trim();
  if (/^https:\/\//i.test(text)) return { ok: false, message: 'The Toon speaks plain http. Remove https:// from the address.' };
  text = text.replace(/^http:\/\//i, '');
  if (text.endsWith('/')) text = text.slice(0, -1);
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::(\d{1,5}))?$/.exec(text);
  if (!match) return invalid;
  const host = match[1].toLowerCase();
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) return invalid;
  if (/^[0-9.]+$/.test(host)) {
    const parts = host.split('.');
    const octets = parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
    if (!octets || Number(parts[0]) === 0) return invalid;
  } else if (host.split('.').some((label) => label.length === 0 || label.length > 63) || /^(?:\d+|0x[0-9a-f]*)$/i.test(host.split('.').pop())) {
    return invalid;
  }
  return { ok: true, host, port };
}

function integerOption(name, text, limits) {
  if (!/^\d+$/.test(text)) return { error: `${name} must be a whole number from ${limits.min} to ${limits.max}.` };
  const number = Number(text);
  if (number < limits.min || number > limits.max) return { error: `${name} must be a whole number from ${limits.min} to ${limits.max}.` };
  return { value: number };
}

/**
 * @param {string[]} argv the arguments after `node scripts/toon-probe.js`
 * @returns {{help: true} | {error: string} | {options: object}}
 */
function parseArgs(argv) {
  const options = {
    address: null,
    out: null,
    stdout: false,
    label: null,
    water: true,
    timeoutMs: LIMITS.timeoutMs.default,
    samples: LIMITS.samples.default,
    everySeconds: LIMITS.everySeconds.default,
  };
  const positional = [];
  const withValue = new Set(['--out', '--label', '--timeout', '--samples', '--every']);

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--stdout') options.stdout = true;
    else if (argument === '--no-water') options.water = false;
    else if (argument.startsWith('--')) {
      const equals = argument.indexOf('=');
      const name = equals === -1 ? argument : argument.slice(0, equals);
      if (!withValue.has(name)) return { error: `Unknown option ${name}. Use --help to see the options.` };
      let value = equals === -1 ? argv[index + 1] : argument.slice(equals + 1);
      if (equals === -1) index++;
      if (value === undefined) return { error: `${name} needs a value.` };
      if (name === '--out') options.out = value;
      else if (name === '--label') {
        value = value.trim();
        if (value.length > LIMITS.labelLength) return { error: `--label is at most ${LIMITS.labelLength} characters.` };
        options.label = value === '' ? null : value;
      } else {
        const key = { '--timeout': 'timeoutMs', '--samples': 'samples', '--every': 'everySeconds' }[name];
        const parsed = integerOption(name, value, LIMITS[key]);
        if (parsed.error) return { error: parsed.error };
        options[key] = parsed.value;
      }
    } else positional.push(argument);
  }

  if (positional.length !== 1) return { error: positional.length === 0 ? 'Give the address of the Toon.' : 'Give exactly one address.' };
  const target = normalizeAddress(positional[0]);
  if (!target.ok) return { error: target.message };
  options.address = target;
  return { options };
}

/* ---------------------------------------------------------------------------------------------------------------------
 * Masking
 * ------------------------------------------------------------------------------------------------------------------- */

/*
 * Lookarounds instead of \b: an underscore is a word character, so \b would not see the UUID in a field name such as
 * "dev_3f2a9c1e-...", and field names are exactly where a Toon puts the id of a node.
 */
const PATTERNS = Object.freeze([
  [/(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi, '<uuid>'],
  [/(?<![0-9a-f])(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}(?![0-9a-f])/gi, '<mac>'],
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '<email>'],
  [/(?<![0-9])(?:\d{1,3}\.){3}\d{1,3}(?![0-9])/g, '<ip>'],
  [/(?<![0-9a-f:])(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}(?![0-9a-f:])/gi, '<ip>'],
  [/(?<![a-z0-9-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|lan|home|internal|localdomain|home\.arpa)(?![a-z0-9-])/gi, '<host>'],
]);

/** Words in a field name (split at case changes and separators) that say the value identifies someone or something. */
const DENIED_WORDS = new Set([
  'name', 'uuid', 'guid', 'serial', 'serialnumber', 'sn', 'mac', 'macaddress', 'ssid', 'bssid', 'password', 'passwd', 'pwd', 'pass',
  'passphrase', 'token', 'secret', 'key', 'apikey', 'email', 'mail', 'user', 'username', 'login', 'account', 'customer', 'agreement',
  'contract', 'owner', 'address', 'ip', 'ipaddress', 'host', 'hostname', 'url', 'uri', 'location', 'lat', 'latitude', 'lon', 'lng',
  'longitude', 'city', 'street', 'zip', 'postcode', 'postalcode', 'phone', 'imei', 'imsi', 'iccid',
]);
/** Fields whose text value is a short product or status word that the maintainer needs (the kind of a meter node, the result). */
const KEPT_TEXT_FIELDS = new Set(['type', 'result', 'devicetype', 'devtype']);
const NUMBER_TEXT = /^[+-]?\d+(?:\.\d+)?$/;
const PLAIN_WORD_TEXT = /^(?:nan|true|false)$/i;
const SHORT_TOKEN = /^[A-Za-z0-9_.-]{1,40}$/;

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const fieldWords = (name) => name
  .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[^A-Za-z0-9]+/)
  .filter(Boolean)
  .map((word) => word.toLowerCase());

/**
 * @param {{host: string, port: number | null}} target the Toon that is probed: its address is masked wherever it appears
 * @returns the masking functions and the counters that say what they did
 */
function createRedactor(target) {
  const own = target.port === null ? escapeForRegExp(target.host) : `${escapeForRegExp(target.host)}(?::${target.port})?`;
  const ownAddress = new RegExp(`(?<![0-9a-z.-])${own}(?![0-9a-z-])`, 'gi'); // not inside a longer number or name
  const counts = {
    textsMasked: 0, numbersMasked: 0, fieldNamesChanged: 0, subtreesMasked: 0, truncated: false,
  };
  let nodes = 0;

  /** Replaces what looks personal inside a text. @returns {{text: string, hits: number}} */
  function scrub(text) {
    let hits = 0;
    let result = text.replace(ownAddress, () => {
      hits++;
      return '<toon>';
    });
    PATTERNS.forEach(([pattern, replacement]) => {
      result = result.replace(pattern, () => {
        hits++;
        return replacement;
      });
    });
    return { text: result, hits };
  }

  const denied = (name) => name !== null && fieldWords(name).some((word) => DENIED_WORDS.has(word));

  function maskText(text, name) {
    if (denied(name)) {
      counts.textsMasked++;
      return REDACTED;
    }
    const trimmed = text.trim();
    const keep = scrub(text).hits === 0
      && (NUMBER_TEXT.test(trimmed) || PLAIN_WORD_TEXT.test(trimmed) || (name !== null && KEPT_TEXT_FIELDS.has(name.toLowerCase()) && SHORT_TOKEN.test(trimmed)));
    if (keep) return text;
    counts.textsMasked++;
    return REDACTED;
  }

  function maskName(name) {
    const short = name.length > LIMITS.maxKeyLength ? `${name.slice(0, LIMITS.maxKeyLength)}...` : name;
    const { text } = scrub(short);
    if (text !== name) counts.fieldNamesChanged++;
    return text;
  }

  function walk(value, name, depth) {
    nodes++;
    if (nodes > LIMITS.maxNodes || depth > LIMITS.maxDepth) {
      counts.truncated = true;
      return '<truncated>';
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (Number.isFinite(value) && !denied(name)) return value;
      counts.numbersMasked++;
      return REDACTED;
    }
    if (typeof value === 'string') return maskText(value, name);
    if (Array.isArray(value)) {
      if (denied(name)) {
        counts.subtreesMasked++;
        return REDACTED;
      }
      if (value.length > LIMITS.maxArray) counts.truncated = true;
      return value.slice(0, LIMITS.maxArray).map((item) => walk(item, name, depth + 1));
    }
    if (isRecord(value)) {
      if (denied(name)) {
        counts.subtreesMasked++;
        return REDACTED;
      }
      const result = Object.create(null); // a parsed "__proto__" key is an ordinary key here
      Object.keys(value).forEach((key) => {
        const base = maskName(key);
        let safe = base;
        for (let copy = 2; Object.hasOwn(result, safe); copy++) safe = `${base}#${copy}`;
        result[safe] = walk(value[key], key, depth + 1);
      });
      return result;
    }
    counts.subtreesMasked++;
    return REDACTED;
  }

  return {
    counts,
    scrub,
    /** @returns {unknown} the value with personal data left out, keys and numbers intact */
    json: (value) => walk(value, null, 0),
    /** A short piece of a text that is not JSON, for an error page: one line, scrubbed, bounded. */
    snippet(text) {
      const flat = text.slice(0, 400).replace(/\s+/g, ' ').trim();
      if (!/^[\x20-\x7e]*$/.test(flat)) return '<not text>';
      return scrub(flat).text.slice(0, LIMITS.maxSnippet);
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------------
 * Asking the Toon
 * ------------------------------------------------------------------------------------------------------------------- */

async function readBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > LIMITS.maxBytes) {
    await response.body?.cancel().catch(() => {});
    return { tooLarge: true, bytes: declared };
  }
  if (!response.body) return { text: '', bytes: 0 };
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > LIMITS.maxBytes) return { tooLarge: true, bytes }; // leaving the loop cancels the stream
    text += decoder.decode(chunk, { stream: true });
  }
  return { text: text + decoder.decode(), bytes };
}

/** Sets outcome, bodyKind and body of a 2xx answer. */
function classifyBody(entry, text, redactor) {
  const trimmed = text.trim();
  if (trimmed === '') {
    entry.outcome = 'bad_body';
    entry.bodyKind = 'empty';
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    entry.outcome = 'bad_body';
    entry.bodyKind = trimmed.startsWith('<') ? 'html' : 'text';
    return;
  }
  if (!isRecord(parsed)) {
    entry.outcome = 'bad_body';
    entry.bodyKind = 'json-not-an-object';
    return;
  }
  entry.bodyKind = 'json';
  entry.outcome = Object.hasOwn(parsed, 'result') && parsed.result === 'error' ? 'toon_error' : 'ok';
  entry.body = redactor.json(parsed);
}

/**
 * One GET. Never throws: whatever goes wrong is the `outcome` (the words of ToonError in lib/toon/errors.js:
 * ok, timeout, network, http, redirect, too_large, bad_body, toon_error, aborted).
 * @returns {Promise<object>} the entry of the file; its `body` is already masked, the raw answer is not kept anywhere
 */
async function ask(endpoint, context) {
  const {
    base, fetch: fetchIt, timeoutMs, signal, redactor,
  } = context;
  const entry = {
    id: endpoint.id,
    label: endpoint.label,
    request: { method: 'GET', path: endpoint.path, query: { ...endpoint.query } },
    outcome: null,
    status: null,
    ms: null,
    contentType: null,
    bytes: null,
    bodyKind: null,
  };
  const url = new URL(base);
  url.pathname = endpoint.path;
  Object.entries(endpoint.query).forEach(([name, value]) => url.searchParams.set(name, value));

  const timeout = AbortSignal.timeout(timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchIt(url.href, {
      method: 'GET', redirect: 'manual', headers: REQUEST_HEADERS, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    entry.status = response.status;
    entry.contentType = response.headers.get('content-type');
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      entry.outcome = 'redirect';
    } else if (!response.ok) {
      const { text = '', bytes } = await readBody(response);
      entry.outcome = 'http';
      entry.bytes = bytes;
      entry.snippet = redactor.snippet(text);
    } else {
      const { text, bytes, tooLarge } = await readBody(response);
      entry.bytes = bytes;
      if (tooLarge) entry.outcome = 'too_large';
      else classifyBody(entry, text, redactor);
    }
  } catch (error) {
    if (timeout.aborted) entry.outcome = 'timeout';
    else if (signal && signal.aborted) entry.outcome = 'aborted';
    else {
      entry.outcome = 'network';
      const code = error && error.cause && typeof error.cause.code === 'string' ? error.cause.code : null;
      if (code && /^[A-Z_]{3,30}$/.test(code)) entry.errorCode = code;
    }
  }
  entry.ms = Math.round(performance.now() - started);
  return entry;
}

/** What the water page says about the add-on, in the words of the ToonWater status of the app. */
function waterVerdict(entry) {
  if (entry.outcome === 'ok') {
    const { body } = entry;
    return body.result === 'ok' && isRecord(body.water) ? 'detected' : 'unexpected';
  }
  if (entry.outcome === 'http' && entry.status === 404) return 'not_found';
  if (entry.outcome === 'timeout' || entry.outcome === 'network') return 'unreachable';
  return 'unexpected';
}

const quantityKind = (value) => {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && NUMBER_TEXT.test(value.trim())) return 'number';
  if (typeof value === 'string' && /^nan$/i.test(value.trim())) return 'nan';
  return 'other';
};

/** From the (already masked) meter answer: which nodes exist, of what type, and what their quantity fields hold. */
function describeMeters(body) {
  if (!isRecord(body)) return null;
  const nodes = Object.keys(body).filter((key) => isRecord(body[key])).map((key) => {
    const node = body[key];
    const quantities = {};
    QUANTITY_FIELDS.filter((name) => Object.hasOwn(node, name)).forEach((name) => {
      quantities[name] = quantityKind(node[name]);
    });
    return {
      key,
      type: typeof node.type === 'string' && node.type !== REDACTED ? node.type : null,
      fields: Object.keys(node).sort(),
      quantities,
    };
  });
  return {
    nodeCount: nodes.length,
    legacyKeysPresent: Object.fromEntries(LEGACY_METER_KEYS.map((key) => [key, Object.hasOwn(body, key)])),
    nodes,
  };
}

/** One round of questions, in order and one at a time; a Toon that does not answer the first one is not asked the rest. */
async function askAll(context) {
  const results = [];
  let skipped = null;
  for (const endpoint of ENDPOINTS) {
    if (endpoint.optional && !context.water) continue;
    if (skipped) {
      results.push({
        id: endpoint.id, label: endpoint.label, outcome: 'skipped', note: skipped,
      });
      continue;
    }
    const entry = await ask(endpoint, context);
    results.push(entry);
    if (endpoint.id === 'thermostat' && (entry.outcome === 'timeout' || entry.outcome === 'network')) {
      skipped = 'not asked: the Toon did not answer the first question';
    }
    if (context.signal && context.signal.aborted) break;
  }
  return results;
}

/* ---------------------------------------------------------------------------------------------------------------------
 * The watch mode (--samples n)
 * ------------------------------------------------------------------------------------------------------------------- */

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function pick(value, steps) {
  return steps.reduce((current, step) => (isRecord(current) && Object.hasOwn(current, step) ? current[step] : undefined), value);
}

function createWatch(clockMs) {
  const endpoints = new Map();
  const fields = new Map();
  const ranges = new Map();
  const transitions = [];
  let samples = 0;

  const slot = (map, key, make) => {
    if (!map.has(key)) map.set(key, make());
    return map.get(key);
  };

  return {
    /** @param {object[]} results the entries of one round @param {number} at epoch milliseconds */
    add(results, at) {
      samples++;
      const when = new Date(at).toISOString();
      results.forEach((entry) => {
        const stats = slot(endpoints, entry.id, () => ({ outcomes: {}, ms: [], last: null }));
        const outcome = entry.outcome === 'http' ? `http ${entry.status}` : entry.outcome;
        stats.outcomes[outcome] = (stats.outcomes[outcome] || 0) + 1;
        if (typeof entry.ms === 'number' && entry.status !== null) stats.ms.push(entry.ms);
        if (stats.last !== null && stats.last !== outcome && entry.outcome !== 'skipped' && transitions.length < LIMITS.maxTransitions) {
          transitions.push({
            at: when, endpoint: entry.id, from: stats.last, to: outcome,
          });
        }
        if (entry.outcome !== 'skipped') stats.last = outcome;

        (WATCHED_FIELDS[entry.id] || []).forEach((name) => {
          if (!entry.body || !Object.hasOwn(entry.body, name)) return;
          const record = slot(fields, `${entry.id}.${name}`, () => ({ seen: {}, changes: [], last: undefined }));
          const value = String(entry.body[name]);
          record.seen[value] = (record.seen[value] || 0) + 1;
          if (record.last !== value && record.changes.length < LIMITS.maxTransitions) record.changes.push({ at: when, value });
          record.last = value;
        });
      });
      WATCHED_RANGES.forEach(([id, steps]) => {
        const entry = results.find((result) => result.id === id);
        const number = entry && entry.body ? pick(entry.body, steps) : undefined;
        if (typeof number !== 'number') return;
        const range = slot(ranges, `${id}.${steps.join('.')}`, () => ({ min: number, max: number, nonZeroSamples: 0 }));
        range.min = Math.min(range.min, number);
        range.max = Math.max(range.max, number);
        if (number !== 0) range.nonZeroSamples++;
      });
    },
    summary({ startedAt, interrupted }) {
      const latency = {};
      endpoints.forEach((stats, id) => {
        const sorted = [...stats.ms].sort((a, b) => a - b);
        latency[id] = {
          outcomes: stats.outcomes,
          answered: sorted.length,
          minMs: sorted.length ? sorted[0] : null,
          medianMs: sorted.length ? percentile(sorted, 0.5) : null,
          p95Ms: sorted.length ? percentile(sorted, 0.95) : null,
          maxMs: sorted.length ? sorted[sorted.length - 1] : null,
        };
      });
      return {
        samplesTaken: samples,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(clockMs()).toISOString(),
        interrupted,
        latency,
        fieldChanges: Object.fromEntries([...fields].map(([name, record]) => [name, { seen: record.seen, changes: record.changes }])),
        ranges: Object.fromEntries(ranges),
        outcomeChanges: transitions,
      };
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------------
 * The whole run
 * ------------------------------------------------------------------------------------------------------------------- */

const stamp = (at) => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function describeEntry(entry) {
  if (entry.outcome === 'skipped') return 'not asked';
  const result = entry.outcome === 'http' ? `HTTP ${entry.status}` : entry.outcome;
  return `${result.padEnd(9)} ${entry.ms === null ? '' : `${entry.ms} ms`}`.trimEnd();
}

/** Creates the folder when it is missing and refuses to overwrite a file; the file is private to the user. */
function writeNewFile(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: 'wx', mode: 0o600 });
}

function chooseFile(options, cwd, at) {
  const name = `toon-probe-${stamp(at)}.json`;
  if (options.out === null) return path.join(cwd, name);
  const target = path.resolve(cwd, options.out);
  const isFolder = /[\\/]$/.test(options.out) || (fs.existsSync(target) && fs.statSync(target).isDirectory());
  return isFolder ? path.join(target, name) : target;
}

/**
 * @param {string[]} argv
 * @param {object} [io] everything that touches the outside, so that a test can stand in for it
 * @returns {Promise<{exitCode: number, dump?: object, file?: string}>}
 */
async function run(argv, io = {}) {
  const write = io.write || ((text) => process.stdout.write(text));
  const warn = io.warn || ((text) => process.stderr.write(text));
  const clockMs = io.now || Date.now;
  const sleep = io.sleep || ((ms, signal) => pause(ms, undefined, { signal }).catch(() => {}));
  const cwd = io.cwd || process.cwd();

  const parsed = parseArgs(argv);
  if (parsed.help) {
    write(USAGE);
    return { exitCode: 0 };
  }
  if (parsed.error) {
    warn(`${parsed.error}\n\n${USAGE}`);
    return { exitCode: 2 };
  }

  const { options } = parsed;
  const { host, port } = options.address;
  const redactor = createRedactor({ host, port });
  const base = `http://${host}${port === null ? '' : `:${port}`}`;
  const context = {
    base, fetch: io.fetch || fetch, timeoutMs: options.timeoutMs, signal: io.signal, redactor, water: options.water,
  };
  const startedAt = clockMs();
  const watch = options.samples > 1 ? createWatch(clockMs) : null;

  let first = null;
  let last = null;
  let taken = 0;
  let thermostatAnswered = false;
  while (taken < options.samples && !(context.signal && context.signal.aborted)) {
    const roundStart = clockMs();
    const results = await askAll(context);
    taken++;
    first = first || results;
    last = results;
    thermostatAnswered = thermostatAnswered || results.some((entry) => entry.id === 'thermostat' && entry.outcome === 'ok');
    if (watch) watch.add(results, roundStart);
    warn(`[${taken}/${options.samples}] ${results.map((entry) => `${entry.id} ${describeEntry(entry)}`).join(', ')}\n`);
    if (taken < options.samples) await sleep(Math.max(0, options.everySeconds * 1000 - (clockMs() - roundStart)), context.signal);
  }

  const interrupted = taken < options.samples;
  const water = first && first.find((entry) => entry.id === 'water');
  const meters = first && first.find((entry) => entry.id === 'meters');
  const dump = {
    schema: SCHEMA,
    tool: { name: 'toon-probe', node: process.version },
    createdAt: new Date(startedAt).toISOString(),
    label: options.label === null ? null : redactor.scrub(options.label).text,
    readOnly: true,
    target: { host: '<redacted>', port: port === null ? 80 : port },
    settings: {
      timeoutMs: options.timeoutMs, samples: options.samples, everySeconds: options.samples > 1 ? options.everySeconds : null, water: options.water,
    },
    redaction: {
      rules: [
        'The address of the Toon is not stored.',
        'Texts are kept only when they are a plain number, NaN, true/false, or the value of a "type" or "result" field; every other text is replaced by <redacted>.',
        'Values of fields whose name says name, uuid, serial, mac, ssid, password, e-mail, address, host and similar are replaced.',
        'IP addresses, MAC addresses, UUIDs, e-mail addresses and .local host names are replaced everywhere, also in field names.',
        'Numbers (temperatures, meter readings, flows) are kept: they are what is compared with the screen of the Toon.',
      ],
      counts: redactor.counts,
    },
    summary: {
      thermostatAnswered,
      outcomes: Object.fromEntries((first || []).map((entry) => [entry.id, entry.outcome === 'http' ? `http ${entry.status}` : entry.outcome])),
      toonWater: water ? waterVerdict(water) : 'not asked',
    },
    endpoints: first || [],
    metersAnalysis: meters && meters.body ? describeMeters(meters.body) : null,
    watch: watch ? { ...watch.summary({ startedAt, interrupted }), last: last || [] } : null,
    next: 'Read this file before you share it. It is meant to be pasted into a GitHub issue or a chat.',
  };

  const text = `${JSON.stringify(dump, null, 2)}\n`;
  if (options.stdout) {
    write(text);
    return { exitCode: thermostatAnswered ? 0 : 1, dump };
  }

  const file = chooseFile(options, cwd, startedAt);
  try {
    (io.writeFile || writeNewFile)(file, text);
  } catch (error) {
    const why = error && error.code === 'EEXIST' ? 'it already exists' : (error && error.code) || 'it cannot be written';
    warn(`The result was not written to ${file}: ${why}. Use --out to choose another name, or --stdout.\n`);
    return { exitCode: 2, dump };
  }
  write(`Open-Toon probe (read only)\n${(first || []).map((entry) => `  ${entry.id.padEnd(11)}${describeEntry(entry)}`).join('\n')}\n`
    + `${interrupted ? `Stopped after ${taken} of ${options.samples} samples.\n` : ''}`
    + `Written: ${file}\nRead the file before you share it: it is plain text. Nothing was changed on the Toon.\n`);
  return { exitCode: thermostatAnswered ? 0 : 1, dump, file };
}

if (require.main === module) {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    process.stderr.write(`This tool needs Node.js 22 or newer; this is Node.js ${process.versions.node}.\n`);
    process.exitCode = 2;
  } else {
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    run(process.argv.slice(2), { signal: stop.signal }).then(({ exitCode }) => {
      process.exitCode = exitCode;
    }, (error) => {
      process.stderr.write(`The probe stopped unexpectedly: ${error && error.message ? error.message : 'unknown error'}\n`);
      process.exitCode = 2;
    });
  }
}

module.exports = {
  ENDPOINTS, LEGACY_METER_KEYS, LIMITS, REDACTED, SCHEMA, USAGE, createRedactor, createWatch, describeMeters, normalizeAddress, parseArgs, run, waterVerdict,
};
