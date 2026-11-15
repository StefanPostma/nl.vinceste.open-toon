'use strict';

/*
 * Mutation preload for the QA pass (docs/sdlc/08-test-report.md section 7). With QA_MUTANT=<name> one behaviour of the
 * app is broken in memory, when the modules load, so that a test run can show whether the tests notice. Nothing on disk
 * changes and the application files are not touched. Load it after register.cjs:
 *
 *   QA_MUTANT=stop-is-a-no-op node --require ./test/helpers/register.cjs --require ./test/helpers/mutants.cjs --test "test/**\/*.test.js"
 *
 * scripts/qa-mutation.js runs every mutant against the suites and prints the table of the report.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// the mutants name the module they break by its path
// eslint-disable-next-line import/no-dynamic-require, global-require
const load = (file) => require(path.join(ROOT, file));

/** Every mutant: what it breaks, and the function that breaks it. */
const MUTANTS = {
  'water-polled-while-off': {
    breaks: 'ToonWater polling no longer depends on the setting: /water.html is read for every device (FR-51, FR-60)',
    apply() {
      const features = load('lib/features/index.js');
      const original = features.activeGroups;
      features.activeGroups = (state, list) => original({ ...state, toonwater: true }, list);
    },
  },
  'water-items-on-every-device': {
    breaks: 'a new or migrated device always gets the three water capabilities (FR-51, FR-56 AC3, FR-111 AC3)',
    apply() {
      const features = load('lib/features/index.js');
      const original = features.capabilitiesFor;
      features.capabilitiesFor = (state, list) => original({ ...state, toonwater: true }, list);
    },
  },
  'legacy-water-always-off': {
    breaks: 'the migration switches ToonWater off for devices that already have water data (FR-56 AC1)',
    apply() {
      const features = load('lib/features/index.js');
      const original = features.legacyDefaults;
      features.legacyDefaults = (...args) => Object.fromEntries(Object.keys(original(...args)).map((key) => [key, false]));
    },
  },
  'switch-off-keeps-the-items': {
    breaks: 'unticking ToonWater removes no capability (FR-53 AC1)',
    apply() {
      const capabilities = load('lib/engine/capabilities.js');
      const original = capabilities.reconcile;
      capabilities.reconcile = (device, plan, context) => original(device, { ...plan, remove: [] }, context);
    },
  },
  'stop-is-a-no-op': {
    breaks: 'deleting a device leaves its poller running (FR-84 AC1)',
    apply() {
      const { Poller } = load('lib/engine/poller.js');
      Poller.prototype.stop = function stop() {};
    },
  },
  'timer-never-cleared': {
    breaks: 'a poller that is cancelled or re-armed leaves its old timer behind, so loops multiply (FR-80 AC3, NFR-12)',
    apply() {
      const { Poller } = load('lib/engine/poller.js');
      Poller.prototype._disarm = function disarm() {
        this.timer = null;
      };
    },
  },
  'address-change-ignored': {
    breaks: 'a new address in the settings keeps the poller on the old Toon (FR-82 AC2)',
    apply() {
      const { Poller } = load('lib/engine/poller.js');
      Poller.prototype.reset = function reset() {};
    },
  },
  'never-unavailable': {
    breaks: 'the device never becomes unavailable, whatever the Toon does (FR-81 AC1)',
    apply() {
      const schedule = load('lib/engine/schedule.js');
      const original = schedule.createLedger;
      schedule.createLedger = (options) => original({ ...options, emit: (event) => (event.type === 'unavailable' ? undefined : options.emit(event)) });
    },
  },
  'never-available-again': {
    breaks: 'an unavailable device is not set available when the Toon answers again (FR-81 AC2)',
    apply() {
      const schedule = load('lib/engine/schedule.js');
      const original = schedule.createLedger;
      schedule.createLedger = (options) => original({ ...options, emit: (event) => (event.type === 'available' ? undefined : options.emit(event)) });
    },
  },
  'no-backoff': {
    breaks: 'an offline Toon is asked every interval for ever, the request rate never goes down (FR-81 AC3, NFR-03 AC2)',
    apply() {
      const schedule = load('lib/engine/schedule.js');
      schedule.backoffMs = (failures, interval) => interval;
    },
  },
  'missing-page-asked-every-cycle': {
    breaks: 'a /water.html that answers 404 is asked for again at every cycle (FR-57 AC1, NFR-03 AC2)',
    apply() {
      const schedule = load('lib/engine/schedule.js');
      const original = schedule.createLedger;
      schedule.createLedger = (options) => Object.assign(original(options), { held: () => false });
    },
  },
  'update-cards-resolve-silently': {
    breaks: 'the Update cards resolve when the Toon cannot be reached (FR-74 AC2, FR-73 AC2)',
    apply() {
      const { Poller } = load('lib/engine/poller.js');
      const original = Poller.prototype.refresh;
      Poller.prototype.refresh = async function refresh(...args) {
        const outcomes = await original.apply(this, args);
        return Object.fromEntries(Object.keys(outcomes).map((key) => [key, null]));
      };
    },
  },
  'first-value-fires-trigger': {
    breaks: 'the first value of a capability fires its trigger (FR-70 AC4)',
    apply() {
      const apply = load('lib/engine/apply.js');
      const original = apply.createApplier;
      apply.createApplier = (options) => original({
        ...options,
        onChanges: (changes) => options.onChanges(changes.map((change) => ({ ...change, prev: change.prev === null ? 'first' : change.prev }))),
      });
    },
  },
  'trigger-fires-twice': {
    breaks: 'every change fires its trigger twice (FR-70 AC1)',
    apply() {
      const apply = load('lib/engine/apply.js');
      const original = apply.createApplier;
      apply.createApplier = (options) => original({
        ...options,
        onChanges: (changes) => {
          options.onChanges(changes);
          options.onChanges(changes);
        },
      });
    },
  },
};

const name = process.env.QA_MUTANT;
if (name) {
  if (!Object.hasOwn(MUTANTS, name)) throw new Error(`Unknown mutant ${name}; known: ${Object.keys(MUTANTS).join(', ')}`);
  MUTANTS[name].apply();
}

module.exports = { MUTANTS };
