const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// start.gg applies an events() `limit` BEFORE the videogameId filter. A small
// limit silently drops tracked games at big multi-game majors: with limit 20,
// Frosty Faustings XIX showed 7 of its 14 games on the official site (no Street
// Fighter 6, TEKKEN 8, KOF XV, Smash...). Found by the daily tournament
// reality check on 2026-11-14. Every events() query must use the shared
// EVENTS_LIMIT, never a hard-coded small number.
const { EVENTS_LIMIT } = require('../../startggClient');
const ROOT = path.join(__dirname, '..', '..');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'client' || e.name === 'test') return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

test('the shared limit is large enough for the biggest majors', () => {
  assert.ok(EVENTS_LIMIT >= 100, `EVENTS_LIMIT is ${EVENTS_LIMIT}`);
});

test('no start.gg events() query hard-codes a numeric limit', () => {
  const offenders = [];
  for (const f of jsFiles(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/events\(\s*limit:\s*(\d+)/g)) {
      offenders.push(`${path.relative(ROOT, f)}: events(limit: ${m[1]})`);
    }
  }
  assert.deepEqual(offenders, [], 'use ${EVENTS_LIMIT} from startggClient instead');
});
