'use strict';

/*
 * NFR-06 AC4: a fixture that stands in for a hardware capture says so. Every file under test/fixtures/toon is
 * {source, payload}, the source names where the shape comes from, states "not captured" and carries HW-02.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  toonFixtureNames, toonFixture, toonPayload, jsonFixture, FIXTURE_DIR,
} = require('../helpers/fixtures');

describe('NFR-06 AC4: Toon fixtures are labelled as derived, not captured', () => {
  test('every file has a source and a payload and nothing else', () => {
    toonFixtureNames().forEach((name) => {
      const fixture = toonFixture(name);

      assert.deepEqual(Object.keys(fixture).sort(), ['payload', 'source'], name);
      assert.equal(typeof fixture.source, 'string', name);
      assert.match(fixture.source, /^derived from .+, not captured; HW-02$/, name);
    });
  });

  test('the fixture set is the one that ADR-0013 and the implementation plan name', () => {
    assert.deepEqual(toonFixtureNames(), [
      'getdevices-dev2-single-tariff', 'getdevices-dev2-two-tariff', 'getdevices-dev3', 'getdevices-empty', 'getdevices-missing-node',
      'hostile-null-node', 'hostile-own-property', 'hostile-proto', 'hostile-string-powerusage', 'hostile-water-array',
      'junk-empty-body', 'junk-empty-object', 'junk-html', 'junk-result-error', 'junk-truncated', 'junk-wrong-types',
      'power-feed-in', 'power-no-production', 'power',
      'thermostat-burner', 'thermostat-setpoint-1975', 'thermostat-states', 'thermostat',
      'water-esp-flat', 'water-html', 'water-no-total', 'water-ok',
    ].sort());
  });
});

describe('NFR-06 AC4: fixture content', () => {
  test('thermostat: every value is a string, activeState covers 0 1 2 3 4 -1 as strings and numbers, burnerInfo 0 to 3', () => {
    Object.entries(toonPayload('thermostat')).forEach(([key, value]) => assert.equal(typeof value, 'string', key));

    const states = toonPayload('thermostat-states');
    assert.deepEqual(['comfort', 'home', 'sleep', 'away', 'vacation', 'manual'].map((name) => states[name].activeState), ['0', '1', '2', '3', '4', '-1']);
    assert.deepEqual(['numeric-home', 'numeric-vacation', 'numeric-manual'].map((name) => states[name].activeState), [1, 4, -1]);
    const burner = toonPayload('thermostat-burner');
    assert.deepEqual(['off', 'heating', 'hot_water', 'preheating'].map((name) => burner[name].burnerInfo), ['0', '1', '2', '3']);
    assert.equal(toonPayload('thermostat-setpoint-1975').currentSetpoint, '1975');
  });

  test('power: with and without powerProduction, and no dayUsage anywhere (03 I6)', () => {
    assert.ok(Object.hasOwn(toonPayload('power'), 'powerProduction'));
    assert.ok(Object.hasOwn(toonPayload('power-feed-in'), 'powerProduction'));
    assert.equal(Object.hasOwn(toonPayload('power-no-production'), 'powerProduction'), false);
    ['power', 'power-feed-in', 'power-no-production'].forEach((name) => {
      assert.equal(Object.hasOwn(toonPayload(name).powerUsage, 'dayUsage'), false, name);
    });
  });

  test('getDevices: dev_2 two-tariff, dev_2 single-tariff with "NaN" nt node, dev_3, missing node, empty', () => {
    const two = toonPayload('getdevices-dev2-two-tariff');
    const single = toonPayload('getdevices-dev2-single-tariff');

    assert.match(two['dev_2.4'].CurrentElectricityQuantity, /^\d+$/);
    assert.match(two['dev_2.6'].CurrentElectricityQuantity, /^\d+$/);
    assert.equal(single['dev_2.4'].CurrentElectricityQuantity, 'NaN');
    assert.equal(single['dev_2.6'].CurrentElectricityQuantity, 'NaN');
    assert.match(single['dev_2.2'].CurrentElectricityQuantity, /^\d+$/);
    assert.ok(Object.keys(toonPayload('getdevices-dev3')).every((key) => key.startsWith('dev_3')));
    assert.equal(Object.hasOwn(toonPayload('getdevices-missing-node'), 'dev_2.4'), false);
    assert.deepEqual(toonPayload('getdevices-empty'), {});
  });

  test('water: ok, no total, flat ESP and HTML', () => {
    assert.deepEqual(Object.keys(toonPayload('water-ok').water), ['flow', 'total', 'value', 'avgValue']);
    assert.equal(Object.hasOwn(toonPayload('water-no-total').water, 'total'), false);
    assert.ok(Object.hasOwn(toonPayload('water-esp-flat'), 'waterquantity'));
    assert.match(toonPayload('water-html'), /^<html>/);
  });

  test('junk: empty object, result error, truncated, empty body, HTML, wrong types', () => {
    assert.deepEqual(toonPayload('junk-empty-object'), {});
    assert.deepEqual(toonPayload('junk-result-error'), { result: 'error' });
    assert.throws(() => JSON.parse(toonPayload('junk-truncated')));
    assert.equal(toonPayload('junk-empty-body'), '');
    assert.match(toonPayload('junk-html'), /^<!DOCTYPE html>/);
    assert.equal(toonPayload('junk-wrong-types').currentSetpoint, null);
  });

  test('hostile shapes of ADR-0003 are present as written, __proto__ as an own property', () => {
    assert.deepEqual(toonPayload('hostile-null-node'), { 'dev_2.4': null });
    assert.deepEqual(toonPayload('hostile-own-property'), { 'dev_2.4': { hasOwnProperty: 1 } });
    assert.deepEqual(toonPayload('hostile-water-array'), { water: [] });
    assert.deepEqual(toonPayload('hostile-string-powerusage'), { powerUsage: '460' });
    const proto = toonPayload('hostile-proto');
    assert.equal(Object.hasOwn(proto, '__proto__'), true);
    assert.equal(Object.getPrototypeOf(proto), Object.prototype);
    assert.equal({}.polluted, undefined);
  });

  test('payloads are fresh copies: changing one does not change the next read', () => {
    toonPayload('thermostat').currentTemp = 'changed';

    assert.equal(toonPayload('thermostat').currentTemp, '2034');
  });
});

describe('NFR-14 AC1: era and baseline fixtures', () => {
  test('eras.json holds the four device eras of 04 Appendix B and the three water value variants', () => {
    const eras = jsonFixture('eras.json');

    assert.deepEqual(Object.keys(eras.eras), ['era0', 'era1', 'era2', 'era3']);
    assert.deepEqual(Object.values(eras.eras).map((era) => era.capabilities.length), [6, 7, 10, 11]);
    assert.ok(eras.eras.era0.capabilities.includes('meter_power'));
    assert.deepEqual(Object.keys(eras.waterValueVariants), ['a', 'b', 'c']);
    assert.equal(eras.waterValueVariants.a.measure_water, 0, 'zero is a value, not null');
    assert.deepEqual(eras.addressVariants, ['0.0.0.0', '192.168.1.50:80', ' 192.168.1.50 ']);
    assert.deepEqual(eras.common.data, { id: 'ENECO-001-12391' });
  });

  test('baseline-app.json is parseable JSON of the baseline app', () => {
    const baseline = jsonFixture('baseline-app.json');

    assert.equal(baseline.id, 'nl.vinceste.open-toon');
    assert.equal(baseline.version, '1.0.0');
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(FIXTURE_DIR, 'baseline-app.json'))).digest('hex').length, 40);
  });
});
