'use strict';

/*
 * Stand-in for `require('homey')` in tests (served by test/helpers/register.cjs). It exports what the SDK v3
 * module exports (App, Driver, Device, env, manifest) and makes every SDK v2 entry point fail loudly, so code
 * that still uses the old API cannot pass the tests. Instances are created by createWorld() in ./world.js.
 */

const { App } = require('./app');
const { Driver } = require('./driver');
const { Device } = require('./device');
const current = require('./current');

function removed(name, hint) {
  throw new Error(`Homey.${name} is SDK v2 API and does not exist in SDK v3: ${hint}`);
}

const homey = {
  App, Driver, Device,
};

Object.defineProperty(homey, 'env', { get: () => current.get().env, enumerable: true });
Object.defineProperty(homey, 'manifest', { get: () => current.get().manifest, enumerable: true });

homey.__ = () => removed('__', 'use this.homey.__() in app, driver and device code');

['FlowCardAction', 'FlowCardCondition', 'FlowCardTrigger', 'FlowCardTriggerDevice'].forEach((name) => {
  homey[name] = class RemovedFlowCard {
    constructor() {
      removed(name, 'get cards with this.homey.flow.getActionCard(), getConditionCard() or getDeviceTriggerCard()');
    }
  };
});

['app', 'ManagerSettings', 'ManagerDrivers', 'ManagerFlow', 'ManagerI18n', 'ManagerNotifications', 'ManagerCloud', 'ManagerApi', 'ManagerClock', 'ManagerInsights'].forEach((name) => {
  Object.defineProperty(homey, name, { get: () => removed(name, 'managers live on this.homey in SDK v3'), enumerable: false });
});

module.exports = homey;
