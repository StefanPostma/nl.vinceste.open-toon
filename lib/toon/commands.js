'use strict';

/*
 * What can be asked of the Toon, as endpoint objects {path, query} for ToonClient#get (never as strings, so
 * nothing a Flow supplies can reach a URL unchecked, NFR-04 AC4). Writes return a request list, a read is a
 * single endpoint. Arguments are validated first; a bad one throws ToonError('config') and no request exists.
 */

const { ToonError } = require('./errors');
const { TEMPERATURE_STATES, SETPOINT_RANGE } = require('./parse');

const THERMOSTAT = '/happ_thermstat';
/** The presets a user may switch to; vacation and none are read-only. */
const WRITABLE_STATES = Object.freeze(['comfort', 'home', 'sleep', 'away']);

const ENDPOINTS = Object.freeze({
  thermostat: Object.freeze({ path: THERMOSTAT, query: Object.freeze({ action: 'getThermostatInfo' }) }),
  power: Object.freeze({ path: '/happ_pwrusage', query: Object.freeze({ action: 'GetCurrentUsage' }) }),
  meters: Object.freeze({ path: '/hdrv_zwave', query: Object.freeze({ action: 'getDevices.json' }) }),
});

const changeScheme = (query) => ({ path: THERMOSTAT, query: { action: 'changeSchemeState', ...query } });

/*
 * resume_program of set_temperature_state (ADR-0015). `yes` is the temporary override that the baseline
 * always sent. `no` is a placeholder until hardware shows how to switch the program off and keep a preset
 * [HW-04]; if no sequence works it becomes identical to `yes`.
 */
const RESUME = Object.freeze({
  yes: (temperatureState) => [changeScheme({ state: 2, temperatureState })],
  no: (temperatureState) => [changeScheme({ state: 0, temperatureState })],
});

/** @returns {{path: string, query: object}[]} one request: the setpoint in whole centi-degrees */
function setpoint(degrees) {
  if (typeof degrees !== 'number' || !Number.isFinite(degrees) || degrees < SETPOINT_RANGE.min || degrees > SETPOINT_RANGE.max) {
    throw new ToonError('config');
  }
  const stepped = Math.round(degrees * 2) / 2; // the capability steps by 0.5 (ADR-0005)
  return [{ path: THERMOSTAT, query: { action: 'setSetpoint', Setpoint: Math.round(stepped * 100) } }];
}

/**
 * @param {string} state one of WRITABLE_STATES
 * @param {string} [resume] 'yes' (also when unset) or 'no'
 * @returns {{path: string, query: object}[]}
 */
function scheme(state, resume) {
  const mode = resume === undefined || resume === null ? 'yes' : resume;
  if (!WRITABLE_STATES.includes(state) || typeof mode !== 'string' || !Object.hasOwn(RESUME, mode)) throw new ToonError('config');
  return RESUME[mode](TEMPERATURE_STATES[state]);
}

const programOn = () => [changeScheme({ state: 1 })];
const programOff = () => [changeScheme({ state: 0 })];

module.exports = {
  ENDPOINTS, RESUME, WRITABLE_STATES, setpoint, scheme, programOn, programOff,
};
