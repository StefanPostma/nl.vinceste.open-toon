'use strict';

/*
 * The manifest as Homey Compose produces it (app.json from .homeycompose/**, driver.compose.json,
 * driver.settings.compose.json, driver.flow.compose.json): the definitions the design needs exist, in en and nl,
 * and say what the ADRs say. The stability contract against the baseline is test/static/contract.test.js; the
 * agreement with the feature registry is test/static/registry-vs-manifest.test.js.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { BURNER_STATES, TEMPERATURE_STATES } = require('../../lib/toon/parse');
const { jsonFixture } = require('../helpers/fixtures');
const { ROOT, readJson } = require('../helpers/paths');

const app = readJson('app.json');
const baseline = jsonFixture('baseline-app.json');
const driver = app.drivers.find((entry) => entry.id === 'open-toon');
const settings = driver.settings.flatMap((entry) => (entry.type === 'group' ? entry.children : [entry]));
const setting = (id) => settings.find((entry) => entry.id === id);
const groupOf = (id) => driver.settings.find((entry) => entry.type === 'group' && entry.children.some((child) => child.id === id));
const cards = ['triggers', 'conditions', 'actions'].flatMap((kind) => app.flow[kind].map((card) => ({ kind, card })));
const card = (kind, id) => app.flow[kind].find((entry) => entry.id === id);
const argOf = (entry, name) => entry.args.find((arg) => arg.name === name);
const ids = (list) => list.map((entry) => entry.id);
const LANGUAGES = ['en', 'nl'];

/** Every object with an `en` or an `nl` key, with its path. */
function localizedTexts(node, where = 'app.json') {
  if (Array.isArray(node)) return node.flatMap((item, index) => localizedTexts(item, `${where}[${index}]`));
  if (typeof node !== 'object' || node === null) return [];
  const own = Object.hasOwn(node, 'en') || Object.hasOwn(node, 'nl') ? [[where, node]] : [];
  return [...own, ...Object.entries(node).flatMap(([key, value]) => localizedTexts(value, `${where}.${key}`))];
}

const usable = (text) => (Array.isArray(text) ? text.length > 0 && text.every(usable) : typeof text === 'string' && text.trim() !== '');
const inversions = (text) => [...text.matchAll(/!\{\{([^}]*)\}\}/g)].map((match) => match[1]);
const placeholders = (text) => [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]);

