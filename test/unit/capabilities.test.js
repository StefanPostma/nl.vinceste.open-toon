'use strict';

/*
 * What saving device settings means (planSettingsChange), and the code that applies a capability plan to a device
 * (reconcile, migrate), against a stub device that records every Homey call. The era matrix on the real device is in
 * test/scenario/migration-eras.test.js; the pure plans are in planners.test.js.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FEATURES, CORE,
} = require('../../lib/features');
const {
  MIGRATION_VERSION, planSettingsChange, reconcile, migrate,
} = require('../../lib/engine/capabilities');
const synthetic = require('../helpers/feature-synthetic');
const { jsonFixture } = require('../helpers/fixtures');

const { eras } = jsonFixture('eras.json');
const PLAIN = FEATURES.filter((feature) => feature.always); // the part every device has; the optional features have their own tests
const WITH_SYNTHETIC = [...PLAIN, synthetic];

const plan = (oldSettings, newSettings, features) => planSettingsChange({
  oldSettings, newSettings, changedKeys: Object.keys(newSettings).filter((key) => oldSettings[key] !== newSettings[key]), features,
});

describe('FR-03: a changed address is validated and compared as a host', () => {
  const stored = { address: '192.168.1.50', poll_interval: 30 };

  test('AC2: invalid addresses are refused with the reason that selects the message', () => {
    const reasons = {
      '0.0.0.0': 'invalid',
      '': 'invalid',
      '192.168.1.50/foo': 'invalid',
      '192.168.1.50?x=1': 'invalid',
      'user@host': 'invalid',
      'a b': 'invalid',
      '192.168.1.50:99999': 'invalid',
      'https://192.168.1.50': 'https',
      'fe80::1': 'ipv6',
    };

    Object.entries(reasons).forEach(([address, reason]) => {
      const outcome = plan(stored, { ...stored, address });
      assert.deepEqual(outcome.errors, [{ key: 'address', reason }], JSON.stringify(address));
      assert.equal(outcome.address, null);
      assert.equal(outcome.startPoller, false);
    });
  });

  test('AC1: spelling variants of the same host change nothing; another host is a change', () => {
    ['192.168.1.50', ' 192.168.1.50 ', 'http://192.168.1.50/', '192.168.1.50/'].forEach((address) => {
      const outcome = plan({ ...stored, address: '192.168.1.50' }, { ...stored, address });
      assert.deepEqual(outcome, {
        errors: [], address: null, startPoller: false, interval: false, toggles: [],
      }, JSON.stringify(address));
    });
    assert.equal(plan(stored, { ...stored, address: '192.168.1.51' }).address, '192.168.1.51');
    assert.equal(plan(stored, { ...stored, address: ' toon.local ' }).address, 'toon.local');
    assert.equal(plan(stored, { ...stored, address: '192.168.1.50:80' }).address, '192.168.1.50:80', 'another port is another host');
  });

  test('FR-03 AC3: a stored address that was unusable (the manifest default 0.0.0.0, empty, missing) and a valid new one starts the poller', () => {
    ['0.0.0.0', '', undefined, 'a b'].forEach((address) => {
      const outcome = plan({ address, poll_interval: 30 }, { address: '192.168.1.50', poll_interval: 30 });

      assert.equal(outcome.startPoller, true, String(address));
      assert.equal(outcome.address, '192.168.1.50');
      assert.deepEqual(outcome.errors, []);
    });
  });

  test('only the changed keys are looked at: an unusable stored address is no error when the user saves something else', () => {
    const legacy = { address: '0.0.0.0', poll_interval: 30 };
    const outcome = planSettingsChange({ oldSettings: legacy, newSettings: { ...legacy, poll_interval: 60 }, changedKeys: ['poll_interval'] });

    assert.deepEqual(outcome.errors, []);
    assert.equal(outcome.interval, true);
    assert.equal(outcome.address, null);
    assert.equal(outcome.startPoller, false);
  });

  test('the status labels in newSettings never count: they are no changed keys', () => {
    const outcome = planSettingsChange({
      oldSettings: { ...stored, last_update: 'a', last_problem: 'b' },
      newSettings: { ...stored, last_update: 'c', last_problem: 'd' },
      changedKeys: [],
    });

    assert.deepEqual(outcome, {
      errors: [], address: null, startPoller: false, interval: false, toggles: [],
    });
  });
});

describe('FR-83: the poll interval', () => {
  const stored = { address: '192.168.1.50', poll_interval: 30 };

  test('AC1: 5, 3601 and "abc" are refused; 10 and 3600 are accepted; empty means the default', () => {
    [5, 3601, 'abc'].forEach((value) => {
      assert.deepEqual(plan(stored, { ...stored, poll_interval: value }).errors, [{ key: 'poll_interval', reason: 'range' }], String(value));
    });
    [10, 3600].forEach((value) => {
      const outcome = plan(stored, { ...stored, poll_interval: value });
      assert.deepEqual(outcome.errors, [], String(value));
      assert.equal(outcome.interval, true);
    });
    const empty = plan(stored, { ...stored, poll_interval: '' });
    assert.deepEqual(empty.errors, []);
    assert.equal(empty.interval, false, 'empty is 30 s, which is what it was');
  });

  test('AC2: 30 to 60 is a change; the same value written as text is not', () => {
    assert.equal(plan(stored, { ...stored, poll_interval: 60 }).interval, true);
    assert.equal(plan({ ...stored, poll_interval: 45 }, { ...stored, poll_interval: '45' }).interval, false);
  });
});

describe('FR-111: toggles are planned for registered optional features and for nothing else', () => {
  test('a feature switch that really changes is a toggle; a repeated value, a missing key or a non-boolean is not', () => {
    const off = { address: '192.168.1.50', synthetic_enabled: false };

    assert.deepEqual(plan(off, { ...off, synthetic_enabled: true }, WITH_SYNTHETIC).toggles, [{ id: 'synthetic', setting: 'synthetic_enabled', on: true }]);
    assert.deepEqual(plan({ ...off, synthetic_enabled: true }, off, WITH_SYNTHETIC).toggles, [{ id: 'synthetic', setting: 'synthetic_enabled', on: false }]);
    assert.deepEqual(plan(off, { ...off, synthetic_enabled: 'true' }, WITH_SYNTHETIC).toggles, []);
    assert.deepEqual(planSettingsChange({
      oldSettings: off, newSettings: { ...off, synthetic_enabled: true }, changedKeys: ['address'], features: WITH_SYNTHETIC,
    }).toggles, [], 'not a changed key');
    assert.deepEqual(plan(off, { ...off, synthetic_enabled: true }).toggles, [], 'the real registry has no such feature');
  });

  test('junk in, a plan out: nothing throws', () => {
    [undefined, null, 'x', 5, []].forEach((value) => {
      const outcome = planSettingsChange({ oldSettings: value, newSettings: value, changedKeys: ['address', 'poll_interval'] });

      assert.deepEqual(outcome.errors.map((error) => error.key), ['address'], String(value));
    });
    assert.deepEqual(planSettingsChange({ oldSettings: {}, newSettings: {}, changedKeys: undefined }).errors, []);
  });
});

/** A stub that records every Homey call and can be told to fail one. */
function stubDevice({
  capabilities = [], settings = {}, store = {}, options = {},
} = {}) {
  const calls = [];
  const device = {
    calls,
    stopped: false,
    failOn: null,
    getStore: () => ({ ...store }),
    getSettings: () => ({ ...settings }),
    getCapabilities: () => [...capabilities],
    hasCapability: (id) => capabilities.includes(id),
    getCapabilityOptions: (id) => ({ ...(options[id] || {}) }),
    async addCapability(id) {
      calls.push(`add ${id}`);
      if (device.failOn === `add ${id}`) throw new Error('Core refused');
      capabilities.push(id);
    },
    async removeCapability(id) {
      calls.push(`remove ${id}`);
      if (device.failOn === `remove ${id}`) throw new Error('Core refused');
      capabilities.splice(capabilities.indexOf(id), 1);
    },
    async setCapabilityOptions(id, value) {
      calls.push(`options ${id}`);
      if (device.failOn === `options ${id}`) throw new Error('Core refused');
      options[id] = value;
    },
    async setSettings(changes) {
      calls.push(`settings ${Object.keys(changes).join(',')}`);
      Object.assign(settings, changes);
    },
    async setStoreValue(key, value) {
      calls.push(`store ${key}=${value}`);
      store[key] = value;
    },
  };
  return device;
}

