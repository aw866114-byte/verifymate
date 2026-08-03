// The check runner cron. Runs every check, stores the run, opens/closes
// incidents, emails only when something CHANGED (no alert spam).
// Vercel cron sends Authorization: Bearer CRON_SECRET automatically.

const { requireAgent } = require('../../lib/auth');
const store = require('../../lib/store');
const { runAll } = require('../../lib/checks');
const { reconcile, sendEmail, alertHtml } = require('../../lib/alert');

async function handler(req, res) {
  if (!requireAgent(req, res, { allowCron: true })) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    const events = store.writable() ? (await store.get('checks', '_events')) || {} : {};
    const run = await runAll({ events });

    let stored = { ok: false, why: 'store read-only' };
    let changes = { opened: [], closed: [] };
    if (store.writable()) {
      await store.put('checks', '_latest', run);
      await store.add('audit', { what: 'check-run', pass: run.pass, fail: run.fail });
      stored = { ok: true, why: 'stored' };
      changes = await reconcile(run);
      if (changes.opened.length || changes.closed.length) {
        const subject = `VerifyMate: ${changes.opened.length} new failure${changes.opened.length === 1 ? '' : 's'}${changes.closed.length ? `, ${changes.closed.length} fixed` : ''}`;
        const mail = await sendEmail(subject, alertHtml(changes.opened, changes.closed));
        changes.mail = mail;
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, pass: run.pass, fail: run.fail, byModule: run.byModule, stored, changes }, null, 2));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
