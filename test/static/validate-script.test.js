'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLevel, driftedFiles, LEVELS } = require('../../scripts/validate');

describe('FR-120 AC1: scripts/validate.js', () => {
  test('validates at publish level unless told otherwise', () => {
    assert.equal(parseLevel([]), 'publish');
    assert.equal(parseLevel(['--level', 'verified']), 'verified');
    assert.deepEqual(LEVELS, ['debug', 'publish', 'verified']);
    assert.equal(LEVELS.includes(parseLevel(['--level', 'nonsense'])), false);
  });

  test('a file the CLI rewrote counts as drift, an untouched one does not', () => {
    const before = { 'app.json': 'a', 'locales/en.json': 'b', 'locales/nl.json': 'c' };

    assert.deepEqual(driftedFiles(before, { ...before }), []);
    assert.deepEqual(driftedFiles(before, { ...before, 'app.json': 'changed' }), ['app.json']);
    assert.deepEqual(driftedFiles(before, { ...before, 'locales/en.json': 'x', 'locales/nl.json': 'y' }), ['locales/en.json', 'locales/nl.json']);
  });
});
