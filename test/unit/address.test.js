'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAddress, REASONS } = require('../../lib/toon/address');

const accepted = (host) => ({ ok: true, host });
const rejected = (reason) => ({ ok: false, reason });

describe('FR-03 AC1: addresses a user may type are normalised', () => {
  const table = [
    ['192.168.1.50', '192.168.1.50'],
    ['192.168.1.50:80', '192.168.1.50:80'],
    [' http://192.168.1.50/ ', '192.168.1.50'],
    ['toon.local', 'toon.local'],
    [' 192.168.1.50 ', '192.168.1.50'],
    ['HTTP://Toon.Local:8080/', 'toon.local:8080'],
    ['192.168.1.50:080', '192.168.1.50:80'],
    ['192.168.1.50:65535', '192.168.1.50:65535'],
    ['127.0.0.1:54321', '127.0.0.1:54321'],
    ['my-toon', 'my-toon'],
  ];

  table.forEach(([input, host]) => {
    test(`${JSON.stringify(input)} -> ${host}`, () => {
      assert.deepEqual(normalizeAddress(input), accepted(host));
    });
  });
});

describe('FR-03 AC2: everything else is rejected with a reason and never throws', () => {
  const invalid = [
    '0.0.0.0', '', '   ', '192.168.1.50/foo', '192.168.1.50?x=1', '192.168.1.50#frag', 'user@host', 'user:pw@192.168.1.50',
    'a b', '192.168.1.50:99999', ':99999', '192.168.1.50:0', '192.168.1.50:', '12', '999.1.1.1', '192.168.1', '192.168.001.050',
    '1.2.3.4.5', 'toon..local', '-toon.local', 'toon-.local', 'foo.123', '0x7f.0.0.1', 'ftp://192.168.1.50', 'http://', '/',
    '192.168.1.50//', '192.168.1.50\n/x', '192.168.1.50\\foo', 'toon.local.', `${'a'.repeat(64)}.local`, 'a'.repeat(300), '255.0.0.256',
  ];

  invalid.forEach((input) => {
    test(`${JSON.stringify(input.length > 40 ? `${input.slice(0, 40)}...` : input)} is invalid`, () => {
      assert.deepEqual(normalizeAddress(input), rejected('invalid'));
    });
  });

  test('values that are not strings are invalid and are never converted to text', () => {
    const exploding = {
      toString() {
        throw new Error('must not be called');
      },
    };
    const values = [null, undefined, 12, 0, NaN, true, {}, [], ['192.168.1.50'], exploding, Symbol('x'), () => '1.2.3.4'];

    values.forEach((value) => {
      assert.deepEqual(normalizeAddress(value), rejected('invalid'));
    });
  });
});

describe('FR-03 AC2: https and IPv6 have their own reasons', () => {
  test('https:// is refused as such, whatever follows', () => {
    ['https://1.2.3.4', 'HTTPS://toon.local', ' https://192.168.1.50:443/ ', 'https://[fe80::1]'].forEach((input) => {
      assert.deepEqual(normalizeAddress(input), rejected('https'), input);
    });
  });

  test('bracketed and bare IPv6 literals are refused as such', () => {
    ['[fe80::1]', 'fe80::1', '[fe80::1]:80', 'http://[::1]/', '::1', '2001:db8::8a2e:370:7334', '[::1'].forEach((input) => {
      assert.deepEqual(normalizeAddress(input), rejected('ipv6'), input);
    });
  });

  test('the three reasons are distinct and listed', () => {
    const reasons = ['https://1.2.3.4', '[fe80::1]', '12'].map((input) => normalizeAddress(input).reason);

    assert.deepEqual(reasons, ['https', 'ipv6', 'invalid']);
    assert.deepEqual([...REASONS].sort(), [...reasons].sort());
  });
});

describe('NFR-04 AC1: an accepted address can only ever be a host', () => {
  /** Small deterministic generator, so a failure can be reproduced. */
  function generator(seed) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  test('10,000 generated strings: none throws, and every accepted one builds a URL with that host and nothing else', () => {
    const random = generator(20261112);
    const alphabet = '0123456789abcxyz.:/[]@?#% -\\\n\t_,;"\'<>';
    let acceptedCount = 0;

    for (let index = 0; index < 10000; index++) {
      const length = Math.floor(random() * 24);
      const input = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
      const result = normalizeAddress(input);

      if (result.ok) {
        acceptedCount++;
        const url = new URL(`http://${result.host}`);
        assert.equal(url.pathname, '/', input);
        assert.equal(`${url.username}${url.password}${url.search}${url.hash}`, '', input);
        assert.match(result.host, /^[a-z0-9.-]+(?::\d{1,5})?$/, input);
      } else {
        assert.ok(REASONS.includes(result.reason), input);
      }
    }
    assert.ok(acceptedCount > 0, 'the generator must produce some valid addresses too');
  });

  test('numeric host spellings that a URL parser would turn into another address are refused', () => {
    ['3232235826', '0300.0250.01.062', '0xc0.0xa8.0x01.0x32', '192.168.1.0x32', '192.11010354'].forEach((input) => {
      assert.equal(normalizeAddress(input).ok, false, input);
    });
  });
});
