'use strict';

class App {
  constructor({ homey, world }) {
    this.homey = homey;
    this.id = world.manifest.id;
    this.manifest = world.manifest;
    this._world = world;
  }

  log(...args) {
    this._world.logs.push({ level: 'log', source: 'app', args });
  }

  error(...args) {
    this._world.logs.push({ level: 'error', source: 'app', args });
  }

  async onInit() {
    // hook for the app
  }

  async onUninit() {
    // hook for the app
  }
}

module.exports = { App };
