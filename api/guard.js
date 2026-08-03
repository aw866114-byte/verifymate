// STAGE 20 endpoint. POST { text, kind? } → { pass, verdict, violations }.
const { requireAgent } = require('../lib/auth');
const { guard } = require('../lib/guard');

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'POST only' })); }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!b.text) throw new Error('missing: text');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...guard(b.text, b.kind || 'general') }, null, 2));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
