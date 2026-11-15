'use strict';

/*
 * The part of the app that every Toon has: the thermostat, the electricity and gas meters and the boiler.
 * It is a feature like any other (same shape, see index.js), except that it is always on. The hot-water
 * flag and the burner state come from the thermostat answer, so they live here and never switch with an
 * optional add-on (FR-31).
 */

const { ENDPOINTS } = require('../toon/commands');
const { parseThermostat, parsePower, parseMeters } = require('../toon/parse');

/** Peak and off-peak together in kWh, three decimals; a tariff that the Toon does not report (null) counts as nothing. */
const kwh = (value) => Math.round(((value('meter_power.peak') || 0) + (value('meter_power.offPeak') || 0)) * 1000) / 1000;

module.exports = Object.freeze({
  id: 'core',
  always: true,
  capabilities: Object.freeze([
    'target_temperature',
    'measure_temperature',
    'temperature_state',
    'meter_power.peak',
    'meter_power.offPeak',
    'measure_power',
    'meter_gas',
    'alarm_water.hotwater',
    'burner_state',
  ]),
  pollGroups: Object.freeze([
    Object.freeze({
      id: 'thermostat', critical: true, endpoint: ENDPOINTS.thermostat, parse: parseThermostat,
    }),
    Object.freeze({
      id: 'power', critical: false, endpoint: ENDPOINTS.power, parse: parsePower,
    }),
    Object.freeze({
      id: 'meters', critical: false, endpoint: ENDPOINTS.meters, parse: parseMeters,
    }),
  ]),
  /** The cards of the part every device has (ADR-0009). Every card of the manifest is claimed by exactly one feature. */
  cards: Object.freeze({
    actions: Object.freeze(['set_temperature_state', 'enable_program', 'disable_program', 'update_status', 'update_powerusage', 'update_metertotals']),
    conditions: Object.freeze(['temperature_state_is', 'hotwater_dispensing', 'burner_state_is']),
    triggers: Object.freeze([
      'meter_gas_changed', 'meter_power_changed', 'alarm_water_changed', 'temperature_state_changed', 'burner_state_changed_to',
    ]),
  }),
  /*
   * When a change fires a trigger (ADR-0009): `caps` are the capabilities whose change counts, `tokens(value)` and `state(value)`
   * are built from the values the device holds after the change. `source: 'homey'` marks a trigger that Homey fires itself for a
   * custom capability, so the app must not [HW-06]; if hardware shows that Homey does not, that one word becomes 'app'.
   */
  rules: Object.freeze([
    Object.freeze({ caps: Object.freeze(['meter_gas']), card: 'meter_gas_changed', tokens: (value) => ({ meter_gas: value('meter_gas') }) }),
    Object.freeze({
      caps: Object.freeze(['meter_power.peak', 'meter_power.offPeak']),
      card: 'meter_power_changed',
      tokens: (value) => ({ meter_power: kwh(value) }),
    }),
    Object.freeze({
      caps: Object.freeze(['alarm_water.hotwater']),
      card: 'alarm_water_changed',
      tokens: (value) => ({ 'alarm_water.hotwater': value('alarm_water.hotwater') }),
    }),
    Object.freeze({
      caps: Object.freeze(['temperature_state']),
      card: 'temperature_state_changed',
      source: 'homey',
      tokens: (value) => ({ temperature_state: value('temperature_state') }),
    }),
    Object.freeze({
      caps: Object.freeze(['burner_state']),
      card: 'burner_state_changed_to',
      tokens: (value) => ({ burner_state: value('burner_state') }),
      state: (value) => ({ state: value('burner_state') }), // the Flow's run listener compares it with the state the user chose
    }),
  ]),
});
