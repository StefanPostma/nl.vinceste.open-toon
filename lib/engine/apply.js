'use strict';

/*
 * The only code that writes capability values (NFR-01 AC2). Values come from the parsers as {capability id ->
 * value}; here they are filtered, guarded and written, and the changes are reported:
 *  - only finite numbers, non-empty strings and booleans are written, never undefined, null or NaN;
 *  - an id the device does not hold is skipped (a device never holds every capability the parsers know);
 *  - a value that is not current any more (device gone, address changed, a write came in between) is dropped;
 *  - counters follow the decrease policy of ADR-0014;
 *  - an unchanged value is not written again; every failed write is caught, and logged once until it works again.
 * Which Flow trigger a change fires is no business of this file: the caller gets the changes. A caller that fails
 * does not make the write fail: the values are in, the failure is logged.
 */

/** Counters that only grow. A device that reports 0, NaN or a lower value is wrong, or has a new meter. */
const COUNTERS = Object.freeze(['meter_power.peak', 'meter_power.offPeak', 'meter_gas', 'meter_water.total']);
const LOWER_CYCLES = 3;
const MAX_NOTES = 20;

const isWritable = (value) => (typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean' || (typeof value === 'string' && value !== ''));

/**
 * The counter-decrease policy. 0, NaN and anything that is not a number never pass. A lower value is held back
 * until three cycles in a row deliver one: then it is the new baseline (meter replaced, counter reset on the Toon).
 * Values that are not counters always pass.
 * @param {(line: string) => void} info
 * @returns {(id: string, next: *, stored: *) => boolean} whether `next` may replace `stored`
 */
function createMeterGuard(info) {
  const lower = new Map();
  return (id, next, stored) => {
    if (!COUNTERS.includes(id)) return true;
    if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) return false;
    if (typeof stored !== 'number' || next >= stored) {
      lower.delete(id);
      return true;
    }
    const cycles = (lower.get(id) || 0) + 1;
    if (cycles < LOWER_CYCLES) {
      lower.set(id, cycles);
      return false;
    }
    lower.delete(id);
    info(`${id} was lower than ${stored} for ${LOWER_CYCLES} cycles in a row: accepting ${next} as the new baseline`);
    return true;
  };
}

/**
 * @param {object} options
 * @param {{hasCapability: Function, getCapabilityValue: Function, setCapabilityValue: Function}} options.device
 * @param {(line: string) => void} options.log
 * @param {(line: string) => void} options.error
 * @param {(changes: {id: string, prev: *, next: *}[]) => void} [options.onChanges]
 * @returns {(result: {values: object, notes?: string[]}, current: () => boolean) => Promise<{id: string, prev: *, next: *}[]>}
 *   applyValues: writes what may be written and returns the changes; never rejects
 */
function createApplier({
  device, log, error, onChanges,
}) {
  const guard = createMeterGuard(log);
  const noted = new Set();
  const failing = new Set();

  async function write({ id, next, prev }, current) {
    try {
      await device.setCapabilityValue(id, next);
      failing.delete(id);
      return { id, prev, next };
    } catch (cause) {
      if (current() && !failing.has(id)) error(`could not set ${id}: ${cause.message}`);
      failing.add(id);
      return null;
    }
  }

  return async function applyValues({ values, notes = [] }, current) {
    notes.filter((note) => !noted.has(note) && noted.size < MAX_NOTES).forEach((note) => {
      noted.add(note);
      log(note);
    });
    if (!current()) return [];
    const writes = Object.entries(values)
      .filter(([id, next]) => isWritable(next) && device.hasCapability(id))
      .map(([id, next]) => ({ id, next, prev: device.getCapabilityValue(id) }))
      .filter(({ id, next, prev }) => guard(id, next, prev) && prev !== next);
    const changes = (await Promise.all(writes.map((entry) => write(entry, current)))).filter(Boolean);
    if (changes.length > 0 && onChanges) {
      try {
        onChanges(changes);
      } catch (cause) {
        error(`the changes could not be passed on: ${cause.message}`);
      }
    }
    return changes;
  };
}

module.exports = { COUNTERS, createMeterGuard, createApplier };
