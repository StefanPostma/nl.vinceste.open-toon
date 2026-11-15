'use strict';

/*
 * FR-31 AC4 / NFR-14 AC1 (QA pass, docs/sdlc/08-test-report.md): what a user reads on the tile and in the tags of a
 * Flow is part of the stability contract. The contract test pins the ids; this one pins the titles, units and options
 * of every capability that the baseline (5cc3b90) had, and the values of its custom capability. New entries may be
 * added; nothing the baseline said may change.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { readJson } = require('../helpers/paths');
const { jsonFixture } = require('../helpers/fixtures');

const baseline = jsonFixture('baseline-app.json');
const current = readJson('app.json');
const driver = (manifest) => manifest.drivers.find((entry) => entry.id === 'open-toon');

describe('FR-31 AC4 / NFR-14 AC1: the titles and options of the baseline capabilities are unchanged', () => {
  test('every capabilitiesOptions entry of the baseline driver is still there, word for word, in en and nl', () => {
    const before = driver(baseline).capabilitiesOptions;
    const after = driver(current).capabilitiesOptions;
    assert.ok(Object.keys(before).length >= 6, 'the baseline has options to compare');
    Object.entries(before).forEach(([id, options]) => {
      assert.deepEqual(after[id], options, id);
    });
  });

  test('alarm_water.hotwater keeps its id and its title "Hot water dispensing" / "Warm water afgifte"', () => {
    assert.ok(driver(current).capabilities.includes('alarm_water.hotwater'));
    assert.deepEqual(driver(current).capabilitiesOptions['alarm_water.hotwater'].title, { en: 'Hot water dispensing', nl: 'Warm water afgifte' });
  });

  test('the custom capabilities of the baseline keep their title, type and every value they had (an enum may only grow)', () => {
    Object.entries(baseline.capabilities).forEach(([id, definition]) => {
      const now = current.capabilities[id];
      assert.ok(now, `${id} still exists`);
      assert.deepEqual(now.title, definition.title, `${id}: title`);
      assert.equal(now.type, definition.type, `${id}: type`);
      (definition.values || []).forEach((value) => {
        assert.deepEqual(now.values.find((entry) => entry.id === value.id), value, `${id}: value ${value.id}`);
      });
    });
  });
});