const guards = (device, extra = {}) => ({
  isStopped: () => device.stopped,
  log: (line) => {
    device.lines = [...(device.lines || []), line];
  },
  ...extra,
});

describe('FR-111 AC2 / M-4: reconcile adds what is missing, guarded, and undoes a half-done plan', () => {
  test('adds only what the device lacks, in plan order, and removes only what it has', async () => {
    const device = stubDevice({ capabilities: ['a', 'b'] });
    await reconcile(device, { add: ['b', 'c', 'd'], remove: ['a', 'zzz'] }, guards(device));

    assert.deepEqual(device.calls, ['add c', 'add d', 'remove a']);
  });

  test('an empty plan calls nothing, not even for the options', async () => {
    const device = stubDevice({ capabilities: ['a'] });
    await reconcile(device, {}, guards(device));

    assert.deepEqual(device.calls, []);
  });

  test('when a second add fails, the first one is removed again and the error is rethrown', async () => {
    const device = stubDevice({ capabilities: ['keep'] });
    device.failOn = 'add c2';

    await assert.rejects(reconcile(device, { add: ['c1', 'c2', 'c3'] }, guards(device)), /Core refused/);
    assert.deepEqual(device.calls, ['add c1', 'add c2', 'remove c1']);
    assert.deepEqual(device.getCapabilities(), ['keep'], 'no stray capability');
  });

  test('an undo that fails is logged, and the original error still wins', async () => {
    const device = stubDevice();
    device.failOn = 'add c2';
    device.removeCapability = async () => {
      throw new Error('undo refused');
    };

    await assert.rejects(reconcile(device, { add: ['c1', 'c2'] }, guards(device)), /Core refused/);
    assert.match(device.lines[0], /could not undo adding c1: undo refused/);
  });

  test('FR-84 AC3: once the device is stopped no further Homey call is made', async () => {
    const device = stubDevice();
    const stopAfterFirst = device.addCapability;
    device.addCapability = async (id) => {
      await stopAfterFirst(id);
      device.stopped = true;
    };
    await reconcile(device, { add: ['c1', 'c2'], remove: ['c1'], options: { c1: { title: 'x' } } }, guards(device));

    assert.deepEqual(device.calls, ['add c1']);
  });

  test('options: set only where they differ from what the device holds; a second pass sets nothing', async () => {
    const device = stubDevice({ capabilities: ['a', 'b', 'c'], options: { a: { title: 'x' }, b: { title: 'old' } } });
    const options = {
      a: { title: 'x' }, b: { title: 'new' }, c: { step: 0.5 }, absent: { title: 'not on the device' },
    };
    await reconcile(device, {}, guards(device, { options }));
    assert.deepEqual(device.calls, ['options b', 'options c']);

    device.calls.length = 0;
    await reconcile(device, {}, guards(device, { options }));
    assert.deepEqual(device.calls, [], 'U2: three expensive calls skipped in the common case');
  });

  test('an option that cannot be set is logged and the others are still tried; it is never fatal', async () => {
    const device = stubDevice({ capabilities: ['a', 'b'] });
    device.failOn = 'options a';
    await reconcile(device, {}, guards(device, { options: { a: { title: 'x' }, b: { title: 'y' } } }));

    assert.deepEqual(device.calls, ['options a', 'options b']);
    assert.match(device.lines[0], /options of a could not be set/);
  });
});

