'use strict';

/*
 * Capability definitions for the fake Homey. Custom capabilities come from the app manifest, system
 * capabilities from the validator's own definitions in homey-lib (a devDependency of the Homey CLI),
 * so the fake and `homey app validate` agree on types, enum values and steps.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

// homey-lib is a dependency of the Homey CLI, not of this project: resolve it the way the CLI does.
const cliRequire = createRequire(require.resolve('homey/package.json'));
const SYSTEM_DIR = path.join(path.dirname(cliRequire.resolve('homey-lib/package.json')), 'assets', 'capability', 'capabilities');
const systemCache = new Map();

function systemDefinition(base) {
  if (!/^[a-z0-9_]+$/i.test(base)) return null;
  if (!systemCache.has(base)) {
    const file = path.join(SYSTEM_DIR, `${base}.json`);
    systemCache.set(base, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
  }
  return systemCache.get(base);
}

function sameNumber(a, b) {
  return Math.abs(a - b) < 1e-9;
}

class CapabilityModel {
  constructor(manifest) {
    this.custom = manifest.capabilities || {};
  }

  /** The definition of `id` (custom, or system including sub-capabilities such as meter_power.peak), or null. */
  definition(id) {
    if (typeof id !== 'string') return null;
    if (Object.hasOwn(this.custom, id)) return this.custom[id];
    const [base] = id.split('.');
    if (Object.hasOwn(this.custom, base)) return this.custom[base];
    return systemDefinition(base);
  }

  isCustom(id) {
    return typeof id === 'string' && Object.hasOwn(this.custom, id.split('.')[0]);
  }

  /** The error message for a value Homey would refuse for this capability, or null when it is fine. */
  valueError(id, deviceOptions, value) {
    const definition = this.definition(id);
    if (!definition) return `Invalid Capability: ${id}`;
    if (value === null) return null;
    const options = { ...definition, ...(deviceOptions || {}) };
    const invalid = (expected) => `Invalid value for capability ${id}: expected ${expected}, got ${typeof value === 'number' ? value : JSON.stringify(value)}`;

    switch (definition.type) {
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) return invalid('a finite number');
        if (options.step && !sameNumber(value / options.step, Math.round(value / options.step))) {
          return invalid(`a multiple of step ${options.step}`);
        }
        return null;
      case 'boolean':
        return typeof value === 'boolean' ? null : invalid('a boolean');
      case 'string':
        return typeof value === 'string' ? null : invalid('a string');
      case 'enum': {
        const ids = (definition.values || []).map((entry) => entry.id);
        return ids.includes(value) ? null : invalid(`one of ${ids.join('|')}`);
      }
      default:
        return null;
    }
  }
}

module.exports = { CapabilityModel };
