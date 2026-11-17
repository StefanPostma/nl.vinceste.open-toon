'use strict';

/*
 * Lint canary fixture (ADR-0012): a Homey.Device subclass with one un-awaited SDK promise.
 * The repository lint must stay clean, so the rule is disabled here; test/static/lint-canary.test.js lints this
 * file with allowInlineConfig:false and expects exactly one report, which proves that the rule is live.
 */

/* eslint-disable @typescript-eslint/no-floating-promises */

const Homey = require('homey');

class CanaryDevice extends Homey.Device {
  async onInit() {
    this.setCapabilityValue('measure_power', 1);
  }
}

module.exports = CanaryDevice;
