'use strict';

/*
 * ADR-0012: "the lint proves NFR-01 AC2" is itself a test. The canary lints fixtures with the repository's real
 * ESLint configuration and with inline directives switched off (the fixtures disable their rule so that the
 * repository lint stays clean).
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');
const {
  ROOT, exists, read, readJson,
} = require('../helpers/paths');

const eslint = new ESLint({ cwd: ROOT, allowInlineConfig: false });

async function lint(relative) {
  const [result] = await eslint.lintFiles([relative]);
  return result.messages;
}

describe('NFR-01 AC2: lint canary', () => {
  test('exactly one no-floating-promises report on an un-awaited setCapabilityValue of a Homey.Device subclass', async () => {
    const messages = await lint('test/fixtures/lint/floating-promise-device.js');

    assert.deepEqual(messages.filter((message) => message.fatal), [], 'the fixture must be inside the type-aware project');
    const floating = messages.filter((message) => message.ruleId === '@typescript-eslint/no-floating-promises');
    assert.equal(floating.length, 1, JSON.stringify(messages));
    assert.match(read('test/fixtures/lint/floating-promise-device.js').split('\n')[floating[0].line - 1], /this\.setCapabilityValue/);
  });

  test('the SDK types are installed: without them every Homey call is any and the rule would be silent', () => {
    const pkg = readJson('node_modules/@types/homey/package.json');

    assert.equal(pkg.name, 'homey-apps-sdk-v3-types');
    assert.ok(exists('node_modules/@types/homey/homey.d.ts'));
  });

  test('homey-app/global-timers reports the bare setTimeout and misses global.setTimeout, which layering.test.js catches', async () => {
    const messages = await lint('test/fixtures/lint/global-timer.js');
    const source = read('test/fixtures/lint/global-timer.js').split('\n');
    const reported = messages.filter((message) => message.ruleId === 'homey-app/global-timers').map((message) => source[message.line - 1].trim());

    assert.deepEqual(reported, ['setTimeout(callback, 10);']);
  });

  test('the repository configuration makes both rules errors for application code', async () => {
    const config = await eslint.calculateConfigForFile(path.join(ROOT, 'lib', 'probe.js'));

    assert.deepEqual(config.rules['@typescript-eslint/no-floating-promises'], ['error', { ignoreVoid: false }]);
    assert.equal(config.rules['homey-app/global-timers'][0], 'error');
    assert.equal(config.rules['homey-app/homey-log'][0], 'error');
    assert.equal(config.rules['@typescript-eslint/no-misused-promises'][0], 'error');
  });

  test('tests stay under the rule: only the node:test registration calls are exempt from no-floating-promises', async () => {
    const config = await eslint.calculateConfigForFile(path.join(ROOT, 'test', 'unit', 'probe.test.js'));
    const [severity, options] = config.rules['@typescript-eslint/no-floating-promises'];

    assert.equal(severity, 'error');
    assert.equal(options.ignoreVoid, false);
    assert.deepEqual(options.allowForKnownSafeCalls, [{
      from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'suite'],
    }]);
  });
});

describe('NFR-10 AC1: lint configuration', () => {
  test('.eslintrc.json extends athom/homey-app and the lint script fails on warnings', () => {
    const config = readJson('.eslintrc.json');

    assert.equal(config.extends, 'athom/homey-app');
    assert.equal(config.parserOptions.project, './tsconfig.eslint.json');
    assert.match(readJson('package.json').scripts.lint, /--max-warnings 0/);
  });

  test('no JavaScript file is ignored by lint: app.js, the driver, lib, the scripts and the test doubles are all checked', async () => {
    const files = ['app.js'];
    for (const tree of ['drivers', 'lib', 'test', 'scripts']) {
      if (!fs.existsSync(path.join(ROOT, tree))) continue;
      for (const entry of fs.readdirSync(path.join(ROOT, tree), { recursive: true })) {
        if (/\.c?js$/.test(entry)) files.push(path.join(tree, entry).split(path.sep).join('/'));
      }
    }

    const ignored = [];
    for (const file of files) {
      if (await eslint.isPathIgnored(path.join(ROOT, file))) ignored.push(file);
    }

    assert.ok(files.includes('test/helpers/fake-homey/app.js'), 'the fake Homey App double must be among the inspected files');
    assert.deepEqual(ignored, []);
  });

  test('the type-aware project covers every linted tree and is named so that the CLI keeps the app in JavaScript mode', () => {
    const project = readJson('tsconfig.eslint.json');

    assert.deepEqual(project.include, ['app.js', 'drivers/**/*.js', 'lib/**/*.js', 'test/**/*.js', 'test/**/*.cjs', 'scripts/**/*.js']);
    assert.deepEqual(project.compilerOptions.types, ['node', 'homey']);
    assert.equal(fs.existsSync(path.join(ROOT, 'tsconfig.json')), false);
    assert.equal(Object.hasOwn(readJson('package.json').devDependencies, 'typescript'), false);
  });
});
