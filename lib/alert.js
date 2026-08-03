// STAGE 8 of the modules — ALERTS. Incident open/close + the 7am digest.
// Email via Resend (transactional — its correct use). Fail-soft: with no key,
// the alert is stored and marked unsent instead of silently vanishing.

const store = require('./store');

async function sendEmail(subject, html) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_TO || 'aw866114@gmail.com';
  const from = process.env.ALERT_FROM || 'VerifyMate <onboarding@resend.dev>';
  if (!key) return { sent: false, why: 'RESEND_API_KEY not set on this project — alert stored, not emailed' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const j = await r.json().catch(() => ({}));
  return { sent: r.ok, why: r.ok ? 'delivered to ' + to : 'Resend ' + r.status + ': ' + JSON.stringify(j).slice(0, 200) };
}

/** Compare a fresh check run to stored incidents; open new ones, close fixed ones. */
async function reconcile(run) {
  const opened = [], closed = [];
  if (!store.writable()) return { opened, closed, note: 'store read-only — incidents not persisted' };

  const incidents = await store.readAll('incidents');
  const byId = new Map(incidents.map((i) => [i.id, i]));

  for (const r of run.results) {
    const existing = byId.get(r.id);
    if (!r.ok && (!existing || existing.status === 'closed')) {
      await store.put('incidents', r.id, { module: r.module, status: 'open', evidence: r.evidence, since: new Date().toISOString().slice(0, 10) });
      opened.push(r);
    } else if (r.ok && existing && existing.status === 'open' && existing.module === r.module) {
      await store.put('incidents', r.id, { status: 'closed', closedEvidence: r.evidence, closed: new Date().toISOString().slice(0, 10) });
      closed.push(r);
    }
  }
  return { opened, closed };
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function alertHtml(opened, closed) {
  const row = (r, color) => `<tr><td style="padding:6px 10px;border-left:3px solid ${color}"><b>${esc(r.name)}</b><br><span style="color:#666;font-family:monospace;font-size:12px">${esc(r.evidence)}</span></td></tr>`;
  return `<table style="font-family:Inter,Arial,sans-serif;border-collapse:collapse;max-width:640px">
    ${opened.map((r) => row(r, '#b03030')).join('')}
    ${closed.map((r) => row(r, '#2f7d52')).join('')}
  </table>`;
}

module.exports = { sendEmail, reconcile, alertHtml, esc };
