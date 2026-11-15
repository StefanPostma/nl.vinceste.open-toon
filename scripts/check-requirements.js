'use strict';

/*
 * Requirement-id coverage (NFR-06 AC2).
 *
 * Parses the MoSCoW table (section 9) of docs/sdlc/01-requirements.md and collects the ids named in test titles.
 * Every MUST/SHOULD id that mocks can verify ("M" in the Verify column) must be named by at least one test title,
 * and no test title may name an unknown id.
 *
 * Usage: node scripts/check-requirements.js [--matrix]
 *   (none)    exits 1 when an id has no test or a title names an unknown id
 *   --matrix  prints every MUST/SHOULD id with the tests that name it (a Markdown table, the input of the test
 *             report); exits 1 when a mock-verifiable id has no test
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REQUIREMENTS_FILE = path.join(ROOT, 'docs', 'sdlc', '01-requirements.md');
const TEST_DIR = path.join(ROOT, 'test');

const ID_PATTERN = /\b(?:FR|NFR)-\d+\b/g;
const TITLE_PATTERN = /\b(?:describe|test|it)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;

/**
 * @param {string} markdown content of 01-requirements.md
 * @returns {{id: string, title: string, moscow: string, verify: string}[]}
 */
function parseRequirements(markdown) {
  const start = markdown.indexOf('## 9. MoSCoW summary');
  if (start === -1) throw new Error('Section "9. MoSCoW summary" not found');
  const rest = markdown.slice(start + 1);
  const end = rest.search(/\n## /);
  const section = end === -1 ? rest : rest.slice(0, end);

  return section.split('\n')
    .map((line) => line.match(/^\|\s*((?:N?FR)-\d+)\s*\|\s*(.*?)\s*\|\s*(MUST|SHOULD|COULD|WONT)\s*\|\s*(.*?)\s*\|\s*$/))
    .filter(Boolean)
    .map(([, id, title, moscow, verify]) => ({
      id, title, moscow, verify,
    }));
}

/** MUST and SHOULD requirements that can be verified without hardware ("M" in the Verify column). */
function requiredIds(rows) {
  return rows
    .filter((row) => (row.moscow === 'MUST' || row.moscow === 'SHOULD') && row.verify.includes('M'))
    .map((row) => row.id);
}

function idsIn(title) {
  return title.match(ID_PATTERN) || [];
}

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'fixtures' ? [] : testFiles(full);
    return entry.name.endsWith('.test.js') ? [full] : [];
  });
}

/** @returns {{file: string, title: string}[]} every describe/test/it title of the *.test.js files under test/ */
function collectTitles(dir = TEST_DIR) {
  return testFiles(dir).flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return [...source.matchAll(TITLE_PATTERN)].map((match) => ({
      file: path.relative(ROOT, file),
      title: (match[1] || match[2] || match[3]).replace(/\\(['"`\\])/g, '$1'),
    }));
  });
}

/**
 * @param {{id: string}[]} rows all requirements of the table
 * @param {{title: string}[]} titles test titles
 * @returns {{required: string[], pending: string[], unknown: string[]}}
 */
function evaluate(rows, titles) {
  const known = new Set(rows.map((row) => row.id));
  const named = new Set(titles.flatMap((entry) => idsIn(entry.title)));
  const required = requiredIds(rows);
  return {
    required,
    pending: required.filter((id) => !named.has(id)),
    unknown: [...named].filter((id) => !known.has(id)).sort(),
  };
}

function sortIds(ids) {
  return [...ids].sort((a, b) => {
    const [, kindA, numA] = a.match(/^(N?FR)-(\d+)$/);
    const [, kindB, numB] = b.match(/^(N?FR)-(\d+)$/);
    return kindA === kindB ? Number(numA) - Number(numB) : kindA.localeCompare(kindB);
  });
}

/**
 * The requirement-to-test matrix: one entry per MUST and SHOULD requirement, in table order.
 * @param {{id: string, moscow: string, verify: string}[]} rows
 * @param {{file: string, title: string}[]} titles
 * @returns {{id: string, title: string, moscow: string, verify: string, tests: {file: string, title: string}[]}[]}
 */
function matrix(rows, titles) {
  return rows
    .filter((row) => row.moscow === 'MUST' || row.moscow === 'SHOULD')
    .map((row) => ({ ...row, tests: titles.filter((entry) => idsIn(entry.title).includes(row.id)) }));
}

const escapeCell = (text) => text.replace(/\|/g, '\\|');

/** @returns {string} the matrix as a Markdown table; a requirement that only hardware can verify says so */
function renderMatrix(entries) {
  const lines = ['| Id | Prio | Verify | Requirement | Tests (file: title) |', '|---|---|---|---|---|'];
  entries.forEach((entry) => {
    let tests = entry.tests.map((test) => `${test.file}: ${escapeCell(test.title)}`).join('<br>');
    if (entry.tests.length === 0) tests = entry.verify.includes('M') ? '**none**' : 'hardware only';
    lines.push(`| ${entry.id} | ${entry.moscow} | ${entry.verify} | ${escapeCell(entry.title)} | ${tests} |`);
  });
  return `${lines.join('\n')}\n`;
}

function currentState() {
  const rows = parseRequirements(fs.readFileSync(REQUIREMENTS_FILE, 'utf8'));
  const titles = collectTitles();
  return { rows, titles, ...evaluate(rows, titles) };
}

function main(argv = process.argv.slice(2)) {
  const {
    rows, titles, pending, unknown,
  } = currentState();

  if (argv.includes('--matrix')) {
    const entries = matrix(rows, titles);
    process.stdout.write(renderMatrix(entries));
    const untested = entries.filter((entry) => entry.verify.includes('M') && entry.tests.length === 0).map((entry) => entry.id);
    if (untested.length > 0) {
      process.stderr.write(`no test names: ${untested.join(', ')}\n`);
      process.exitCode = 1;
    }
    return;
  }

  const problems = [];
  if (unknown.length > 0) problems.push(`test titles name unknown requirement ids: ${unknown.join(', ')}`);
  if (pending.length > 0) problems.push(`no test title names: ${sortIds(pending).join(', ')}`);
  if (problems.length > 0) {
    process.stderr.write(`${problems.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Requirement coverage consistent: every mock-verifiable MUST/SHOULD id has a test.\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  parseRequirements, requiredIds, idsIn, collectTitles, evaluate, sortIds, currentState, matrix, renderMatrix, main,
};
