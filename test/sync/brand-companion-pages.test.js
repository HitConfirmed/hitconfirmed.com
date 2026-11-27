const { test } = require('node:test');
const assert = require('node:assert');

// Real case (2026-11-27 tournament reality check): start.gg's "Evo" search
// returned "Evo Singapore 2027 Side Tourneys by Rocket Punch (pending
// approval)" — a 0-entrant third-party SoulCalibur VI page. It passed the
// /^evo\b/ brand regex, and findBrandTournaments only skipped "Community
// Tournaments" pages, so the official Tournaments page listed it as a major
// of its own beside the real Evo Singapore 2027.
const { findBrandTournaments } = require('../../scripts/sync-upcoming');

test('brand search skips side-tourney / pending-approval companion pages but keeps the main event', async () => {
  const fake = async (_query, { name }) => ({
    tournaments: {
      nodes: name === 'Evo' ? [
        { slug: 'tournament/evo-singapore-2027', name: 'Evo Singapore 2027' },
        { slug: 'tournament/evo-singapore-2027-side-tourneys-by-rocket-punch-pending-approval', name: 'Evo Singapore 2027 Side Tourneys by Rocket Punch (pending approval)' },
        { slug: 'tournament/evo-2026-community-tournaments', name: 'Evo 2026 Community Tournaments' },
        { slug: 'tournament/evo-france-2026-side-events', name: 'EVO France 2026 Side Events' },
      ] : [],
    },
  });
  const seen = await findBrandTournaments('q', 0, 1, [1], fake);
  assert.deepStrictEqual([...seen.keys()], ['tournament/evo-singapore-2027']);
});
