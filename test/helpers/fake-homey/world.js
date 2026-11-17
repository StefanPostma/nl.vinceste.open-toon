'use strict';

/*
 * The test world: one fake Homey with a fake clock, the real manifest and the real locale files.
 *
 *   const world = createWorld({ language: 'en' });
 *   world.useAppFiles();                       // app.js and drivers/<id>/{driver,device}.js of this repository
 *   await world.start();
 *   const device = await world.createDevice({ driverId: 'open-toon', settings: { address: '192.168.1.50' } });
 *
 * Everything the app does through `this.homey` is recorded: world.logs, world.calls, world.triggerCalls,
 * world.notifications. Behaviour that rests on an unverified reading of the Homey docs is marked [HW-xx]
 * in the tests that exercise it (docs/sdlc/05-architecture.md section 17).
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { App } = require('./app');
const { Driver } = require('./driver');
const { settingModel } = require('./settings');
const { CapabilityModel } = require('./capabilities');
const { FlowManager } = require('./flow');
const { PairSession } = require('./pair');
const current = require('./current');
const { createClock } = require('../fake-clock');

const ROOT = path.join(__dirname, '..', '..', '..');
const jsonClone = (value) => JSON.parse(JSON.stringify(value));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadLocales(appDir) {
  const dir = path.join(appDir, 'locales');
  return Object.fromEntries(fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name.slice(0, -'.json'.length), readJson(path.join(dir, name))]));
}

function settingDefaults(driverManifest) {
  return Object.fromEntries(settingModel(driverManifest)
    .filter((entry) => entry.value !== undefined)
    .map((entry) => [entry.id, entry.value]));
}

/** Per-device options a freshly paired device starts with: the driver's capabilitiesOptions, then the view's overrides. */
function optionsFor(manifest, capabilities, overrides = {}) {
  const base = manifest.capabilitiesOptions || {};
  return Object.fromEntries(capabilities
    .filter((id) => base[id] || overrides[id])
    .map((id) => [id, { ...jsonClone(base[id] || {}), ...jsonClone(overrides[id] || {}) }]));
}

