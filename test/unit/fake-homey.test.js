'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const Homey = require('homey');
const { createWorld } = require('../helpers/fake-homey/world');

/** A minimal app under test: a device that records its lifecycle and exposes hooks to the tests. */
class TestDevice extends Homey.Device {
  async onInit() {
    this.trace = ['onInit'];
  }

  async onSettings(event) {
    this.trace.push('onSettings');
    this.lastSettingsEvent = event;
    if (this.settingsBehaviour) return this.settingsBehaviour(event);
    return undefined;
  }

  async onDeleted() {
    this.trace.push('onDeleted');
  }

  async onUninit() {
    this.trace.push('onUninit');
  }
}

/** The initial value of every setting of the driver in the manifest: what a freshly paired device starts with. */
function manifestSettingDefaults(world) {
  return Object.fromEntries(world.manifest.drivers[0].settings
    .flatMap((entry) => (entry.type === 'group' ? entry.children : [entry]))
    .map((setting) => [setting.id, setting.value]));
}

async function bootDevice(spec = {}) {
  const world = createWorld();
  world.registerDriver('open-toon', { Device: TestDevice });
  const device = await world.createDevice({ driverId: 'open-toon', ...spec });
  return { world, device };
}

describe('NFR-06 AC1: fake Homey is strict about capabilities', () => {
  test('invalid capability: writing, reading, listening and option changes on a capability the device lacks all fail', async () => {
    const { device } = await bootDevice({ capabilities: ['target_temperature'] });

    await assert.rejects(device.setCapabilityValue('meter_power', 1), /Invalid Capability: meter_power/);
    assert.throws(() => device.getCapabilityValue('meter_power'), /Invalid Capability/);
    assert.throws(() => device.registerCapabilityListener('meter_power', async () => {}), /Invalid Capability/);
    await assert.rejects(device.setCapabilityOptions('meter_power', {}), /Invalid Capability/);
    await assert.rejects(device.removeCapability('meter_power'), /Invalid Capability/);
  });

  test('invalid capability: an id Homey does not know cannot be added, a known one only once', async () => {
    const { device } = await bootDevice({ capabilities: ['target_temperature'] });

    await assert.rejects(device.addCapability('no_such_capability'), /Invalid Capability/);
    await device.addCapability('measure_power');
    assert.equal(device.getCapabilityValue('measure_power'), null);
    await assert.rejects(device.addCapability('measure_power'), /already exists/, 'a guarded add is required: do not add on every init');
    await device.removeCapability('measure_power');
    assert.equal(device.hasCapability('measure_power'), false);
  });

  test('a value of the wrong type is rejected, null clears', async () => {
    const { device } = await bootDevice({ capabilities: ['measure_power', 'alarm_water.hotwater', 'measure_temperature'] });

    await assert.rejects(device.setCapabilityValue('measure_power', '324'), /expected a finite number/);
    await assert.rejects(device.setCapabilityValue('measure_power', NaN), /expected a finite number/);
    await assert.rejects(device.setCapabilityValue('measure_power', undefined), /expected a finite number/);
    await assert.rejects(device.setCapabilityValue('alarm_water.hotwater', 'true'), /expected a boolean/);
    await device.setCapabilityValue('measure_power', 324);
    await device.setCapabilityValue('measure_power', null);
    assert.equal(device.getCapabilityValue('measure_power'), null);
  });

  test('an enum value outside the declared list is rejected', async () => {
    const { device } = await bootDevice({ capabilities: ['temperature_state'] });

    await assert.rejects(device.setCapabilityValue('temperature_state', 'tropical'), /one of comfort\|home\|sleep\|away\|none/);
    await assert.rejects(device.setCapabilityValue('temperature_state', undefined), /temperature_state/);
    await device.setCapabilityValue('temperature_state', 'sleep');
    assert.equal(device.getCapabilityValue('temperature_state'), 'sleep');
  });

  test('off-step target_temperature is rejected, an on-step value is accepted [HW-03]', async () => {
    const { device } = await bootDevice({ capabilities: ['target_temperature'] });

    await assert.rejects(device.setCapabilityValue('target_temperature', 19.75), /multiple of step 0\.5/);
    await assert.rejects(device.setCapabilityValue('target_temperature', 19.8), /multiple of step 0\.5/);
    await device.setCapabilityValue('target_temperature', 19.5);
    await device.setCapabilityValue('target_temperature', 20);
    assert.equal(device.getCapabilityValue('target_temperature'), 20);
  });

  test('capability options: addCapability applies none, setCapabilityOptions replaces them [HW-03]', async () => {
    const { device } = await bootDevice({ capabilities: ['target_temperature'] });
    assert.deepEqual(device.getCapabilityOptions('target_temperature'), { step: 0.5, min: 6, max: 30 }, 'options of the driver manifest apply to capabilities the device was created with');

    await device.addCapability('meter_power.peak');
    assert.deepEqual(device.getCapabilityOptions('meter_power.peak'), {}, 'the manifest options of a later added capability are NOT applied by Homey in this reading');
    await device.setCapabilityOptions('meter_power.peak', { title: { en: 'Peak', nl: 'Piek' } });
    assert.deepEqual(device.getCapabilityOptions('meter_power.peak'), { title: { en: 'Peak', nl: 'Piek' } });
    await device.removeCapability('meter_power.peak');
    await device.addCapability('meter_power.peak');
    assert.deepEqual(device.getCapabilityOptions('meter_power.peak'), {}, 'removal forgets options');
  });

  test('a capability value is stored only when its registered listener resolves [HW-04]', async () => {
    const { device } = await bootDevice({ capabilities: ['target_temperature'], values: { target_temperature: 18 } });
    const seen = [];
    device.registerCapabilityListener('target_temperature', async (value, options) => {
      seen.push([value, options]);
      assert.equal(device.getCapabilityValue('target_temperature'), 18, 'still the old value while the listener runs');
    });

    await device.simulateCapabilitySet('target_temperature', 21, { source: 'tile' });
    assert.deepEqual(seen, [[21, { source: 'tile' }]]);
    assert.equal(device.getCapabilityValue('target_temperature'), 21);
  });

  test('listener rejection keeps the stored value and surfaces the error [HW-04]', async () => {
    const { device } = await bootDevice({ capabilities: ['temperature_state'], values: { temperature_state: 'home' } });
    device.registerCapabilityListener('temperature_state', async () => {
      throw new Error('Vacation mode can only be set on the Toon itself');
    });

    await assert.rejects(device.simulateCapabilitySet('temperature_state', 'away'), /Vacation mode/);
    assert.equal(device.getCapabilityValue('temperature_state'), 'home');
  });

  test('a user change needs a listener, a setable capability and a valid value', async () => {
    const { device } = await bootDevice({ capabilities: ['target_temperature', 'measure_power'] });

    await assert.rejects(device.simulateCapabilitySet('target_temperature', 20), /Missing Capability Listener/);
    await assert.rejects(device.simulateCapabilitySet('measure_power', 20), /not setable/);
    device.registerCapabilityListener('target_temperature', async () => {});
    await assert.rejects(device.simulateCapabilitySet('target_temperature', 20.1), /multiple of step/);
  });
});

