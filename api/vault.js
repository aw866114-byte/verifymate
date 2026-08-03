// The vault's only door. PUT values in, list names. No read path exists.
//
// POST { name, value, note? }  → { ok, name, stored, length }  (value never echoed)
// GET                          → names + metadata only

const { requireAgent } = require('../lib/auth');
const { putSecret, listSecrets } = require('../lib/vault');
const store = require('../lib/store');

function body(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET') {
      const names = await listSecrets();
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, secrets: names, note: 'Values are write-only. There is no endpoint that returns one, by design.' }, null, 2));
    }
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'GET or POST' })); }
    const b = body(req);
    if (!b.name || !b.value) throw new Error('missing: name, value');
    const out = await putSecret(b.name, b.value, b.note);
    if (store.writable()) await store.add('audit', { what: 'vault-put', name: b.name, length: String(b.value).length });
    res.statusCode = out.ok ? 200 : 503;
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
