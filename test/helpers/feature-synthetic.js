'use strict';

/*
 * An imaginary fourth feature that exists only in tests: a switch, one capability, one poll group on its own
 * endpoint and a legacy rule, which is everything a real optional feature has. A test that registers it and
 * gets a setting, a poll group and a capability plan without any edit to lib/engine proves that the engine is
 * generic (ADR-0001, ADR-0013). It is never part of the real registry.
 */

const isRecord = (value) => typeof value === 'object' && value !== null;

module.exports = Object.freeze({
  id: 'synthetic',
  optional: true,
  setting: 'synthetic_enabled',
  capabilities: Object.freeze(['measure_pressure']),
  legacyIf: (capabilities) => capabilities.includes('measure_pressure'),
  pollGroups: Object.freeze([
    Object.freeze({
      id: 'synthetic',
      critical: false,
      endpoint: Object.freeze({ path: '/synthetic.json' }),
      parse: (json) => (isRecord(json) && typeof json.pressure === 'number' && Number.isFinite(json.pressure)
        ? { values: { measure_pressure: json.pressure }, notes: [] }
        : { values: {}, notes: ['unexpected'] }),
    }),
  ]),
});
