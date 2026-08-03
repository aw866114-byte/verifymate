// STAGES 6 (RECORD), 8 (PROVE), 10 (ERRATA), 19 (COVERAGE) — the write side.
// A session writes decisions the second they happen. Evidence is not optional.
//
// POST body — one of:
//   { type:'settle',   id, verdict, evidence, do_not_reopen?, expires? }
//   { type:'reopen',   id, evidence }                  // only a failing check reopens
//   { type:'erratum',  id, claim, correction }         // wrong claim, withdrawn forever
//   { type:'coverage', sweep, checked, total, skipped:[] }
//   { type:'incident', id, module, evidence, impact }  // open a failure
//   { type:'close',    id, evidence }                  // close a failure, with proof
//   { type:'queue',    id, kind:'work'|'aj', title, steps, status? }
//   { type:'followup', id, who, about, next, due }
//   { type:'clock',    id, what, due, action }
//   { type:'inventory',id, asset, state }

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');

function body(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'POST only' })); }

  try {
    const b = body(req);
    const t = b.type;
    const need = (fields) => {
      const missing = fields.filter((f) => !b[f]);
      if (missing.length) throw new Error('missing: ' + missing.join(', '));
    };
    let out;

    if (t === 'settle') {
      need(['id', 'verdict', 'evidence']);
      out = await store.put('facts', b.id, {
        verdict: b.verdict, evidence: b.evidence,
        verified: new Date().toISOString().slice(0, 10),
        do_not_reopen: !!b.do_not_reopen, expires: b.expires || null,
      });
    } else if (t === 'reopen') {
      need(['id', 'evidence']);
      const fact = await store.get('facts', b.id);
      if (fact && fact.do_not_reopen && !String(b.evidence).trim()) throw new Error('do_not_reopen facts reopen only on evidence');
      out = await store.put('facts', b.id, { retired: true, reopened: b.evidence });
      if (out.ok) await store.put('incidents', b.id, { module: 'state', status: 'open', evidence: b.evidence, since: new Date().toISOString().slice(0, 10) });
    } else if (t === 'erratum') {
      need(['id', 'claim', 'correction']);
      out = await store.put('errata', b.id, { claim: b.claim, correction: b.correction, withdrawn: new Date().toISOString().slice(0, 10), claudes_error: b.claudes_error !== false });
    } else if (t === 'coverage') {
      need(['sweep', 'checked', 'total']);
      out = await store.put('coverage', b.sweep, { checked: b.checked, total: b.total, skipped: b.skipped || [], honest: b.checked >= b.total ? 'complete' : `checked ${b.checked} of ${b.total}; did not open: ${(b.skipped || []).join(', ') || 'unlisted'}` });
    } else if (t === 'incident') {
      need(['id', 'module', 'evidence']);
      out = await store.put('incidents', b.id, { module: b.module, evidence: b.evidence, impact: b.impact || '', status: 'open', since: new Date().toISOString().slice(0, 10) });
    } else if (t === 'close') {
      need(['id', 'evidence']);
      out = await store.put('incidents', b.id, { status: 'closed', closedEvidence: b.evidence, closed: new Date().toISOString().slice(0, 10) });
    } else if (t === 'queue') {
      need(['id', 'kind', 'title']);
      out = await store.put('queue', b.id, { kind: b.kind, title: b.title, steps: b.steps || '', status: b.status || 'open' });
    } else if (t === 'followup') {
      need(['id', 'who', 'about']);
      out = await store.put('followups', b.id, { who: b.who, about: b.about, next: b.next || '', due: b.due || null, status: b.status || 'open' });
    } else if (t === 'clock') {
      need(['id', 'what', 'due']);
      out = await store.put('clocks', b.id, { what: b.what, due: b.due, action: b.action || '', status: b.status || 'armed' });
    } else if (t === 'inventory') {
      need(['id', 'asset', 'state']);
      out = await store.put('inventory', b.id, { asset: b.asset, state: b.state });
    } else if (t === 'event') {
      // Feeds the WATCHDOG silence alarms: sale, ww-enquiry, outreach-run, etsy-review…
      need(['event']);
      out = await store.put('checks', '_events', { [b.event]: b.at || new Date().toISOString() });
    } else {
      throw new Error('unknown type: ' + t);
    }

    res.statusCode = out.ok ? 200 : 503;
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
module.exports = Object.assign(handler, { default: handler });