function createWorld({
  appDir = ROOT, language = 'en', clock = createClock(), env = {}, locales,
} = {}) {
  const world = {
    clock,
    manifest: readJson(path.join(appDir, 'app.json')),
    locales: locales || loadLocales(appDir),
    language,
    env,
    logs: [],
    calls: [],
    triggerCalls: [],
    notifications: [],
    autoFireCustomTriggers: false,
    app: null,
  };
  world.capabilities = new CapabilityModel(world.manifest);

  const registrations = new Map();
  const driverInstances = new Map();
  const records = [];
  let instances = [];
  let AppClass = App;
  let started = false;
  let notificationFailures = 0;
  const appTimers = new Set();

  function translate(key, tokens) {
    const dictionary = world.locales[world.language];
    if (!dictionary) throw new Error(`Missing translation: no locale ${world.language}`);
    const value = String(key).split('.').reduce((node, part) => (
      node && typeof node === 'object' && Object.hasOwn(node, part) ? node[part] : undefined
    ), dictionary);
    if (typeof value !== 'string') throw new Error(`Missing translation: ${key} (${world.language})`);
    return value.replace(/__(\w+)__/g, (match, name) => (tokens && Object.hasOwn(tokens, name) ? String(tokens[name]) : match));
  }

  const homey = {
    env,
    manifest: world.manifest,
    platform: 'local',
    app: null,
    flow: null,
    __: translate,
    setTimeout(callback, delay, ...args) {
      const handle = clock.setTimeout(callback, delay, ...args);
      appTimers.add(handle);
      return handle;
    },
    clearTimeout: (handle) => clock.clearTimeout(handle),
    setInterval(callback, delay, ...args) {
      const handle = clock.setInterval(callback, delay, ...args);
      appTimers.add(handle);
      return handle;
    },
    clearInterval: (handle) => clock.clearInterval(handle),
    i18n: {
      getLanguage: () => world.language,
      getLocale: () => world.language,
    },
    clock: {
      getTimezone: () => 'Europe/Amsterdam',
    },
    notifications: {
      async createNotification({ excerpt } = {}) {
        if (typeof excerpt !== 'string' || excerpt === '') throw new TypeError('createNotification({excerpt}) needs a non-empty excerpt');
        if (notificationFailures > 0) {
          notificationFailures--;
          throw new Error('Could not create the notification');
        }
        world.notifications.push({ excerpt });
      },
    },
    drivers: {
      getDriver(id) {
        if (!driverInstances.has(id)) throw new Error(`Driver not found: ${id}`);
        return driverInstances.get(id);
      },
      getDrivers: () => Object.fromEntries(driverInstances),
    },
  };
  world.homey = homey;

  function driverManifest(driverId) {
    const manifest = (world.manifest.drivers || []).find((entry) => entry.id === driverId);
    if (!manifest) throw new Error(`Driver ${driverId} is not in app.json`);
    return manifest;
  }

  world.setLanguage = (next) => {
    if (!world.locales[next]) throw new Error(`No locale ${next}`);
    world.language = next;
  };
  world.failNextNotification = (count = 1) => {
    notificationFailures += count;
  };
  world.devices = () => [...instances];
  world.driver = (id) => homey.drivers.getDriver(id);
  world.callsOf = (method, deviceId) => world.calls.filter((entry) => entry.method === method && (deviceId === undefined || entry.deviceId === deviceId));
  world.logLines = (level) => world.logs
    .filter((entry) => level === undefined || entry.level === level)
    .map((entry) => `${entry.source}: ${entry.args.map(String).join(' ')}`);

  /** Homey's own `<custom capability>_changed` trigger, modelled behind the autoFireCustomTriggers flag. */
  world.homeyChangedCapability = (device, id, value) => {
    if (!world.autoFireCustomTriggers || !world.capabilities.isCustom(id)) return;
    const cardId = `${id}_changed`;
    const exists = [...(world.manifest.flow.triggers || []), ...(world.manifest.drivers || []).flatMap((entry) => (entry.flow && entry.flow.triggers) || [])]
      .some((card) => card.id === cardId);
    if (!exists) return;
    world.triggerCalls.push({
      id: cardId, deviceId: device.getData().id, tokens: { [id]: value }, state: {}, source: 'homey',
    });
  };

  world.registerApp = (Class) => {
    AppClass = Class;
  };
  world.registerDriver = (id, { Driver: DriverClass = Driver, Device }) => {
    driverManifest(id);
    registrations.set(id, { Driver: DriverClass, Device });
  };
  /** Registers app.js and drivers/<id>/{driver,device}.js of the repository under test. */
  world.useAppFiles = () => {
    const load = createRequire(path.join(appDir, 'package.json'));
    if (fs.existsSync(path.join(appDir, 'app.js'))) world.registerApp(load('./app.js'));
    (world.manifest.drivers || []).forEach((entry) => {
      const dir = path.join('.', 'drivers', entry.id);
      world.registerDriver(entry.id, {
        Driver: fs.existsSync(path.join(appDir, dir, 'driver.js')) ? load(`./${dir}/driver.js`) : Driver,
        Device: load(`./${dir}/device.js`),
      });
    });
  };

  async function instantiate(record) {
    const registration = registrations.get(record.driverId);
    const device = new registration.Device({
      homey, driver: driverInstances.get(record.driverId), record, world,
    });
    instances.push(device);
    await device.onInit();
    return device;
  }

  world.start = async () => {
    if (started) throw new Error('The world is already started; use restartApp()');
    started = true;
    homey.flow = new FlowManager(world);
    world.app = new AppClass({ homey, world });
    homey.app = world.app;
    await world.app.onInit();
    for (const [id, { Driver: DriverClass }] of registrations) {
      const driver = new DriverClass({
        homey, id, manifest: driverManifest(id), world,
      });
      driverInstances.set(id, driver);
      await driver.onInit();
    }
    for (const record of records) await instantiate(record);
  };

  /**
   * Adds a device as a legacy device would exist: `settings`, `capabilities` and `values` are used exactly as
   * given. Omitted settings take the manifest defaults, omitted capabilities the driver's list.
   */
  world.createDevice = async ({ driverId = world.manifest.drivers[0].id, ...spec } = {}) => {
    if (!started) await world.start();
    const manifest = driverManifest(driverId);
    const capabilities = spec.capabilities ? [...spec.capabilities] : [...manifest.capabilities];
    const options = spec.capabilitiesOptions ? jsonClone(spec.capabilitiesOptions) : optionsFor(manifest, capabilities);
    const record = {
      driverId,
      name: spec.name || 'ToonDevice',
      data: jsonClone(spec.data || { id: 'ENECO-001-12391' }),
      class: spec.class || manifest.class,
      settings: jsonClone(spec.settings || settingDefaults(manifest)),
      store: jsonClone(spec.store || {}),
      capabilities,
      options,
      values: Object.fromEntries(capabilities.map((id) => [id, spec.values && Object.hasOwn(spec.values, id) ? spec.values[id] : null])),
      available: true,
      unavailableMessage: null,
      warning: null,
    };
    records.push(record);
    return instantiate(record);
  };

  /** What Homey does when the pair view calls Homey.createDevice(): defaults are applied, duplicates refused. */
  world.createPairedDevice = async (driverId, deviceData) => {
    if (typeof deviceData !== 'object' || deviceData === null) throw new TypeError('createDevice needs a device object');
    if (typeof deviceData.name !== 'string' || deviceData.name === '') throw new TypeError('createDevice: name must be a non-empty string');
    if (typeof deviceData.data !== 'object' || deviceData.data === null || !Object.hasOwn(deviceData.data, 'id')) {
      throw new TypeError('createDevice: data must be an object with an id');
    }
    if (records.some((record) => record.driverId === driverId && JSON.stringify(record.data) === JSON.stringify(deviceData.data))) {
      throw new Error('A device with this data already exists');
    }
    const manifest = driverManifest(driverId);
    const capabilities = deviceData.capabilities || manifest.capabilities;
    const device = await world.createDevice({
      driverId,
      name: deviceData.name,
      data: deviceData.data,
      settings: { ...settingDefaults(manifest), ...(deviceData.settings || {}) },
      store: deviceData.store,
      capabilities,
      capabilitiesOptions: optionsFor(manifest, capabilities, deviceData.capabilitiesOptions),
    });
    await device.onAdded();
    return device;
  };

  world.startPairing = async (driverId) => {
    if (!started) await world.start();
    const driver = homey.drivers.getDriver(driverId);
    const session = new PairSession(world, driver);
    if (typeof driver.onPair === 'function') await driver.onPair(session);
    return session;
  };

  world.deleteDevice = async (device) => {
    const index = records.indexOf(device.fake);
    if (index === -1) throw new Error('The device is not part of this world');
    records.splice(index, 1);
    instances = instances.filter((entry) => entry !== device);
    try {
      await device.onDeleted();
      await device.onUninit();
    } finally {
      device._deleted = true;
    }
  };

  /** Stops every device, driver and the app, clears the timers they armed, and starts all of them again over the same state. */
  world.restartApp = async () => {
    for (const device of instances) await device.onUninit();
    instances.forEach((device) => {
      device._deleted = true;
    });
    for (const driver of driverInstances.values()) await driver.onUninit();
    await world.app.onUninit();
    appTimers.forEach((handle) => clock.clearTimeout(handle));
    appTimers.clear();
    instances = [];
    driverInstances.clear();
    started = false;
    await world.start();
  };

  current.set(world);
  return world;
}

module.exports = { createWorld };
