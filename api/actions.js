// STAGE 7 — APPROVE. Nothing changes without this passing through you.
//
// POST { do:'propose', type, params, why }  → dry-runs, stores the approval with
//                                             diff + rollback, returns it. Nothing executed.
// POST { do:'approve', id }                 → executes, records audit + rollback. One click.
// POST { do:'decline', id }
// GET                                       → pending approvals
//
// Approvals expire after 30 minutes — a stale diff must be re-proposed.

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');
const stripe = require('../lib/adapters/stripe');

const REGISTRY = { ...stripe.ACTIONS };
const TTL_MS = 30 * 60 * 1000;

function body(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET') {
      const all = (await store.readAll('approvals')).filter((a) => a.status === 'pending');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, pending: all, actionsAvailable: Object.keys(REGISTRY) }, null, 2));
    }
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'GET or POST' })); }
    const b = body(req);

    if (b.do === 'propose') {
      const action = REGISTRY[b.type];
      if (!action) throw new Error('unknown action type: ' + b.type + '. Available: ' + Object.keys(REGISTRY).join(', '));
      const dry = await action.dryRun(b.params || {});
      const id = 'ap-' + Date.now().toString(36);
      const record = {
        type: b.type, params: b.params || {}, why: b.why || '',
        diff: dry.diff, detail: dry.detail, blastRadius: dry.blastRadius, rollback: dry.rollback,
        status: 'pending', proposedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
      };
      const out = await store.put('approvals', id, record);
      if (!out.ok) { res.statusCode = 503; return res.end(JSON.stringify(out)); }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, id, ...record }, null, 2));
    }

    if (b.do === 'approve' || b.do === 'decline') {
      const ap = await store.get('approvals', b.id);
      if (!ap) throw new Error('no such approval: ' + b.id);
      if (ap.status !== 'pending') throw new Error('already ' + ap.status);
      if (b.do === 'decline') {
        await store.put('approvals', b.id, { status: 'declined', decidedAt: new Date().toISOString() });
        await store.add('audit', { what: 'declined', id: b.id, type: ap.type });
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, id: b.id, status: 'declined' }));
      }
      if (new Date(ap.expiresAt).getTime() < Date.now()) {
        await store.put('approvals', b.id, { status: 'expired' });
        throw new Error('approval expired — the diff is stale, re-propose it');
      }
      const action = REGISTRY[ap.type];
      const result = await action.execute(ap.params);
      await store.put('approvals', b.id, { status: 'executed', decidedAt: new Date().toISOString(), result });
      await store.add('audit', { what: 'executed', id: b.id, type: ap.type, params: ap.params, result, rollback: ap.rollback });
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, id: b.id, status: 'executed', result, rollback: ap.rollback }, null, 2));
    }

    throw new Error('unknown do: ' + b.do);
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
