const { test } = require('node:test');
const assert = require('node:assert');
const { shouldDeferUpstreamSync, MAX_DEFER_MS } = require('../../scripts/upstream-sync-deferral');

const NOW = Date.parse('2026-11-13T18:00:00Z');
const HOUR = 60 * 60 * 1000;

test('runs when nothing is live', () => {
  assert.equal(shouldDeferUpstreamSync({ live: false, lastRunMs: NOW - HOUR, now: NOW }), false);
});

test('defers for a live tournament when the last run was recent', () => {
  assert.equal(shouldDeferUpstreamSync({ live: true, lastRunMs: NOW - 25 * HOUR, now: NOW }), true);
});

test('stops deferring once the cap has passed (real case: stuck Saltmine event blocked it Oct 30 - Nov 13)', () => {
  const lastRun = Date.parse('2026-10-30T02:42:32Z');
  assert.equal(shouldDeferUpstreamSync({ live: true, lastRunMs: lastRun, now: NOW }), false);
  assert.equal(shouldDeferUpstreamSync({ live: true, lastRunMs: NOW - MAX_DEFER_MS - 1, now: NOW }), false);
});

test('never-run sync is not starved by a live tournament', () => {
  assert.equal(shouldDeferUpstreamSync({ live: true, lastRunMs: null, now: NOW }), false);
});
