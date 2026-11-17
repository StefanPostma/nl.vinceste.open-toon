'use strict';

/*
 * Stability contract CT-01 (docs/sdlc/04-compat-contract.md Appendix A) as revised by ADR-0017:
 * the baseline manifest (git show 5cc3b90:app.json, stored as test/fixtures/baseline-app.json) is compared
 * with the committed app.json. Everything an installed device or a user's Flow can depend on must survive.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { jsonFixture } = require('../helpers/fixtures');
const { FEATURES } = require('../../lib/features');
const { ROOT, readJson } = require('../helpers/paths');

const ADR_DIR = path.join(ROOT, 'docs', 'adr');
const baseline = jsonFixture('baseline-app.json');
const exceptions = jsonFixture('contract-exceptions.json');
const current = () => readJson('app.json');
const clone = (value) => JSON.parse(JSON.stringify(value));
const featureCapabilities = FEATURES.flatMap((feature) => feature.capabilities);

function driverOf(manifest) {
  return (manifest.drivers || []).find((entry) => entry.id === 'open-toon');
}

function dropdownIds(arg) {
  return (arg.values || []).map((entry) => entry.id);
}

function cardsOf(manifest) {
  const out = {};
  const add = (kind, card) => {
    out[`${kind}:${card.id}`] = {
      deprecated: Boolean(card.deprecated),
      args: Object.fromEntries((card.args || []).map((arg) => [arg.name, { type: arg.type, values: dropdownIds(arg), filter: arg.filter }])),
      tokens: Object.fromEntries((card.tokens || []).map((token) => [token.name, token.type || 'string'])),
    };
  };
  const scan = (flow) => ['triggers', 'conditions', 'actions'].forEach((kind) => ((flow && flow[kind]) || []).forEach((card) => add(kind, card)));
  scan(manifest.flow);
  (manifest.drivers || []).forEach((driver) => scan(driver.flow));
  return out;
}

function summarize(manifest) {
  const driver = driverOf(manifest);
  return {
    appId: manifest.id,
    driverFound: Boolean(driver),
    class: driver && driver.class,
    energy: driver && JSON.stringify(driver.energy),
    capabilities: (driver && driver.capabilities) || [],
    capabilityOptionKeys: Object.keys((driver && driver.capabilitiesOptions) || {}),
    settings: ((driver && driver.settings) || []).flatMap((entry) => (entry.children || [entry]).map((child) => child.id)),
    customCapabilities: Object.fromEntries(Object.entries(manifest.capabilities || {}).map(([id, definition]) => [id, (definition.values || []).map((value) => value.id)])),
    cards: cardsOf(manifest),
  };
}

/**
 * CT-01. Returns one message per violation.
 * @param {object} base baseline manifest
 * @param {object} candidate manifest under test
 * @param {{exceptions?: object, featureCapabilities?: string[]}} [options]
 *   `exceptions` is test/fixtures/contract-exceptions.json (ADR-0017); `featureCapabilities` are the capability
 *   ids of the feature registry (lib/features).
 */