describe('NFR-07 AC1: platform declaration and the version (ADR-0004)', () => {
  test('NFR-07 AC1: the app is local-only, the driver talks over the LAN, the floor is 12.9.0, SDK 3', () => {
    assert.deepEqual(app.platforms, ['local']);
    assert.deepEqual(driver.platforms, ['local']);
    assert.deepEqual(driver.connectivity, ['lan']);
    assert.equal(app.compatibility, '>=12.9.0');
    assert.equal(app.sdk, 3);
    assert.deepEqual(app.permissions, []);
  });

  test('FR-120 AC1: the version is plain semver, 2.0.0, and package.json agrees', () => {
    assert.equal(app.version, '2.0.0');
    assert.match(app.version, /^\d+\.\d+\.\d+$/);
    assert.equal(readJson('package.json').version, app.version);
    assert.equal(readJson('.homeycompose/app.json').version, app.version);
  });

  test('NFR-11 AC3: every contributor of the baseline is still credited', () => {
    assert.ok(baseline.contributors.developers.length >= 2);
    baseline.contributors.developers.forEach((developer) => {
      assert.ok(app.contributors.developers.some((entry) => entry.name === developer.name), developer.name);
    });
    assert.equal(app.author.name, baseline.author.name);
  });

  test('ADR-0002 item 4: store metadata is there, the description is not the name, the links are the repository of the owner', () => {
    assert.match(app.brandColor, /^#[0-9A-Fa-f]{6}$/);
    assert.equal(app.category, 'climate');
    LANGUAGES.forEach((language) => {
      assert.notEqual(app.description[language], app.name[language], `${language} description repeats the name`);
      assert.ok(app.description[language].length > 20, `${language} description`);
      assert.ok(app.tags[language].length >= 3, `${language} tags`);
    });
    const repository = 'https://github.com/StefanPostma/nl.vinceste.open-toon';
    assert.equal(app.source, repository);
    assert.equal(app.homepage, repository);
    assert.equal(app.bugs.url, `${repository}/issues`);
    assert.equal(app.support, `${repository}/issues`);
    assert.deepEqual(app.images, baseline.images);
  });
});

describe('ADR-0002: the manifest comes from Homey Compose sources', () => {
  test('the compose sources exist, the generated file says so, and .homeycompose/locales does not exist', () => {
    ['.homeycompose/app.json', '.homeycompose/capabilities/temperature_state.json', '.homeycompose/capabilities/burner_state.json',
      'drivers/open-toon/driver.compose.json', 'drivers/open-toon/driver.settings.compose.json', 'drivers/open-toon/driver.flow.compose.json'].forEach((file) => {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
    });
    assert.equal(fs.existsSync(path.join(ROOT, '.homeycompose', 'locales')), false, 'Compose would merge it into the hand-written /locales');
    assert.match(app._comment, /generated/i);
  });

  test('the Flow cards live in driver.flow.compose.json only: a card in an app-level compose folder would miss the device argument', () => {
    ['flow', 'drivers'].forEach((folder) => assert.equal(fs.existsSync(path.join(ROOT, '.homeycompose', folder)), false, `.homeycompose/${folder}`));
  });
});

describe('FR-100 AC1: en and nl on every text of the composed manifest', () => {
  test('every object with a language key has a non-empty en and nl text (tags: a list)', () => {
    const problems = localizedTexts(app).flatMap(([where, text]) => LANGUAGES
      .filter((language) => !usable(text[language]))
      .map((language) => `${where}: ${language}`));

    assert.deepEqual(problems, []);
    assert.ok(localizedTexts(app).length > 100, 'the walker really visited the manifest');
  });
});

describe('FR-12 and FR-30 AC1: the capability definitions', () => {
  test('FR-12: temperature_state keeps the baseline values and adds vacation, still a setable picker', () => {
    const definition = app.capabilities.temperature_state;

    assert.deepEqual(ids(definition.values), [...ids(baseline.capabilities.temperature_state.values), 'vacation']);
    assert.deepEqual(definition.values.find((value) => value.id === 'vacation').title, { en: 'Vacation', nl: 'Vakantie' });
    assert.equal(definition.type, 'enum');
    assert.equal(definition.setable, true);
    assert.equal(definition.getable, true);
  });

  test('FR-12: the values of the capability are exactly the names the parser produces', () => {
    assert.deepEqual(ids(app.capabilities.temperature_state.values).sort(), Object.keys(TEMPERATURE_STATES).sort());
  });

  test('FR-30: burner_state is a read-only sensor enum without insights, with the four values of the parser table', () => {
    const definition = app.capabilities.burner_state;

    assert.equal(definition.type, 'enum');
    assert.equal(definition.getable, true);
    assert.equal(definition.setable, false);
    assert.equal(definition.uiComponent, 'sensor');
    assert.equal(definition.insights, false);
    assert.deepEqual(ids(definition.values), ['off', 'heating', 'hot_water', 'preheating']);
    assert.deepEqual(ids(definition.values), BURNER_STATES, 'the table of burnerInfo -> value and the manifest agree');
    assert.deepEqual(Object.keys(app.capabilities).sort(), ['burner_state', 'temperature_state']);
  });
});

describe('FR-32: the burner Flow cards (ADR-0009)', () => {
  test('FR-32: the trigger burner_state_changed_to has a state dropdown (any and the four states) and a token', () => {
    const trigger = card('triggers', 'burner_state_changed_to');
    const state = argOf(trigger, 'state');

    assert.equal(state.type, 'dropdown');
    assert.equal(state.value, 'any');
    assert.deepEqual(ids(state.values), ['any', ...BURNER_STATES]);
    assert.deepEqual(trigger.tokens.map((token) => [token.name, token.type]), [['burner_state', 'string']]);
    LANGUAGES.forEach((language) => assert.ok(trigger.titleFormatted[language].includes('[[state]]')));
  });

  test('FR-32: the condition burner_state_is has a state dropdown with the four states', () => {
    const condition = card('conditions', 'burner_state_is');
    const state = argOf(condition, 'state');

    assert.equal(state.type, 'dropdown');
    assert.equal(state.value, 'heating');
    assert.deepEqual(ids(state.values), BURNER_STATES);
    LANGUAGES.forEach((language) => {
      assert.ok(condition.titleFormatted[language].includes('[[state]]'));
      assert.ok(condition.titleFormatted[language].includes('!{{is|'));
    });
  });

  test('FR-32: no card carries the id Homey runs by itself for a custom enum capability (HS-42)', () => {
    assert.equal(cards.some(({ card: entry }) => entry.id === 'burner_state_changed'), false);
    assert.equal(cards.some(({ card: entry }) => entry.id === 'burner_state_changed_to'), true);
  });

  test('FR-12: vacation is a dropdown value of temperature_state_is and not of set_temperature_state', () => {
    const condition = ids(argOf(card('conditions', 'temperature_state_is'), 'state').values);
    const action = ids(argOf(card('actions', 'set_temperature_state'), 'state').values);

    assert.deepEqual(condition, [...ids(argOf(baseline.flow.conditions.find((entry) => entry.id === 'temperature_state_is'), 'state').values), 'vacation']);
    assert.equal(argOf(card('conditions', 'temperature_state_is'), 'state').value, 'comfort');
    assert.deepEqual(action, ['comfort', 'home', 'sleep', 'away']);
    assert.equal(action.includes('vacation'), false);
  });
});

describe('FR-71 and FR-75: deprecations (ADR-0007, ADR-0009)', () => {
  test('FR-71 AC1: meter_gas_changed and measure_water_changed are deprecated, the other three triggers are not', () => {
    const deprecated = app.flow.triggers.filter((trigger) => trigger.deprecated === true);

    assert.deepEqual(ids(deprecated), ['meter_gas_changed', 'measure_water_changed']);
    assert.deepEqual(ids(app.flow.triggers.filter((trigger) => !trigger.deprecated)), ['meter_power_changed', 'temperature_state_changed', 'alarm_water_changed', 'burner_state_changed_to']);
  });

  test('FR-75 AC1: update_powerusage, update_metertotals and update_water are deprecated, update_status is not and reads "Update now"', () => {
    ['update_powerusage', 'update_metertotals', 'update_water'].forEach((id) => assert.equal(card('actions', id).deprecated, true, id));
    assert.equal(card('actions', 'update_status').deprecated, undefined);
    assert.deepEqual(card('actions', 'update_status').title, { en: 'Update now', nl: 'Update nu' });
  });

  test('FR-75 AC1: exactly five cards are deprecated and no condition is', () => {
    assert.deepEqual(cards.filter(({ card: entry }) => entry.deprecated).map(({ card: entry }) => entry.id).sort(),
      ['measure_water_changed', 'meter_gas_changed', 'update_metertotals', 'update_powerusage', 'update_water']);
    assert.equal(app.flow.conditions.some((condition) => condition.deprecated), false);
  });
});

describe('FR-77 AC1: Flow card text quality', () => {
  test('FR-77 AC1: every card has a title in en and nl and a device argument first, with the same filter', () => {
    assert.equal(cards.length, 16);
    cards.forEach(({ kind, card: entry }) => {
      LANGUAGES.forEach((language) => assert.ok(entry.title[language], `${kind}:${entry.id} title ${language}`));
      assert.deepEqual(entry.args[0], { type: 'device', name: 'device', filter: 'driver_id=open-toon' }, `${kind}:${entry.id}`);
    });
  });

  test('FR-77 AC1: a card with arguments besides the device has a titleFormatted that names each of them, nothing else', () => {
    cards.forEach(({ kind, card: entry }) => {
      const names = entry.args.filter((arg) => arg.type !== 'device').map((arg) => arg.name);
      if (names.length === 0) return;
      LANGUAGES.forEach((language) => {
        assert.ok(entry.titleFormatted && entry.titleFormatted[language], `${kind}:${entry.id} titleFormatted ${language}`);
        assert.deepEqual([...new Set(placeholders(entry.titleFormatted[language]))].sort(), [...names].sort(), `${kind}:${entry.id} ${language}`);
      });
    });
  });

  test('FR-77 AC1: every dropdown argument has a title, every value a title and a label (equal) in en and nl, and the default is one of them', () => {
    const dropdowns = cards.flatMap(({ kind, card: entry }) => entry.args.filter((arg) => arg.type === 'dropdown').map((arg) => ({ where: `${kind}:${entry.id}.${arg.name}`, arg })));

    assert.equal(dropdowns.length, 5);
    dropdowns.forEach(({ where, arg }) => {
      LANGUAGES.forEach((language) => assert.ok(arg.title[language], `${where} title ${language}`));
      assert.ok(ids(arg.values).includes(arg.value), `${where} default ${arg.value}`);
      arg.values.forEach((value) => {
        LANGUAGES.forEach((language) => {
          assert.ok(value.title[language], `${where}.${value.id} title ${language}`);
          assert.equal(value.label[language], value.title[language], `${where}.${value.id} label ${language}`);
        });
      });
    });
  });

  test('FR-77 AC1: no "||" in any titleFormatted, every !{{a|b}} has two non-empty parts in both languages, no parentheses in titles', () => {
    cards.forEach(({ kind, card: entry }) => {
      ['title', 'titleFormatted'].filter((key) => entry[key]).forEach((key) => {
        LANGUAGES.forEach((language) => {
          const text = entry[key][language];
          const where = `${kind}:${entry.id}.${key}.${language}`;
          assert.equal(text.includes('||'), false, where);
          assert.equal(/[()]/.test(text), false, `${where} has parentheses`);
          inversions(text).forEach((inversion) => {
            const parts = inversion.split('|');
            assert.ok(parts.length === 2 && parts.every((part) => part.trim() !== ''), `${where}: !{{${inversion}}}`);
          });
        });
        assert.equal(inversions(entry[key].en).length, inversions(entry[key].nl).length, `${kind}:${entry.id}.${key}: en and nl invert the same number of times`);
      });
    });
  });

  test('FR-77 AC1: the Dutch condition texts use !{{is|is niet}}', () => {
    assert.equal(card('conditions', 'temperature_state_is').titleFormatted.nl, 'Huidige temperatuurstand !{{is|is niet}} gelijk aan [[state]]');
    assert.equal(card('conditions', 'temperature_state_is').title.nl, 'Temperatuurstand !{{is|is niet}}');
    assert.equal(card('conditions', 'burner_state_is').title.nl, 'Brander-stand !{{is|is niet}}');
  });

  test('FR-120 AC1: set_temperature_state names [[state]] and [[resume_program]] in en and nl (the validator demands both)', () => {
    LANGUAGES.forEach((language) => {
      const text = card('actions', 'set_temperature_state').titleFormatted[language];
      assert.ok(text.includes('[[state]]'), language);
      assert.ok(text.includes('[[resume_program]]'), language);
    });
  });

  test('the token title of meter_power_changed says kWh in both languages (the baseline said Wh for a sum in kWh)', () => {
    assert.deepEqual(card('triggers', 'meter_power_changed').tokens[0].title, { en: 'kWh', nl: 'kWh' });
    assert.equal(card('triggers', 'meter_power_changed').tokens[0].name, 'meter_power');
  });
});

describe('FR-50 AC1 and FR-83: the device settings', () => {
  test('FR-83: poll_interval is a number from 10 to 3600 seconds, default 30, with the hint of the requirement', () => {
    const interval = setting('poll_interval');

    assert.equal(interval.type, 'number');
    assert.deepEqual([interval.value, interval.min, interval.max, interval.step], [30, 10, 3600, 1]);
    assert.deepEqual(interval.hint, {
      en: 'How often Homey reads the Toon. Lower values put more load on the Toon.',
      nl: 'Hoe vaak Homey de Toon uitleest. Lagere waarden belasten de Toon meer.',
    });
    assert.equal(groupOf('poll_interval'), groupOf('address'));
  });

  test('address keeps its id and default, has a hint, and a pattern that accepts what the app accepts and refuses https and IPv6', () => {
    const address = setting('address');
    const pattern = new RegExp(address.pattern);

    assert.equal(address.value, '0.0.0.0');
    assert.equal(address.type, 'text');
    assert.doesNotThrow(() => new RegExp(address.pattern, 'v'), 'browsers compile a pattern attribute with the v flag');
    LANGUAGES.forEach((language) => assert.ok(address.hint[language]));
    ['0.0.0.0', '192.168.1.50', '192.168.1.50:80', 'toon.local', 'http://192.168.1.50/', ' 192.168.1.50 '].forEach((text) => assert.ok(pattern.test(text), text));
    ['', 'https://192.168.1.50', 'fe80::1', '[fe80::1]', '192.168.1.50:abc', '192 168 1 50', 'a/b'].forEach((text) => assert.equal(pattern.test(text), false, text));
  });

  // The definitions behind FR-85 (visible status and last problem); the device writes them in a later slice.
  test('last_update and last_problem are read-only labels in a status group of their own', () => {
    ['last_update', 'last_problem'].forEach((id) => {
      assert.equal(setting(id).type, 'label', id);
      assert.equal(groupOf(id), groupOf('last_update'));
    });
    assert.notEqual(groupOf('last_update'), groupOf('address'));
  });

  test('FR-50 AC1: toonwater_enabled is a checkbox (off), with label and hint in en and nl, in the group "ToonWater (optional add-on)"', () => {
    const toggle = setting('toonwater_enabled');
    const group = groupOf('toonwater_enabled');

    assert.equal(toggle.type, 'checkbox');
    assert.equal(toggle.value, false);
    assert.deepEqual(group.label, { en: 'ToonWater (optional add-on)', nl: 'ToonWater (optionele add-on)' });
    assert.deepEqual(toggle.label, { en: 'Enable ToonWater water meter', nl: 'ToonWater-watermeter inschakelen' });
    LANGUAGES.forEach((language) => assert.ok(toggle.hint[language].length > 100, language));
  });

  test('FR-50 AC1: the ToonWater hint says what it adds, that turning it off breaks Flows, and that Insights history may be lost (ADR-0006)', () => {
    const { hint } = setting('toonwater_enabled');

    assert.ok(hint.en.includes('the add-on that makes your water readings available on the Toon'));
    assert.ok(hint.en.includes('Flows that use them will break and their Insights history may be lost'));
    assert.ok(hint.en.endsWith('After turning it back on, check those Flows.'));
    assert.ok(hint.nl.includes('de add-on die je watergegevens beschikbaar maakt op de Toon'));
    assert.ok(hint.nl.includes('Insights-geschiedenis kan verloren gaan'));
    assert.ok(hint.nl.endsWith('Controleer die Flows na het opnieuw inschakelen.'));
  });

  test('FR-50 AC1: toonwater_status is a read-only label in the same group; the groups run connection, status, ToonWater, export', () => {
    assert.equal(setting('toonwater_status').type, 'label');
    assert.equal(groupOf('toonwater_status'), groupOf('toonwater_enabled'));
    assert.deepEqual(driver.settings.map((group) => group.children.map((child) => child.id)), [
      ['address', 'poll_interval'], ['last_update', 'last_problem'], ['toonwater_enabled', 'toonwater_status'], ['export_enabled'],
    ]);
  });

  test('the export switch is a checkbox (off) in the group "Power export (optional)"', () => {
    assert.equal(setting('export_enabled').type, 'checkbox');
    assert.equal(setting('export_enabled').value, false);
    assert.deepEqual(groupOf('export_enabled').label, { en: 'Power export (optional)', nl: 'Teruglevering (optioneel)' });
  });
});

describe('FR-90: Homey Energy stays as it is (ADR-0016, deferred behind hardware)', () => {
  test('FR-90: the energy block is byte-identical to the baseline and names no imported or exported capability', () => {
    assert.equal(JSON.stringify(driver.energy), JSON.stringify(baseline.drivers[0].energy));
    assert.equal(JSON.stringify(driver.energy), '{"cumulative":true}');
  });

  test('FR-90: no imported-energy capability, no plain meter_power or meter_water exists on the driver', () => {
    const named = [...driver.capabilities, ...Object.keys(driver.capabilitiesOptions)];

    ['meter_power', 'meter_power.imported', 'meter_power.exported', 'meter_water'].forEach((id) => assert.equal(named.includes(id), false, id));
  });
});

describe('ADR-0006, ADR-0016, ADR-0017: the default capability list and the options superset', () => {
  // FR-51 AC1, manifest side: a new device starts without water. The test that proves it on a device is a later slice.
  test('the driver lists the nine core capabilities and no water capability; the water trio and the export keep their options', () => {
    const water = ['measure_water', 'meter_water.today', 'meter_water.total'];

    assert.equal(driver.capabilities.length, 9);
    water.forEach((id) => assert.equal(driver.capabilities.includes(id), false, id));
    [...water, 'measure_power.export'].forEach((id) => assert.ok(Object.hasOwn(driver.capabilitiesOptions, id), id));
    assert.deepEqual(driver.capabilitiesOptions['meter_water.today'], baseline.drivers[0].capabilitiesOptions['meter_water.today']);
    assert.deepEqual(driver.capabilitiesOptions['meter_water.total'], baseline.drivers[0].capabilitiesOptions['meter_water.total']);
    assert.deepEqual(driver.capabilitiesOptions.target_temperature, baseline.drivers[0].capabilitiesOptions.target_temperature);
  });

  test('every capability option of the baseline survives unchanged', () => {
    Object.entries(baseline.drivers[0].capabilitiesOptions).forEach(([id, options]) => assert.deepEqual(driver.capabilitiesOptions[id], options, id));
  });

  test('the driver keeps its class, name, images and pairing view', () => {
    const before = baseline.drivers[0];

    assert.equal(driver.class, before.class);
    assert.deepEqual(driver.name, before.name);
    assert.deepEqual(driver.images, before.images);
    assert.deepEqual(driver.pair, before.pair);
  });
});
