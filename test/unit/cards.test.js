'use strict';

/*
 * The small decisions of lib/flow/cards.js on their own: how an argument is read, and which rules a set of changes
 * fires. The cards against a device and a Toon are in test/scenario/flow-*.test.js.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { FEATURES } = require('../../lib/features');
const core = require('../../lib/features/core');
const { normalizeDropdown, normalizeResume, firing } = require('../../lib/flow/cards');

const everyFeature = () => true;
const cardsFired = (changes, isOn = everyFeature) => firing(changes, FEATURES, isOn).map((rule) => rule.card);
const change = (id, prev, next) => ({ id, prev, next });

describe('FR-77 / HW-10: a dropdown argument is a string or an object with an id', () => {
  test('normalizeDropdown', () => {
    assert.equal(normalizeDropdown('sleep'), 'sleep');
    assert.equal(normalizeDropdown({ id: 'sleep' }), 'sleep');
    assert.equal(normalizeDropdown({ id: 'sleep', title: 'Slapen', label: 'Slapen' }), 'sleep');
    assert.equal(normalizeDropdown(undefined), undefined);
    assert.equal(normalizeDropdown(null), null);
    assert.equal(normalizeDropdown({}), undefined);
  });

  test('FR-13 / ADR-0015: resume_program: unset means yes (the decision is in commands.scheme), the old boolean is read as it was meant, nonsense is left for the validation', () => {
    assert.equal(normalizeResume('yes'), 'yes');
    assert.equal(normalizeResume('no'), 'no');
    assert.equal(normalizeResume({ id: 'no' }), 'no');
    assert.equal(normalizeResume(true), 'yes');
    assert.equal(normalizeResume('true'), 'yes');
    assert.equal(normalizeResume(false), 'no');
    assert.equal(normalizeResume({ id: false }), 'no');
    assert.equal(normalizeResume(undefined), undefined);
    assert.equal(normalizeResume(null), null);
    assert.equal(normalizeResume('maybe'), 'maybe');
    assert.equal(normalizeResume(7), 7);
  });
});

describe('FR-70: which rules a set of changes fires', () => {
  test('AC4: the first value a capability ever got fires nothing, whether Homey says null or nothing', () => {
    assert.deepEqual(cardsFired([change('meter_gas', null, 5242.11)]), []);
    assert.deepEqual(cardsFired([change('meter_gas', undefined, 5242.11)]), []);
    assert.deepEqual(cardsFired([change('alarm_water.hotwater', null, false), change('burner_state', null, 'off')]), []);
  });

  test('AC1: a change fires its card, once, whatever the number of capabilities of the rule that changed', () => {
    assert.deepEqual(cardsFired([change('meter_gas', 5242, 5242.11)]), ['meter_gas_changed']);
    assert.deepEqual(cardsFired([change('meter_power.peak', 1, 2), change('meter_power.offPeak', 3, 4)]), ['meter_power_changed']);
    assert.deepEqual(cardsFired([change('meter_power.offPeak', 3, 4)]), ['meter_power_changed']);
    assert.deepEqual(cardsFired([change('meter_power.peak', null, 2), change('meter_power.offPeak', 3, 4)]), ['meter_power_changed'], 'the tariff that is new does not hide the one that changed');
    assert.deepEqual(cardsFired([change('meter_power.peak', null, 2), change('meter_power.offPeak', null, 4)]), []);
    assert.deepEqual(cardsFired([change('alarm_water.hotwater', false, true), change('burner_state', 'off', 'hot_water')]), ['alarm_water_changed', 'burner_state_changed_to']);
  });

  test('a change of a capability that no rule reads fires nothing', () => {
    assert.deepEqual(cardsFired([change('measure_temperature', 20, 20.5), change('measure_power', 1, 2), change('target_temperature', 18, 19)]), []);
  });

  test('ADR-0009 [HW-06]: temperature_state_changed is the rule that Homey fires itself, so the app does not', () => {
    assert.deepEqual(cardsFired([change('temperature_state', 'home', 'sleep')]), []);
    const asApp = FEATURES.map((feature) => (feature === core ? { ...feature, rules: feature.rules.map((rule) => ({ ...rule, source: 'app' })) } : feature));

    assert.deepEqual(firing([change('temperature_state', 'home', 'sleep')], asApp, everyFeature).map((rule) => rule.card), ['temperature_state_changed']);
  });

  test('FR-60: the rules of a feature that is off do not fire', () => {
    const waterOff = (feature) => feature.id !== 'toonwater';

    assert.deepEqual(cardsFired([change('measure_water', 1, 2)]), ['measure_water_changed']);
    assert.deepEqual(cardsFired([change('measure_water', 1, 2)], waterOff), []);
    assert.deepEqual(cardsFired([change('meter_gas', 1, 2), change('measure_water', 1, 2)], waterOff), ['meter_gas_changed']);
  });
});

describe('FR-70 AC5 / FR-32: the tokens and the state that the rules build', () => {
  const rule = (card) => FEATURES.flatMap((feature) => feature.rules || []).find((entry) => entry.card === card);
  const reading = (values) => (id) => (Object.hasOwn(values, id) ? values[id] : null);

  test('meter_power_changed: peak plus off-peak in kWh with three decimals; a tariff that the Toon does not report counts as nothing', () => {
    const { tokens } = rule('meter_power_changed');

    assert.deepEqual(tokens(reading({ 'meter_power.peak': 3718.492, 'meter_power.offPeak': 4120.771 })), { meter_power: 7839.263 });
    assert.deepEqual(tokens(reading({ 'meter_power.peak': 0.1, 'meter_power.offPeak': 0.2 })), { meter_power: 0.3 }, 'no floating-point dust');
    assert.deepEqual(tokens(reading({ 'meter_power.peak': 12.5 })), { meter_power: 12.5 });
    assert.deepEqual(tokens(reading({ 'meter_power.offPeak': 12.5 })), { meter_power: 12.5 });
  });

  test('the other tokens are the value of the capability under the name of the token, and the burner rule hands the state to the Flow', () => {
    assert.deepEqual(rule('meter_gas_changed').tokens(reading({ meter_gas: 5300.5 })), { meter_gas: 5300.5 });
    assert.deepEqual(rule('measure_water_changed').tokens(reading({ measure_water: 4 })), { measure_water: 4 });
    assert.deepEqual(rule('alarm_water_changed').tokens(reading({ 'alarm_water.hotwater': true })), { 'alarm_water.hotwater': true });
    assert.deepEqual(rule('burner_state_changed_to').tokens(reading({ burner_state: 'heating' })), { burner_state: 'heating' });
    assert.deepEqual(rule('burner_state_changed_to').state(reading({ burner_state: 'heating' })), { state: 'heating' });
    assert.deepEqual(rule('temperature_state_changed').tokens(reading({ temperature_state: 'sleep' })), { temperature_state: 'sleep' });
  });
});
