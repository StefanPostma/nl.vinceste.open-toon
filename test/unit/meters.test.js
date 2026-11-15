'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { METER_RULES, discoverMeters } = require('../../lib/toon/parse');
const { toonPayload } = require('../helpers/fixtures');

const keys = (result) => Object.fromEntries(Object.entries(result.nodes).map(([role, found]) => [role, found && found.key]));

describe('FR-22 AC1: the legacy dev_2.x keys are found first', () => {
  test('the dev_2 two-tariff fixture: gas 2.1, peak 2.4, off-peak 2.6, single 2.2', () => {
    const result = discoverMeters(toonPayload('getdevices-dev2-two-tariff'));

    assert.deepEqual(keys(result), {
      gas: 'dev_2.1', peak: 'dev_2.4', offPeak: 'dev_2.6', single: 'dev_2.2',
    });
    assert.deepEqual(result.notes, []);
  });

  test('a legacy key wins over a node of another generation with the same role', () => {
    const payload = toonPayload('getdevices-dev3');
    payload['dev_2.4'] = { type: 'whatever', CurrentElectricityQuantity: '1' };

    assert.equal(keys(discoverMeters(payload)).peak, 'dev_2.4');
    assert.deepEqual(discoverMeters(payload).notes, [], 'no ambiguity: the legacy key decides');
  });

  test('a legacy node that exists but has no reading is still the node of its role', () => {
    const payload = toonPayload('getdevices-dev3');
    payload['dev_2.4'] = { type: 'elec_delivered_nt' };

    assert.equal(keys(discoverMeters(payload)).peak, 'dev_2.4');
  });
});

describe('FR-22 AC1: type strings fill the gaps [HW-02]', () => {
  test('the dev_3 fixture is resolved by METER_RULES', () => {
    const result = discoverMeters(toonPayload('getdevices-dev3'));

    assert.deepEqual(keys(result), {
      gas: 'dev_3.1', peak: 'dev_3.3', offPeak: 'dev_3.5', single: 'dev_3.2',
    });
  });

  test('a missing legacy node is replaced by the node of the right type', () => {
    const result = discoverMeters(toonPayload('getdevices-missing-node'));

    assert.equal(result.nodes.peak.key, 'dev_2.3', 'dev_2.4 is absent, dev_2.3 has the delivered-nt type');
    assert.equal(result.nodes.gas.key, 'dev_2.1');
  });

  test('every role of the table has a legacy key, a field and unambiguous types', () => {
    const seen = new Map();
    Object.entries(METER_RULES).forEach(([role, rule]) => {
      assert.match(rule.legacyKey, /^dev_2\.\d$/, role);
      assert.match(rule.field, /^Current(?:Gas|Electricity)Quantity$/, role);
      assert.ok(rule.types.length >= 1, role);
      rule.types.forEach((type) => {
        assert.equal(seen.has(type), false, `${type} is claimed by ${seen.get(type)} and ${role}`);
        seen.set(type, role);
      });
    });
    assert.deepEqual(Object.keys(METER_RULES), ['gas', 'peak', 'offPeak', 'single']);
  });

  test('the received (feed-in) counters belong to no role', () => {
    const payload = {
      'dev_3.4': { type: 'elec_received_nt', CurrentElectricityQuantity: '1' },
      'dev_3.6': { type: 'elec_received_lt', CurrentElectricityQuantity: '1' },
    };

    assert.deepEqual(keys(discoverMeters(payload)), {
      gas: null, peak: null, offPeak: null, single: null,
    });
  });
});

describe('FR-22 AC2: two candidates for one role are not guessed', () => {
  test('both are named in one note, the role has no node, the other roles are unaffected', () => {
    const payload = toonPayload('getdevices-dev3');
    payload['dev_6.1'] = { type: 'gas', CurrentGasQuantity: '5' };
    const result = discoverMeters(payload);

    assert.equal(result.nodes.gas, null);
    assert.equal(result.nodes.peak.key, 'dev_3.3');
    assert.deepEqual(result.notes, ['meter nodes are ambiguous, nothing is read for them (gas: dev_3.1, dev_6.1)']);
  });

  test('the note never repeats text of the answer except node keys', () => {
    const payload = {
      'dev_3.1': { type: 'gas' },
      'dev_4.1': { type: 'gas' },
      [`dev_${'x'.repeat(40)}`]: { type: 'gas' },
      'not a node key': { type: 'gas' },
    };
    const { notes } = discoverMeters(payload);

    assert.equal(notes.length, 1);
    assert.match(notes[0], /gas: dev_3\.1, dev_4\.1\)$/);
  });
});

describe('FR-24 AC1: hostile and garbled answers', () => {
  const empty = {
    gas: null, peak: null, offPeak: null, single: null,
  };

  test('{"dev_2.4": null}, {"dev_2.4": {"hasOwnProperty": 1}} and the __proto__ shape do not throw', () => {
    assert.deepEqual(keys(discoverMeters(toonPayload('hostile-null-node'))), empty);
    assert.deepEqual(keys(discoverMeters(toonPayload('hostile-own-property'))), { ...empty, peak: 'dev_2.4' });
    assert.deepEqual(keys(discoverMeters(toonPayload('hostile-proto'))), empty);
    assert.equal(({}).polluted, undefined);
  });

  test('anything that is not an object finds nothing', () => {
    [null, undefined, '', 'abc', 42, [], [{ type: 'gas' }], true].forEach((payload) => {
      assert.deepEqual(discoverMeters(payload), { nodes: empty, notes: [] });
    });
  });

  test('a node that is not an object, or whose type is not a string, is not a candidate', () => {
    const payload = {
      'dev_3.1': 'gas', 'dev_3.2': ['elec'], 'dev_3.3': { type: { toString: 'elec_delivered_nt' } }, 'dev_3.5': { type: null },
    };

    assert.deepEqual(keys(discoverMeters(payload)), empty);
  });

  test('an empty device list means no meter adapter', () => {
    assert.deepEqual(discoverMeters(toonPayload('getdevices-empty')), { nodes: empty, notes: [] });
  });

  test('the answer is not modified and nothing of it is shared with the table', () => {
    const payload = toonPayload('getdevices-dev3');
    const copy = JSON.parse(JSON.stringify(payload));
    discoverMeters(payload);

    assert.deepEqual(payload, copy);
    assert.throws(() => {
      METER_RULES.gas.types.push('x');
    }, TypeError);
  });
});
