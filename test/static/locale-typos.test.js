'use strict';

/*
 * FR-101 AC1: the typos and leftovers of the baseline texts do not come back. The denylist is data
 * (test/fixtures/typos.json): one entry per phrase, the languages it is wrong in and the reason. It is matched
 * case-insensitively against every text of locales/<language>.json and against every en/nl text of the manifest.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { jsonFixture } = require('../helpers/fixtures');
const { readJson } = require('../helpers/paths');

const LANGUAGES = ['en', 'nl'];

/** @returns {{where: string, text: string}[]} every string below `node`, with its path */
function strings(node, where = '') {
  if (typeof node === 'string') return [{ where, text: node }];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => strings(value, where ? `${where}.${key}` : key));
}

/** The en and nl texts of the manifest: every string that sits below a key `en` or `nl`. */
function manifestTexts(manifest) {
  const found = [];
  const visit = (node, where) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${where}[${index}]`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    Object.entries(node).forEach(([key, value]) => {
      if (LANGUAGES.includes(key)) found.push(...strings(value, `${where}.${key}`).map((entry) => ({ language: key, ...entry })));
      else visit(value, `${where}.${key}`);
    });
  };
  visit(manifest, 'app.json');
  return found;
}

/**
 * @param {{where: string, text: string}[]} texts the texts of one language
 * @param {string} language
 * @param {{text: string, languages: string[], why: string}[]} denylist
 * @returns {string[]} one message per hit
 */
function typoHits(texts, language, denylist) {
  return denylist
    .filter((entry) => entry.languages.includes(language))
    .flatMap((entry) => texts
      .filter(({ text }) => text.toLowerCase().includes(entry.text.toLowerCase()))
      .map(({ where }) => `${where}: "${entry.text}" (${entry.why})`));
}

const denylist = jsonFixture('typos.json');

describe('FR-101 AC1: the typo denylist', () => {
  test('every entry names a phrase, at least one language of en and nl, and a reason', () => {
    denylist.forEach((entry) => {
      assert.equal(typeof entry.text, 'string');
      assert.ok(entry.text.length > 0);
      assert.ok(entry.languages.length > 0 && entry.languages.every((language) => LANGUAGES.includes(language)), entry.text);
      assert.ok(entry.why.length > 0, entry.text);
    });
  });

  test('it holds the phrases that the audit found in the baseline', () => {
    ['Somethink', 'happend', 'succesfull', 'an unique', 'Mi Home', 'IP adres', 'token', 'battery'].forEach((phrase) => {
      assert.ok(denylist.some((entry) => entry.text === phrase), phrase);
    });
  });

  test('the scanner finds a phrase in any case, only in the languages of its entry, and reports where', () => {
    const texts = [{ where: 'pair.error', text: 'SOMETHINK bad happend' }, { where: 'pair.address', text: 'Het IP adres' }, { where: 'pair.ok', text: 'Fine' }];

    assert.deepEqual(typoHits(texts, 'en', denylist).sort(), [
      'pair.address: "IP adres" (Dutch spelling in the English file; Dutch is \'IP-adres\')',
      'pair.error: "Somethink" (typo of \'something\' in the baseline pairing error)',
      'pair.error: "happend" (typo of \'happened\')',
    ].sort());
    assert.equal(typoHits(texts, 'nl', denylist).some((hit) => hit.includes('IP adres')), false, '"IP adres" is wrong in en only');
  });
});

describe('FR-101 AC1: no typo and no leftover of the Xiaomi app in the texts', () => {
  LANGUAGES.forEach((language) => {
    test(`locales/${language}.json holds none of the denied phrases`, () => {
      assert.deepEqual(typoHits(strings(readJson(`locales/${language}.json`)), language, denylist), []);
    });

    test(`the ${language} texts of the manifest hold none of the denied phrases`, () => {
      const texts = manifestTexts(readJson('app.json')).filter((entry) => entry.language === language);

      assert.ok(texts.length > 100, 'the scan sees the manifest texts');
      assert.deepEqual(typoHits(texts, language, denylist), []);
    });
  });

  test('FR-101 AC1: repair_migration_v3 exists in both locale files or in neither', () => {
    const [en, nl] = LANGUAGES.map((language) => Object.hasOwn(readJson(`locales/${language}.json`), 'repair_migration_v3'));

    assert.equal(en, nl);
  });

  test('the nl locale file has no English word of the baseline Xiaomi text left (token, battery, Mi Home)', () => {
    const text = JSON.stringify(readJson('locales/nl.json')).toLowerCase();

    ['token', 'battery', 'mi home'].forEach((phrase) => assert.equal(text.includes(phrase), false, phrase));
  });
});
