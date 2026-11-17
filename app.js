'use strict';

const Homey = require('homey');

class ToonApp extends Homey.App {
  async onInit() {
    // Raw Toon answers are logged only on a development run (`homey app run`) or when env.json was present at install.
    this.debugPayloads = process.env.DEBUG === '1' || this.homey.env.OPEN_TOON_DEBUG === '1';
    this.log('Open-Toon started');
  }
}

module.exports = ToonApp;
