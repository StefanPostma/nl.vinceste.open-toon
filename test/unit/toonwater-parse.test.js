'use strict';

/*
 * parseWater (FR-58): the answer of /water.html in, capability values out. The add-on writes litres; the items are
 * m3 with three decimals, except the flow, which is litres per minute as it comes. Every member counts on its own,
 * and whatever is not a usable number is left out. Fixtures are derived from docs/sdlc/03-reuse-inventory.md
 * section 5 and not captured on a Toon (HW-02).
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const toonwater = require('../../lib/features/toonwater');
const { toonPayload } = require('../helpers/fixtures');

const parseWater = toonwater.pollGroups[0].parse;
const answer = (water) => ({ result: 'ok', water });

describe('FR-58 AC1: litres become m3 with three decimals, the flow stays as delivered', () => {
  test('value 12345 is 12.345 m3 today, total likewise, flow unscaled', () => {
    assert.deepEqual(parseWater(answer({ flow: 4, value: 12345, total: 7350214 })), {
      values: { measure_water: 4, 'meter_water.today': 12.345, 'meter_water.total': 7350.214 },
      notes: [],
    });
  });

  test('the fixture of the add-on from version 1.1.16 on; avgValue is ignored (AC4)', () => {
    assert.deepEqual(parseWater(toonPayload('water-ok')).values, { measure_water: 0, 'meter_water.today': 0.137, 'meter_water.total': 7350.214 });
    assert.equal(Object.values(parseWater(answer({ flow: 1, avgValue: 200 })).values).includes(200), false);
  });

  test('litres are rounded to whole litres before the division: no floating-point dust', () => {
    assert.equal(parseWater(answer({ value: 1 })).values['meter_water.today'], 0.001);
    assert.equal(parseWater(answer({ value: 3 })).values['meter_water.today'], 0.003);
    assert.equal(parseWater(answer({ total: 7350214.4 })).values['meter_water.total'], 7350.214);
    assert.equal(String(parseWater(answer({ total: 7 })).values['meter_water.total']), '0.007');
  });

  test('numbers that arrive as plain decimal strings count too', () => {
    assert.deepEqual(parseWater(answer({ flow: '4', value: '137' })).values, { measure_water: 4, 'meter_water.today': 0.137 });
  });
});

describe('[fixes BD-3] FR-58 AC2: every member counts on its own', () => {
  test('a payload without total (an add-on before 1.1.16) updates the flow and today, and leaves the total alone', () => {
    assert.deepEqual(parseWater(toonPayload('water-no-total')), {
      values: { measure_water: 0, 'meter_water.today': 1.668 },
      notes: [],
    });
    assert.equal(Object.hasOwn(parseWater(toonPayload('water-no-total')).values, 'meter_water.total'), false, 'no NaN, no undefined, no entry');
  });

  test('any one member alone is enough', () => {
    assert.deepEqual(parseWater(answer({ flow: 3 })).values, { measure_water: 3 });
    assert.deepEqual(parseWater(answer({ value: 10 })).values, { 'meter_water.today': 0.01 });
    assert.deepEqual(parseWater(answer({ total: 10 })).values, { 'meter_water.total': 0.01 });
    assert.deepEqual(parseWater(answer({})).values, {}, 'a water object without members is an answer without values, not a failure');
    assert.equal(parseWater(answer({})).unusable, undefined);
  });
});

describe('FR-58 AC3: negative, null, text and lists are left out; nothing throws', () => {
  [-1, -0.5, null, 'abc', '', 'NaN', [], {}, true, Infinity, NaN, '1e3', undefined].forEach((raw) => {
    test(`${JSON.stringify(raw) ?? 'undefined'} in any member produces no value`, () => {
      assert.deepEqual(parseWater(answer({ flow: raw, value: raw, total: raw })).values, {});
    });
  });

  test('a bad member does not spoil the good ones next to it', () => {
    assert.deepEqual(parseWater(answer({ flow: 'abc', value: 137, total: -3 })).values, { 'meter_water.today': 0.137 });
  });

  test('zero is a value: no flow, nothing used today', () => {
    assert.deepEqual(parseWater(answer({ flow: 0, value: 0 })).values, { measure_water: 0, 'meter_water.today': 0 });
  });
});

describe('FR-55 AC6 / ADR-0003: answers that are not the add-on\'s are unusable, never an exception', () => {
  test('result other than ok, a missing or non-object water member: unexpected', () => {
    [
      {}, { result: 'error' }, { result: 'ok' }, { result: 'ok', water: null }, { result: 'ok', water: 'wet' }, { result: 'ok', water: [] },
      { result: 'ok ', water: {} }, { water: { flow: 1 } }, toonPayload('hostile-water-array'), toonPayload('water-html'),
      toonPayload('junk-empty-object'), toonPayload('junk-result-error'), null, undefined, 'text', 12, [], [{ water: {} }],
    ].forEach((payload) => {
      const parsed = parseWater(payload);
      assert.equal(parsed.unusable, 'unexpected', JSON.stringify(payload));
      assert.deepEqual(parsed.values, {});
      assert.equal(parsed.notes.length, 1);
    });
  });

  test('the flat answer of the sensor module (waterflow, waterquantity) is unexpected, with the hint that this is not the Toon\'s address', () => {
    const parsed = parseWater(toonPayload('water-esp-flat'));

    assert.equal(parsed.unusable, 'sensor_module');
    assert.deepEqual(parsed.values, {});
    assert.match(parsed.notes[0], /sensor module/);
    assert.equal(parseWater({ waterflow: '0.0' }).unusable, 'sensor_module', 'either member is enough');
    assert.equal(parseWater({ result: 'ok', water: {}, waterquantity: '5' }).unusable, 'sensor_module', 'also next to the add-on members');
  });

  test('hostile shapes: own properties named like methods or the prototype change nothing', () => {
    assert.equal(parseWater(JSON.parse('{"__proto__": {"polluted": 1}}')).unusable, 'unexpected');
    assert.equal({}.polluted, undefined);
    assert.equal(parseWater({ result: 'ok', water: { hasOwnProperty: 1, flow: 2 } }).values.measure_water, 2);
    assert.equal(parseWater(JSON.parse('{"result":"ok","water":{"__proto__":{"flow":9}}}')).values.measure_water, undefined);
  });
});

describe('the feature of the registry (ADR-0006)', () => {
  test('legacyIf: any of the three water items keeps the feature on; the hot water flag and everything else does not', () => {
    const { legacyIf } = toonwater;

    ['measure_water', 'meter_water.today', 'meter_water.total'].forEach((id) => assert.equal(legacyIf(['measure_power', id]), true, id));
    assert.equal(legacyIf(['alarm_water.hotwater', 'measure_power', 'meter_water']), false);
    assert.equal(legacyIf([]), false);
  });

  test('the poll group asks for /water.html, holds back after 404 and after other failures, and reports every answer', () => {
    const [group] = toonwater.pollGroups;

    assert.deepEqual(group.endpoint, { path: '/water.html' });
    assert.equal(group.critical, false);
    assert.equal(group.report, true);
    assert.deepEqual(group.absentOn404, { backoffMs: 15 * 60e3 });
    assert.deepEqual([group.failBackoffMs, group.failEscalateAfter, group.escalatedBackoffMs], [5 * 60e3, 3, 15 * 60e3]);
    assert.equal(toonwater.probeBudgetMs, 3000);
    assert.equal(toonwater.hintAfter404Ms, 24 * 3600e3);
    assert.equal(toonwater.warnWhenMigrationDecided, false);
  });

  test('the feature object is frozen all the way down, so no device can change it for another', () => {
    assert.equal(Object.isFrozen(toonwater), true);
    assert.equal(Object.isFrozen(toonwater.pollGroups[0]), true);
    assert.equal(Object.isFrozen(toonwater.pollGroups[0].absentOn404), true);
    assert.equal(Object.isFrozen(toonwater.texts.status), true);
    assert.equal(Object.isFrozen(toonwater.capabilities), true);
  });

  test('the rule for the water trigger hands the card the flow, nothing else', () => {
    const [rule] = toonwater.rules;

    assert.deepEqual(rule.caps, ['measure_water']);
    assert.equal(rule.card, 'measure_water_changed');
    assert.deepEqual(rule.tokens((id) => ({ measure_water: 7 })[id]), { measure_water: 7 });
  });
});
