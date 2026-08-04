// STAGE 1 — LOAD. The first call of every session. One request, the whole state.
// Also serves stages 2 (RULES), 4 (BRIEF), 10 (ERRATA), 12 (EXISTS-ALREADY),
// 13 (YOUR QUEUE), 17 (FOLLOW-UP), 18 (CLOCK), 19 (COVERAGE) on the read side.

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');
const { VERSION } = require('../lib/version');
const { RUNNERS, CONFIG } = require('../lib/checks');

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    const state = await store.fullState();

    let checks = null, handoff = null, approvals = [], money = null;
    if (store.writable()) {
      [checks, handoff, money] = await Promise.all([
        store.get('checks', '_latest'),
        store.get('sessions', '_latest_handoff'),
        store.get('money', '_latest'),
      ]);
      approvals = (await store.readAll('approvals')).filter((a) => a.status === 'pending');
    }

    // DEPLOYED — the LIVE build version of each site, re-checked ON EVERY LOAD
    // (fetches /_version.txt right now), so it updates continuously as AJ works —
    // never a day-old cron snapshot, never a hand-typed handoff line. Trust
    // deployed over any prose. Falls back to the last stored check on live-fetch fail.
    const deployed = {};
    const versionChecks = (CONFIG.checks || []).filter((c) => c.type === 'version');
    await Promise.all(versionChecks.map(async (c) => {
      try {
        const r = await RUNNERS.version(c);
        deployed[c.id] = { live: r.value, ok: r.ok, checkedAt: new Date().toISOString(), evidence: r.evidence, source: 'live' };
      } catch (e) {
        const s = checks && Array.isArray(checks.results) ? checks.results.find((x) => x.id === c.id) : null;
        if (s) deployed[c.id] = { live: s.value, ok: s.ok, checkedAt: checks.ranAt, evidence: s.evidence, source: 'stored', liveError: String(e).slice(0, 120) };
        else deployed[c.id] = { live: null, ok: false, checkedAt: new Date().toISOString(), evidence: 'live check failed and no stored value', source: 'none', liveError: String(e).slice(0, 120) };
      }
    }));

    const now = new Date().toISOString();
    const due = (arr) => (arr || []).filter((c) => c.status !== 'done' && c.due && c.due <= now.slice(0, 10));

    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      generated: now,
      appVersion: VERSION,
      protocol: 'Run the 20 stages. Write back as you go. Done requires evidence. For what is LIVE on a site, trust deployed (re-checked live from _version.txt on every load) over any prose in handoffs or settled facts.',
      ...state,
      deployed,
      dueClocks: due(state.clocks),
      dueFollowups: due(state.followups),
      checks,
      money,
      pendingApprovals: approvals,
      lastHandoff: handoff,
    }, null, 2));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
