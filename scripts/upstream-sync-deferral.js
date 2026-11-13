// Decides whether the daily upstream sync (upcoming majors + recent results)
// should defer because a tournament is live.
//
// Deferring keeps start.gg's rate-limit budget free for the 60s live poller,
// but it can't be allowed to go on forever. Real case: a Grand Final Reset
// that was never reported kept Saltmine League Europe West Finals "live"
// from Oct 31 to Nov 13. In that time the sync deferred every hour, never
// ran, and Upcoming Tournaments shrank to 10 because nothing new was added.
// After MAX_DEFER_MS without a completed run, the sync runs even if a
// tournament is live: a refresh that is somewhat late beats one that never
// happens.
const MAX_DEFER_MS = 48 * 60 * 60 * 1000;

function shouldDeferUpstreamSync({ live, lastRunMs, now = Date.now() }) {
  if (!live) return false;
  if (lastRunMs == null || Number.isNaN(lastRunMs)) return false; // never ran - don't starve it from day one
  return now - lastRunMs < MAX_DEFER_MS;
}

module.exports = { shouldDeferUpstreamSync, MAX_DEFER_MS };
