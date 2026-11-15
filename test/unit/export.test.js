'use strict';

/*
 * The power export feature (ADR-0016, FR-25): the registry entry, and what the generic parts make of it. The value
 * comes from the answer of the power group that every device polls; the feature has no group, no probe and no status.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const exportFeature = require('../../lib/features/export');
const {
  FEATURES, featureState, activeGroups, capabilitiesFor, legacyDefaults, decisionKeys,
} = require('../../lib/features');
const { planCapabilities, planSettingsChange } = require('../../lib/engine/capabilities');
const { parsePower } = require('../../lib/toon/parse');
const { createApplier } = require('../../lib/engine/apply');
const { toonPayload } = require('../helpers/fixtures');

const usage = (value, production) => ({
  result: 'ok',
  powerUsage: { value, avgValue: 1 },
  ...(production === undefined ? {} : { powerProduction: { value: production, avgValue: 1 } }),
});

describe('FR-25 / ADR-0016: the feature in the registry', () => {
  test('it is optional, off by default, and owns one capability and no poll group', () => {
    assert.equal(exportFeature.optional, true);
    assert.equal(exportFeature.setting, 'export_enabled');
    assert.deepEqual(exportFeature.capabilities, ['measure_power.export']);
    assert.deepEqual(exportFeature.pollGroups, []);
    assert.equal(exportFeature.statusSetting, undefined, 'nothing to show: it needs no status');
    assert.equal(exportFeature.probe, undefined, 'and no probe');
    assert.equal(Object.isFrozen(exportFeature), true);
    assert.equal(FEATURES.includes(exportFeature), true);
  });

  test('FR-25 AC3: with the switch off the capability is not wanted and no request is added; on, it is wanted and still adds no poll group', () => {
    const off = featureState({});
    const on = featureState({ export_enabled: true });

    assert.equal(capabilitiesFor(off).includes('measure_power.export'), false);
    assert.equal(capabilitiesFor(on).includes('measure_power.export'), true);
    assert.deepEqual(activeGroups(on).map((group) => group.id), activeGroups(off).map((group) => group.id));
    assert.deepEqual(activeGroups(on).map((group) => group.id), ['thermostat', 'power', 'meters']);
  });

  test('a device that predates the feature starts with it off, whatever it holds; the migration records no decision for it', () => {
    assert.equal(legacyDefaults(['measure_power', 'measure_power.export']).export_enabled, false);
    assert.equal(legacyDefaults([]).export_enabled, false);
    assert.deepEqual(decisionKeys(), ['toonwaterDecidedBy'], 'only ToonWater has a decision that matters later');
  });

  test('switching it on adds exactly its capability; switching it off removes exactly that one', () => {
    const core = capabilitiesFor(featureState({}));

    assert.deepEqual(planCapabilities({ current: core, state: featureState({ export_enabled: true }) }).add, ['measure_power.export']);
    assert.deepEqual(planCapabilities({
      current: [...core, 'measure_power.export'], state: featureState({}), switchedOff: ['export'],
    }).remove, ['measure_power.export']);
    assert.deepEqual(planCapabilities({ current: core, state: featureState({}), switchedOff: ['export'] }).remove, [], 'it is not there: nothing to remove');
  });

  test('the toggle of a save is found from the settings; the other switch is left alone', () => {
    const { toggles } = planSettingsChange({
      oldSettings: { export_enabled: false, toonwater_enabled: false },
      newSettings: { export_enabled: true, toonwater_enabled: false },
      changedKeys: ['export_enabled'],
    });

    assert.deepEqual(toggles, [{ id: 'export', setting: 'export_enabled', on: true }]);
  });
});

describe('FR-25 AC1 / AC2: the value is the powerProduction of the answer that is polled anyway', () => {
  test('AC1: powerProduction 1200 is the export, and measure_power is still the import', () => {
    assert.deepEqual(parsePower(usage(460, 1200)).values, { measure_power: 460, 'measure_power.export': 1200 });
    assert.deepEqual(parsePower(toonPayload('power-feed-in')).values, { measure_power: 324, 'measure_power.export': 1250 });
  });

  test('AC2: an answer without powerProduction leaves the export alone', () => {
    assert.deepEqual(parsePower(toonPayload('power-no-production')).values, { measure_power: 324 });
    assert.deepEqual(parsePower(usage(460)).values, { measure_power: 460 });
    [null, undefined, '', 'abc', -5, {}, []].forEach((raw) => {
      assert.equal(Object.hasOwn(parsePower(usage(460, raw)).values, 'measure_power.export'), false, JSON.stringify(raw));
    });
  });

  test('FR-27: measure_power is never negative, whatever the export says', () => {
    assert.deepEqual(parsePower(usage(-300, 300)).values, { 'measure_power.export': 300 });
    assert.equal(Object.hasOwn(parsePower(usage(-300)).values, 'measure_power'), false);
    assert.equal(parsePower(usage(0, 0)).values['measure_power.export'], 0, 'zero is a value: nothing is fed back');
  });

  test('AC3: while the device does not hold the capability, the writer drops the value and says nothing', async () => {
    const held = new Map([['measure_power', null]]);
    const written = [];
    const device = {
      hasCapability: (id) => held.has(id),
      getCapabilityValue: (id) => held.get(id),
      async setCapabilityValue(id, value) {
        written.push(id);
        held.set(id, value);
      },
    };
    const lines = [];
    const apply = createApplier({ device, log: (line) => lines.push(line), error: (line) => lines.push(line) });

    await apply(parsePower(usage(460, 1200)), () => true);

    assert.deepEqual(written, ['measure_power']);
    assert.deepEqual(lines, []);
    held.set('measure_power.export', null);
    await apply(parsePower(usage(460, 1200)), () => true);
    assert.equal(held.get('measure_power.export'), 1200, 'and once the device holds it, the value is written');
  });
});
