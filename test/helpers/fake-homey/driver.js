'use strict';

class Driver {
  constructor({
    homey, id, manifest, world,
  }) {
    this.homey = homey;
    this.id = id;
    this.manifest = manifest;
    this._world = world;
  }

  log(...args) {
    this._world.logs.push({ level: 'log', source: `driver:${this.id}`, args });
  }

  error(...args) {
    this._world.logs.push({ level: 'error', source: `driver:${this.id}`, args });
  }

  getDevices() {
    return this._world.devices().filter((device) => device.driver === this);
  }

  async onInit() {
    // hook for the app
  }

  async onUninit() {
    // hook for the app
  }
}

module.exports = { Driver };
