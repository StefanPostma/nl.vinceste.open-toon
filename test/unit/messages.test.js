'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KINDS, ToonError, toUserMessage, addressMessage, KIND_KEYS, ADDRESS_KEYS,
} = require('../../lib/toon/errors');
const { REASONS } = require('../../lib/toon/address');
const { createWorld } = require('../helpers/fake-homey/world');
const { readJson } = require('../helpers/paths');

const locales = { en: readJson('locales/en.json'), nl: readJson('locales/nl.json') };
const manifest = readJson('app.json');

const lookup = (language, key) => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), locales[language]);
const homeyFor = (language) => createWorld({ language }).homey;

/** Capability ids that must never show up in a sentence for a user (NFR-16 AC1). */
const capabilityIds = [...new Set([
  ...Object.keys(manifest.capabilities || {}),
  ...manifest.drivers.flatMap((driver) => [...(driver.capabilities || []), ...Object.keys(driver.capabilitiesOptions || {})]),
  'measure_water', 'meter_water.today', 'meter_water.total', 'burner_state', 'measure_power.export',
])];
const INTERNALS = ['fetch', 'undici', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'AbortError', 'TypeError', 'SyntaxError', 'stack', 'undefined', 'null', 'NaN', '[object', 'ToonError', 'JSON'];

const everyMessage = (language) => {
  const homey = homeyFor(language);
  const errors = KINDS.map((kind) => new ToonError(kind, kind === 'http' ? { status: 503 } : {}));
  return [
    ...errors.map((error) => [`kind ${error.kind}`, toUserMessage(homey, error)]),
    ...REASONS.map((reason) => [`address ${reason}`, addressMessage(homey, reason)]),
    ['an unknown error', toUserMessage(homey, new Error('boom'))],
  ];
};

describe('NFR-16 AC1: every ToonError kind and address problem has a message in en and nl', () => {
  test('KIND_KEYS has one key for every kind of ToonError, and no other', () => {
    assert.deepEqual(Object.keys(KIND_KEYS).sort(), [...KINDS].sort());
  });

  test('ADDRESS_KEYS has one key for every reason of normalizeAddress, and no other', () => {
    assert.deepEqual(Object.keys(ADDRESS_KEYS).sort(), [...REASONS].sort());
  });

  test('every key of both tables exists in locales/en.json and locales/nl.json as a non-empty text', () => {
    const keys = [...Object.values(KIND_KEYS), ...Object.values(ADDRESS_KEYS), 'error.unknown'];

    ['en', 'nl'].forEach((language) => {
      keys.forEach((key) => {
        const text = lookup(language, key);
        assert.equal(typeof text, 'string', `${language}:${key}`);
        assert.notEqual(text.trim(), '', `${language}:${key}`);
      });
    });
  });

  test('the error block has the same keys and the same tokens in en and nl, plus the keys of the plan', () => {
    const en = locales.en.error;
    const nl = locales.nl.error;
    const planned = ['timeout', 'network', 'http', 'bad_body', 'toon_error', 'aborted', 'address_https', 'address_ipv6', 'not_toon', 'vacation_readonly'];
    const tokens = (text) => (text.match(/__\w+__/g) || []).sort();

    assert.deepEqual(Object.keys(en).sort(), Object.keys(nl).sort());
    planned.forEach((key) => assert.ok(Object.hasOwn(en, key), key));
    Object.keys(en).forEach((key) => assert.deepEqual(tokens(en[key]), tokens(nl[key]), key));
    assert.deepEqual(tokens(en.http), ['__status__']);
  });
});