describe('NFR-06 AC1: fake Homey models settings the way the docs describe', () => {
  test('setSettings does not call onSettings [HW-13]', async () => {
    const { device } = await bootDevice({ capabilities: [], settings: { address: '192.168.1.50' } });

    await device.setSettings({ address: '192.168.1.51' });
    assert.equal(device.getSetting('address'), '192.168.1.51');
    assert.deepEqual(device.trace, ['onInit']);
  });

  test('simulateSettingsSave calls onSettings with old, new and changed keys, then persists the new settings [HW-13]', async () => {
    const { device } = await bootDevice({ capabilities: [], settings: { address: '192.168.1.50' } });
    device.settingsBehaviour = async () => {
      assert.equal(device.getSetting('address'), '192.168.1.50', 'getSetting still returns the old value during onSettings');
      return 'saved';
    };

    const result = await device.simulateSettingsSave({ address: '192.168.1.60' });
    assert.equal(result, 'saved');
    assert.deepEqual(device.lastSettingsEvent, {
      oldSettings: { address: '192.168.1.50' },
      newSettings: { address: '192.168.1.60' },
      changedKeys: ['address'],
    });
    assert.equal(device.getSetting('address'), '192.168.1.60');
    device.settingsBehaviour = undefined;
    await device.simulateSettingsSave({ address: '192.168.1.60' });
    assert.deepEqual(device.lastSettingsEvent.changedKeys, [], 'saving an unchanged value changes no key');
  });

  test('onSettings rejection keeps the old settings [HW-13]', async () => {
    const { device } = await bootDevice({ capabilities: [], settings: { address: '192.168.1.50' } });
    device.settingsBehaviour = async () => {
      throw new Error('That is not an IP address');
    };

    await assert.rejects(device.simulateSettingsSave({ address: 'nope' }), /not an IP address/);
    assert.equal(device.getSetting('address'), '192.168.1.50');
  });

  test('after onSettings resolves the saved settings overwrite what the app wrote with setSettings meanwhile [HW-13]', async () => {
    const { device } = await bootDevice({ capabilities: [], settings: { address: '192.168.1.50' } });
    device.settingsBehaviour = async () => {
      await device.setSettings({ address: '10.0.0.1' });
    };

    await device.simulateSettingsSave({ address: '192.168.1.60' });
    assert.equal(device.getSetting('address'), '192.168.1.60');
  });

  test('setting values are checked against the manifest and unknown keys are refused', async () => {
    const { device } = await bootDevice({ capabilities: [], settings: { address: '192.168.1.50' } });

    await assert.rejects(device.setSettings({ nonsense: 'x' }), /Invalid Setting: nonsense/);
    await assert.rejects(device.setSettings({ address: 5 }), /expected a string/);
    await assert.rejects(device.simulateSettingsSave({ nonsense: 'x' }), /Invalid Setting/);
  });

  test('a legacy device keeps exactly the settings it was given, a new one gets the manifest defaults', async () => {
    const world = createWorld();
    world.registerDriver('open-toon', { Device: TestDevice });
    const legacy = await world.createDevice({ data: { id: 'a' }, settings: { address: '192.168.1.50', unknown_extra: 'kept' } });
    const fresh = await world.createDevice({ data: { id: 'b' } });

    assert.deepEqual(legacy.getSettings(), { address: '192.168.1.50', unknown_extra: 'kept' });
    assert.deepEqual(fresh.getSettings(), manifestSettingDefaults(world));
    assert.equal(fresh.getSetting('address'), '0.0.0.0');
  });
});

