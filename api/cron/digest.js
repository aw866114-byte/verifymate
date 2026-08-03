// The 7am digest — the morning glance, in your inbox before coffee.
// What's failing, what's due, what only you can do, what sold.

const { requireAgent } = require('../../lib/auth');
const store = require('../../lib/store');
const { sendEmail, esc } = require('../../lib/alert');

async function handler(req, res) {
  if (!requireAgent(req, res, { allowCron: true })) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    const state = await store.fullState();
    const checks = store.writable() ? await store.get('checks', '_latest') : null;
    const money = store.writable() ? await store.get('money', '_latest') : null;
    const today = new Date().toISOString().slice(0, 10);

    const failing = state.failing || [];
    const ajQueue = (state.queue || []).filter((q) => q.kind === 'aj' && q.status === 'open');
    const dueClocks = (state.clocks || []).filter((c) => c.status !== 'done' && c.due && c.due <= today);
    const dueFu = (state.followups || []).filter((f) => f.status === 'open' && f.due && f.due <= today);

    const li = (arr, f) => arr.length ? arr.map((x) => `<li style="margin-bottom:6px">${f(x)}</li>`).join('') : '<li style="color:#2f7d52">Nothing.</li>';
    const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:640px;color:#1f2226">
  <h2 style="font-family:Georgia,serif">Morning, AJ.</h2>
  ${checks ? `<p><b>${checks.pass}/${checks.total}</b> checks passing (run ${esc(checks.ranAt)})</p>` : '<p>No check run stored yet.</p>'}
  ${money ? `<p><b>Money:</b> ${esc(money.summary || JSON.stringify(money).slice(0, 200))}</p>` : ''}
  <h3 style="color:#b03030">Failing (${failing.length})</h3><ul>${li(failing, (x) => `<b>${esc(x.id)}</b> — ${esc(x.impact || x.evidence || '')}`)}</ul>
  <h3 style="color:#b8642e">Only you can do these (${ajQueue.length})</h3><ul>${li(ajQueue, (x) => `<b>${esc(x.title)}</b><br><span style="color:#666;font-size:13px">${esc(x.steps || '')}</span>`)}</ul>
  <h3>Due today — clocks (${dueClocks.length})</h3><ul>${li(dueClocks, (x) => `<b>${esc(x.what)}</b> — ${esc(x.action || '')}`)}</ul>
  <h3>Due today — follow-ups (${dueFu.length})</h3><ul>${li(dueFu, (x) => `<b>${esc(x.who)}</b>: ${esc(x.next || x.about)}`)}</ul>
  <p style="color:#999;font-size:12px">VerifyMate · the app remembers so nobody has to.</p>
</div>`;

    const mail = await sendEmail(`VerifyMate 7am — ${failing.length} failing · ${ajQueue.length} for you · ${dueClocks.length + dueFu.length} due`, html);
    if (store.writable()) await store.add('audit', { what: 'digest', mail });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, failing: failing.length, ajQueue: ajQueue.length, dueClocks: dueClocks.length, dueFollowups: dueFu.length, mail }, null, 2));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
