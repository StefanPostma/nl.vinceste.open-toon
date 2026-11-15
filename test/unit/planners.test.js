'use strict';

/*
 * The pure planners of the feature registry and of the capability migration (ADR-0001, ADR-0010, ADR-0013 L0):
 * featureState, activeGroups, capabilitiesFor, legacyDefaults, planMigration, planCapabilities. They never see a
 * device, so the era matrix and the toggles are plain tables here; applying a plan to a device (reconcile) and the
 * real optional features arrive in later slices. Two stand-ins are registered inside this file only:
 * the synthetic feature of test/helpers/feature-synthetic.js and a water-shaped feature with the legacy rule of
 * ADR-0006, so that the plans of 05-architecture.md section 9 can be checked before the real feature exists.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  FEATURES, CORE, featureState, activeGroups, capabilitiesFor, legacyDefaults,
} = require('../../lib/features');
const { MIGRATION_VERSION, planMigration, planCapabilities } = require('../../lib/engine/capabilities');
const synthetic = require('../helpers/feature-synthetic');
const { jsonFixture } = require('../helpers/fixtures');
const { ROOT } = require('../helpers/paths');

const baseline = jsonFixture('baseline-app.json');
const { eras } = jsonFixture('eras.json');

const WATER = ['measure_water', 'meter_water.today', 'meter_water.total'];
const waterShaped = Object.freeze({
  id: 'waterlike',
  optional: true,
  setting: 'waterlike_enabled',
  capabilities: WATER,
  legacyIf: (capabilities) => capabilities.some((id) => WATER.includes(id)),
});
const PLAIN = FEATURES.filter((feature) => feature.always); // what the registry held before the optional features
const WITH_WATER = [...PLAIN, waterShaped];

const apply = (current, plan) => [...current.filter((id) => !plan.remove.includes(id)), ...plan.add];

describe('FR-111: the registry answers from its data alone', () => {
  test('the registry holds the core feature, always on, with the nine capabilities of the driver in manifest order, then the two optional features', () => {
    assert.deepEqual(FEATURES.map((feature) => feature.id), ['core', 'toonwater', 'export']);
    assert.deepEqual(PLAIN.map((feature) => feature.id), ['core']);
    assert.deepEqual(CORE, [
      'target_temperature', 'measure_temperature', 'temperature_state', 'meter_power.peak', 'meter_power.offPeak',
      'measure_power', 'meter_gas', 'alarm_water.hotwater', 'burner_state',
    ]);
    assert.deepEqual(capabilitiesFor({}), CORE, 'core needs no entry in the state');
  });

  test('featureState: core is always on, an optional feature only on an exact true', () => {
    assert.deepEqual(featureState({}, PLAIN), { core: true });
    assert.deepEqual(featureState({}), { core: true, toonwater: false, export: false }, 'the real optional features start off');
    const features = [...PLAIN, synthetic];

    assert.deepEqual(featureState({ synthetic_enabled: true }, features), { core: true, synthetic: true });
    [false, undefined, null, 'true', 1, 0, {}, []].forEach((value) => {
      assert.equal(featureState({ synthetic_enabled: value }, features).synthetic, false, JSON.stringify(value));
    });
    [undefined, null, 'x', 7, [], true].forEach((settings) => {
      assert.deepEqual(featureState(settings, features), { core: true, synthetic: false }, String(settings));
    });
  });

  test('featureState reads own properties only', () => {
    const inherited = Object.create({ synthetic_enabled: true });

    assert.equal(featureState(inherited, [...PLAIN, synthetic]).synthetic, false);
  });

  test('activeGroups: thermostat (critical), power and meters in that order, then the groups of the features that are on', () => {
    const groups = activeGroups({ core: true });

    assert.deepEqual(groups.map((group) => group.id), ['thermostat', 'power', 'meters']);
    assert.deepEqual(groups.map((group) => group.critical), [true, false, false]);
    groups.forEach((group) => {
      assert.equal(typeof group.endpoint.path, 'string');
      assert.equal(typeof group.parse, 'function');
    });
    assert.deepEqual(activeGroups({}).map((group) => group.id), ['thermostat', 'power', 'meters'], 'core without an entry in the state');
  });

  test('capabilitiesFor lists each capability once, features in registry order', () => {
    const twin = { ...synthetic, id: 'twin', setting: 'twin_enabled' };
    const features = [...PLAIN, synthetic, twin];

    assert.deepEqual(capabilitiesFor({ synthetic: true, twin: true }, features), [...CORE, 'measure_pressure']);
    assert.deepEqual(capabilitiesFor({ synthetic: false, twin: true }, features), [...CORE, 'measure_pressure']);
    assert.deepEqual(capabilitiesFor({ synthetic: false, twin: false }, features), CORE);
  });

  test('legacyDefaults: one entry per optional feature, from its legacyIf and the capabilities held', () => {
    assert.deepEqual(legacyDefaults(CORE, PLAIN), {}, 'no optional feature, nothing to decide');
    assert.deepEqual(legacyDefaults(CORE), { toonwater_enabled: false, export_enabled: false });
    assert.deepEqual(legacyDefaults(['measure_water'], WITH_WATER), { waterlike_enabled: true });
    assert.deepEqual(legacyDefaults(CORE, WITH_WATER), { waterlike_enabled: false });
    assert.deepEqual(legacyDefaults(['measure_pressure', 'meter_water.total'], [...WITH_WATER, synthetic]), { waterlike_enabled: true, synthetic_enabled: true });
    [undefined, null, 'measure_water', {}].forEach((held) => {
      assert.deepEqual(legacyDefaults(held, WITH_WATER), { waterlike_enabled: false }, String(held));
    });
  });

  test('an optional feature without a legacyIf starts off', () => {
    const plain = {
      id: 'plain', optional: true, setting: 'plain_enabled', capabilities: ['measure_pressure'],
    };

    assert.deepEqual(legacyDefaults(['measure_pressure'], [plain]), { plain_enabled: false });
  });
});

describe('FR-111 AC1: planMigration decides only for a device without the marker of the migration', () => {
  test('marker absent or unusable -> legacy, with the switches decided from the capability list', () => {
    const era2 = eras.era2.capabilities;

    [{}, undefined, null, 'marker', { migrationVersion: 0 }, { migrationVersion: '1' }, { migrationVersion: NaN }, { migrationVersion: null }, { toonwaterDecidedBy: 'user' }].forEach((store) => {
      assert.deepEqual(planMigration({ store, capabilities: era2, features: WITH_WATER }), { legacy: true, settings: { waterlike_enabled: true } }, JSON.stringify(store));
    });
    assert.deepEqual(planMigration({ store: {}, capabilities: eras.era1.capabilities, features: WITH_WATER }), { legacy: true, settings: { waterlike_enabled: false } });
  });

  test('marker present -> legacy is false and nothing is decided, whatever the capabilities say', () => {
    assert.equal(MIGRATION_VERSION, 1);
    [{ migrationVersion: 1 }, { migrationVersion: 2 }, { migrationVersion: 1, other: 'kept' }].forEach((store) => {
      assert.deepEqual(planMigration({ store, capabilities: eras.era3.capabilities, features: WITH_WATER }), { legacy: false, settings: {} }, JSON.stringify(store));
      assert.deepEqual(planMigration({ store, capabilities: CORE, features: WITH_WATER }), { legacy: false, settings: {} });
    });
  });

  test('without optional features a legacy device has nothing to switch', () => {
    assert.deepEqual(planMigration({ store: {}, capabilities: eras.era0.capabilities, features: PLAIN }), { legacy: true, settings: {} });
  });
});

describe('FR-111 AC1/AC2: the plan for every device era adds, keeps what the device has, and is empty in steady state', () => {
  const addedByCore = {
    era0: ['meter_power.peak', 'meter_power.offPeak', 'alarm_water.hotwater', 'burner_state'],
    era1: ['alarm_water.hotwater', 'burner_state'],
    era2: ['alarm_water.hotwater', 'burner_state'],
    era3: ['burner_state'],
  };

  Object.entries(addedByCore).forEach(([name, expectedAdd]) => {
    const current = eras[name].capabilities;

    test(`${name} (${eras[name].label}): only the capabilities of the core feature are added, nothing is removed`, () => {
      const plan = planCapabilities({ current, state: featureState({}) });

      assert.deepEqual(plan.add, expectedAdd);
      assert.deepEqual(plan.remove, []);
      assert.deepEqual(plan.desired, CORE);
    });

    test(`${name}: the capabilities the registry does not claim (an old meter_power, the water items) stay`, () => {
      const plan = planCapabilities({ current, state: featureState({}) });
      const extras = current.filter((id) => !CORE.includes(id));
      const after = apply(current, plan);

      extras.forEach((id) => assert.ok(after.includes(id), `${id} kept`));
      assert.equal(plan.add.includes('meter_power'), false, 'the plain meter_power is never added');
      current.forEach((id) => assert.ok(after.includes(id), `${id} survives`));
    });

    test(`${name}: applying the plan and planning again gives the empty plan (steady state, no add or remove calls)`, () => {
      const once = apply(current, planCapabilities({ current, state: featureState({}) }));

      assert.deepEqual(planCapabilities({ current: once, state: featureState({}) }), { desired: CORE, add: [], remove: [] });
    });
  });

  test('the same eras with a water-shaped feature: the decision and the plan follow ADR-0006 / 05 section 9', () => {
    const expected = {
      era0: { waterlike_enabled: false, add: addedByCore.era0 },
      era1: { waterlike_enabled: false, add: addedByCore.era1 },
      era2: { waterlike_enabled: true, add: addedByCore.era2 },
      era3: { waterlike_enabled: true, add: addedByCore.era3 },
    };

    Object.entries(expected).forEach(([name, outcome]) => {
      const current = eras[name].capabilities;
      const { settings } = planMigration({ store: {}, capabilities: current, features: WITH_WATER });
      const plan = planCapabilities({ current, state: featureState(settings, WITH_WATER), features: WITH_WATER });

      assert.deepEqual(settings, { waterlike_enabled: outcome.waterlike_enabled }, name);
      assert.deepEqual(plan.add, outcome.add, name);
      assert.deepEqual(plan.remove, [], name);
      assert.deepEqual(planCapabilities({ current: apply(current, plan), state: featureState(settings, WITH_WATER), features: WITH_WATER }).add, [], `${name} steady state`);
    });
  });

  test('a device with only some of the optional capabilities is switched on and gets the missing ones, nothing is removed', () => {
    const current = [...CORE, 'measure_water'];
    const { settings } = planMigration({ store: {}, capabilities: current, features: WITH_WATER });
    const plan = planCapabilities({ current, state: featureState(settings, WITH_WATER), features: WITH_WATER });

    assert.deepEqual(settings, { waterlike_enabled: true });
    assert.deepEqual(plan.add, ['meter_water.today', 'meter_water.total']);
    assert.deepEqual(plan.remove, []);
  });

  test('desired is built from the active features, never from everything the manifest lists', () => {
    const everything = baseline.drivers[0].capabilities;

    ['era0', 'era1'].forEach((name) => {
      const plan = planCapabilities({ current: eras[name].capabilities, state: featureState({}, WITH_WATER), features: WITH_WATER });

      assert.notDeepEqual([...plan.desired].sort(), [...everything].sort(), name);
      WATER.forEach((id) => {
        assert.ok(everything.includes(id), 'the baseline manifest lists the water items');
        assert.equal(plan.desired.includes(id), false, `${name}: ${id} is not desired while the feature is off`);
        assert.equal(plan.add.includes(id), false, `${name}: ${id} is not added`);
      });
    });
  });

  test('a store that is not an object, capabilities that are not a list: planners never throw', () => {
    [undefined, null, 'x', 5, {}].forEach((current) => {
      assert.deepEqual(planCapabilities({ current, state: {} }).add, CORE, String(current));
    });
    assert.equal(planMigration({ store: undefined, capabilities: undefined }).legacy, true);
  });
});

describe('FR-111: toggling an optional feature adds or removes exactly its capabilities', () => {
  const full = [...CORE, ...WATER];

  test('on: exactly the capabilities of that feature are added', () => {
    const plan = planCapabilities({ current: CORE, state: { waterlike: true }, features: WITH_WATER });

    assert.deepEqual(plan.add, WATER);
    assert.deepEqual(plan.remove, []);
  });

  test('off: the capabilities of the switched-off feature go, everything else stays', () => {
    const plan = planCapabilities({
      current: full, state: { waterlike: false }, switchedOff: ['waterlike'], features: WITH_WATER,
    });

    assert.deepEqual(plan.remove, WATER);
    assert.deepEqual(plan.add, []);
    assert.deepEqual(apply(full, plan), CORE);
  });

  test('a feature that is merely off is never removed without a user switching it off', () => {
    const plan = planCapabilities({ current: full, state: { waterlike: false }, features: WITH_WATER });

    assert.deepEqual(plan.remove, []);
  });

  test('switching off removes only what the device has, and never core or a feature that is still on', () => {
    assert.deepEqual(planCapabilities({
      current: [...CORE, 'measure_water'], state: { waterlike: false }, switchedOff: ['waterlike'], features: WITH_WATER,
    }).remove, ['measure_water']);
    assert.deepEqual(planCapabilities({
      current: full, state: { waterlike: true }, switchedOff: ['waterlike'], features: WITH_WATER,
    }).remove, [], 'the state wins: the feature is on');
    assert.deepEqual(planCapabilities({
      current: full, state: { waterlike: false }, switchedOff: ['core'], features: WITH_WATER,
    }).remove, [], 'core cannot be switched off');
    assert.deepEqual(planCapabilities({
      current: full, state: { waterlike: false }, switchedOff: ['unknown'], features: WITH_WATER,
    }).remove, []);
  });

  test('a capability that another active feature also claims is kept', () => {
    const shared = { ...synthetic, capabilities: ['meter_water.total'] };
    const features = [...WITH_WATER, shared];
    const plan = planCapabilities({
      current: full, state: { waterlike: false, synthetic: true }, switchedOff: ['waterlike'], features,
    });

    assert.deepEqual(plan.remove, ['measure_water', 'meter_water.today']);
  });

  test('tick, untick, tick: every step plans from what the device has, and the end state equals the last choice', () => {
    const steps = [true, false, true];
    let current = [...CORE];

    steps.forEach((on, index) => {
      const plan = planCapabilities({
        current, state: { waterlike: on }, switchedOff: on ? [] : ['waterlike'], features: WITH_WATER,
      });
      current = apply(current, plan);
      assert.equal(new Set(current).size, current.length, `step ${index}: no duplicate capability`);
      assert.deepEqual(current.filter((id) => WATER.includes(id)), on ? WATER : [], `step ${index}`);
    });
    assert.deepEqual(current, [...CORE, ...WATER]);
  });
});

describe('FR-111: a synthetic feature needs zero edits to lib/engine (ADR-0001 kill criterion)', () => {
  const features = [...PLAIN, synthetic];

  test('it obtains a setting, a poll group and a capability plan from the generic planners', () => {
    const state = featureState({ synthetic_enabled: true }, features);
    const groups = activeGroups(state, features);

    assert.deepEqual(state, { core: true, synthetic: true });
    assert.deepEqual(groups.map((group) => group.id), ['thermostat', 'power', 'meters', 'synthetic']);
    assert.equal(groups[3].endpoint.path, '/synthetic.json');
    assert.deepEqual(groups[3].parse({ pressure: 1013 }).values, { measure_pressure: 1013 });
    assert.deepEqual(groups[3].parse({ pressure: 'high' }), { values: {}, notes: ['unexpected'] });
    assert.deepEqual(planCapabilities({ current: CORE, state, features }).add, ['measure_pressure']);
    assert.deepEqual(planCapabilities({
      current: [...CORE, 'measure_pressure'], state: { synthetic: false }, switchedOff: ['synthetic'], features,
    }).remove, ['measure_pressure']);
    assert.deepEqual(planMigration({ store: {}, capabilities: [...CORE, 'measure_pressure'], features }), { legacy: true, settings: { synthetic_enabled: true } });
    assert.deepEqual(planMigration({ store: {}, capabilities: CORE, features }), { legacy: true, settings: { synthetic_enabled: false } });
  });

  test('it is registered inside the test only: the real registry is untouched', () => {
    assert.deepEqual(FEATURES.map((feature) => feature.id), ['core', 'toonwater', 'export']);
    assert.deepEqual(activeGroups(featureState({ synthetic_enabled: true })).map((group) => group.id), ['thermostat', 'power', 'meters']);
    assert.equal(Object.isFrozen(FEATURES), true);
  });

  test('the engine and the registry index name no feature and reach no feature file but the registry', () => {
    const engineDir = path.join(ROOT, 'lib', 'engine');
    const engine = fs.readdirSync(engineDir).map((name) => path.join(engineDir, name));
    const named = /\b(?:synthetic|toonwater|water|export_enabled)\b/i;
    const featureFile = /require\(\s*['"]\.\.\/features\/[^'"]+['"]/;
    const listing = /^.*(?:require\(|const FEATURES =).*$/gm; // the registry loads the feature files and lists them: the one place that has to name them

    [...engine, path.join(ROOT, 'lib', 'features', 'index.js')].forEach((file) => {
      assert.equal(named.test(fs.readFileSync(file, 'utf8').replace(listing, '')), false, `${path.relative(ROOT, file)} names a feature`);
    });
    engine.forEach((file) => {
      assert.equal(featureFile.test(fs.readFileSync(file, 'utf8')), false, `${path.relative(ROOT, file)} requires a feature file directly`);
    });
  });
});
