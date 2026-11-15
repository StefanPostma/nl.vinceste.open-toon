'use strict';

/*
 * FR-100: every user-visible string exists in en and nl.
 *  - manifest text objects carry both languages (AC1);
 *  - every translation key the code asks for resolves in both locale files, and no key is left unused (AC2);
 * FR-101 AC2 follows from the first check: a key that the code asks for is never missing, so every key that was
 * removed from the baseline files was an unused one.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  ROOT, read, readJson, walk,
} = require('../helpers/paths');

const LANGUAGES = ['en', 'nl'];
const TEXT_KEYS = ['title', 'titleFormatted', 'hint', 'label', 'description'];

function flatten(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'object' && value !== null ? flatten(value, full) : [[full, value]];
  });
}

/** Code and views that may ask for translations. */
function sourceFiles() {
  const code = (file) => /\.(js|html)$/.test(file);
  return [
    ...(fs.existsSync(path.join(ROOT, 'app.js')) ? ['app.js'] : []),
    ...walk('drivers').filter(code),
    ...walk('lib').filter(code),
  ];
}

/** Keys asked for through __('key') and data-i18n="key", with the file that asks. */
function requestedKeys(file, source) {
  const calls = [...source.matchAll(/__\(\s*(['"])([^'"]+)\1/g)].map((match) => match[2]);
  const attributes = [...source.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
  return [...calls, ...attributes].map((key) => ({ key, file }));
}

/** Locale leaf keys that appear as a quoted string literal anywhere in the code (covers literal key tables). */
function literalKeys(source, known) {
  return known.filter((key) => source.includes(`'${key}'`) || source.includes(`"${key}"`));
}

function localizedProblems(node, where) {
  const problems = [];
  LANGUAGES.forEach((language) => {
    if (typeof node[language] !== 'string' || node[language].trim() === '') problems.push(`${where}: missing or empty ${language}`);
  });
  return problems;
}

/** FR-100 AC1: every user-visible text of the manifest has en and nl. */
function manifestProblems(manifest) {
  const problems = [];
  const visit = (node, where) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${where}[${index}]`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    Object.entries(node).forEach(([key, value]) => {
      const here = `${where}.${key}`;
      const isText = TEXT_KEYS.includes(key) || (key === 'name' && typeof value === 'object') || key === 'example';
      if (isText && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (key !== 'example' || LANGUAGES.some((language) => Object.hasOwn(value, language))) problems.push(...localizedProblems(value, here));
      } else if (TEXT_KEYS.includes(key) && typeof value === 'string') {
        problems.push(`${here}: a plain string where en and nl are required`);
      } else {
        visit(value, here);
      }
    });
  };
  visit(manifest, 'app.json');
  ['name', 'description'].forEach((key) => {
    if (typeof manifest[key] !== 'object') problems.push(`app.json.${key}: must be localized`);
  });
  (manifest.drivers || []).forEach((driver) => {
    if (typeof driver.name !== 'object') problems.push(`drivers.${driver.id}.name: must be localized`);
  });
  return problems;
}

describe('FR-100 AC1: manifest text objects carry en and nl', () => {
  test('app.json has en and nl on every user-visible text', () => {
    assert.deepEqual(manifestProblems(readJson('app.json')), []);
  });

  test('a missing language, an empty text and a plain string are reported', () => {
    const broken = {
      name: { en: 'x', nl: 'x' },
      description: { en: 'd', nl: 'd' },
      capabilities: { c: { title: { en: 'only english' }, values: [{ id: 'a', title: { en: 'a', nl: '  ' } }] } },
      flow: { actions: [{ id: 'z', title: 'plain', args: [{ name: 'device', type: 'device' }, { name: 'q', type: 'dropdown', values: [{ id: 'v', label: { nl: 'alleen nl' } }] }] }] },
      drivers: [{ id: 'd', name: 'plain', settings: [{ type: 'group', label: { en: 'g', nl: 'g' }, children: [{ id: 's', hint: { nl: 'x' } }] }] }],
    };
    const problems = manifestProblems(broken);

    assert.deepEqual(problems.sort(), [
      'app.json.capabilities.c.title: missing or empty nl',
      'app.json.capabilities.c.values[0].title: missing or empty nl',
      'app.json.drivers[0].settings[0].children[0].hint: missing or empty en',
      'app.json.flow.actions[0].args[1].values[0].label: missing or empty en',
      'app.json.flow.actions[0].title: a plain string where en and nl are required',
      'drivers.d.name: must be localized',
    ].sort());
  });
});

describe('FR-100 AC2: translation keys resolve in both locale files, none is unused', () => {
  const locales = Object.fromEntries(LANGUAGES.map((language) => [language, new Map(flatten(readJson(`locales/${language}.json`)))]));
  const known = [...new Set(LANGUAGES.flatMap((language) => [...locales[language].keys()]))].sort();
  const files = sourceFiles().map((file) => ({ file, source: read(file) }));

  test('FR-101 AC2: every key the code asks for exists in en and nl, so every key removed from the baseline was unused', () => {
    const missing = files.flatMap(({ file, source }) => requestedKeys(file, source))
      .flatMap(({ key, file }) => LANGUAGES.filter((language) => !locales[language].has(key)).map((language) => `${file} asks for ${key}, missing in ${language}`));

    assert.deepEqual(missing, []);
  });

  test('every locale text is a non-empty string', () => {
    const empty = LANGUAGES.flatMap((language) => [...locales[language]].filter(([, text]) => typeof text !== 'string' || text.trim() === '').map(([key]) => `${language}:${key}`));

    assert.deepEqual(empty, []);
  });

  test('FR-100 AC2: no key is unused and none exists in one language only', () => {
    const used = new Set(files.flatMap(({ file, source }) => [...requestedKeys(file, source).map((entry) => entry.key), ...literalKeys(source, known)]));
    const flagged = known.filter((key) => !used.has(key) || LANGUAGES.some((language) => !locales[language].has(key)));

    assert.deepEqual(flagged, []);
  });

  test('the scanners find __(), Homey.__(), this.homey.__() and data-i18n, and literal key tables', () => {
    const source = 'a(__(\'one.two\')); Homey.__("three"); this.homey.__(\'four\', {x: 1}); <p data-i18n="five.six"></p> const TABLE = {timeout: \'error.timeout\'};';

    assert.deepEqual(requestedKeys('x.js', source).map((entry) => entry.key), ['one.two', 'three', 'four', 'five.six']);
    assert.deepEqual(literalKeys(source, ['error.timeout', 'error.other']), ['error.timeout']);
  });

  test('FR-100 AC2: a key that the code asks for but a locale lacks is reported', () => {
    const asked = requestedKeys('drivers/x/device.js', 'this.homey.__(\'error.new_thing\')');
    const missing = asked.filter(({ key }) => !locales.en.has(key));

    assert.deepEqual(missing, [{ key: 'error.new_thing', file: 'drivers/x/device.js' }]);
  });
});
