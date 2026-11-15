'use strict';

/*
 * The feature registry (lib/features) and the manifest (app.json, composed from .homeycompose and the driver
 * compose files) describe the same things twice: which capabilities, settings and cards belong to which feature.
 * This test keeps the two in step (docs/sdlc/05-architecture.md section 13, L3). `checkRegistry` takes the
 * features as a parameter, so the negative cases and the synthetic feature of test/helpers run through the same
 * code that checks the real registry.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { FEATURES, CORE } = require('../../lib/features');
const toonwater = require('../../lib/features/toonwater');
const { CapabilityModel } = require('../helpers/fake-homey/capabilities');
const synthetic = require('../helpers/feature-synthetic');
const { read, readJson } = require('../helpers/paths');

const clone = (value) => JSON.parse(JSON.stringify(value));
const manifest = () => readJson('app.json');

const driverOf = (app) => app.drivers.find((entry) => entry.id === 'open-toon');
const settingsOf = (driver) => (driver.settings || []).flatMap((entry) => (entry.type === 'group' ? entry.children : [entry]));
const cardIdsOf = (app) => ['triggers', 'conditions', 'actions'].flatMap((kind) => (app.flow[kind] || []).map((card) => card.id));
const cardsOf = (feature) => [...new Set(Object.values(feature.cards || {}).filter(Array.isArray).flat())];

/** @returns {string[]} one message per place where the registry and the manifest disagree */
function checkRegistry(app, features) {
  const problems = [];
  const driver = driverOf(app);
  const model = new CapabilityModel(app);
  const settings = settingsOf(driver);
  const cards = cardIdsOf(app);
  const seen = {
    feature: new Map(), capability: new Map(), 'poll group': new Map(), card: new Map(),
  };
  const claim = (kind, key, owner) => {
    if (seen[kind].has(key)) problems.push(`${kind} ${key} is claimed by ${seen[kind].get(key)} and ${owner}`);
    else seen[kind].set(key, owner);
  };

  features.forEach((feature) => {
    claim('feature', feature.id, feature.id);
    feature.capabilities.forEach((id) => {
      claim('capability', id, feature.id);
      if (!model.definition(id)) problems.push(`${feature.id}: capability ${id} is neither a custom nor a system capability`);
      if (feature.always) {
        if (!driver.capabilities.includes(id)) problems.push(`${feature.id}: capability ${id} is missing from the driver capabilities`);
      } else {
        if (driver.capabilities.includes(id)) problems.push(`${feature.id}: optional capability ${id} must not be in the driver capabilities`);
        if (!Object.hasOwn(driver.capabilitiesOptions || {}, id)) problems.push(`${feature.id}: optional capability ${id} has no entry in capabilitiesOptions`);
      }
    });

    if (feature.optional) {
      const setting = settings.find((entry) => entry.id === feature.setting);
      if (!setting) problems.push(`${feature.id}: setting ${feature.setting} is not in the driver settings`);
      else if (setting.type !== 'checkbox' || setting.value !== false) problems.push(`${feature.id}: setting ${feature.setting} must be a checkbox with value false`);
    }
    if (feature.statusSetting) {
      const status = settings.find((entry) => entry.id === feature.statusSetting);
      if (!status || status.type !== 'label') problems.push(`${feature.id}: statusSetting ${feature.statusSetting} must be a label setting`);
    }
    cardsOf(feature).forEach((id) => {
      if (!cards.includes(id)) problems.push(`${feature.id}: card ${id} is not in the manifest`);
      claim('card', id, feature.id);
    });

    (feature.pollGroups || []).forEach((group) => {
      claim('poll group', group.id, feature.id);
      if (typeof group.critical !== 'boolean' || typeof group.parse !== 'function' || !/^\//.test(group.endpoint && group.endpoint.path)) {
        problems.push(`${feature.id}: poll group ${group.id} needs a boolean critical, a parse function and an endpoint path`);
      }
    });
  });
  return problems;
}

/** The manifest the synthetic feature would need: its setting, its capability option, nothing else. */
function withSynthetic(app) {
  const extended = clone(app);
  const driver = driverOf(extended);
  driver.capabilitiesOptions[synthetic.capabilities[0]] = {};
  driver.settings.push({
    id: synthetic.setting, type: 'checkbox', value: false, label: { en: 'Synthetic', nl: 'Synthetisch' },
  });
  return extended;
}

