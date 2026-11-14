// Remove one or more start.gg events' sets from set_markets and bracket_history
// - for cleaning up a bracket that was tracked by mistake (a doubles or side
// event merged into a game's real bracket). bracket_history has no event
// column, so set ids are fetched from start.gg per event and deleted exactly.
//
// Refuses to delete any market that has picks (set_bets) - those need a real
// void/refund decision, not a purge.
//
// Usage: node scripts/purge-event-sets.js <startggEventId> [...more] [--apply]
//   (dry run by default: prints what would be deleted)
const db = require('../db/db');
const { startgg } = require('../startggClient');

const SETS = `
query EventSets($id: ID!, $page: Int!) {
  event(id: $id) {
    id name
    sets(page: $page, perPage: 50, sortType: STANDARD) { pageInfo { totalPages } nodes { id } }
  }
}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function eventSetIds(eventId) {
  const ids = [];
  let name = null;
  for (let page = 1, total = 1; page <= total; page++) {
    const d = await startgg(SETS, { id: String(eventId), page });
    if (!d?.event) throw new Error(`event ${eventId} not found on start.gg`);
    name = d.event.name;
    total = d.event.sets?.pageInfo?.totalPages || 0;
    for (const s of d.event.sets?.nodes || []) ids.push(String(s.id));
    await sleep(900);
  }
  return { name, ids };
}

async function purge(eventIds, { apply = false } = {}) {
  const summary = [];
  for (const eventId of eventIds) {
    const { name, ids } = await eventSetIds(eventId);
    const byEvent = await db.allAsync('SELECT id, startgg_set_id FROM set_markets WHERE startgg_event_id = ?', [String(eventId)]);
    const setIds = new Set([...ids, ...byEvent.map((m) => String(m.startgg_set_id))]);
    const list = [...setIds];
    const ph = list.map(() => '?').join(',') || "''";
    const markets = list.length ? await db.allAsync(`SELECT id FROM set_markets WHERE startgg_set_id IN (${ph})`, list) : [];
    const marketIds = markets.map((m) => m.id);
    const bets = marketIds.length
      ? (await db.getAsync(`SELECT COUNT(*) c FROM set_bets WHERE market_id IN (${marketIds.map(() => '?').join(',')})`, marketIds)).c
      : 0;
    if (bets > 0) throw new Error(`event ${eventId} (${name}): ${bets} pick(s) on its markets - refusing to purge`);
    const history = list.length ? (await db.getAsync(`SELECT COUNT(*) c FROM bracket_history WHERE startgg_set_id IN (${ph})`, list)).c : 0;
    if (apply && list.length) {
      await db.runAsync('BEGIN');
      try {
        await db.runAsync(`DELETE FROM set_markets WHERE startgg_set_id IN (${ph})`, list);
        await db.runAsync(`DELETE FROM bracket_history WHERE startgg_set_id IN (${ph})`, list);
        await db.runAsync('COMMIT');
      } catch (err) { await db.runAsync('ROLLBACK'); throw err; }
    }
    summary.push({ eventId, name, startggSets: ids.length, markets: marketIds.length, history, applied: apply });
  }
  return summary;
}

module.exports = { purge };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ids = args.filter((a) => /^\d+$/.test(a));
  if (!ids.length) { console.error('usage: node scripts/purge-event-sets.js <eventId>... [--apply]'); process.exit(1); }
  purge(ids, { apply })
    .then((s) => { console.table(s); process.exit(0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
