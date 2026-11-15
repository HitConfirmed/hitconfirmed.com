const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Player photos: roster page -> infobox "|image=" -> thumbnail -> stored blob,
// re-checked weekly, never re-downloaded when unchanged, and a failed lookup
// never wipes a photo we already have.
let db, sync, mk, file;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const DAY = 86400000;

before(() => {
  file = path.join(os.tmpdir(), `mm-photos-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DATABASE_PATH = file;
  for (const m of ['../../db/db', '../../leagues/markets', '../../leagues/sync']) delete require.cache[require.resolve(m)];
  db = require('../../db/db');
  sync = require('../../leagues/sync');
  mk = require('../../leagues/markets');
});

beforeEach(async () => {
  for (const t of ['league_player_photos', 'league_teams', 'league_seasons']) await db.runAsync(`DELETE FROM ${t}`);
  await db.runAsync(`INSERT INTO league_seasons (id, slug, name, liquipedia_page) VALUES (1, 's', 'S', 'P')`);
  const roster = { players: [
    { name: 'AngryBird', page: 'AngryBird' },
    { name: 'Big Bird', page: 'Big_Bird' }, // underscore form -> normalized by the wiki
    { name: 'Phenom', page: 'Phenom' }, // page without a photo
    { name: 'Rookie', page: null }, // red link: never looked up
  ], staff: [] };
  await db.runAsync(`INSERT INTO league_teams (season_id, lp_key, name, roster_json) VALUES (1, 'RD', 'Red Dunes', ?)`, [JSON.stringify(roster)]);
});

after(() => { try { fs.unlinkSync(file); } catch { /* ignore */ } });

const wikitext = {
  AngryBird: '{{Infobox player\n|id=AngryBird\n|image=AngryBird EWC 2025.jpg\n|country=Jordan\n}}',
  'Big Bird': '{{Infobox player\n|id=Big Bird\n|image=File:Big_Bird_EVO_2024.png\n}}',
  Phenom: '{{Infobox player\n|id=Phenom\n|image=\n}}',
};
function fakeApi(calls) {
  return async (params) => {
    calls.push(params);
    const titles = params.titles.split('|');
    if (params.prop === 'revisions') {
      const normalized = titles.filter((t) => t.includes('_')).map((t) => ({ from: t, to: t.replace(/_/g, ' ') }));
      const pages = Object.fromEntries(titles.map((t, i) => {
        const title = t.replace(/_/g, ' ');
        return [i + 1, { title, revisions: [{ slots: { main: { '*': wikitext[title] || '' } } }] }];
      }));
      return { query: { normalized, pages } };
    }
    const pages = Object.fromEntries(titles.map((t, i) => [-(i + 1), { title: t,
      imageinfo: [{ mime: 'image/jpeg', thumburl: `https://img.test/160px-${encodeURIComponent(t)}` }] }]));
    return { query: { pages } };
  };
}
const fetchImage = (log) => async (url) => { log.push(url); return { contentType: 'image/jpeg', data: Buffer.from(`jpg:${url}`) }; };
const run = (opts) => sync.syncPlayerPhotos(1, { apiGapMs: 0, imageGapMs: 0, now: NOW, ...opts });

test('infoboxImage reads the image field and normalizes the file name', () => {
  assert.strictEqual(sync.infoboxImage(wikitext.AngryBird), 'AngryBird EWC 2025.jpg');
  assert.strictEqual(sync.infoboxImage(wikitext['Big Bird']), 'Big Bird EVO 2024.png');
  assert.strictEqual(sync.infoboxImage(wikitext.Phenom), null);
  assert.strictEqual(sync.infoboxImage('|imagedark=x.png'), null);
});

test('downloads photos for rostered players and exposes them on the season', async () => {
  const calls = []; const got = [];
  const stats = await run({ query: fakeApi(calls), fetchImage: fetchImage(got) });
  assert.deepStrictEqual(stats, { checked: 3, downloaded: 2, fromStartgg: 0, none: 1, failed: 0 });
  assert.strictEqual(calls.length, 2); // one wikitext batch + one imageinfo batch
  assert.ok(!calls[0].titles.includes('Rookie'));
  assert.strictEqual(got.length, 2);

  const season = await mk.getSeason('s');
  const byName = Object.fromEntries(season.teams[0].players.map((p) => [p.name, p.photoUrl]));
  assert.match(byName.AngryBird, /^\/api\/leagues\/player-photo\/\d+$/);
  assert.match(byName['Big Bird'], /^\/api\/leagues\/player-photo\/\d+$/);
  assert.strictEqual(byName.Phenom, null);
  assert.strictEqual(byName.Rookie, null);
});

test('players with a photo are never looked up again; players without one are re-checked weekly', async () => {
  await run({ query: fakeApi([]), fetchImage: fetchImage([]) });
  const calls = []; const got = [];
  await run({ query: fakeApi(calls), fetchImage: fetchImage(got), now: NOW + 3 * DAY });
  assert.strictEqual(calls.length, 0);
  await run({ query: fakeApi(calls), fetchImage: fetchImage(got), now: NOW + 8 * DAY });
  assert.deepStrictEqual(calls.map((c) => c.titles), ['Phenom']); // only the one still missing
  assert.strictEqual(got.length, 0);
});

test('a kept photo survives the wiki dropping it', async () => {
  await run({ query: fakeApi([]), fetchImage: fetchImage([]) });
  // Simulate a forced re-check where Liquipedia no longer has any photo.
  await db.runAsync(`UPDATE league_player_photos SET checked_at = NULL`);
  await db.runAsync(`INSERT INTO league_player_photos (page, checked_at) VALUES ('x', NULL) ON CONFLICT DO NOTHING`);
  const empty = async () => ({ query: { pages: {} } });
  await sync.syncPlayerPhotos(1, { query: empty, startggImages: async () => new Map(), apiGapMs: 0, imageGapMs: 0, now: NOW + 30 * DAY });
  const n = await db.getAsync('SELECT COUNT(*) c FROM league_player_photos WHERE data IS NOT NULL');
  assert.strictEqual(n.c, 2);
});

test('falls back to the start.gg profile picture, shrunk', async () => {
  wikitext.Phenom = '{{Infobox player\n|id=Phenom\n|image=\n|startgg=C921A066\n}}';
  try {
    const asked = []; const got = [];
    const stats = await run({
      query: fakeApi([]), fetchImage: fetchImage(got),
      startggImages: async (ids) => { asked.push(...ids); return new Map([['c921a066', 'https://images.start.gg/u.png']]); },
      shrink: async () => ({ contentType: 'image/jpeg', data: Buffer.from('small') }),
    });
    assert.deepStrictEqual(asked, ['c921a066']); // only for the player the wiki had no photo of
    assert.strictEqual(stats.fromStartgg, 1);
    assert.strictEqual(stats.none, 0);
    const row = await db.getAsync(`SELECT file, source_url, content_type, data FROM league_player_photos WHERE page = 'Phenom'`);
    assert.strictEqual(row.file, 'startgg:c921a066');
    assert.strictEqual(row.data.toString(), 'small');
  } finally {
    wikitext.Phenom = '{{Infobox player\n|id=Phenom\n|image=\n}}';
  }
});

test('an API failure keeps existing photos and retries next run', async () => {
  await run({ query: fakeApi([]), fetchImage: fetchImage([]) });
  const failing = async () => { throw new Error('HTTP 429'); };
  const stats = await run({ query: failing, fetchImage: fetchImage([]), now: NOW + 8 * DAY });
  assert.strictEqual(stats.failed, 1); // only Phenom was due
  const n = await db.getAsync('SELECT COUNT(*) c FROM league_player_photos WHERE data IS NOT NULL');
  assert.strictEqual(n.c, 2);
});

test('a non-image download is rejected and not stored', async () => {
  const stats = await run({ query: fakeApi([]), fetchImage: async () => ({ contentType: 'text/html', data: Buffer.from('<html>') }) });
  assert.strictEqual(stats.downloaded, 0);
  assert.strictEqual(stats.failed, 2);
  const n = await db.getAsync('SELECT COUNT(*) c FROM league_player_photos WHERE data IS NOT NULL');
  assert.strictEqual(n.c, 0);
});
