'use strict';

const Homey = require('homey');
const {
  PairingProblem, pairingMessage, readAddress, testConnection, buildNewDevice,
} = require('../../lib/engine/pairing');
const { createFlow } = require('../../lib/flow/cards');
const { ToonClient, homeyTimers } = require('../../lib/toon/client');
const { ToonError } = require('../../lib/toon/errors');

class ToonDriver extends Homey.Driver {
  constructor(...args) {
    super(...args);
    this._timers = homeyTimers(this);
  }

  /** Gets the Flow cards from Homey once: puts the listeners on the cards and keeps the triggers for the devices (HS-41). */
  async onInit() {
    this._flow = createFlow(this.homey);
    this._flow.register();
    this.log('Open-Toon driver started');
  }

  /**
   * A device reports the capability changes of one poll answer; the triggers that they call for are fired. Never throws.
   * @param {object} device
   * @param {{id: string, prev: *, next: *}[]} changes
   */
  fireTriggers(device, changes) {
    this._flow.fire(device, changes);
  }

  /**
   * The pair view (ADR-0008) asks for two things: to test the connection to an address, and to turn what the user
   * entered into the device that it then creates itself.
   * @param {object} session the PairSession
   */
  async onPair(session) {
    session.setHandler('testConnection', (request) => this._pairing(() => this._testConnection(request)));
    session.setHandler('buildDevice', (request) => this._pairing(() => this._buildDevice(request)));
  }

  /**
   * The one place where the app gets hold of the network: the global fetch of the runtime goes into the client from here.
   * @param {string} host a normalized address
   * @param {{setTimeout: Function, clearTimeout: Function}} timers the Homey timers of the device that asks
   */
  createClient(host, timers) {
    return new ToonClient({ host, fetch: (url, init) => globalThis.fetch(url, init), timers });
  }

  _testConnection(request) {
    return testConnection(this.createClient(readAddress(request), this._timers), { timers: this._timers });
  }

  _buildDevice(request) {
    return buildNewDevice(request, {
      options: this.manifest.capabilitiesOptions,
      taken: this.getDevices().map((device) => device.getData().id),
    });
  }

  /** Whatever goes wrong while pairing reaches the view as a sentence in the language of the user, never as an error of ours. */
  async _pairing(task) {
    try {
      return await task();
    } catch (error) {
      if (!(error instanceof PairingProblem) && !(error instanceof ToonError)) this.error('pairing failed unexpectedly:', error);
      throw new Error(pairingMessage(this.homey, error));
    }
  }
}

module.exports = ToonDriver;