describe('ADR-0001 / NFR-14 AC1: the real registry matches the manifest', () => {
  test('every capability, setting, card and poll group the registry names exists in the manifest as the registry says', () => {
    assert.deepEqual(checkRegistry(manifest(), FEATURES), []);
  });

  test('CORE equals the capabilities of driver.compose.json and of the composed app.json, in the same order', () => {
    const compose = readJson('drivers/open-toon/driver.compose.json');

    assert.deepEqual(CORE, compose.capabilities);
    assert.deepEqual(CORE, driverOf(manifest()).capabilities);
    assert.equal(CORE.length, 9);
  });

  test('FR-50 AC1: every optional switch of the driver is a checkbox that starts unticked, and its status is a read-only label', () => {
    const settings = settingsOf(driverOf(manifest()));
    const checkboxes = settings.filter((entry) => entry.type === 'checkbox');

    assert.deepEqual(checkboxes.map((entry) => entry.id), ['toonwater_enabled', 'export_enabled']);
    checkboxes.forEach((entry) => assert.equal(entry.value, false, `${entry.id} defaults to off`));
    assert.equal(settings.find((entry) => entry.id === 'toonwater_status').type, 'label');
  });

  test('both real optional features: each setting is a checkbox that starts unticked, each card is claimed by at most one feature, and the status of ToonWater is a label', () => {
    const optional = FEATURES.filter((feature) => feature.optional);
    const settings = settingsOf(driverOf(manifest()));

    assert.deepEqual(optional.map((feature) => feature.id), ['toonwater', 'export']);
    optional.forEach((feature) => {
      const setting = settings.find((entry) => entry.id === feature.setting);
      assert.equal(setting.type, 'checkbox', feature.setting);
      assert.equal(setting.value, false, feature.setting);
    });
    assert.equal(settings.find((entry) => entry.id === optional[0].statusSetting).type, 'label');
    const claimed = optional.flatMap(cardsOf);
    assert.deepEqual(claimed, [...new Set(claimed)], 'no card has two owners');
    assert.deepEqual(claimed.sort(), ['measure_water_changed', 'update_water']);
  });

  test('every toonwater.* key that the code asks for or names exists in en and nl, and each key of the feature texts is a toonwater.* key', () => {
    const files = ['lib/features/toonwater.js', 'lib/engine/optional.js', 'drivers/open-toon/device.js'];
    const sources = files.map(read).join('\n');
    const named = new Set([...sources.matchAll(/__\(\s*['"](toonwater\.[\w.]+)['"]/g), ...sources.matchAll(/['"](toonwater\.[\w.]+)['"]/g)].map((match) => match[1]));
    const texts = JSON.stringify(toonwater.texts).match(/toonwater\.[\w.]+/g);
    ['en', 'nl'].forEach((language) => {
      const dictionary = readJson(`locales/${language}.json`).toonwater;
      [...named, ...texts].forEach((key) => assert.equal(typeof dictionary[key.slice('toonwater.'.length)], 'string', `${key} in ${language}`));
      assert.deepEqual(Object.keys(dictionary).sort(), [...new Set(texts.map((key) => key.slice('toonwater.'.length)))].sort(), `${language}: no key without a use, none without a text`);
    });
  });

  test('a poll group that reports and holds back after failures says so with numbers, and the optional feature has what the engine needs to show it', () => {
    FEATURES.filter((feature) => feature.statusSetting).forEach((feature) => {
      ['probe', 'classify'].forEach((name) => assert.equal(typeof feature[name], 'function', `${feature.id}.${name}`));
      ['decidedByKey', 'firstNotFoundKey', 'hintSentKey'].forEach((name) => assert.equal(typeof feature[name], 'string', `${feature.id}.${name}`));
      assert.ok(feature.probeBudgetMs > 0 && feature.hintAfter404Ms > 0);
      Object.values(feature.texts.status).forEach((key) => assert.match(key, /^toonwater\./));
      assert.deepEqual(Object.keys(feature.texts.saved).sort(), Object.keys(feature.texts.status).sort(), 'a save message for every status');
    });
  });

  test('the optional capabilities the registry will own (ADR-0006, ADR-0016) are in capabilitiesOptions and not in the default list', () => {
    const driver = driverOf(manifest());
    const optional = ['measure_water', 'meter_water.today', 'meter_water.total', 'measure_power.export'];

    optional.forEach((id) => {
      assert.ok(Object.hasOwn(driver.capabilitiesOptions, id), `${id} keeps its options`);
      assert.equal(driver.capabilities.includes(id), false, `${id} is not a default capability`);
      assert.ok(new CapabilityModel(manifest()).definition(id), `${id} is a capability Homey knows`);
    });
  });

  test('every capability the driver lists is a capability Homey knows, custom ones from the manifest', () => {
    const app = manifest();
    const model = new CapabilityModel(app);

    driverOf(app).capabilities.forEach((id) => assert.ok(model.definition(id), id));
    assert.deepEqual(Object.keys(app.capabilities).sort(), ['burner_state', 'temperature_state']);
  });
});

describe('ADR-0001: checkRegistry reports every kind of disagreement (negative cases)', () => {
  const optionalFeature = (extra = {}) => ({ ...synthetic, ...extra });

  test('a synthetic feature without its manifest entries is reported, with them it passes', () => {
    const features = [...FEATURES, synthetic];

    assert.deepEqual(checkRegistry(manifest(), features), [
      'synthetic: optional capability measure_pressure has no entry in capabilitiesOptions',
      'synthetic: setting synthetic_enabled is not in the driver settings',
    ]);
    assert.deepEqual(checkRegistry(withSynthetic(manifest()), features), []);
  });

  test('a core capability that the driver does not list', () => {
    const app = manifest();
    driverOf(app).capabilities = driverOf(app).capabilities.filter((id) => id !== 'burner_state');

    assert.deepEqual(checkRegistry(app, FEATURES), ['core: capability burner_state is missing from the driver capabilities']);
  });

  test('an optional capability that is also a default capability', () => {
    const app = withSynthetic(manifest());
    driverOf(app).capabilities.push('measure_pressure');

    assert.deepEqual(checkRegistry(app, [...FEATURES, synthetic]), ['synthetic: optional capability measure_pressure must not be in the driver capabilities']);
  });

  test('a capability that no Homey knows', () => {
    const features = [...FEATURES, optionalFeature({ capabilities: ['measure_nonsense'] })];
    const app = withSynthetic(manifest());
    driverOf(app).capabilitiesOptions.measure_nonsense = {};

    assert.deepEqual(checkRegistry(app, features), ['synthetic: capability measure_nonsense is neither a custom nor a system capability']);
  });

  test('a switch that is not a checkbox, or does not start unticked, or whose status is not a label', () => {
    const features = [...FEATURES, optionalFeature({ statusSetting: 'synthetic_status' })];
    const app = withSynthetic(manifest());
    const setting = settingsOf(driverOf(app)).find((entry) => entry.id === 'synthetic_enabled');

    assert.deepEqual(checkRegistry(app, features), ['synthetic: statusSetting synthetic_status must be a label setting']);
    setting.value = true;
    assert.deepEqual(checkRegistry(app, [...FEATURES, synthetic]), ['synthetic: setting synthetic_enabled must be a checkbox with value false']);
    setting.value = false;
    setting.type = 'text';
    assert.deepEqual(checkRegistry(app, [...FEATURES, synthetic]), ['synthetic: setting synthetic_enabled must be a checkbox with value false']);
  });

  test('a card the manifest does not declare', () => {
    const features = [...FEATURES, optionalFeature({ cards: { guarded: ['update_nothing'], triggers: ['nothing_changed'] } })];

    assert.deepEqual(checkRegistry(withSynthetic(manifest()), features), [
      'synthetic: card update_nothing is not in the manifest',
      'synthetic: card nothing_changed is not in the manifest',
    ]);
  });

  test('two features that claim the same capability, the same id or the same poll group', () => {
    const twin = optionalFeature({ id: 'twin', setting: 'synthetic_enabled' });
    const problems = checkRegistry(withSynthetic(manifest()), [...FEATURES, synthetic, twin]);

    assert.ok(problems.includes('capability measure_pressure is claimed by synthetic and twin'), problems.join('\n'));
    assert.ok(problems.includes('poll group synthetic is claimed by synthetic and twin'), problems.join('\n'));
    assert.ok(checkRegistry(manifest(), [...FEATURES, ...FEATURES]).includes('feature core is claimed by core and core'));
  });

  test('a card that two features claim', () => {
    const features = [...FEATURES, optionalFeature({ cards: { guarded: ['update_water'], triggers: [] } })];

    assert.ok(checkRegistry(withSynthetic(manifest()), features).includes('card update_water is claimed by toonwater and synthetic'));
  });

  test('a poll group without a critical flag, a parser or an absolute endpoint path', () => {
    const group = (extra) => ({ ...synthetic.pollGroups[0], ...extra });
    const broken = [group({ critical: undefined }), group({ parse: undefined }), group({ endpoint: { path: 'synthetic.json' } })];

    broken.forEach((entry) => {
      const features = [...FEATURES, optionalFeature({ pollGroups: [entry] })];
      assert.deepEqual(checkRegistry(withSynthetic(manifest()), features), ['synthetic: poll group synthetic needs a boolean critical, a parse function and an endpoint path']);
    });
  });
});