function checkContract(base, candidate, { exceptions: allowed = exceptions, featureCapabilities = [] } = {}) {
  const before = summarize(base);
  const after = summarize(candidate);
  const problems = [];

  if (before.appId !== after.appId) problems.push(`app id ${before.appId} -> ${after.appId}`);
  if (!after.driverFound) problems.push('driver open-toon is gone');
  if (before.class !== after.class) problems.push(`driver class ${before.class} -> ${after.class}`);
  if (before.energy !== after.energy) problems.push(`energy block changed: ${before.energy} -> ${after.energy}`);
  before.settings.forEach((key) => after.settings.includes(key) || problems.push(`setting key removed: ${key}`));

  Object.entries(before.customCapabilities).forEach(([id, values]) => values.forEach((value) => {
    if (!(after.customCapabilities[id] || []).includes(value)) problems.push(`custom capability ${id}: enum value removed: ${value}`);
  }));

  const removable = (allowed && allowed.driverCapabilitiesRemovedFromManifest) || {};
  before.capabilities.forEach((id) => {
    if (after.capabilities.includes(id)) return;
    if (!after.capabilityOptionKeys.includes(id) && !featureCapabilities.includes(id)) {
      problems.push(`driver capability ${id} is gone from the manifest`);
    } else if (!Object.hasOwn(removable, id)) {
      problems.push(`undocumented manifest removal of driver capability ${id}`);
    }
  });
  Object.entries(removable).forEach(([id, adr]) => {
    const exists = fs.existsSync(ADR_DIR) && fs.readdirSync(ADR_DIR).some((name) => name.startsWith(`${adr.replace('ADR-', '')}-`));
    if (!exists) problems.push(`exception for ${id} names ${adr}, which does not exist under docs/adr`);
  });

  Object.entries(before.cards).forEach(([key, card]) => {
    const now = after.cards[key];
    if (!now) {
      problems.push(`flow card removed (keep it, deprecated): ${key}`);
      return;
    }
    Object.entries(card.args).forEach(([name, arg]) => {
      const argNow = now.args[name];
      if (!argNow) {
        problems.push(`${key}: argument removed: ${name}`);
        return;
      }
      if (argNow.type !== arg.type) problems.push(`${key}: argument ${name} type ${arg.type} -> ${argNow.type}`);
      if (arg.filter !== argNow.filter) problems.push(`${key}: argument ${name} filter ${arg.filter} -> ${argNow.filter}`);
      arg.values.forEach((value) => argNow.values.includes(value) || problems.push(`${key}: dropdown ${name} value removed: ${value}`));
    });
    Object.entries(card.tokens).forEach(([name, type]) => {
      if (now.tokens[name] !== type) problems.push(`${key}: token ${name} (${type}) removed or retyped`);
    });
    if (card.deprecated && !now.deprecated) problems.push(`${key}: un-deprecated`);
  });
  return problems;
}

function mutated(change, source = current()) {
  const manifest = clone(source);
  change(manifest, driverOf(manifest));
  return manifest;
}

const card = (manifest, section, id) => manifest.flow[section].find((entry) => entry.id === id);

describe('FR-76 AC1 / NFR-14 AC1: the committed manifest honours the stability contract', () => {
  test('test/fixtures/baseline-app.json is the manifest of commit 5cc3b90, byte for byte', () => {
    const digest = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'baseline-app.json'))).digest('hex');

    assert.equal(digest, '40e2aa39ed1d61fcf424c619c26f8c82aa60356c');
  });

  test('FR-76 AC1: app.json passes CT-01 against the baseline', () => {
    assert.deepEqual(checkContract(baseline, current(), { featureCapabilities }), []);
  });

  test('FR-76 AC1: the baseline itself passes, and additive changes pass (deprecation, a new enum value, a new card)', () => {
    assert.deepEqual(checkContract(baseline, baseline), []);
    const additive = mutated((manifest) => {
      card(manifest, 'actions', 'update_water').deprecated = true;
      manifest.capabilities.temperature_state.values.push({ id: 'vacation', title: { en: 'Vacation', nl: 'Vakantie' } });
      manifest.flow.triggers.push({ id: 'burner_state_changed_to', title: { en: 'x', nl: 'x' } });
    }, baseline);

    assert.deepEqual(checkContract(baseline, additive), []);
  });

  test('FR-76 AC1: the contract covers the 11 driver capabilities, 5 triggers, 2 conditions and 7 actions of the baseline', () => {
    const summary = summarize(baseline);

    assert.equal(summary.capabilities.length, 11);
    assert.deepEqual(Object.keys(summary.cards).map((key) => key.split(':')[0]).reduce((counts, kind) => ({ ...counts, [kind]: (counts[kind] || 0) + 1 }), {}), {
      triggers: 5, conditions: 2, actions: 7,
    });
  });
});

