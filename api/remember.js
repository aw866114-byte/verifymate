// REMEMBER — AJ writes his own rules, without a chat, from his phone or his computer.
//
// Until 16 Aug 2026 the rules list was baked into lib/state-seed.json, which meant
// a rule could only be added by editing code and redeploying — i.e. only by Claude.
// That is the thing this route removes. AJ types or speaks a rule, it lands in
// Firestore, and fullState() merges it OVER the seed on the very next /api/context.
// Every program he owns reads it from that moment on.
//
// POST { text, id? }        → save a rule
// POST { id, retire:true }  → retire a rule AJ added (seed rules cannot be retired here)
// GET                       → list every rule currently in force, his first

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');

function body(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

function slug(text) {
  return 'aj-' + String(text).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-').slice(0, 8).join('-')
    .slice(0, 60);
}

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET') {
      const state = await store.fullState();
      const mine = (await store.readAll('rules')).filter((r) => !r.retired);
      const mineIds = new Set(mine.map((r) => r.id));
      res.statusCode = 200;
      return res.end(JSON.stringify({
        ok: true,
        writable: store.writable(),
        mine: mine.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
        builtIn: (state.rules || []).filter((r) => !mineIds.has(r.id)),
        total: (state.rules || []).length,
      }, null, 2));
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok: false, error: 'GET or POST' }));
    }

    const b = body(req);

    if (b.retire === true) {
      if (!b.id) throw new Error('missing: id');
      const existing = await store.get('rules', b.id);
      if (!existing) throw new Error(`no rule of AJ's with id "${b.id}". Built-in rules cannot be retired here.`);
      const out = await store.put('rules', b.id, { retired: true, retiredAt: new Date().toISOString() });
      await store.add('audit', { act: 'rule.retire', id: b.id, by: 'AJ' });
      res.statusCode = out.ok ? 200 : 503;
      return res.end(JSON.stringify({ ...out, retired: b.id }));
    }

    const text = String(b.text || '').trim();
    if (!text) throw new Error('missing: text — say the rule in plain words');
    if (text.length > 2000) throw new Error('too long — a rule should be a sentence or two, not an essay');

    const id = String(b.id || slug(text));
    const rule = {
      text,
      addedBy: 'AJ',
      source: b.source || 'remember-button',
      addedAt: new Date().toISOString(),
      retired: false,
    };

    const out = await store.put('rules', id, rule);
    if (!out.ok) { res.statusCode = 503; return res.end(JSON.stringify(out)); }

    // Prove it landed. A 200 is not proof — read it straight back out of the store.
    const readBack = await store.get('rules', id);
    const landed = !!readBack && readBack.text === text;

    await store.add('audit', { act: 'rule.add', id, text: text.slice(0, 200), by: 'AJ' });
    await store.add('journal', { session: 'aj-remember-button', did: `AJ added a rule: ${text.slice(0, 160)}`, evidence: `rules/${id}` });

    res.statusCode = landed ? 200 : 500;
    res.end(JSON.stringify({
      ok: landed,
      id,
      landed,
      readBack: readBack ? readBack.text : null,
      message: landed
        ? 'Saved. Every program that reads your canon has this rule from now on.'
        : 'The write returned success but reading it back did not match. Nothing has been trusted. Try again.',
    }, null, 2));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
}

module.exports = Object.assign(handler, { default: handler });
