// Syncs team-league seasons (leagues/config.js) from Liquipedia into the
// league_* tables, then drives every match's betting market (open / close /
// settle / void - see leagues/markets.js).
//
// Requests per season: the season page + each existing stage subpage, all
// through fetchPageHtml's process-wide 30s gate (Liquipedia API terms). A
// season that ended more than a few days ago is re-checked only once a day.
//
// Safety rules for money:
//  - a match is keyed by (stage page, list #, match #) on Liquipedia. If that
//    slot later shows different teams, its market is voided (refund) rather
//    than graded against the new pairing;
//  - if a stage page fails to load, its matches are left exactly as they
//    were (still shown, markets untouched) - a fetch error never voids anything;
//  - a match that disappears from a page that DID load has its open market voided.
const db = require('../db/db');
const { fetchPageHtml, USER_AGENT } = require('../scripts/fetch-liquipedia-bracket');
const { LEAGUE_SEASONS } = require('./config');
const { findSubpages, parseTeams, parseMatches } = require('./parse');
const markets = require('./markets');

const STAGE_ORDER = ['Regular_Season', 'Group_Stage', 'Playoffs', 'Bracket', 'Finals'];
const stageRank = (sub) => { const i = STAGE_ORDER.indexOf(sub); return i < 0 ? STAGE_ORDER.length : i; };
const prettyStage = (sub) => (sub ? sub.replace(/_/g, ' ') : 'Main');
const FINISHED_RESYNC_MS = 24 * 60 * 60 * 1000;
const FINISHED_AFTER_DAYS = 3;
const IMAGE_GAP_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchLiquipediaImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { contentType: res.headers.get('content-type'), data: Buffer.from(await res.arrayBuffer()) };
}

// Picks lock at the match's real start when Liquipedia has one, else at
// 00:00 on match day in the league's offset (see config.js).
function lockAtFor(match, tzOffsetHours) {
  if (match.startTs) return new Date(match.startTs * 1000).toISOString();
  if (!match.date) return null;
  const [y, m, d] = match.date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - tzOffsetHours * 3600 * 1000).toISOString();
}

async function upsertSeason(cfg) {
  await db.runAsync(
    `INSERT INTO league_seasons (slug, name, short_name, region, game_name, liquipedia_page)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, region=excluded.region,
       game_name=excluded.game_name, liquipedia_page=excluded.liquipedia_page`,
    [cfg.slug, cfg.name, cfg.shortName, cfg.region, cfg.gameName, cfg.page]);
  return db.getAsync('SELECT * FROM league_seasons WHERE slug = ?', [cfg.slug]);
}

async function upsertTeam(seasonId, t) {
  await db.runAsync(
    `INSERT INTO league_teams (season_id, lp_key, name, short_name, division, logo_source_url, roster_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(season_id, lp_key) DO UPDATE SET
       name = excluded.name,
       short_name = COALESCE(excluded.short_name, league_teams.short_name),
       division = COALESCE(excluded.division, league_teams.division),
       logo_source_url = COALESCE(excluded.logo_source_url, league_teams.logo_source_url),
       roster_json = COALESCE(excluded.roster_json, league_teams.roster_json)`,
    [seasonId, t.key, t.name, t.shortName || null, t.division || null, t.logoUrl || null,
      t.players ? JSON.stringify({ players: t.players, staff: t.staff || [] }) : null]);
  return (await db.getAsync('SELECT id FROM league_teams WHERE season_id = ? AND lp_key = ?', [seasonId, t.key])).id;
}

