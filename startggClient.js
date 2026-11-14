const axios = require('axios');

const STARTGG_URL = 'https://api.start.gg/gql/alpha';

async function startgg(query, variables = {}, tokenOverride) {
  const token = tokenOverride || process.env.STARTGG_API_TOKEN;
  if (!token) throw new Error('Missing STARTGG_API_TOKEN in environment');

  const res = await axios.post(STARTGG_URL, { query, variables }, {
    headers: { Authorization: `Bearer ${token}` },
    // Cap how long a stuck Start.gg connection can block a poller cycle. Without
    // this, axios waits indefinitely and a hung request stalls live sync.
    timeout: 10000,
  });
  if (res.data.errors) {
    throw new Error(`StartGG errors: ${JSON.stringify(res.data.errors)}`);
  }
  return res.data.data;
}

// start.gg applies an events() `limit` BEFORE the videogameId filter, not
// after it. With limit 20, Frosty Faustings XIX (many side events) returned
// only 7 of its 14 tracked games - Street Fighter 6, TEKKEN 8, KOF XV, Smash
// Ultimate and others silently vanished from the site. Found by the daily
// tournament reality check (2026-11-14). 100 covers the largest majors and
// stays under start.gg's query-complexity limit for every query using it.
const EVENTS_LIMIT = 100;

module.exports = { startgg, EVENTS_LIMIT };
