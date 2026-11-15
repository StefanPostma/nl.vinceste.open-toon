'use strict';

/*
 * A scenario world for the L2 tests (ADR-0013): the real app files under the fake Homey, one or more mock Toons
 * behind the global fetch, and one fake clock that drives every timer and Date.now. Nothing here touches the
 * network: a request to a host without a mock Toon fails like an unroutable address.
 *
 *   const scenario = createScenario({ toons: { '192.168.1.50': {} } });
 *   await scenario.start();               // patches fetch, Date.now and Math.random; call scenario.stop() when done
 *   const device = await scenario.addDevice();
 *   await scenario.clock.tick(60e3);
 *   scenario.toon().requestsTo('/happ_pwrusage');
 */

const { createWorld } = require('./fake-homey/world');
const { createMockToon } = require('./mock-toon');
const { featureState, capabilitiesFor } = require('../../lib/features');

const EPOCH = Date.UTC(2026, 10, 13, 12, 0, 0);
const DEFAULT_HOST = '192.168.1.50';

function unroutable() {
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' });
  return error;
}

/**
 * @param {{toons?: Object<string, object>, language?: string}} [options] `toons`: host -> options of createMockToon
 */
function createScenario({ toons = { [DEFAULT_HOST]: {} }, language = 'en' } = {}) {
  const world = createWorld({ language });
  const { clock } = world;
  const mocks = new Map(Object.entries(toons).map(([host, options]) => [host, createMockToon(options)]));
  const adapters = new Map([...mocks].map(([host, mock]) => [host, mock.fetchWith(clock)]));
  const contacted = [];
  const original = { fetch: globalThis.fetch, now: Date.now, random: Math.random };

  async function routed(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    contacted.push(url.host);
    const adapter = adapters.get(url.host);
    if (!adapter) throw unroutable();
    return adapter(input, init);
  }

  const scenario = {
    world,
    clock,
    mocks,
    /** The mock Toon of a host (default: the first). */
    toon: (host = [...mocks.keys()][0]) => mocks.get(host),
    /** Every host that any request went to, in order of first contact. */
    hostsContacted: () => [...new Set(contacted)],
    requestCount: () => contacted.length,

    /** Patches fetch, Date.now and Math.random (the start jitter of the poller is then always 1 s plus 1 s). */
    async start() {
      globalThis.fetch = routed;
      Date.now = () => EPOCH + clock.now();
      Math.random = () => 0.5;
      world.useAppFiles();
      await world.start();
      return scenario;
    },

    /** Gives the globals back. */
    stop() {
      globalThis.fetch = original.fetch;
      Date.now = original.now;
      Math.random = original.random;
    },

    /**
     * A device as the SDK would hand it to onInit. Settings default to the manifest's defaults with the address of
     * the first mock Toon; give `settings` to start from an exact (legacy) settings object instead.
     */
    async addDevice({ address = [...mocks.keys()][0], settings, ...spec } = {}) {
      const defaults = Object.fromEntries(world.manifest.drivers[0].settings
        .flatMap((entry) => (entry.type === 'group' ? entry.children : [entry]))
        .filter((entry) => entry.value !== undefined)
        .map((entry) => [entry.id, entry.value]));
      return world.createDevice({ driverId: 'open-toon', settings: settings || { ...defaults, address }, ...spec });
    },

    /**
     * A device as the pairing creates it (docs/sdlc/05-architecture.md section 7): complete settings, the marker of the
     * migration, the user as the one who decided, and the capabilities of the features that are on.
     * @param {{toonwater?: boolean, exportPower?: boolean, address?: string, settings?: object, store?: object}} [spec]
     */
    async addPaired({
      toonwater = false, exportPower = false, address = [...mocks.keys()][0], settings = {}, store = {}, ...spec
    } = {}) {
      const defaults = Object.fromEntries(world.manifest.drivers[0].settings
        .flatMap((entry) => (entry.type === 'group' ? entry.children : [entry]))
        .filter((entry) => entry.value !== undefined)
        .map((entry) => [entry.id, entry.value]));
      const all = {
        ...defaults, address, toonwater_enabled: toonwater, export_enabled: exportPower, ...settings,
      };
      return world.createDevice({
        driverId: 'open-toon',
        settings: all,
        capabilities: capabilitiesFor(featureState(all)),
        store: { migrationVersion: 1, toonwaterDecidedBy: 'user', ...store },
        ...spec,
      });
    },

    /** Log lines of level `level` written by devices. */
    deviceLog: (level) => world.logs.filter((entry) => entry.source.startsWith('device:') && (level === undefined || entry.level === level))
      .map((entry) => entry.args.map(String).join(' ')),
  };
  return scenario;
}

/** Runs `body` with a started scenario and always gives the global fetch, Date.now and Math.random back. */
async function withScenario(options, body) {
  const scenario = createScenario(options);
  await scenario.start();
  try {
    return await body(scenario);
  } finally {
    scenario.stop();
  }
}

module.exports = {
  createScenario, withScenario, DEFAULT_HOST, EPOCH,
};