describe('FR-76 AC1: every violation class of CT-01 is reported (negative cases)', () => {
  const cases = [
    ['capability dropped without exception', (manifest, driver) => {
      driver.capabilities = driver.capabilities.filter((id) => id !== 'meter_gas');
    }, /driver capability meter_gas is gone from the manifest/],
    ['card removed', (manifest) => {
      manifest.flow.triggers = manifest.flow.triggers.filter((entry) => entry.id !== 'meter_gas_changed');
    }, /flow card removed.*triggers:meter_gas_changed/],
    ['argument removed', (manifest) => {
      card(manifest, 'actions', 'set_temperature_state').args = card(manifest, 'actions', 'set_temperature_state').args.filter((arg) => arg.name !== 'resume_program');
    }, /set_temperature_state: argument removed: resume_program/],
    ['argument retyped', (manifest) => {
      card(manifest, 'actions', 'set_temperature_state').args.find((arg) => arg.name === 'state').type = 'text';
    }, /argument state type dropdown -> text/],
    ['dropdown value removed', (manifest) => {
      const arg = card(manifest, 'conditions', 'temperature_state_is').args.find((entry) => entry.name === 'state');
      arg.values = arg.values.filter((value) => value.id !== 'none');
    }, /dropdown state value removed: none/],
    ['token retyped', (manifest) => {
      card(manifest, 'triggers', 'alarm_water_changed').tokens[0].type = 'string';
    }, /token alarm_water\.hotwater \(boolean\) removed or retyped/],
    ['setting key removed', (manifest, driver) => {
      driver.settings[0].children[0].id = 'host';
    }, /setting key removed: address/],
    ['enum value removed', (manifest) => {
      manifest.capabilities.temperature_state.values = manifest.capabilities.temperature_state.values.filter((value) => value.id !== 'sleep');
    }, /enum value removed: sleep/],
    ['energy changed', (manifest, driver) => {
      driver.energy = { cumulative: false };
    }, /energy block changed/],
    ['device argument filter string changed', (manifest) => {
      card(manifest, 'conditions', 'hotwater_dispensing').args[0].filter = 'driver_id=open-toon&capabilities=measure_water';
    }, /hotwater_dispensing: argument device filter/],
    ['driver class changed', (manifest, driver) => {
      driver.class = 'sensor';
    }, /driver class thermostat -> sensor/],
    ['app id changed', (manifest) => {
      manifest.id = 'nl.example.other';
    }, /app id nl\.vinceste\.open-toon -> nl\.example\.other/],
    ['driver id changed', (manifest, driver) => {
      driver.id = 'toon';
    }, /driver open-toon is gone/],
    ['capability with options leaves the capability list without being listed', (manifest, driver) => {
      driver.capabilities = driver.capabilities.filter((id) => id !== 'alarm_water.hotwater');
    }, /undocumented manifest removal of driver capability alarm_water\.hotwater/],
  ];

  cases.forEach(([name, change, expected]) => {
    test(`${name}`, () => {
      const problems = checkContract(baseline, mutated(change));

      assert.ok(problems.length >= 1, 'the mutation must be reported');
      assert.ok(problems.some((problem) => expected.test(problem)), `expected ${expected} in:\n${problems.join('\n')}`);
    });
  });

  test('card un-deprecated', () => {
    const deprecatedBaseline = mutated((manifest) => {
      card(manifest, 'actions', 'update_water').deprecated = true;
    }, baseline);
    const problems = checkContract(deprecatedBaseline, baseline);

    assert.deepEqual(problems, ['actions:update_water: un-deprecated']);
  });
});

describe('FR-76 AC2: ADR-0017 exceptions let exactly the listed ids leave the capability list', () => {
  const waterIds = ['measure_water', 'meter_water.today', 'meter_water.total'];
  // The baseline has capabilitiesOptions entries for the two meters but none for measure_water: the move of
  // ADR-0017 (S3) must add one, which is what this simulated candidate does.
  const withoutWater = (manifest, driver) => {
    driver.capabilities = driver.capabilities.filter((id) => !waterIds.includes(id));
    driver.capabilitiesOptions.measure_water = {};
  };

  test('the exception file names the three water ids and an ADR that exists', () => {
    assert.deepEqual(exceptions, {
      driverCapabilitiesRemovedFromManifest: { measure_water: 'ADR-0017', 'meter_water.today': 'ADR-0017', 'meter_water.total': 'ADR-0017' },
    });
    assert.ok(fs.readdirSync(ADR_DIR).some((name) => name.startsWith('0017-')));
  });

  test('moving the water trio out of capabilities passes when they stay in capabilitiesOptions and are listed', () => {
    assert.deepEqual(checkContract(baseline, mutated(withoutWater, baseline)), []);
  });

  test('the same move fails as undocumented without the exception file', () => {
    const problems = checkContract(baseline, mutated(withoutWater, baseline), { exceptions: { driverCapabilitiesRemovedFromManifest: {} } });

    assert.deepEqual(problems, waterIds.map((id) => `undocumented manifest removal of driver capability ${id}`));
  });

  test('an id that also leaves capabilitiesOptions and the features is gone, exception or not', () => {
    const gone = mutated((manifest, driver) => {
      withoutWater(manifest, driver);
      delete driver.capabilitiesOptions['meter_water.total'];
    }, baseline);

    assert.deepEqual(checkContract(baseline, gone), ['driver capability meter_water.total is gone from the manifest']);
    assert.deepEqual(checkContract(baseline, gone, { featureCapabilities: ['meter_water.total'] }), []);
  });

  test('an exception that names a missing ADR is itself a violation', () => {
    const problems = checkContract(baseline, baseline, { exceptions: { driverCapabilitiesRemovedFromManifest: { measure_water: 'ADR-9999' } } });

    assert.deepEqual(problems, ['exception for measure_water names ADR-9999, which does not exist under docs/adr']);
  });
});

