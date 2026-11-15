'use strict';

/*
 * One Flow card of the fake Homey. A card accepts exactly one run listener, validates the arguments it is run
 * with, and device triggers validate their tokens.
 */

function tokenError(token, value) {
  if (token.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? null : 'a finite number';
  if (token.type === 'boolean') return typeof value === 'boolean' ? null : 'a boolean';
  if (token.type === 'string' || token.type === undefined) return typeof value === 'string' ? null : 'a string';
  return null;
}

class FlowCard {
  constructor(world, kind, definition) {
    this.world = world;
    this.kind = kind;
    this.id = definition.id;
    this.manifest = definition;
    this.runListener = null;
  }

  registerRunListener(listener) {
    if (typeof listener !== 'function') throw new TypeError(`Flow card ${this.id}: the run listener must be a function`);
    if (this.runListener) throw new Error(`Flow card ${this.id}: a run listener is already registered`);
    this.runListener = listener;
    return this;
  }

  /** Test API: what Homey does when the card runs. Dropdown values may be given as 'id' or {id}. */
  async run(args = {}, state = {}) {
    if (!this.runListener) throw new Error(`Flow card ${this.id}: no run listener registered`);
    const declared = (this.manifest.args || []);
    Object.keys(args).forEach((name) => {
      if (!declared.some((arg) => arg.name === name)) throw new Error(`Flow card ${this.id}: unknown argument ${name}`);
    });
    declared.filter((arg) => arg.type === 'dropdown').forEach((arg) => {
      if (args[arg.name] === undefined) return;
      const given = typeof args[arg.name] === 'object' && args[arg.name] !== null ? args[arg.name].id : args[arg.name];
      if (!arg.values.some((entry) => entry.id === given)) throw new Error(`Flow card ${this.id}: ${given} is not a value of ${arg.name}`);
    });
    return this.runListener(args, state);
  }

  /** Device trigger cards: fire the trigger for a device. */
  async trigger(device, tokens = {}, state = {}) {
    if (this.kind !== 'trigger') throw new Error(`Flow card ${this.id} is not a trigger`);
    if (!device || typeof device.getData !== 'function') throw new TypeError(`Flow card ${this.id}: trigger() needs the device as first argument`);
    const declared = this.manifest.tokens || [];
    Object.keys(tokens).forEach((name) => {
      const token = declared.find((entry) => entry.name === name);
      if (!token) throw new Error(`Flow card ${this.id}: unknown token ${name}`);
      const expected = tokenError(token, tokens[name]);
      if (expected) throw new TypeError(`Flow card ${this.id}: token ${name} must be ${expected}`);
    });
    this.world.triggerCalls.push({
      id: this.id, deviceId: device.getData().id, tokens: { ...tokens }, state: { ...state }, source: 'app',
    });
  }
}

module.exports = { FlowCard };
