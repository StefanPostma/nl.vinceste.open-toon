'use strict';

/*
 * The pair view under test. The inline script of drivers/open-toon/pair/start.html runs in a vm context against a
 * minimal DOM (elements by id, with the properties and events that the script uses) and a `Homey` object that the
 * test supplies. A click on a disabled button does nothing, as in a browser. Text set through `textContent` stays
 * text: nothing here parses markup, and the script has no other way to put text on the page. What this does not
 * model is Homey's own pairing screen around the view: that is [HW-01].
 *
 *   const view = loadPairView({ __: translate, emit, createDevice, done, setTitle });
 *   view.type('address', '192.168.1.50');
 *   await view.click('test');
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const START = path.join(__dirname, '..', '..', 'drivers', 'open-toon', 'pair', 'start.html');
const TAG_WITH_ID = /<[a-z][a-z0-9]*\s([^>]*\bid="[^"]+"[^>]*)>/gi;

class Element {
  constructor(id, { hidden, disabled }) {
    this.id = id;
    this.hidden = hidden;
    this.disabled = disabled;
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this.classes = new Set();
    this.listeners = new Map();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this.classes.has(name) : Boolean(force);
        if (on) this.classes.add(name);
        else this.classes.delete(name);
        return on;
      },
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  /** Calls the listeners of an event; resolves when the async ones are done. */
  dispatch(type) {
    return Promise.all((this.listeners.get(type) || []).map((listener) => listener({ type, target: this })));
  }
}

/**
 * @param {object} homey the `Homey` object of the view: `__`, `emit`, `createDevice`, `done`, `setTitle`
 * @param {string} [file] the view to load
 */
function loadPairView(homey, file = START) {
  const html = fs.readFileSync(file, 'utf8');
  const elements = new Map();
  for (const [, attributes] of html.matchAll(TAG_WITH_ID)) {
    const bare = attributes.replace(/"[^"]*"/g, '""');
    const [, id] = /\bid="([^"]+)"/.exec(attributes);
    elements.set(id, new Element(id, { hidden: /\bhidden\b/.test(bare), disabled: /\bdisabled\b/.test(bare) }));
  }
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];
  const element = (id) => {
    if (!elements.has(id)) throw new Error(`The view has no element ${id}`);
    return elements.get(id);
  };
  vm.runInNewContext(script, { document: { getElementById: (id) => elements.get(id) || null }, Homey: homey });

  return {
    element,
    /** What the user sees of an element: false while it is hidden. */
    shown: (id) => !element(id).hidden,
    text: (id) => element(id).textContent,
    /** Types into a field; the `input` event follows. */
    type(id, value) {
      element(id).value = value;
      return element(id).dispatch('input');
    },
    tick(id, checked = true) {
      element(id).checked = checked;
      return element(id).dispatch('change');
    },
    click(id) {
      const target = element(id);
      return target.disabled ? Promise.resolve([]) : target.dispatch('click');
    },
  };
}

module.exports = { loadPairView, START };
