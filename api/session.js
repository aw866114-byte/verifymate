// STAGES 5 (WORK), 9 (HANDOFF) and the protocol gate (1–2).
//
// POST { action:'start', session, ackRules:true }   → session registered; refuses without ackRules
// POST { action:'log',  session, did, evidence? }   → append-only journal, as it happens
// POST { action:'handoff', session, state }         → overwrites _latest_handoff; written continuously,
//                                                     so a dead chat costs nothing
// GET                                               → latest handoff + last 50 journal lines

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');

function body(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET') {
      const handoff = await store.get('sessions', '_latest_handoff');
      const journal = (await store.readAll('journal')).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, handoff, journal }, null, 2));
    }
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'GET or POST' })); }

    const b = body(req);
    let out;
    if (b.action === 'start') {
      if (b.ackRules !== true) {
        res.statusCode = 428;
        return res.end(JSON.stringify({ ok: false, error: 'Refused: a session must acknowledge the rules before working. GET /api/context, read rules + settled + errata, then start with ackRules:true.' }));
      }
      out = await store.put('sessions', b.session || ('s-' + Date.now()), { started: new Date().toISOString(), acked: true });
    } else if (b.action === 'log') {
      if (!b.did) throw new Error('missing: did');
      out = await store.add('journal', { session: b.session || 'unknown', did: b.did, evidence: b.evidence || '' });
    } else if (b.action === 'handoff') {
      if (!b.state) throw new Error('missing: state');
      out = await store.put('sessions', '_latest_handoff', { session: b.session || 'unknown', state: b.state });
    } else {
      throw new Error('unknown action: ' + b.action);
    }
    res.statusCode = out.ok ? 200 : 503;
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
