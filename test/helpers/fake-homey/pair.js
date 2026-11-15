'use strict';

/*
 * Fake PairSession (SDK v3). The app side is setHandler/emit/showView/nextView/prevView/done; `call` and
 * `createDevice` simulate what the pair view does with Homey.emit() and Homey.createDevice().
 */

class PairSession {
  constructor(world, driver) {
    this.world = world;
    this.driver = driver;
    this.handlers = {};
    this.emitted = [];
    this.views = [];
    this.finished = false;
  }

  setHandler(event, handler) {
    if (typeof event !== 'string' || typeof handler !== 'function') throw new TypeError('setHandler(event: string, handler: function)');
    if (Object.hasOwn(this.handlers, event)) throw new Error(`A handler for pair event ${event} is already registered`);
    this.handlers[event] = handler;
  }

  /** v2 pairing API; SDK v3 hands the driver a PairSession without it. */
  on() {
    throw new Error('Listening on the pairing socket is the SDK v2 pairing API; SDK v3 uses session.setHandler(event, handler)');
  }

  async emit(event, data) {
    this.emitted.push({ event, data });
  }

  async showView(id) {
    this.views.push(id);
  }

  async nextView() {
    this.views.push('next');
  }

  async prevView() {
    this.views.push('prev');
  }

  async done() {
    this.finished = true;
  }

  /** Test API: the pair view calls Homey.emit(event, data) and awaits the handler's result. */
  async call(event, data) {
    if (!Object.hasOwn(this.handlers, event)) throw new Error(`No handler registered for pair event ${event}`);
    return this.handlers[event](data);
  }

  /** Test API: the pair view calls Homey.createDevice(deviceData). */
  async createDevice(deviceData) {
    return this.world.createPairedDevice(this.driver.id, deviceData);
  }
}

module.exports = { PairSession };
