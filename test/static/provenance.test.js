'use strict';

/*
 * NFR-11 AC1 (QA pass, docs/sdlc/08-test-report.md): the part of the licensing rule that a test can see. The review that
 * the code of the water feature is not a copy of the unlicensed sources stays a human review; what is checked here is
 * that the code says where it comes from, that the docs record the licence of the sources, and that no marker of
 * the unlicensed code (its language, its file names, a copyright line) is in the code of the app.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { read, walk } = require('../helpers/paths');

const CODE_DIRS = ['lib', 'drivers', 'scripts'];

describe('NFR-11 AC1: the water feature records its provenance', () => {
  const feature = read('lib/features/toonwater.js');
  const header = feature.slice(0, feature.indexOf('const {'));

  test('the header of the one file that names /water.html says what it was written from, and what it was not', () => {
    assert.match(header, /Provenance/);
    assert.match(header, /interface description/i);
    assert.match(header, /GPL-3\.0/);
    assert.match(header, /PR #21/);
    assert.match(header, /No source file of the unlicensed oepi-loepi/);
  });

  test('the requirements and the reuse inventory record that the sources carry no licence and were read for the interface only', () => {
    const requirements = read('docs/sdlc/01-requirements.md');
    const section = requirements.slice(requirements.indexOf('## 13. Provenance and licensing record'));
    assert.match(section, /no licence/i);
    assert.match(section, /all-rights-reserved/i);
    assert.match(section, /only[\s\S]{0,40}to learn the Toon HTTP interface/i);
    assert.match(read('docs/sdlc/03-reuse-inventory.md'), /Interface knowledge only/);
  });

  test('no file of the app, its tests excepted, carries a copyright line, a QML marker or the name of a file of the unlicensed code', () => {
    const markers = [/copyright\s*(\(c\)|©|\d{4})/i, /\bqml\b/i, /ToonWaterApp/, /\bimport\s+qs\b/i, /\bimport\s+BxtClient\b/];
    const offenders = CODE_DIRS.flatMap(walk)
      .filter((file) => /\.(js|cjs|html|json)$/.test(file) && !file.startsWith('drivers/open-toon/assets/'))
      .filter((file) => markers.some((marker) => marker.test(read(file))));
    assert.ok(CODE_DIRS.flatMap(walk).length > 20, 'the scan did look at the code');
    assert.deepEqual(offenders, []);
  });
});
