// STAGE 1 — LOAD. The first call of every session. One request, the whole state.
// Also serves stages 2 (RULES), 4 (BRIEF), 10 (ERRATA), 12 (EXISTS-ALREADY),
// 13 (YOUR QUEUE), 17 (FOLLOW-UP), 18 (CLOCK), 19 (COVERAGE) on the read side.

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');
const { VERSION } = require('../lib/version');
const { RUNNERS, CONFIG } = require('../lib/checks');

// ---- 22 Aug 2026 ----------------------------------------------------------
// Keep this payload from growing forever WITHOUT hiding anything.
// settled and errata come back as an INDEX: every id, always, with a one-line
// headline taken from the first sentence. Only the most recent records carry
// their full text, in settledRecent / errataRecent.
// doNotReopen carries EVERY do-not-reopen fact in full, because AskMate builds
// its whole canon from those and must never lose a word of them.
// Any single record can be fetched whole from /api/fact?collection=..&id=..
// Add ?full=1 to get the old complete shape back, unchanged.
const HEADLINE_CAP = 180, FULL_SETTLED = 30, FULL_ERRATA = 15;

function vmHeadline(rec, fields) {
  let t = '';
  for (const f of fields) { const v = rec[f]; if (typeof v === 'string' && v.trim()) { t = v.trim(); break; } }
  if (!t) return '';
  t = t.replace(/\s+/g, ' ');
  const cut = t.search(/[.!?](\s|$)/);
  if (cut > 20 && cut < HEADLINE_CAP) t = t.slice(0, cut + 1);
  return t.length > HEADLINE_CAP ? t.slice(0, HEADLINE_CAP - 3) + '...' : t;
}

function vmIndex(items, fields) {
  return (items || []).map((r) => {
    const row = { id: r.id, headline: vmHeadline(r, fields) };
    for (const k of ['verified', 'withdrawn', 'status']) if (r[k]) row[k] = r[k];
    if (r.do_not_reopen) row.do_not_reopen = true;
    return row;
  });
}

function vmRecent(items, n, key) {
  return [...(items || [])]
    .sort((a, b) => String(b[key] || '').localeCompare(String(a[key] || '')))
    .slice(0, n);
}

function vmTrim(state, req) {
  const q = (req && req.query) || {};
  if (String(q.full || '') === '1') return {};
  return {
    settled: vmIndex(state.settled, ['verdict']),
    settledRecent: vmRecent(state.settled, FULL_SETTLED, 'verified'),
    doNotReopen: (state.settled || []).filter((x) => x.do_not_reopen),
    errata: vmIndex(state.errata, ['claim', 'correction']),
    errataRecent: vmRecent(state.errata, FULL_ERRATA, 'withdrawn'),
    howToRead: 'settled and errata are an INDEX - every id is listed, nothing is hidden, but only the headline is here. settledRecent and errataRecent carry the newest ones in full, and doNotReopen carries every do-not-reopen fact in full. Fetch any single record whole from /api/fact?collection=settled&id=<id>. Add ?full=1 to this endpoint for the old complete payload.',
  };
}

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
    ...vmTrim(state, req),
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
