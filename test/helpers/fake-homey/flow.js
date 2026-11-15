'use strict';

/* Flow manager of the fake Homey: cards exist only when the manifest declares them. */

const { FlowCard } = require('./flow-card');

const KINDS = {
  action: 'actions',
  condition: 'conditions',
  trigger: 'triggers',
};

function manifestCards(manifest, section) {
  const fromApp = (manifest.flow && manifest.flow[section]) || [];
  const fromDrivers = (manifest.drivers || []).flatMap((driver) => (driver.flow && driver.flow[section]) || []);
  return [...fromApp, ...fromDrivers];
}

class FlowManager {
  constructor(world) {
    this.world = world;
    this.cards = new Map();
  }

  card(kind, id) {
    const key = `${kind}:${id}`;
    if (!this.cards.has(key)) {
      const definition = manifestCards(this.world.manifest, KINDS[kind]).find((entry) => entry.id === id);
      if (!definition) throw new Error(`Invalid Flow Card ID: ${id} (no ${kind} card with this id in app.json)`);
      this.cards.set(key, new FlowCard(this.world, kind, definition));
    }
    return this.cards.get(key);
  }

  getActionCard(id) {
    return this.card('action', id);
  }

  getConditionCard(id) {
    return this.card('condition', id);
  }

  getTriggerCard(id) {
    return this.card('trigger', id);
  }

  getDeviceTriggerCard(id) {
    const card = this.card('trigger', id);
    if (!(card.manifest.args || []).some((arg) => arg.type === 'device')) {
      throw new Error(`Flow card ${id} has no device argument; use getTriggerCard`);
    }
    return card;
  }
}

module.exports = { FlowManager, FlowCard };

module.exports = { FlowManager };
