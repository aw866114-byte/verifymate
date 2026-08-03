// VerifyMate test harness — the auth tests + synthetic journey the standard
// requires. Runs with NO store configured on purpose: proves every route fails
// closed, honestly, before Firestore exists. Run: npm test
//
// Exits non-zero on any failure. Never ship on a red run.

process.env.VERIFYMATE_AGENT_KEY = 'test-agent-key-0123456789';
process.env.VERIFYMATE_VAULT_KEY = 'a'.repeat(64);
delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
delete process.env.CRON_SECRET;

const http = require('http');

const routes = {
  '/api/context': require('../api/context'),
  '/api/verdict': require('../api/verdict'),
  '/api/session': require('../api/session'),
  '/api/checks': require('../api/checks'),
  '/api/vault': require('../api/vault'),
  '/api/actions': require('../api/actions'),
  '/api/guard': require('../api/guard'),
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const h = routes[u.pathname];
  if (!h) { res.statusCode = 404; return res.end('{}'); }
  req.query = Object.fromEntries(u.searchParams);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => { req.body = body; h(req, res); });
});

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch('http://127.0.0.1:39091' + path, {
    method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function main() {
  await new Promise((ok) => server.listen(39091, ok));
  const KEY = process.env.VERIFYMATE_AGENT_KEY;

  console.log('\n— auth: every operator route locked from its first line —');
  for (const p of Object.keys(routes)) {
    const anon = await call(p, { method: p === '/api/context' || p === '/api/checks' ? 'GET' : 'POST' });
    check(`${p} anonymous → 401`, anon.status === 401, 'got ' + anon.status);
    const wrong = await call(p, { token: 'wrong-key', method: 'GET' });
    check(`${p} wrong key → 401`, wrong.status === 401, 'got ' + wrong.status);
  }

  console.log('\n— stage 1–2: LOAD + RULES —');
  const ctx = await call('/api/context', { token: KEY });
  check('context → 200', ctx.status === 200, 'got ' + ctx.status);
  check('context is readOnly without a store (honest)', ctx.j.readOnly === true);
  check('rules present incl. rule-zero', (ctx.j.rules || []).some((r) => r.id === 'rule-zero'));
  check('settled facts carried', (ctx.j.settled || []).length >= 15);
  check('errata carried (withdrawn claims)', (ctx.j.errata || []).length >= 9);
  check('inventory carried (exists-already)', (ctx.j.inventory || []).length >= 10);
  check('aj queue carried', (ctx.j.queue || []).some((q) => q.kind === 'aj'));

  const noAck = await call('/api/session', { token: KEY, method: 'POST', body: { action: 'start' } });
  check('session without ackRules → 428 refused', noAck.status === 428, 'got ' + noAck.status);

  console.log('\n— fail closed: writes refuse loudly with no store —');
  const settle = await call('/api/verdict', { token: KEY, method: 'POST', body: { type: 'settle', id: 't', verdict: 'v', evidence: 'e' } });
  check('settle without store → 503 with the fix named', settle.status === 503 && /FIREBASE_SERVICE_ACCOUNT_KEY/.test(settle.j.error || ''), 'got ' + settle.status);
  const sec = await call('/api/vault', { token: KEY, method: 'POST', body: { name: 'x', value: 'y' } });
  check('vault put without store → 503, never silently dropped', sec.status === 503, 'got ' + sec.status);

  console.log('\n— stage 15: vault is write-only and the crypto round-trips —');
  const vault = require('../lib/vault');
  const blob = vault.encrypt('super-secret-value');
  check('encrypt does not contain plaintext', !blob.includes('super-secret-value'));
  check('decrypt round-trips', vault.decrypt(blob) === 'super-secret-value');
  const vaultApi = require('fs').readFileSync(require('path').join(__dirname, '../api/vault.js'), 'utf8');
  check('no API path returns a secret value', !/useSecret|decrypt/.test(vaultApi));

  console.log('\n— stage 20: GUARD —');
  const g = (t, k) => call('/api/guard', { token: KEY, method: 'POST', body: { text: t, kind: k } });
  let r = await g('Written by Andrew Walker, founder.');
  check('"Andrew Walker" → BLOCKED', r.j.pass === false);
  r = await g('Contact andrew@theprotocolcollective.com for access.');
  check('andrew@ mailbox exempt → clean', r.j.pass === true && r.j.violations.length === 0);
  r = await g('As a compliance expert with years in AML, I built this.');
  check('credential claim → BLOCKED', r.j.pass === false);
  r = await g('G\'day — I build operator dashboards. AJ Walker.', 'general');
  check('clean copy passes', r.j.pass === true);
  r = await g('Quick note about your listing. Cheers, AJ.', 'outreach');
  check('outreach missing Spam Act footer → warned', r.j.violations.some((v) => v.id === 'spam-act-footer'));

  console.log('\n— checks engine: definition of correct is loadable + typed —');
  const { CONFIG, RUNNERS } = require('../lib/checks');
  check('every check has a known runner', CONFIG.checks.every((c) => RUNNERS[c.type]));
  check('every check has id/module/name', CONFIG.checks.every((c) => c.id && c.module && c.name));
  const silence = await RUNNERS.silence({ event: 'sale', maxDays: 14 }, { events: {} });
  check('silence with no data FAILS (absence is a signal)', silence.ok === false);
  const silence2 = await RUNNERS.silence({ event: 'sale', maxDays: 14 }, { events: { sale: new Date().toISOString() } });
  check('silence with fresh event passes', silence2.ok === true);

  server.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
