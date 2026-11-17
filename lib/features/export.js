'use strict';

/*
 * Power export (ADR-0016, FR-25): the power a household feeds back into the grid, in watts, as a capability of its own.
 * It is the second optional feature and has no poll group of its own: parsePower reads `powerProduction` from the
 * answer of the power group that every device already polls, and the writer drops the value while the device does
 * not hold the capability. `measure_power` stays the import and is never negative (FR-27).
 */

module.exports = Object.freeze({
  id: 'export',
  optional: true,
  setting: 'export_enabled',
  capabilities: Object.freeze(['measure_power.export']),
  pollGroups: Object.freeze([]),
  refreshOnEnable: Object.freeze(['power']), // so that the first value does not wait for the next cycle
});