describe('NFR-06 AC1: fake Homey availability, warnings and the device store', () => {
  test('setUnavailable callback argument throws, the v3 call takes an optional message and returns a Promise', async () => {
    const { device } = await bootDevice({ capabilities: [] });

    assert.throws(() => device.setUnavailable('offline', () => {}), /SDK v2 signature/);
    assert.throws(() => device.setUnavailable(() => {}), /SDK v2 signature/);
    assert.throws(() => device.setUnavailable(42), /message must be a string/);
    const result = device.setUnavailable('Your Toon cannot be reached');
    assert.ok(result instanceof Promise);
    await result;
    assert.equal(device.getAvailable(), false);
    assert.equal(device.fake.unavailableMessage, 'Your Toon cannot be reached');
    await device.setAvailable();
    assert.equal(device.getAvailable(), true);
  });

  test('setWarning needs text, unsetWarning clears it', async () => {
    const { device } = await bootDevice({ capabilities: [] });

    await assert.rejects(device.setWarning(42), /non-empty string/);
    await device.setWarning('ToonWater not found');
    assert.equal(device.fake.warning, 'ToonWater not found');
    await device.unsetWarning();
    assert.equal(device.fake.warning, null);
  });

  test('store values are JSON copies, not shared references', async () => {
    const { device } = await bootDevice({ capabilities: [], store: { migrationVersion: 1 } });
    const list = ['a'];
    await device.setStoreValue('list', list);
    list.push('b');

    assert.deepEqual(device.getStoreValue('list'), ['a']);
    assert.deepEqual(device.getStoreKeys().sort(), ['list', 'migrationVersion']);
    await device.unsetStoreValue('list');
    assert.equal(device.getStoreValue('list'), undefined);
  });

  test('writes to a device that was deleted reject', async () => {
    const { world, device } = await bootDevice({ capabilities: ['measure_power'] });
    await world.deleteDevice(device);

    await assert.rejects(device.setCapabilityValue('measure_power', 1), /has been deleted/);
    await assert.rejects(device.setSettings({ address: '1.2.3.4' }), /has been deleted/);
    assert.throws(() => device.setUnavailable('x'), /has been deleted/);
  });
});

