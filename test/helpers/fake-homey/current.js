'use strict';

/* The world that the module `homey` reports env and manifest for (the most recently created one). */

let current = null;

module.exports = {
  set(world) {
    current = world;
  },
  get() {
    if (!current) throw new Error('Homey.env / Homey.manifest need a world: call createWorld() first');
    return current;
  },
};