describe('FR-111 / FR-110 / M-1..M-7: migrate brings a legacy device up to date and writes the marker last', () => {
  const manifestOptions = { burner_state: {}, 'alarm_water.hotwater': { title: { en: 'Hot water dispensing' } } };

  test('era 1: the missing core capabilities are added, the options that differ reconciled, and only then the marker is written', async () => {
    const device = stubDevice({ capabilities: [...eras.era1.capabilities], settings: { address: '192.168.1.50' } });
    const ran = await migrate(device, { features: PLAIN, options: manifestOptions, ...guards(device) });

    assert.equal(ran, true);
    assert.deepEqual(device.calls, ['add alarm_water.hotwater', 'add burner_state', 'options alarm_water.hotwater', `store migrationVersion=${MIGRATION_VERSION}`]);
    assert.deepEqual(device.getCapabilities().filter((id) => !eras.era1.capabilities.includes(id)), ['alarm_water.hotwater', 'burner_state']);
  });

  test('era 0: the plain meter_power stays, and the capabilities of the core feature are added around it', async () => {
    const device = stubDevice({ capabilities: [...eras.era0.capabilities] });
    await migrate(device, { features: PLAIN, ...guards(device) });

    assert.ok(device.getCapabilities().includes('meter_power'));
    CORE.forEach((id) => assert.ok(device.getCapabilities().includes(id), id));
    assert.equal(device.calls.some((call) => call.startsWith('remove')), false, 'nothing is ever removed');
  });

  test('the switches of the optional features are decided from the capabilities and persisted before the plan runs', async () => {
    const device = stubDevice({ capabilities: [...CORE, 'measure_pressure'], settings: { address: 'x' } });
    await migrate(device, { features: WITH_SYNTHETIC, ...guards(device) });

    assert.deepEqual(device.calls, ['settings synthetic_enabled', `store migrationVersion=${MIGRATION_VERSION}`]);
    assert.equal(device.getSettings().synthetic_enabled, true);

    const fresh = stubDevice({ capabilities: [...CORE] });
    await migrate(fresh, { features: WITH_SYNTHETIC, ...guards(fresh) });
    assert.equal(fresh.getSettings().synthetic_enabled, false);
    assert.equal(fresh.getCapabilities().includes('measure_pressure'), false, 'a feature that is off is not added');
  });

  test('FR-111 AC2: with the marker present nothing is called and nothing is decided again', async () => {
    const device = stubDevice({ capabilities: [...eras.era1.capabilities], store: { migrationVersion: 1 } });
    const ran = await migrate(device, { features: PLAIN, options: manifestOptions, ...guards(device) });

    assert.equal(ran, false);
    assert.deepEqual(device.calls, []);
  });

  test('M-6: a failure in the plan leaves no marker, so the next start tries again', async () => {
    const device = stubDevice({ capabilities: [...eras.era3.capabilities] });
    device.failOn = 'add burner_state';

    await assert.rejects(migrate(device, { features: PLAIN, ...guards(device) }), /Core refused/);
    assert.equal(device.calls.some((call) => call.startsWith('store')), false);
    assert.deepEqual(device.getCapabilities(), eras.era3.capabilities);
  });

  test('a device that was deleted during the migration gets no marker and no further call', async () => {
    const device = stubDevice({ capabilities: [...eras.era0.capabilities] });
    const add = device.addCapability;
    device.addCapability = async (id) => {
      await add(id);
      device.stopped = true;
    };
    const ran = await migrate(device, { features: PLAIN, ...guards(device) });

    assert.equal(ran, false);
    assert.deepEqual(device.calls, ['add meter_power.peak']);
  });
});

