// STAGE 16 — MONEY. The revenue truth, from Stripe, read-only.
// GET ?days=7 → summary. Also stores _latest so the digest can quote it.

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');
const { revenueSummary } = require('../lib/adapters/stripe');

async function handler(req, res) {
  if (!requireAgent(req, res, { allowCron: true })) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    const days = Math.min(90, parseInt((req.query && req.query.days) || '7', 10) || 7);
    const summary = await revenueSummary(days);
    if (store.writable()) {
      await store.put('money', '_latest', summary);
      if (summary.count > 0 && summary.latest[0]) {
        await store.put('checks', '_events', { sale: new Date().toISOString() }); // feeds the silence alarm
      }
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...summary }, null, 2));
  } catch (e) {
    // No stripe_restricted in the vault yet → say exactly that, not "error".
    res.statusCode = 424;
    res.end(JSON.stringify({ ok: false, error: String(e), fix: 'Create a RESTRICTED Stripe key (Payment Links/Products/Prices write, Charges read, nothing else) and paste it into the vault as "stripe_restricted" on the dashboard.' }));
  }
}
module.exports = Object.assign(handler, { default: handler });