describe('NFR-16 AC1: the messages are plain words without internals', () => {
  ['en', 'nl'].forEach((language) => {
    test(`${language}: no message names a library, an error code, a capability id or a token`, () => {
      everyMessage(language).forEach(([what, message]) => {
        INTERNALS.forEach((word) => assert.equal(message.includes(word), false, `${language} ${what} contains ${word}: ${message}`));
        capabilityIds.forEach((id) => assert.equal(message.includes(id), false, `${language} ${what} contains ${id}`));
        assert.doesNotMatch(message, /__\w+__/, `${language} ${what} has an unreplaced token`);
        assert.doesNotMatch(message, /\n|\sat \S+\(/, `${language} ${what} looks like a stack trace`);
      });
    });

    test(`${language}: every message is a sentence that ends with a full stop`, () => {
      everyMessage(language).forEach(([what, message]) => assert.match(message, /^[A-Z].*\.$/, `${language} ${what}: ${message}`));
    });
  });

  test('the two languages say different things (a copied English text would pass the key checks)', () => {
    const english = everyMessage('en').map(([, message]) => message);
    const dutch = everyMessage('nl').map(([, message]) => message);

    english.forEach((message, index) => assert.notEqual(message, dutch[index], message));
  });

  test('the messages that name the next step do so: address and network problems say where to look', () => {
    const [en, nl] = [homeyFor('en'), homeyFor('nl')];

    assert.match(toUserMessage(en, new ToonError('network')), /IP address/);
    assert.match(toUserMessage(nl, new ToonError('network')), /IP-adres/);
    assert.match(addressMessage(en, 'invalid'), /for example 192\.168\.1\.50/);
    assert.match(addressMessage(nl, 'ipv6'), /IPv4-adres/);
  });
});

describe('toUserMessage', () => {
  const en = homeyFor('en');

  test('each kind picks its own text, except the three that mean "an answer this app cannot use"', () => {
    const texts = Object.fromEntries(KINDS.map((kind) => [kind, toUserMessage(en, new ToonError(kind, kind === 'http' ? { status: 500 } : {}))]));

    assert.equal(texts.redirect, texts.bad_body);
    assert.equal(texts.too_large, texts.bad_body);
    assert.equal(new Set(Object.values(texts)).size, KINDS.length - 2);
  });

  test('an HTTP error names its status, in both languages', () => {
    assert.match(toUserMessage(en, new ToonError('http', { status: 503 })), /\(code 503\)/);
    assert.match(toUserMessage(homeyFor('nl'), new ToonError('http', { status: 404 })), /\(code 404\)/);
  });

  test('an HTTP error without a usable status still reads well', () => {
    [undefined, NaN, 'abc', null, {}, 4.5].forEach((status) => {
      const error = new ToonError('http');
      error.status = status;

      assert.match(toUserMessage(en, error), /\(code \?\)/, String(status));
    });
  });

  test('a ToonError carrying a library error shows nothing of it', () => {
    const cause = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
    const message = toUserMessage(en, new ToonError('network', { cause }));

    assert.equal(message, toUserMessage(en, new ToonError('network')));
    assert.doesNotMatch(message, /fetch|ECONNRESET/);
  });

  test('anything that is not a ToonError gets the generic text and never throws', () => {
    const generic = toUserMessage(en, new ToonError('config'));
    const plain = [new Error('SECRET boom'), new TypeError('x'), 'text', 42, null, undefined, {}, { kind: 'timeout' }, { kind: 'http', status: 500 }, [], Symbol('s')];

    plain.forEach((error) => {
      const message = toUserMessage(en, error);

      assert.equal(message, locales.en.error.unknown, String(error));
      assert.notEqual(message, generic);
      assert.equal(message.includes('SECRET'), false);
    });
  });

  test('a kind that is not in the table cannot be built, so a forged one falls back to the generic text', () => {
    const forged = Object.assign(new ToonError('timeout'), { kind: '__proto__' });
    const fromPrototype = Object.assign(new ToonError('timeout'), { kind: 'toString' });

    assert.equal(toUserMessage(en, forged), locales.en.error.unknown);
    assert.equal(toUserMessage(en, fromPrototype), locales.en.error.unknown);
  });
});

describe('FR-03 AC2: addresses that are refused say why', () => {
  const en = homeyFor('en');

  test('each reason has its own text', () => {
    const texts = REASONS.map((reason) => addressMessage(en, reason));

    assert.equal(new Set(texts).size, REASONS.length);
    assert.match(addressMessage(en, 'https'), /https:\/\//);
    assert.match(addressMessage(en, 'ipv6'), /IPv6/);
  });

  test('an unknown reason is read as an invalid address', () => {
    ['other', '', undefined, null, 5, {}, '__proto__'].forEach((reason) => {
      assert.equal(addressMessage(en, reason), addressMessage(en, 'invalid'), String(reason));
    });
  });
});