async function syncTeamLogos(seasonId, fetchImage, imageGapMs) {
  const teams = await db.allAsync(
    `SELECT t.id, t.logo_source_url FROM league_teams t LEFT JOIN league_team_logos l ON l.team_id = t.id
     WHERE t.season_id = ? AND t.logo_source_url IS NOT NULL AND (l.team_id IS NULL OR l.source_url != t.logo_source_url)`, [seasonId]);
  for (const t of teams) {
    try {
      const img = await fetchImage(t.logo_source_url);
      if (!/^image\//.test(img.contentType || '')) throw new Error(`not an image (${img.contentType})`);
      await db.runAsync(
        `INSERT INTO league_team_logos (team_id, source_url, content_type, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(team_id) DO UPDATE SET source_url=excluded.source_url, content_type=excluded.content_type, data=excluded.data`,
        [t.id, t.logo_source_url, img.contentType, img.data]);
    } catch (e) {
      console.error(`[leagues] logo for team ${t.id} failed: ${e.message}`);
    } finally {
      await sleep(imageGapMs);
    }
  }
}

// ---- player photos --------------------------------------------------------
// Each rostered player's photo, stored in league_player_photos (keyed by their
// Liquipedia page, so every league/season shares it) and served locally - the
// page never hotlinks anyone.
//
// Sources, in order:
//  1. the Liquipedia infobox photo (two batched wiki API queries per season:
//     wikitext -> "|image=" file, then imageinfo -> a 160px thumbnail), spaced
//     to Liquipedia's 1-request-per-2s limit for non-parse API calls;
//  2. the player's start.gg profile picture, via the "|startgg=" id on the same
//     infobox (one batched start.gg query), shrunk to a 160px square.
//
// KEEP WHAT WE FIND: once a player has a photo it is never re-fetched,
// replaced or deleted by the sync - only players still without one are
// re-checked, weekly.
const LP_API = 'https://liquipedia.net/fighters/api.php';
const API_GAP_MS = 2000;
const PHOTO_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const PHOTO_WIDTH = 160;
const PHOTO_MAX_BYTES = 512 * 1024;
const RAW_MAX_BYTES = 15 * 1024 * 1024; // start.gg originals can be several MB before shrinking
const API_BATCH = 50;

// start.gg profile pictures for many user ids in one request (aliased fields).
// ids are validated hex (infoboxStartgg), so inlining them is safe.
async function startggProfileImages(ids) {
  const { startgg } = require('../startggClient');
  const fields = ids.map((id, i) => `u${i}: user(slug: "user/${id}") { images { url type } }`).join('\n');
  const data = await startgg(`query { ${fields} }`);
  const out = new Map();
  ids.forEach((id, i) => {
    const img = (data?.[`u${i}`]?.images || []).find((x) => x.type === 'profile');
    if (img?.url) out.set(id, img.url);
  });
  return out;
}

// Center-crop to a PHOTO_WIDTH square JPEG on the app's dark card colour
// (so transparent PNG avatars don't turn black).
async function shrinkToSquare(buf) {
  const Jimp = require('jimp');
  const img = await Jimp.read(buf);
  img.cover(PHOTO_WIDTH, PHOTO_WIDTH);
  const out = new Jimp(PHOTO_WIDTH, PHOTO_WIDTH, 0x151821ff).composite(img, 0, 0).quality(85);
  return { contentType: 'image/jpeg', data: await out.getBufferAsync(Jimp.MIME_JPEG) };
}

async function liquipediaQuery(params) {
  const url = `${LP_API}?${new URLSearchParams({ action: 'query', format: 'json', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// MediaWiki title form: underscores are spaces, first letter upper-case.
const wikiTitle = (s) => { const t = String(s).replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

// One "|key=value" line of a player infobox (HTML comments stripped).
function infoboxField(wikitext, key) {
  const m = new RegExp(`^\\s*\\|\\s*${key}\\s*=\\s*([^|\\n}]*?)\\s*$`, 'm').exec(wikitext || '');
  return m ? m[1].replace(/<!--.*?-->/g, '').trim() || null : null;
}

// "|image=AngryBird EWC 2025.jpg" from a player page's infobox.
function infoboxImage(wikitext) {
  const file = infoboxField(wikitext, 'image')?.replace(/^(file|image):/i, '').trim();
  return file ? wikiTitle(file) : null;
}

// "|startgg=c921a066" - the player's start.gg user id.
function infoboxStartgg(wikitext) {
  const id = infoboxField(wikitext, 'startgg');
  return id && /^[0-9a-f]{6,16}$/i.test(id) ? id.toLowerCase() : null;
}

// Follows MediaWiki's normalized + redirects chains back to what we asked for.
function resolveTitles(query, requested) {
  const step = new Map([...(query?.normalized || []), ...(query?.redirects || [])].map((r) => [r.from, r.to]));
  const out = new Map();
  for (const t of requested) {
    let cur = t;
    for (let i = 0; i < 5 && step.has(cur); i++) cur = step.get(cur);
    out.set(t, cur);
  }
  return out;
}

async function syncPlayerPhotos(seasonId, {
  query = liquipediaQuery, startggImages = startggProfileImages, shrink = shrinkToSquare,
  fetchImage = fetchLiquipediaImage, apiGapMs = API_GAP_MS, imageGapMs = IMAGE_GAP_MS, now = Date.now(),
} = {}) {
  const teams = await db.allAsync('SELECT roster_json FROM league_teams WHERE season_id = ? AND roster_json IS NOT NULL', [seasonId]);
  const pages = new Set();
  for (const t of teams) for (const p of JSON.parse(t.roster_json).players || []) if (p.page) pages.add(p.page);
  const known = new Map((await db.allAsync('SELECT page, data IS NOT NULL AS has_data, checked_at FROM league_player_photos'))
    .map((r) => [r.page, r]));
  // Players we already have a photo for are done for good.
  const due = [...pages].filter((p) => {
    const r = known.get(p);
    return !r || (!r.has_data && (!r.checked_at || now - Date.parse(r.checked_at) >= PHOTO_RECHECK_MS));
  });
  const stats = { checked: 0, downloaded: 0, fromStartgg: 0, none: 0, failed: 0 };
  const checkedAt = new Date(now).toISOString();

  for (let i = 0; i < due.length; i += API_BATCH) {
    const batch = due.slice(i, i + API_BATCH);
    const source = new Map(); // page -> { url, file, startgg }
    try {
      const q1 = await query({ prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: batch.join('|') });
      const titleOf = resolveTitles(q1.query, batch);
      const textOf = new Map(Object.values(q1.query?.pages || {}).map((p) => [p.title, p.revisions?.[0]?.slots?.main?.['*'] || '']));
      const fileOf = new Map(batch.map((p) => [p, infoboxImage(textOf.get(titleOf.get(p)))]));
      const sggOf = new Map(batch.map((p) => [p, infoboxStartgg(textOf.get(titleOf.get(p)))]));
      const files = [...new Set([...fileOf.values()].filter(Boolean))];
      if (files.length) {
        await sleep(apiGapMs);
        const fileTitles = files.map((f) => `File:${f}`);
        const q2 = await query({ prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: String(PHOTO_WIDTH), titles: fileTitles.join('|') });
        const ftitleOf = resolveTitles(q2.query, fileTitles);
        const infoOf = new Map(Object.values(q2.query?.pages || {}).map((p) => [p.title, p.imageinfo?.[0]]));
        for (const page of batch) {
          const f = fileOf.get(page);
          const info = f && infoOf.get(ftitleOf.get(`File:${f}`));
          if (info && /^image\//.test(info.mime || '')) source.set(page, { url: info.thumburl || info.url, file: f });
        }
      }
      await sleep(apiGapMs);
      // Fallback: the start.gg profile picture for whoever the wiki has no photo of.
      const sggPages = batch.filter((p) => !source.has(p) && sggOf.get(p));
      if (sggPages.length) {
        try {
          const urlOf = await startggImages([...new Set(sggPages.map((p) => sggOf.get(p)))]);
          for (const page of sggPages) {
            const url = urlOf.get(sggOf.get(page));
            if (url) source.set(page, { url, file: `startgg:${sggOf.get(page)}`, startgg: true });
          }
        } catch (e) {
          console.error(`[leagues] start.gg photo lookup failed: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`[leagues] player photo lookup failed: ${e.message}`);
      stats.failed += batch.length;
      continue;
    }

    for (const page of batch) {
      const src = source.get(page);
      stats.checked++;
      if (!src) {
        // Nothing anywhere (yet): note the check so we only look again next week.
        // Only touches rows WITHOUT a photo - a kept photo is never cleared.
        await db.runAsync(
          `INSERT INTO league_player_photos (page, checked_at) VALUES (?, ?)
           ON CONFLICT(page) DO UPDATE SET checked_at = excluded.checked_at WHERE league_player_photos.data IS NULL`,
          [page, checkedAt]);
        stats.none++;
        continue;
      }
      try {
        let img = await fetchImage(src.url);
        if (!/^image\//.test(img.contentType || '')) throw new Error(`not an image (${img.contentType})`);
        if (img.data.length > RAW_MAX_BYTES) throw new Error(`too large (${img.data.length} bytes)`);
        if (src.startgg || img.data.length > PHOTO_MAX_BYTES) img = await shrink(img.data);
        if (img.data.length > PHOTO_MAX_BYTES) throw new Error(`too large after shrinking (${img.data.length} bytes)`);
        await db.runAsync(
          `INSERT INTO league_player_photos (page, file, source_url, content_type, data, checked_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(page) DO UPDATE SET file=excluded.file, source_url=excluded.source_url, content_type=excluded.content_type,
             data=excluded.data, checked_at=excluded.checked_at WHERE league_player_photos.data IS NULL`,
          [page, src.file, src.url, img.contentType, img.data, checkedAt]);
        stats.downloaded++;
        if (src.startgg) stats.fromStartgg++;
      } catch (e) {
        // Left unchecked so the next run retries it.
        console.error(`[leagues] photo for ${page} failed: ${e.message}`);
        stats.failed++;
      } finally {
        await sleep(imageGapMs);
      }
    }
  }
  return stats;
}

