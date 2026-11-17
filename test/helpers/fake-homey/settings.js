'use strict';

/* Setting definitions of a driver manifest and the value checks Homey applies to them. */

function settingModel(driverManifest) {
  return (driverManifest.settings || []).flatMap((entry) => (entry.type === 'group' ? entry.children : [entry]));
}

function settingError(definition, value) {
  const { id, type } = definition;
  switch (type) {
    case 'checkbox': return typeof value === 'boolean' ? null : `Invalid value for setting ${id}: expected a boolean`;
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : `Invalid value for setting ${id}: expected a number`;
    case 'dropdown':
    case 'radio': return (definition.values || []).some((entry) => entry.id === value) ? null : `Invalid value for setting ${id}: not one of the values`;
    default: return typeof value === 'string' ? null : `Invalid value for setting ${id}: expected a string`;
  }
}

module.exports = { settingModel, settingError };
