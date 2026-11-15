'use strict';

/*
 * Layering rules of docs/sdlc/05-architecture.md section 2 (ADR-0002, ADR-0012, ADR-0013), checked by grep.
 * The scanners work on a path and a source text, so each rule has a positive and a negative case on inline
 * snippets; the same scanners then run over the real tree. Files listed in .eslintrc.json "ignorePatterns" would be
 * exempt; since S4 replaced the baseline files the list is empty and every file is checked.
 *
 * Timers: ESLint's homey-app/global-timers reports bare setTimeout()/setInterval() only. Here the bare form and
 * the global/globalThis member forms are both reported; `this.homey.setTimeout(` and a timers object that was
 * injected (`timers.setTimeout(`) are fine.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, read, walk } = require('../helpers/paths');

const OUTBOUND_MODULES = ['http', 'https', 'net', 'dns', 'undici', 'child_process', 'dgram', 'tls'];
const TIMER_CALL = /(?<![.\w$])set(?:Timeout|Interval)\s*\(|\b(?:global|globalThis)\.set(?:Timeout|Interval)\s*\(/g;

// The leftovers of the old code base that must not come back (implementation plan section 1.2). Assembled from
// fragments so that this file itself does not trip the greps that verify the repository.
const LEFTOVERS = [
  ['the homey-wifidriver dependency', new RegExp(`require\\(\\s*['"]homey-wifi${'driver'}['"]`)],
  ['the request-promise library', new RegExp(`request-${'promise'}`)],
  ['the SDK v2 Homey.__', new RegExp(`Homey\\.__${'\\('}`)],
  ['the SDK v2 socket.on pairing API', new RegExp(`socket\\.${'on'}\\(`)],
  ['an SDK v2 flow card class', new RegExp(`new Homey\\.${'Flow'}`)],
  ['an open task marker', new RegExp(`\\b(?:${'TO'}${'DO'}|${'FIX'}${'ME'})\\b`)],
  ['console logging', new RegExp(`console\\.${'log'}`)],
];

/** The ignorePatterns as repository paths: a leading slash anchors a pattern to the config directory. */
function ignoredFiles() {
  return (JSON.parse(read('.eslintrc.json')).ignorePatterns || []).map((pattern) => pattern.replace(/^\//, ''));
}

/** Block comments become blank lines and whole-line // comments vanish, so that prose cannot trip a rule. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => '\n'.repeat(comment.split('\n').length - 1))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function findAll(file, source, pattern, message) {
  return [...source.matchAll(pattern)].map((match) => `${file}:${lineOf(source, match.index)}: ${message}`);
}

const inApp = (file) => file === 'app.js' || file.startsWith('drivers/') || file.startsWith('lib/');
const inLibOrDrivers = (file) => file.startsWith('lib/') || file.startsWith('drivers/');

/**
 * All layering rules for one file.
 * @param {string} file path relative to the repository root, '/' separated
 * @param {string} rawSource file content
 * @returns {string[]} one message per violation
 */
function scan(file, rawSource) {
  const source = stripComments(rawSource);
  const problems = [];

  if (file.startsWith('lib/')) {
    problems.push(...findAll(file, source, /require\(\s*['"]homey['"]\s*\)/g, 'require("homey") belongs to app.js and drivers/** only'));
  }
  if (inApp(file) && file !== 'drivers/open-toon/driver.js') {
    problems.push(...findAll(file, source, /\b(?:globalThis|global)\.fetch\b/g, 'only drivers/open-toon/driver.js may touch the global fetch'));
  }
  if (inLibOrDrivers(file)) {
    const modules = new RegExp(`require\\(\\s*['"](?:node:)?(?:${OUTBOUND_MODULES.join('|')})['"]\\s*\\)`, 'g');
    problems.push(...findAll(file, source, modules, 'an outbound network or process module; fetch is the only way out'));
  }
  if (inApp(file) || file.startsWith('scripts/')) {
    problems.push(...findAll(file, source, TIMER_CALL, 'a global timer; use this.homey.setTimeout or an injected timers object'));
  }
  if (inApp(file) && file !== 'lib/features/toonwater.js') {
    problems.push(...findAll(file, source, /water\.html/g, '/water.html belongs to lib/features/toonwater.js only'));
  }
  if ((inApp(file) || file.startsWith('scripts/')) && file.endsWith('.js')) {
    LEFTOVERS.forEach(([what, pattern]) => problems.push(...findAll(file, source, new RegExp(pattern, 'g'), `leftover of the old code: ${what}`)));
  }
  return problems;
}

/*
 * ADR-0005 never-rejects rule: `this.homey.setTimeout(() => this.refresh(), ms)` returns a promise from an arrow
 * function, which no-floating-promises does not see, so a callback that rejects would be an unhandled rejection. A
 * timer callback therefore may only call one of these functions, and each of them is async with a try/catch around
 * everything it does. A callback that is a plain identifier only forwards one that was made elsewhere.
 */
const NEVER_REJECTS = ['_tick', '_soon', '_reassert'];
const TIMER_CALL_WITH_CALLBACK = /\b(?:homey|_?timers)\.set(?:Timeout|Interval)\s*\(/g;
const FUNCTION_BODY_GUARDED = /^\s*(?:(?:const|let)\b[^;]*;\s*)*try\s*\{[\s\S]*\}\s*catch\b/;

/** The index of the bracket that closes the one at `open`. */
function closingBracket(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if ('([{'.includes(source[index])) depth++;
    else if (')]}'.includes(source[index]) && --depth === 0) return index;
  }
  return source.length;
}

/** The text of the first argument of the call whose opening parenthesis is at `open`. */
function firstArgument(source, open) {
  let depth = 0;
  for (let index = open + 1; index < source.length; index++) {
    const char = source[index];
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char) && depth-- === 0) return source.slice(open + 1, index);
    else if (char === ',' && depth === 0) return source.slice(open + 1, index);
  }
  return source.slice(open + 1);
}

function scanTimerCallbacks(file, rawSource) {
  const source = stripComments(rawSource);
  return [...source.matchAll(TIMER_CALL_WITH_CALLBACK)].flatMap((match) => {
    const callback = firstArgument(source, match.index + match[0].length - 1).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(callback)) return [];
    const safe = NEVER_REJECTS.some((name) => new RegExp(`\\b${name}\\(`).test(callback)) && !/\bawait\b/.test(callback);
    return safe ? [] : [`${file}:${lineOf(source, match.index)}: a timer callback must only call ${NEVER_REJECTS.join(' or ')}`];
  });
}

/** Every async function of the allow-list in this file must wrap its whole body in try/catch. */
function scanNeverRejectsDefinitions(file, rawSource) {
  const source = stripComments(rawSource);
  return NEVER_REJECTS.flatMap((name) => {
    const found = new RegExp(`async ${name}\\(`).exec(source);
    if (!found) return [];
    const parameters = source.indexOf('(', found.index);
    const open = source.indexOf('{', closingBracket(source, parameters));
    const body = source.slice(open + 1, closingBracket(source, open));
    return FUNCTION_BODY_GUARDED.test(body) ? [] : [`${file}:${lineOf(source, found.index)}: ${name} must be async and wrapped in try/catch`];
  });
}

/** JavaScript files under app.js, drivers/, lib/ and scripts/ that are not exempt. */
function checkedFiles() {
  const exempt = ignoredFiles();
  return [...(fs.existsSync(path.join(ROOT, 'app.js')) ? ['app.js'] : []), ...walk('drivers'), ...walk('lib'), ...walk('scripts')]
    .filter((file) => /\.(js|cjs)$/.test(file) && !exempt.includes(file));
}

describe('NFR-15: fetch is the only outbound path and it enters through one file', () => {
  test('no module under lib/ or drivers/ requires an outbound module, also with the node: prefix', () => {
    OUTBOUND_MODULES.forEach((name) => {
      [name, `node:${name}`].forEach((id) => {
        assert.equal(scan('lib/toon/client.js', `const x = require('${id}');`).length, 1, id);
        assert.equal(scan('drivers/open-toon/device.js', `const x = require("${id}");`).length, 1, id);
      });
    });
    assert.deepEqual(scan('scripts/validate.js', "const { spawnSync } = require('child_process');"), [], 'scripts may start the Homey CLI');
  });

  test('globalThis.fetch is allowed in drivers/open-toon/driver.js only', () => {
    assert.deepEqual(scan('drivers/open-toon/driver.js', 'const client = create(globalThis.fetch);'), []);
    assert.equal(scan('lib/toon/client.js', 'globalThis.fetch(url);').length, 1);
    assert.equal(scan('drivers/open-toon/device.js', 'const f = global.fetch;').length, 1);
    assert.equal(scan('app.js', 'globalThis.fetch(url)').length, 1);
    assert.deepEqual(scan('lib/toon/client.js', 'const response = await fetch(url, init);'), [], 'an injected fetch parameter is the intended use');
  });

  test('require("homey") is allowed in app.js and drivers/** but not in lib/**', () => {
    assert.deepEqual(scan('app.js', "const Homey = require('homey');"), []);
    assert.deepEqual(scan('drivers/open-toon/device.js', "const Homey = require('homey');"), []);
    assert.equal(scan('lib/engine/poller.js', "const Homey = require('homey');").length, 1);
  });

  test('the repository complies', () => {
    assert.deepEqual(checkedFiles().flatMap((file) => scan(file, read(file))), []);
  });
});

describe('NFR-01 AC2: no global timer in app code (the lint rule only sees the bare form)', () => {
  test('bare and member forms are reported, this.homey and injected timers are not', () => {
    assert.equal(scan('lib/engine/poller.js', 'setTimeout(run, 10);').length, 1);
    assert.equal(scan('lib/engine/poller.js', 'setInterval(run, 10);').length, 1);
    assert.equal(scan('lib/engine/poller.js', 'global.setTimeout(run, 10);').length, 1);
    assert.equal(scan('drivers/open-toon/device.js', 'globalThis.setInterval(run, 10);').length, 1);
    assert.equal(scan('app.js', 'const t = setTimeout (run, 10);').length, 1);
    assert.deepEqual(scan('lib/engine/poller.js', 'this.homey.setTimeout(run, 10);'), []);
    assert.deepEqual(scan('lib/toon/client.js', 'const handle = timers.setTimeout(abort, 5000);'), []);
    assert.deepEqual(scan('lib/engine/poller.js', 'this.timers.setTimeout(run, 10);'), []);
    assert.deepEqual(scan('lib/engine/poller.js', '// setTimeout( in a comment\n/* setInterval( too */'), []);
  });

  test('the member-form fixture that ESLint misses is caught here', () => {
    const fixture = read('test/fixtures/lint/global-timer.js');
    const problems = scan('lib/probe.js', fixture);

    assert.equal(problems.length, 2, problems.join('\n'));
    assert.ok(problems.some((problem) => problem.includes('lib/probe.js:13')), 'the global.setTimeout line');
    assert.equal(fixture.split('\n')[12].trim(), 'global.setTimeout(callback, 20);');
  });
});

describe('NFR-10 AC1: the water endpoint has exactly one home', () => {
  test('/water.html may be named in lib/features/toonwater.js only', () => {
    assert.deepEqual(scan('lib/features/toonwater.js', "const PATH = '/water.html';"), []);
    assert.equal(scan('lib/engine/poller.js', "get('/water.html')").length, 1);
    assert.equal(scan('drivers/open-toon/device.js', "'/water.html'").length, 1);
  });
});

describe('NFR-10 AC1: nothing of the old code base comes back', () => {
  test('each leftover is reported in app code and scripts', () => {
    const join = (...parts) => parts.join('');
    const samples = [
      `const lib = require('${join('homey-wifi', 'driver')}');`,
      `require('${join('request-', 'promise-native')}')`,
      "Homey.__('offline')",
      "socket.on('x', cb)",
      `new ${join('Homey.Flow', 'CardAction')}()`,
      `const keep = 1; // ${join('TO', 'DO')}`,
      `const keep = 1; // ${join('FIX', 'ME')}`,
      `${join('console', '.log')}(1)`,
    ];

    samples.forEach((sample) => {
      assert.ok(scan('lib/engine/apply.js', sample).length >= 1, sample);
    });
    assert.equal(scan('scripts/x.js', `${join('console', '.log')}(1)`).length, 1);
    assert.deepEqual(scan('lib/x.js', `// ${join('TO', 'DO')} a whole-line comment is prose`), []);
    assert.deepEqual(scan('drivers/open-toon/pair/start.html', "Homey.__('pair.title'); Homey.emit('x');"), [], 'the front-end API of pair views is correct');
  });

  test('no file is exempt from lint and layering any more: the baseline files are replaced and ignorePatterns is gone', () => {
    assert.deepEqual(ignoredFiles(), []);
    assert.equal(Object.hasOwn(JSON.parse(read('.eslintrc.json')), 'ignorePatterns'), false);
  });
});

describe('NFR-01 AC1 / ADR-0005: a timer callback never rejects', () => {
  test('a callback that calls an allow-listed function passes; any other body, an await, or a missing call is reported', () => {
    assert.deepEqual(scanTimerCallbacks('lib/engine/poller.js', 'this.timers.setTimeout(() => this._tick(), delay);'), []);
    assert.deepEqual(scanTimerCallbacks('drivers/open-toon/device.js', 'this.homey.setTimeout(() => this._soon(key, ids), 1500);'), []);
    assert.equal(scanTimerCallbacks('lib/engine/poller.js', 'timers.setTimeout(() => this.refresh(), 10);').length, 1);
    assert.equal(scanTimerCallbacks('lib/engine/poller.js', 'this.homey.setTimeout(async () => { await this._tick(); }, 10);').length, 1);
    assert.equal(scanTimerCallbacks('lib/engine/poller.js', 'this.homey.setTimeout(function run() { this._cycle(); }, 10);').length, 1);
    assert.equal(scanTimerCallbacks('drivers/open-toon/device.js', 'this.homey.setInterval(() => ping(), 10);').length, 1);
  });

  test('a callback that is a plain identifier only forwards one made elsewhere; comments and unrelated calls are ignored', () => {
    assert.deepEqual(scanTimerCallbacks('drivers/open-toon/device.js', 'setTimeout: (callback, ms) => this.homey.setTimeout(callback, ms),'), []);
    assert.deepEqual(scanTimerCallbacks('lib/engine/poller.js', '// this.homey.setTimeout(() => boom(), 1)\nconst a = arm(() => stop(), 5);'), []);
  });

  test('a function of the allow-list must be async and put everything in try/catch', () => {
    const good = 'async _tick() {\n  const { gen } = this;\n  try {\n    await go();\n  } catch (error) {\n    log(error);\n  } finally {\n    done();\n  }\n}';
    const bare = 'async _tick() {\n  await go();\n}';
    const late = 'async _soon(key) {\n  this.soon.delete(key);\n  try {\n    await go();\n  } catch (error) {\n    log(error);\n  }\n}';

    assert.deepEqual(scanNeverRejectsDefinitions('lib/engine/poller.js', good), []);
    assert.equal(scanNeverRejectsDefinitions('lib/engine/poller.js', bare).length, 1);
    assert.equal(scanNeverRejectsDefinitions('lib/engine/poller.js', late).length, 1, 'work before the try can throw');
    assert.deepEqual(scanNeverRejectsDefinitions('lib/engine/poller.js', 'async other() { await go(); }'), []);
  });

  test('the repository complies, and every name of the allow-list is defined somewhere', () => {
    const files = checkedFiles();
    const sources = files.map((file) => ({ file, source: read(file) }));

    assert.deepEqual(sources.flatMap(({ file, source }) => scanTimerCallbacks(file, source)), []);
    assert.deepEqual(sources.flatMap(({ file, source }) => scanNeverRejectsDefinitions(file, source)), []);
    NEVER_REJECTS.forEach((name) => assert.ok(sources.some(({ source }) => new RegExp(`async ${name}\\(`).test(source)), `${name} is not defined: remove it from the allow-list`));
  });
});

describe('NFR-01 AC1: only the baseline characterisation may announce unhandled events', () => {
  test('expectUnhandled() is not used outside test/baseline and its own fixtures', () => {
    const call = new RegExp(`expect${'Unhandled'}\\(`);
    const allowed = (file) => file.startsWith('test/baseline/') || file.startsWith('test/fixtures/unhandled/') || file === 'test/helpers/unhandled.js'
      || file === 'test/static/layering.test.js';
    const offenders = walk('test').filter((file) => file.endsWith('.js') && !allowed(file) && call.test(read(file)));

    assert.deepEqual(offenders, []);
  });
});
