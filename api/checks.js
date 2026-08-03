// Latest check results — the dashboard's data source. GET only. Auth required.
const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');
const { CONFIG } = require('../lib/checks');

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    const latest = store.writable() ? await store.get('checks', '_latest') : null;
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, configured: CONFIG.checks.length, latest, storeWritable: store.writable() }, null, 2));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
