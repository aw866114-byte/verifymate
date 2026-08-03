// The check engine — stages 3 (VERIFY), 11 (RECHECK), 14 (WATCHDOG) and the
// live truth behind modules: Domains & Email, Sites, Apps, Checkout, Outreach.
//
// Every check hits reality and returns {id, module, name, ok, value, expect, evidence}.
// No check, no claim.

const { Resolver } = require('dns').promises;
const CONFIG = require('./checks-config.json');

const UA = 'VerifyMate/2.0 (+https://verifymate.vercel.app)';

function resolver() {
  const r = new Resolver();
  r.setServers(['1.1.1.1', '1.0.0.1']); // dig is not installed anywhere we run; dnspython taught us to pin resolvers
  return r;
}

async function fetchMeta(url, method = 'GET') {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { method, redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA } });
    const text = method === 'GET' ? await r.text() : '';
    return { status: r.status, text, finalUrl: r.url };
  } finally { clearTimeout(t); }
}

const RUNNERS = {
  // Site/app is up and says what it should.
  async http(c) {
    const { status, text } = await fetchMeta(c.url);
    let ok = status === (c.expectStatus || 200);
    let evidence = `GET ${c.url} → ${status}`;
    if (ok && c.mustContain) {
      ok = text.includes(c.mustContain);
      evidence += ok ? ` · contains "${c.mustContain}"` : ` · MISSING "${c.mustContain}"`;
    }
    return { ok, value: String(status), evidence };
  },

  // The endpoint must REFUSE strangers. 400 means it processed you — that's a fail.
  async locked(c) {
    const { status } = await fetchMeta(c.url, c.method || 'POST');
    const ok = status === 401 || status === 403;
    return { ok, value: String(status), evidence: `${c.method || 'POST'} ${c.url} → ${status}${ok ? ' (refuses strangers)' : ' — PROCESSES anonymous requests; wrap in requireUser()'}` };
  },

  // MX + SPF + DMARC present on a sending/receiving domain.
  async dns_email(c) {
    const r = resolver();
    const d = c.domain;
    const [mx, txt, dmarc] = await Promise.all([
      r.resolveMx(d).catch(() => []),
      r.resolveTxt(d).catch(() => []),
      r.resolveTxt('_dmarc.' + d).catch(() => []),
    ]);
    const spf = txt.flat().some((s) => String(s).startsWith('v=spf1'));
    const hasDmarc = dmarc.flat().some((s) => String(s).startsWith('v=DMARC1'));
    const hasMx = mx.length > 0;
    const want = c.expect || ['mx', 'spf', 'dmarc'];
    const got = { mx: hasMx, spf, dmarc: hasDmarc };
    const ok = want.every((k) => got[k]);
    return { ok, value: `mx:${hasMx ? mx.length : 0} spf:${spf} dmarc:${hasDmarc}`, evidence: `${d} — MX ${hasMx ? '✓' : '✗'} SPF ${spf ? '✓' : '✗'} DMARC ${hasDmarc ? '✓' : '✗'} (resolved via 1.1.1.1)` };
  },

  // The visible build version matches what the state says should be live.
  async version(c) {
    const { status, text } = await fetchMeta(c.url);
    const v = text.trim().slice(0, 80);
    const ok = status === 200 && (!c.expect || v.includes(c.expect));
    return { ok, value: v || String(status), evidence: `${c.url} → "${v}"${c.expect ? ` (expected to include "${c.expect}")` : ''}` };
  },

  // WATCHDOG: absence is a signal. Fails when the stored last-event is older than maxDays.
  // Event timestamps are written by verdicts/journal (e.g. last enquiry, last sale, last cron run).
  async silence(c, ctx) {
    const last = ctx && ctx.events ? ctx.events[c.event] : null;
    if (!last) return { ok: false, value: 'no data', evidence: `No recorded event "${c.event}" yet — wire the source or log it via /api/verdict. Silence unmeasured is silence unnoticed.` };
    const days = (Date.now() - new Date(last).getTime()) / 86400000;
    const ok = days <= c.maxDays;
    return { ok, value: days.toFixed(1) + 'd', evidence: `${c.event} last seen ${last} (${days.toFixed(1)} days ago, alarm at ${c.maxDays})` };
  },
};

async function runAll(ctx) {
  const results = [];
  const queue = [...CONFIG.checks];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const c = queue.shift();
      const started = Date.now();
      try {
        const r = await RUNNERS[c.type](c, ctx);
        results.push({ id: c.id, module: c.module, name: c.name, type: c.type, ...r, ms: Date.now() - started });
      } catch (e) {
        results.push({ id: c.id, module: c.module, name: c.name, type: c.type, ok: false, value: 'error', evidence: String(e).slice(0, 200), ms: Date.now() - started });
      }
    }
  });
  await Promise.all(workers);

  const byModule = {};
  for (const r of results) {
    byModule[r.module] = byModule[r.module] || { pass: 0, fail: 0 };
    byModule[r.module][r.ok ? 'pass' : 'fail']++;
  }
  return {
    ranAt: new Date().toISOString(),
    total: results.length,
    pass: results.filter((r) => r.ok).length,
    fail: results.filter((r) => !r.ok).length,
    byModule,
    results: results.sort((a, b) => (a.module + a.id).localeCompare(b.module + b.id)),
  };
}

module.exports = { runAll, RUNNERS, CONFIG };