// ---- season logo ----------------------------------------------------------
// The league's own logo from the season page's infobox ("|imagedark=" first -
// the app is dark - then "|image="), as a 240px thumbnail stored in
// league_season_logos and served locally. Two small API queries; re-checked
// weekly, and only re-downloaded when the infobox names a different file.
const SEASON_LOGO_WIDTH = 240;
async function syncSeasonLogo(seasonId, page, { query = liquipediaQuery, fetchImage = fetchLiquipediaImage, apiGapMs = API_GAP_MS, now = Date.now() } = {}) {
  const cur = await db.getAsync('SELECT file, data IS NOT NULL AS has_data, checked_at FROM league_season_logos WHERE season_id = ?', [seasonId]);
  if (cur?.checked_at && now - Date.parse(cur.checked_at) < PHOTO_RECHECK_MS) return null;
  const checkedAt = new Date(now).toISOString();
  const q1 = await query({ prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: wikiTitle(page) });
  const text = Object.values(q1.query?.pages || {})[0]?.revisions?.[0]?.slots?.main?.['*'] || '';
  const raw = infoboxField(text, 'imagedark') || infoboxField(text, 'image');
  const file = raw ? wikiTitle(raw.replace(/^(file|image):/i, '').trim()) : null;
  const note = () => db.runAsync(
    `INSERT INTO league_season_logos (season_id, checked_at) VALUES (?, ?)
     ON CONFLICT(season_id) DO UPDATE SET checked_at = excluded.checked_at`, [seasonId, checkedAt]);
  if (!file || (cur?.has_data && cur.file === file)) { await note(); return file ? 'kept' : 'none'; }
  await sleep(apiGapMs);
  const q2 = await query({ prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: String(SEASON_LOGO_WIDTH), titles: `File:${file}` });
  const info = Object.values(q2.query?.pages || {})[0]?.imageinfo?.[0];
  if (!info || !/^image\//.test(info.mime || '')) { await note(); return 'none'; }
  const img = await fetchImage(info.thumburl || info.url);
  if (!/^image\//.test(img.contentType || '')) throw new Error(`not an image (${img.contentType})`);
  if (img.data.length > PHOTO_MAX_BYTES) throw new Error(`too large (${img.data.length} bytes)`);
  await db.runAsync(
    `INSERT INTO league_season_logos (season_id, file, content_type, data, checked_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(season_id) DO UPDATE SET file=excluded.file, content_type=excluded.content_type, data=excluded.data, checked_at=excluded.checked_at`,
    [seasonId, file, img.contentType, img.data, checkedAt]);
  return 'downloaded';
}

/**
 * Sync one season. Returns a summary for logging. `now` (ms) is injectable for tests.
 */
async function syncSeason(cfg, opts = {}) {
  const { fetchPage = fetchPageHtml, fetchImage = fetchLiquipediaImage, imageGapMs = IMAGE_GAP_MS, now = Date.now() } = opts;
  const season = await upsertSeason(cfg);
  // "Seen in this run" is last_seen_at === stamp, so the stamp must be unique
  // per run even if the clock repeats or steps back.
  const prevSync = season.synced_at ? Date.parse(season.synced_at) : 0;
  const stamp = new Date(Math.max(now, prevSync + 1)).toISOString();
  const mainHtml = await fetchPage(cfg.page); // failure here aborts the season untouched
  const cards = parseTeams(mainHtml);
  const subs = findSubpages(mainHtml, cfg.page).sort((a, b) => stageRank(a) - stageRank(b));

  // [{ sub, matches | null (failed) }]
  const stages = [];
  if (!subs.length) stages.push({ sub: null, matches: parseMatches(mainHtml, { stage: 'Main' }) });
  for (const sub of subs) {
    try {
      stages.push({ sub, matches: parseMatches(await fetchPage(`${cfg.page}/${sub}`), { stage: prettyStage(sub) }) });
    } catch (e) {
      console.error(`[leagues] ${cfg.page}/${sub} failed: ${e.message}`);
      stages.push({ sub, matches: null });
    }
  }

  // Teams: cards carry rosters; matches carry short names, divisions and
  // logos for teams that have no card (e.g. a qualifier added late).
  const teams = new Map(cards.map((c) => [c.key, { ...c }]));
  for (const { matches } of stages) {
    for (const m of matches || []) {
      for (const t of [m.team1, m.team2]) {
        if (!t.key) continue;
        const cur = teams.get(t.key) || { key: t.key, name: t.name };
        cur.shortName = cur.shortName || t.shortName;
        cur.logoUrl = cur.logoUrl || t.logoUrl;
        if (m.division && /regular|group/i.test(m.stage || '')) cur.division = cur.division || m.division;
        teams.set(t.key, cur);
      }
    }
  }
  const teamId = new Map();
  for (const t of teams.values()) teamId.set(t.key, await upsertTeam(season.id, t));

  // Matches
  let sortBase = 0;
  const dates = [];
  for (const { sub, matches } of stages) {
    const prefix = `${cfg.page}/${sub || ''}#`;
    if (matches === null) {
      // Keep this stage visible exactly as last synced.
      await db.runAsync(`UPDATE league_matches SET last_seen_at = ? WHERE season_id = ? AND match_key LIKE ?`,
        [stamp, season.id, `${prefix}%`]);
      const prev = await db.getAsync(`SELECT MAX(sort_order) AS mx FROM league_matches WHERE season_id = ? AND match_key LIKE ?`, [season.id, `${prefix}%`]);
      sortBase = Math.max(sortBase, (prev?.mx ?? sortBase) + 1);
      continue;
    }
    for (const [i, m] of matches.entries()) {
      if (m.date) dates.push(m.date);
      const t1 = m.team1.key ? teamId.get(m.team1.key) : null;
      const t2 = m.team2.key ? teamId.get(m.team2.key) : null;
      const winner = m.winner === 1 ? t1 : m.winner === 2 ? t2 : null;
      await db.runAsync(
        `INSERT INTO league_matches (season_id, match_key, stage, round_label, division, sort_order, match_date, lock_at,
            best_of, team1_id, team2_id, team1_score, team2_score, winner_team_id, finished, sets_json, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(match_key) DO UPDATE SET stage=excluded.stage, round_label=excluded.round_label, division=excluded.division,
           sort_order=excluded.sort_order, match_date=excluded.match_date, lock_at=excluded.lock_at, best_of=excluded.best_of,
           team1_id=excluded.team1_id, team2_id=excluded.team2_id, team1_score=excluded.team1_score, team2_score=excluded.team2_score,
           winner_team_id=excluded.winner_team_id, finished=excluded.finished, sets_json=excluded.sets_json, last_seen_at=excluded.last_seen_at`,
        [season.id, `${prefix}${m.listIdx}.${m.matchIdx}`, m.stage, m.roundLabel, m.division, sortBase + i, m.date,
          lockAtFor(m, cfg.tzOffsetHours), m.bestOf, t1, t2, m.score1, m.score2, winner, m.finished ? 1 : 0,
          m.sets.length ? JSON.stringify(m.sets) : null, stamp]);
    }
    sortBase += matches.length;
  }
  dates.sort();
  await db.runAsync('UPDATE league_seasons SET start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), synced_at = ? WHERE id = ?',
    [dates[0] || null, dates[dates.length - 1] || null, stamp, season.id]);

  // Markets. Pricing uses each team's season points so far.
  const rows = await db.allAsync('SELECT * FROM league_matches WHERE season_id = ? ORDER BY sort_order', [season.id]);
  const stats = {};
  for (const m of rows) {
    if (!m.finished || m.team1_score == null || m.last_seen_at !== stamp) continue;
    for (const [id, f, a] of [[m.team1_id, m.team1_score, m.team2_score], [m.team2_id, m.team2_score, m.team1_score]]) {
      if (!id) continue;
      stats[id] = stats[id] || { pf: 0, pa: 0 };
      stats[id].pf += f; stats[id].pa += a;
    }
  }
  const actions = {};
  for (const m of rows) {
    let act;
    if (m.last_seen_at !== stamp) {
      // Gone from a page that loaded fine: refund anything still riding on it.
      const mk = await db.getAsync(`SELECT id FROM league_markets WHERE match_id = ? AND state IN ('open','closed')`, [m.id]);
      if (mk) { await markets.voidMarket(mk.id); act = 'voided'; }
    } else {
      act = await markets.reconcileMatchMarket(m, stats, now);
    }
    if (act) actions[act] = (actions[act] || 0) + 1;
  }

  await syncTeamLogos(season.id, fetchImage, imageGapMs);
  try {
    await syncSeasonLogo(season.id, cfg.page, { query: opts.query, fetchImage, apiGapMs: opts.apiGapMs, now });
  } catch (e) {
    console.error(`[leagues] season logo for ${cfg.slug} failed: ${e.message}`);
  }
  let photos = null;
  try {
    photos = await syncPlayerPhotos(season.id, { query: opts.query, fetchImage, apiGapMs: opts.apiGapMs, imageGapMs, now });
  } catch (e) {
    console.error(`[leagues] player photos for ${cfg.slug} failed: ${e.message}`);
  }
  return { slug: cfg.slug, teams: teams.size, matches: rows.filter((r) => r.last_seen_at === stamp).length, markets: actions, photos };
}

async function syncAllLeagues(opts = {}) {
  const now = opts.now ?? Date.now();
  const doneBefore = new Date(now - FINISHED_AFTER_DAYS * 86400000).toISOString().slice(0, 10);
  const results = [];
  // activeOnly: the quick match-day pass - just the seasons with a match live
  // or on today, so live scores and results land within minutes, not hours.
  const active = opts.activeOnly ? new Set(await markets.activeSeasonSlugs(now)) : null;
  for (const cfg of opts.seasons || LEAGUE_SEASONS) {
    if (active && !active.has(cfg.slug)) continue;
    const s = await db.getAsync('SELECT end_date, synced_at FROM league_seasons WHERE slug = ?', [cfg.slug]);
    const open = s && await db.getAsync(
      `SELECT 1 FROM league_markets lm JOIN league_matches m ON m.id = lm.match_id JOIN league_seasons ls ON ls.id = m.season_id
       WHERE ls.slug = ? AND lm.state IN ('open','closed') LIMIT 1`, [cfg.slug]);
    const finished = s && s.end_date && s.end_date < doneBefore && !open;
    if (finished && s.synced_at && now - Date.parse(s.synced_at) < FINISHED_RESYNC_MS) continue;
    try {
      const r = await syncSeason(cfg, { ...opts, now });
      console.log(`[leagues] ${r.slug}: ${r.teams} teams, ${r.matches} matches, markets ${JSON.stringify(r.markets)}`);
      results.push(r);
    } catch (e) {
      console.error(`[leagues] ${cfg.slug} sync failed: ${e.message}`);
    }
  }
  return results;
}

module.exports = { syncSeason, syncAllLeagues, lockAtFor, syncPlayerPhotos, syncSeasonLogo, infoboxImage, infoboxStartgg, shrinkToSquare };

if (require.main === module) {
  syncAllLeagues().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
