'use strict';

/*
 * FR-122 (documentation en + nl), FR-121 (Store readiness: README.txt, changelog, images, links), NFR-07 AC1 (the
 * supported models), NFR-11 AC3 (credits), NFR-13 AC1 (the release step that takes node_modules out of git is written down).
 *
 * The documents carry three notes that a user must be able to find in their own language, in README.md (English part
 * and Dutch part), README.txt and README.nl.txt: what turning ToonWater off does to Flows and Insights (ADR-0006),
 * that two devices for one Toon are not supported (ADR-0005, R-19), and the one odd Energy interval after a meter
 * replacement (ADR-0014). A note is one sentence that holds the words of its row in NOTES. The wording of the rest
 * of the documents is not pinned.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, read, readJson } = require('../helpers/paths');

const NOTES = {
  en: {
    'ToonWater off: Flows and Insights': [/ToonWater/, /Flows/, /Insights/, /off/],
    'two devices on one Toon': [/two devices for the same Toon/i, /not supported/],
    'odd Energy interval after a meter replacement': [/Energy/, /replace a meter/, /odd (?:Energy )?interval/],
  },
  nl: {
    'ToonWater off: Flows and Insights': [/ToonWater/, /Flows/, /Insights/, /uitzetten/],
    'two devices on one Toon': [/twee apparaten voor dezelfde Toon/i, /niet ondersteund/],
    'odd Energy interval after a meter replacement': [/Energy/, /vervangen van een meter/, /vreemd(?:e)? (?:Energy-)?interval/],
  },
};

/** Markdown marks and links removed, then cut into sentences. */
function sentences(text) {
  return text
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** @returns {string[]} the names of the notes that no sentence of `text` carries */
function missingNotes(text, language) {
  const all = sentences(text);
  return Object.entries(NOTES[language])
    .filter(([, patterns]) => !all.some((sentence) => patterns.every((pattern) => pattern.test(sentence))))
    .map(([name]) => name);
}

/** The English and the Dutch part of README.md, split at the heading of the Dutch part. */
function readmeParts() {
  const text = read('README.md');
  const index = text.indexOf('\n## Nederlands');
  return { en: text.slice(0, index), nl: text.slice(index) };
}

describe('FR-122 AC1: the three notes are in README.md, README.txt and README.nl.txt, in the right language', () => {
  test('README.md says all three in its English part and again in its Dutch part', () => {
    const { en, nl } = readmeParts();

    assert.deepEqual(missingNotes(en, 'en'), []);
    assert.deepEqual(missingNotes(nl, 'nl'), []);
  });

  test('README.txt says all three in English, README.nl.txt in Dutch', () => {
    assert.deepEqual(missingNotes(read('README.txt'), 'en'), []);
    assert.deepEqual(missingNotes(read('README.nl.txt'), 'nl'), []);
  });

});

describe('NFR-07 AC1: README.md names the supported Homey models', () => {
  const { en, nl } = readmeParts();

  test('both languages name the supported Homey models and say that Cloud and Bridge are not supported', () => {
    ['Homey Pro (Early 2023)', 'Homey Pro (2016-2019)', 'Homey Pro mini', 'Homey Cloud', 'Homey Bridge'].forEach((name) => {
      assert.ok(en.includes(name), `en ${name}`);
      assert.ok(nl.includes(name), `nl ${name}`);
    });
  });
});

describe('FR-121 AC1: README.txt and README.nl.txt follow the rules of the App Store listing', () => {
  ['README.txt', 'README.nl.txt'].forEach((file) => {
    test(`${file} is plain text of one or two paragraphs: no Markdown, no URL, no changelog`, () => {
      const text = read(file);
      const paragraphs = text.trim().split(/\n\s*\n/);

      assert.ok(paragraphs.length >= 1 && paragraphs.length <= 2, `${paragraphs.length} paragraphs`);
      assert.equal(/https?:\/\/|www\./i.test(text), false, 'URL');
      assert.equal(/^\s*(?:#|[-*] |\d+\. )|`|\*\*|\]\(/m.test(text), false, 'Markdown');
      assert.equal(/changelog|^\s*\d+\.\d+\.\d+/im.test(text), false, 'changelog');
      assert.ok(text.length < 1500, 'a short text');
    });
  });

  test('both are in the app package: .homeyignore leaves README*.txt out of its list', () => {
    const ignored = read('.homeyignore').split('\n').map((line) => line.trim());

    assert.equal(ignored.some((line) => /README.*\.txt/.test(line)), false);
    assert.ok(ignored.includes('*.md'));
  });
});

describe('FR-121 AC1: the manifest is ready for the App Store (validated at publish level in CI)', () => {
  const manifest = readJson('app.json');
  const png = (relative) => {
    const header = fs.readFileSync(path.join(ROOT, relative)).subarray(0, 24);
    assert.equal(header.subarray(1, 4).toString(), 'PNG', relative);
    return [header.readUInt32BE(16), header.readUInt32BE(20)];
  };

  test('brandColor, platforms, connectivity and the three links are there', () => {
    assert.match(manifest.brandColor, /^#[0-9A-Fa-f]{6}$/);
    assert.deepEqual(manifest.platforms, ['local']);
    assert.deepEqual(manifest.drivers[0].connectivity, ['lan']);
    ['support', 'source', 'homepage'].forEach((key) => assert.match(manifest[key], /^https:\/\/github\.com\/StefanPostma\/nl\.vinceste\.open-toon/));
    assert.match(manifest.bugs.url, /^https:\/\/github\.com\/StefanPostma\/nl\.vinceste\.open-toon\/issues$/);
  });

  test('the app images are 250x175 and 500x350, the driver images 75x75 and 500x500 (HS-18)', () => {
    assert.deepEqual(png(manifest.images.small), [250, 175]);
    assert.deepEqual(png(manifest.images.large), [500, 350]);
    assert.deepEqual(png(manifest.drivers[0].images.small), [75, 75]);
    assert.deepEqual(png(manifest.drivers[0].images.large), [500, 500]);
  });

  test('a README.txt and an English changelog entry for the version of the manifest exist', () => {
    const changelog = readJson('.homeychangelog.json');

    assert.ok(fs.existsSync(path.join(ROOT, 'README.txt')));
    assert.ok(fs.existsSync(path.join(ROOT, 'README.nl.txt')));
    assert.equal(typeof changelog[manifest.version].en, 'string');
    assert.ok(changelog[manifest.version].en.length > 0);
  });
});

describe('FR-122 AC1 and FR-121 AC1: .homeychangelog.json', () => {
  const changelog = readJson('.homeychangelog.json');

  test('every key is a plain semver and 2.0.0 has an en and an nl text', () => {
    Object.keys(changelog).forEach((version) => assert.match(version, /^\d+\.\d+\.\d+$/));
    assert.ok(changelog['2.0.0']);
    ['en', 'nl'].forEach((language) => assert.ok(changelog['2.0.0'][language].trim().length > 0, language));
  });

  test('the version of package.json, of the manifest and of the changelog agree', () => {
    assert.equal(readJson('package.json').version, readJson('app.json').version);
    assert.ok(Object.hasOwn(changelog, readJson('package.json').version));
  });
});

describe('FR-122 AC2, NFR-11 AC3 and NFR-13 AC1: CONTRIBUTING.md and the credits', () => {
  const contributing = read('CONTRIBUTING.md');

  test('NFR-13 AC1: the release step that takes node_modules out of git is written down (it is not done by the build)', () => {
    assert.ok(contributing.includes('git rm -r --cached node_modules'));
  });

  test('FR-122 AC2: README.md and the manifest credit the people who built the app', () => {
    const names = readJson('app.json').contributors.developers.map((developer) => developer.name);
    const readme = read('README.md');

    ['oepi-loepi', 'Paul Heeringa'].forEach((name) => {
      assert.ok(names.includes(name), `manifest ${name}`);
      assert.ok(readme.includes(name), `README ${name}`);
    });
    assert.ok(readme.includes('moezie'));
    assert.ok(readme.includes('GPL-3.0'));
  });
});