describe('NFR-06 AC1: fake Homey flow cards', () => {
  test('unknown flow card id throws for every kind of card', async () => {
    const { world } = await bootDevice({ capabilities: [] });
    const { flow } = world.homey;

    assert.throws(() => flow.getActionCard('no_such_card'), /Invalid Flow Card ID/);
    assert.throws(() => flow.getConditionCard('set_temperature_state'), /Invalid Flow Card ID/, 'an action is not a condition');
    assert.throws(() => flow.getTriggerCard('update_status'), /Invalid Flow Card ID/);
    assert.throws(() => flow.getDeviceTriggerCard('no_such_card'), /Invalid Flow Card ID/);
    assert.equal(flow.getActionCard('update_status').id, 'update_status');
  });

  test('a card accepts one run listener and validates the arguments it is run with', async () => {
    const { world, device } = await bootDevice({ capabilities: [] });
    const card = world.homey.flow.getActionCard('set_temperature_state');

    await assert.rejects(card.run({ device }), /no run listener registered/);
    card.registerRunListener(async (args) => args.state);
    assert.throws(() => card.registerRunListener(async () => {}), /already registered/);
    assert.equal(await card.run({ device, state: 'away', resume_program: 'no' }), 'away');
    assert.equal(await card.run({ device, state: { id: 'home' } }).then((state) => state.id), 'home');
    await assert.rejects(card.run({ device, state: 'tropical' }), /not a value of state/);
    await assert.rejects(card.run({ device, nonsense: 1 }), /unknown argument nonsense/);
  });

  test('device triggers record the call and check the token names and types', async () => {
    const { world, device } = await bootDevice({ capabilities: [] });
    const card = world.homey.flow.getDeviceTriggerCard('alarm_water_changed');

    await card.trigger(device, { 'alarm_water.hotwater': true });
    assert.deepEqual(world.triggerCalls, [{
      id: 'alarm_water_changed', deviceId: 'ENECO-001-12391', tokens: { 'alarm_water.hotwater': true }, state: {}, source: 'app',
    }]);
    await assert.rejects(card.trigger(device, { 'alarm_water.hotwater': 'yes' }), /must be a boolean/);
    await assert.rejects(card.trigger(device, { nonsense: 1 }), /unknown token/);
    await assert.rejects(card.trigger({}, {}), /needs the device/);
  });

  test('autoFireCustomTriggers models the trigger Homey itself fires for a custom capability change [HW-06]', async () => {
    const { world, device } = await bootDevice({ capabilities: ['temperature_state', 'measure_power'] });

    await device.setCapabilityValue('temperature_state', 'home');
    assert.deepEqual(world.triggerCalls, [], 'off by default');

    world.autoFireCustomTriggers = true;
    await device.setCapabilityValue('temperature_state', 'home');
    assert.deepEqual(world.triggerCalls, [], 'an unchanged value fires nothing');
    await device.setCapabilityValue('temperature_state', 'away');
    await device.setCapabilityValue('measure_power', 5);
    assert.deepEqual(world.triggerCalls, [{
      id: 'temperature_state_changed', deviceId: 'ENECO-001-12391', tokens: { temperature_state: 'away' }, state: {}, source: 'homey',
    }]);
  });
});

describe('NFR-06 AC1: fake Homey translations and timers', () => {
  test('FR-100 AC3: missing translation key throws in both languages, tokens are filled', async () => {
    const world = createWorld({
      locales: { en: { a: { b: 'Error: __error__' }, only_en: 'x' }, nl: { a: { b: 'Fout: __error__' } } },
    });

    assert.equal(world.homey.__('a.b', { error: 'boom' }), 'Error: boom');
    assert.throws(() => world.homey.__('a.c'), /Missing translation: a\.c \(en\)/);
    assert.throws(() => world.homey.__('a'), /Missing translation/, 'a branch is not a text');
    world.setLanguage('nl');
    assert.equal(world.homey.__('a.b', { error: 'boem' }), 'Fout: boem');
    assert.throws(() => world.homey.__('only_en'), /Missing translation: only_en \(nl\)/);
    assert.equal(world.homey.__('a.b'), 'Fout: __error__', 'a token without a value stays visible');
  });

  test('homey.setTimeout runs on the fake clock and is cleared when the app restarts', async () => {
    const { world } = await bootDevice({ capabilities: [] });
    let fired = 0;
    world.homey.setTimeout(() => {
      fired++;
    }, 1000);
    world.homey.setInterval(() => {
      fired++;
    }, 400);
    assert.equal(world.clock.armed(), 2);

    await world.clock.tick(1000);
    assert.equal(fired, 3);
    await world.restartApp();
    assert.equal(world.clock.armed(), 0, 'Homey clears app timers on destroy');
  });

  test('notifications are recorded and can be made to fail once', async () => {
    const { world } = await bootDevice({ capabilities: [] });
    world.failNextNotification();

    await assert.rejects(world.homey.notifications.createNotification({ excerpt: 'hint' }), /Could not create/);
    await world.homey.notifications.createNotification({ excerpt: 'hint' });
    assert.deepEqual(world.notifications, [{ excerpt: 'hint' }]);
    await assert.rejects(world.homey.notifications.createNotification({}), /excerpt/);
  });
});