describe('FR-52 AC4 / ADR-0006 item 5: the switches of a save are compared with what is running when that is known', () => {
  const settings = (value) => ({ address: '192.168.1.50', synthetic_enabled: value });
  const toggles = (running, saved, extra = {}) => planSettingsChange({
    oldSettings: settings(false), newSettings: settings(saved), changedKeys: [], state: { core: true, synthetic: running }, features: WITH_SYNTHETIC, ...extra,
  }).toggles;

  test('a save that overtook another one ends in the state of the last save: the old settings do not matter', () => {
    assert.deepEqual(toggles(true, false), [{ id: 'synthetic', setting: 'synthetic_enabled', on: false }], 'on is running, the save says off, and "old" says off too');
    assert.deepEqual(toggles(false, true), [{ id: 'synthetic', setting: 'synthetic_enabled', on: true }]);
    assert.deepEqual(toggles(true, true), []);
    assert.deepEqual(toggles(false, false), []);
  });

  test('only a boolean counts: a save without the key, or with text, changes nothing', () => {
    [undefined, 'true', 1, null].forEach((value) => assert.deepEqual(toggles(true, value), [], String(value)));
  });

  test('the optional features of the registry are looked at, not the features that are always on', () => {
    assert.deepEqual(planSettingsChange({
      oldSettings: {}, newSettings: { toonwater_enabled: true, export_enabled: false }, changedKeys: [], state: { core: true, toonwater: false, export: false },
    }).toggles, [{ id: 'toonwater', setting: 'toonwater_enabled', on: true }]);
  });

  test('without the running state the old settings and the changed keys decide, as before', () => {
    assert.deepEqual(planSettingsChange({
      oldSettings: settings(false), newSettings: settings(true), changedKeys: ['synthetic_enabled'], features: WITH_SYNTHETIC,
    }).toggles, [{ id: 'synthetic', setting: 'synthetic_enabled', on: true }]);
    assert.deepEqual(planSettingsChange({
      oldSettings: settings(false), newSettings: settings(true), changedKeys: [], features: WITH_SYNTHETIC,
    }).toggles, []);
  });
});

describe('ADR-0018 / M-2: the migration records that it decided the switches, before the plan runs and before the marker', () => {
  const deciding = {
    ...synthetic, id: 'deciding', setting: 'deciding_enabled', decidedByKey: 'decidingDecidedBy',
  };

  test('a feature that keeps a record gets "migration" in the store; a feature without one gets nothing', async () => {
    const device = stubDevice({ capabilities: [...CORE] });
    await migrate(device, { features: [...PLAIN, deciding], ...guards(device) });

    assert.deepEqual(device.calls, ['settings deciding_enabled', 'store decidingDecidedBy=migration', `store migrationVersion=${MIGRATION_VERSION}`]);
    const plain = stubDevice({ capabilities: [...CORE] });
    await migrate(plain, { features: WITH_SYNTHETIC, ...guards(plain) });
    assert.deepEqual(plain.calls, ['settings synthetic_enabled', `store migrationVersion=${MIGRATION_VERSION}`]);
  });

  test('a device that has the marker records nothing', async () => {
    const device = stubDevice({ capabilities: [...CORE], store: { migrationVersion: 1 } });
    await migrate(device, { features: [...PLAIN, deciding], ...guards(device) });

    assert.deepEqual(device.calls, []);
  });
});