describe('FR-76 AC2 / NFR-14 AC1: what the committed manifest changes against the baseline, and the exception that covers it', () => {
  const now = current();
  const waterIds = ['measure_water', 'meter_water.today', 'meter_water.total'];

  test('FR-76 AC2: exactly the three water ids left driver.capabilities; they stay in capabilitiesOptions and are the exception file', () => {
    const left = driverOf(baseline).capabilities.filter((id) => !driverOf(now).capabilities.includes(id));

    assert.deepEqual(left, waterIds);
    left.forEach((id) => assert.ok(Object.hasOwn(driverOf(now).capabilitiesOptions, id), `${id} keeps its options`));
    assert.deepEqual(Object.keys(exceptions.driverCapabilitiesRemovedFromManifest).sort(), [...waterIds].sort());
  });

  test('FR-76 AC2: the exception is exercised: without it the committed manifest fails on exactly the three ids', () => {
    const problems = checkContract(baseline, now, { exceptions: { driverCapabilitiesRemovedFromManifest: {} }, featureCapabilities });

    assert.deepEqual(problems, waterIds.map((id) => `undocumented manifest removal of driver capability ${id}`));
  });

  test('FR-76 AC2: a baseline capability that is neither listed nor in capabilitiesOptions nor in the registry would be gone', () => {
    const gone = mutated((manifest, driver) => {
      delete driver.capabilitiesOptions['meter_water.total'];
    });

    const registryWithoutIt = featureCapabilities.filter((id) => id !== 'meter_water.total');

    assert.deepEqual(checkContract(baseline, gone, { featureCapabilities: registryWithoutIt }), ['driver capability meter_water.total is gone from the manifest']);
    assert.deepEqual(checkContract(baseline, gone, { featureCapabilities }), [], 'the water feature of the registry owns it');
  });

  test('R-33: the device argument of every card, old and new, has the filter driver_id=open-toon, byte for byte', () => {
    const filters = Object.values(cardsOf(now)).map((entry) => entry.args.device.filter);

    assert.equal(filters.length, 16);
    filters.forEach((filter) => assert.equal(filter, 'driver_id=open-toon'));
    Object.values(cardsOf(baseline)).forEach((entry) => assert.equal(entry.args.device.filter, 'driver_id=open-toon'));
  });

  test('the five duplicated or redundant cards are deprecated, update_status is not, and nothing else is', () => {
    const cards = cardsOf(now);
    const deprecated = Object.keys(cards).filter((key) => cards[key].deprecated).sort();

    assert.deepEqual(deprecated, ['actions:update_metertotals', 'actions:update_powerusage', 'actions:update_water', 'triggers:measure_water_changed', 'triggers:meter_gas_changed']);
    assert.equal(cards['actions:update_status'].deprecated, false);
  });

  test('the energy block is byte-identical, and the other additions are the two burner cards and the vacation value', () => {
    const before = summarize(baseline);
    const after = summarize(now);

    assert.equal(after.energy, before.energy);
    assert.deepEqual(Object.keys(after.cards).filter((key) => !Object.hasOwn(before.cards, key)).sort(), ['conditions:burner_state_is', 'triggers:burner_state_changed_to']);
    assert.deepEqual(after.customCapabilities.temperature_state.filter((id) => !before.customCapabilities.temperature_state.includes(id)), ['vacation']);
    assert.deepEqual(Object.keys(after.customCapabilities).filter((id) => !Object.hasOwn(before.customCapabilities, id)), ['burner_state']);
    assert.deepEqual(before.settings.filter((key) => !after.settings.includes(key)), []);
  });
});