describe('NFR-06 AC1: fake Homey rejects SDK v2 API and models the lifecycle', () => {
  test('v2-only API throws a descriptive error, require(homey) is the fake', async () => {
    const { world } = await bootDevice({ capabilities: [] });
    const session = await world.startPairing('open-toon');

    const { FlowCardAction } = Homey;
    const underscores = '_'.repeat(2);

    assert.match(require.resolve('homey'), /fake-homey/);
    assert.throws(() => Homey[underscores]('offline'), /SDK v2 API.*this\.homey\.__/);
    assert.throws(() => new FlowCardAction('x'), /SDK v2 API/);
    assert.throws(() => Homey.ManagerSettings, /managers live on this\.homey/);
    assert.throws(() => Homey.app, /SDK v2 API/);
    assert.throws(() => session.on('testConnection', () => {}), /session\.setHandler/);
    assert.deepEqual(Homey.env, {});
    assert.equal(Homey.manifest.id, 'nl.vinceste.open-toon');
  });

  test('deleteDevice runs onDeleted then onUninit and removes the device', async () => {
    const { world, device } = await bootDevice({ capabilities: [] });

    await world.deleteDevice(device);
    assert.deepEqual(device.trace, ['onInit', 'onDeleted', 'onUninit']);
    assert.deepEqual(world.devices(), []);
  });

  test('restartApp re-instantiates devices over the same stored state', async () => {
    const { world, device } = await bootDevice({ capabilities: ['measure_power'], values: { measure_power: 7 }, store: { migrationVersion: 1 } });
    await device.setSettings({ address: '192.168.1.99' });

    await world.restartApp();
    const [again] = world.devices();
    assert.notEqual(again, device);
    assert.deepEqual(device.trace, ['onInit', 'onUninit']);
    assert.deepEqual(again.trace, ['onInit']);
    assert.equal(again.getCapabilityValue('measure_power'), 7);
    assert.equal(again.getStoreValue('migrationVersion'), 1);
    assert.equal(again.getSetting('address'), '192.168.1.99');
    await assert.rejects(device.setCapabilityValue('measure_power', 8), /has been deleted/, 'the old instance is gone');
  });

  test('pairing: createDevice applies defaults, refuses a duplicate id and a malformed device', async () => {
    const { world } = await bootDevice({ capabilities: [] });
    const session = await world.startPairing('open-toon');
    session.setHandler('testConnection', async (data) => ({ ok: data.address }));

    assert.deepEqual(await session.call('testConnection', { address: '1.2.3.4' }), { ok: '1.2.3.4' });
    await assert.rejects(session.call('unknown'), /No handler registered/);
    assert.throws(() => session.setHandler('testConnection', async () => {}), /already registered/);

    const created = await session.createDevice({ name: 'Living room', data: { id: 'toon-1' }, settings: { address: '1.2.3.4' } });
    assert.equal(created.getName(), 'Living room');
    assert.deepEqual(created.getCapabilities(), world.manifest.drivers[0].capabilities, 'the driver capabilities of the manifest');
    assert.deepEqual(created.getSettings(), { ...manifestSettingDefaults(world), address: '1.2.3.4' });
    assert.deepEqual(created.getCapabilityOptions('target_temperature'), { step: 0.5, min: 6, max: 30 });
    await assert.rejects(session.createDevice({ name: 'Again', data: { id: 'toon-1' } }), /already exists/);
    await assert.rejects(session.createDevice({ name: '', data: { id: 'x' } }), /name/);
    await assert.rejects(session.createDevice({ name: 'n', data: {} }), /data must be an object with an id/);
    await assert.rejects(session.createDevice('nope'), /needs a device object/);
  });
});
