'use strict';

/*
 * Where the repository is and how a test reads it, once instead of a copy in every test file. Paths are relative to
 * the repository root and use '/', on every platform.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const posix = (file) => file.split(path.sep).join('/');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

/** Every file below `dir` as a path relative to the root; nothing for a directory that does not exist. */
function walk(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = posix(path.join(dir, entry.name));
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}

module.exports = {
  ROOT, posix, exists, read, readJson, walk,
};
