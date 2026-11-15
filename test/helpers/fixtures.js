'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');
const TOON_DIR = path.join(FIXTURE_DIR, 'toon');

/** Names (without extension) of every file in test/fixtures/toon. */
function toonFixtureNames() {
  return fs.readdirSync(TOON_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

/** The whole fixture file: `{source, payload}`. */
function toonFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(TOON_DIR, `${name}.json`), 'utf8'));
}

/** A fresh copy of the payload, safe to mutate. */
function toonPayload(name) {
  return toonFixture(name).payload;
}

/** Any JSON file in test/fixtures, addressed relative to that directory. */
function jsonFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, relativePath), 'utf8'));
}

module.exports = {
  FIXTURE_DIR, toonFixtureNames, toonFixture, toonPayload, jsonFixture,
};
