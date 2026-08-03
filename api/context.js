// STAGE 1 — LOAD. The first call of every session. One request, the whole state.
// Also serves stages 2 (RULES), 4 (BRIEF), 10 (ERRATA), 12 (EXISTS-ALREADY),
// 13 (YOUR QUEUE), 17 (FOLLOW-UP), 18 (CLOCK), 19 (COVERAGE) on the read side.

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');
const { VERSION } = require('../lib/version');

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    const state = await store.fullState();

    // Latest check run + latest handoff + open approvals ride along so a session
    // needs exactly one call before it is allowed to speak.
    let checks = null, handoff = null, approvals = [], money = null;
    if (store.writable()) {
      [checks, handoff, money] = await Promise.all([
        store.get('checks', '_latest'),
        store.get('sessions', '_latest_handoff'),
        store.get('money', '_latest'),
      ]);
      approvals = (await store.readAll('approvals')).filter((a) => a.status === 'pending');
    }

    const now = new Date().toISOString();
    const due = (arr) => (arr || []).filter((c) => c.status !== 'done' && c.due && c.due <= now.slice(0, 10));

    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      generated: now,
      appVersion: VERSION,
      protocol: 'Run the 20 stages. Do not raise anything settled. Do not restate a claim listed in errata. Before building, check inventory. Write back as you go (POST /api/session, /api/verdict). Done requires evidence.',
      ...state,
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
