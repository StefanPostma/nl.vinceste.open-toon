'use strict';

const { settingModel, settingError } = require('./settings');

const jsonClone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class Device {
  constructor({
    homey, driver, record, world,
  }) {
    this.homey = homey;
    this.driver = driver;
    this._rec = record;
    this._world = world;
    this._listeners = {};
    this._deleted = false;
  }

  /** Test API: the persisted state of this device (available, unavailableMessage, warning, ...). */
  get fake() {
    return this._rec;
  }

  _alive() {
    if (this._deleted) throw new Error(`Device has been deleted: ${this._rec.name}`);
  }

  _record(method, ...args) {
    this._world.calls.push({ method, deviceId: this._rec.data.id, args: jsonClone(args) });
  }

  log(...args) {
    this._world.logs.push({ level: 'log', source: `device:${this._rec.name}`, args });
  }

  error(...args) {
    this._world.logs.push({ level: 'error', source: `device:${this._rec.name}`, args });
  }

  getData() {
    return jsonClone(this._rec.data);
  }

  getName() {
    return this._rec.name;
  }

  getClass() {
    return this._rec.class;
  }

  getSettings() {
    return jsonClone(this._rec.settings);
  }

  getSetting(key) {
    return jsonClone(this._rec.settings[key]);
  }

  async setSettings(changes) {
    this._alive();
    const model = settingModel(this.driver.manifest);
    Object.entries(changes).forEach(([key, value]) => {
      const definition = model.find((entry) => entry.id === key);
      if (!definition) throw new Error(`Invalid Setting: ${key}`);
      const problem = settingError(definition, value);
      if (problem) throw new TypeError(problem);
    });
    this._record('setSettings', changes);
    Object.assign(this._rec.settings, jsonClone(changes));
  }

  getStore() {
    return jsonClone(this._rec.store);
  }

  getStoreKeys() {
    return Object.keys(this._rec.store);
  }

  getStoreValue(key) {
    return jsonClone(this._rec.store[key]);
  }

  async setStoreValue(key, value) {
    this._alive();
    this._record('setStoreValue', key, value);
    this._rec.store[key] = jsonClone(value);
  }

  async unsetStoreValue(key) {
    this._alive();
    delete this._rec.store[key];
  }

  getCapabilities() {
    return [...this._rec.capabilities];
  }

  hasCapability(id) {
    return this._rec.capabilities.includes(id);
  }

  async addCapability(id) {
    this._alive();
    this._record('addCapability', id);
    if (!this._world.capabilities.definition(id)) throw new Error(`Invalid Capability: ${id}`);
    if (this.hasCapability(id)) throw new Error(`Capability already exists: ${id}`);
    this._rec.capabilities.push(id);
    this._rec.values[id] = null;
  }

  async removeCapability(id) {
    this._alive();
    this._record('removeCapability', id);
    if (!this.hasCapability(id)) throw new Error(`Invalid Capability: ${id}`);
    this._rec.capabilities = this._rec.capabilities.filter((entry) => entry !== id);
    delete this._rec.values[id];
    delete this._rec.options[id];
    delete this._listeners[id];
  }

  getCapabilityValue(id) {
    if (!this.hasCapability(id)) throw new Error(`Invalid Capability: ${id}`);
    return this._rec.values[id];
  }

  async setCapabilityValue(id, value) {
    this._alive();
    this._record('setCapabilityValue', id, value);
    if (!this.hasCapability(id)) throw new Error(`Invalid Capability: ${id}`);
    const problem = this._world.capabilities.valueError(id, this._rec.options[id], value);
    if (problem) throw new TypeError(problem);
    this._store(id, value);
  }

  _store(id, value) {
    const previous = this._rec.values[id];
    this._rec.values[id] = value;
    if (!sameJson(previous, value)) this._world.homeyChangedCapability(this, id, value);
  }

  getCapabilityOptions(id) {
    if (!this.hasCapability(id)) throw new Error(`Invalid Capability: ${id}`);
    return jsonClone(this._rec.options[id] || {});
  }

  async setCapabilityOptions(id, options) {
    this._alive();
    this._record('setCapabilityOptions', id, options);
    if (!this.hasCapability(id)) throw new Error(`Invalid Capability: ${id}`);
    this._rec.options[id] = jsonClone(options);
  }

  registerCapabilityListener(id, listener) {
    if (!this.hasCapability(id)) throw new Error(`Invalid Capability: ${id}`);
    if (typeof listener !== 'function') throw new TypeError('The capability listener must be a function');
    this._listeners[id] = listener;
  }

  getAvailable() {
    return this._rec.available;
  }

  async setAvailable() {
    this._alive();
    this._record('setAvailable');
    this._rec.available = true;
    this._rec.unavailableMessage = null;
  }

  /** SDK v3: setUnavailable(message?) returns a Promise; the v2 callback argument is gone. */
  setUnavailable(message, ...rest) {
    if (rest.length > 0 || typeof message === 'function') {
      throw new TypeError('setUnavailable(message, callback) is the SDK v2 signature; SDK v3 takes an optional message and returns a Promise');
    }
    if (message !== undefined && message !== null && typeof message !== 'string') {
      throw new TypeError('setUnavailable(message): message must be a string');
    }
    this._alive();
    this._record('setUnavailable', message);
    this._rec.available = false;
    this._rec.unavailableMessage = message === undefined ? null : message;
    return Promise.resolve();
  }

  async setWarning(message) {
    this._alive();
    if (message !== null && message !== undefined && (typeof message !== 'string' || message === '')) {
      throw new TypeError('setWarning(message): message must be a non-empty string, or null to clear');
    }
    this._record('setWarning', message);
    this._rec.warning = message || null;
  }

  async unsetWarning() {
    this._alive();
    this._record('unsetWarning');
    this._rec.warning = null;
  }

  /** Test API: the user changes a capability in the app (tile slider, picker). The value is stored only if the listener resolves. */
  async simulateCapabilitySet(id, value, options = {}) {
    this._alive();
    if (!this.hasCapability(id)) throw new Error(`Invalid Capability: ${id}`);
    const definition = this._world.capabilities.definition(id);
    if (definition.setable !== true) throw new Error(`Capability is not setable: ${id}`);
    const problem = this._world.capabilities.valueError(id, this._rec.options[id], value);
    if (problem) throw new TypeError(problem);
    const listener = this._listeners[id];
    if (!listener) throw new Error(`Missing Capability Listener: ${id}`);
    await listener(value, options);
    this._store(id, value);
  }

  /** Test API: the user saves device settings. Rejection keeps the old settings; resolution persists the new ones. */
  async simulateSettingsSave(changes) {
    this._alive();
    const model = settingModel(this.driver.manifest);
    Object.entries(changes).forEach(([key, value]) => {
      const definition = model.find((entry) => entry.id === key);
      if (!definition) throw new Error(`Invalid Setting: ${key}`);
      const problem = settingError(definition, value);
      if (problem) throw new TypeError(problem);
    });
    const oldSettings = this.getSettings();
    const newSettings = { ...oldSettings, ...jsonClone(changes) };
    const changedKeys = Object.keys(changes).filter((key) => !sameJson(oldSettings[key], newSettings[key]));
    const result = await this.onSettings({ oldSettings, newSettings, changedKeys });
    this._rec.settings = newSettings;
    return result;
  }

  async onInit() {
    // hook for the app
  }

  async onAdded() {
    // hook for the app
  }

  async onSettings() {
    // hook for the app
  }

  async onRenamed() {
    // hook for the app
  }

  async onDeleted() {
    // hook for the app
  }

  async onUninit() {
    // hook for the app
  }
}

module.exports = { Device };
