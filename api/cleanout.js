// ═══════════════════════════════════════════════════════════════════════════
// CLEAN OUT — AJ retires old settled facts himself, one group at a time.
//
// Why this exists, measured 16 Aug 2026: /api/context was sending 692,628
// characters on every single load. 539,689 of that was 401 settled facts.
// 117 of them were KDP book builds from one fortnight — 40% of his whole memory.
// Every program he owns was dragging that down before it could answer anything.
//
// THE TWO HARD RULES OF THIS FILE:
//   1. NOTHING IS EVER DELETED. Retiring sets a flag. The fact stays in the
//      database, in full, and can be listed and restored at any time.
//   2. do_not_reopen FACTS CANNOT BE TOUCHED. Not by AJ, not by a model, not by
//      a bad request. The check is here in code, not in the page.
//
// GET  /api/cleanout               → the groups, with counts, bytes, dates, samples
// GET  /api/cleanout?retired=1     → everything already retired, in full, so nothing is lost
// POST /api/cleanout {ids:[...], action:'retire'|'restore'}
// POST /api/cleanout {group:'KDP books and Amazon', action:'retire'}

const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');

const GROUPS = [
  ['kdp', 'KDP books and Amazon'],
  ['amazon', 'KDP books and Amazon'],
  ['etsy', 'Etsy'],
  ['pin', 'Pinterest'],
  ['linkedin', 'LinkedIn'],
  ['leadmate', 'LeadMate / outreach'],
  ['outreach', 'LeadMate / outreach'],
  ['tpc', 'The Protocol Collective site'],
  ['walkerworks', 'Walker Works'],
  ['ww-', 'Walker Works'],
  ['allcare', 'All Care'],
  ['all-care', 'All Care'],
  ['reviewmate', 'ReviewMate'],
  ['invoice', 'InvoiceMate'],
  ['quote', 'Quotes and pricing'],
  ['price', 'Quotes and pricing'],
  ['rate', 'Quotes and pricing'],
  ['stripe', 'Stripe and checkout'],
  ['cloudflare', 'Cloudflare / hosting'],
  ['vercel', 'Cloudflare / hosting'],
  ['claude', 'Claude behaviour rules'],
  ['rule', 'Claude behaviour rules'],
  ['handoff', 'Old handover notes'],
  ['session', 'Old handover notes'],
  ['audit', 'Audits and sweeps'],
  ['sweep', 'Audits and sweeps'],
];

function groupOf(fact) {
  const id = String(fact.id || '').toLowerCase();
  for (const [needle, label] of GROUPS) if (id.includes(needle)) return label;
  return 'Everything else';
}

function bytes(x) { return JSON.stringify(x).length; }
function body(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }

/** The one gate that matters. Nothing gets past this. */
function protectedFact(f) { return f && f.do_not_reopen === true; }

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!store.writable()) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ ok: false, error: 'Store not configured — nothing can be retired or restored.' }));
    }

    const all = await store.readAll('facts', 1000);

    if (req.method === 'GET') {
      const wantRetired = /(\?|&)retired=1/.test(req.url || '');
      if (wantRetired) {
        const gone = all.filter((f) => f.retired);
        res.statusCode = 200;
        return res.end(JSON.stringify({
          ok: true,
          note: 'Nothing here is deleted. Every one of these is still stored in full and can be restored.',
          count: gone.length,
          retired: gone.sort((a, b) => (a.retiredAt < b.retiredAt ? 1 : -1)),
        }, null, 2));
      }

      const live = all.filter((f) => !f.retired);
      const map = new Map();
      for (const f of live) {
        const g = protectedFact(f) ? '__PROTECTED__' : groupOf(f);
        if (!map.has(g)) map.set(g, []);
        map.get(g).push(f);
      }
      const groups = [...map.entries()]
        .filter(([g]) => g !== '__PROTECTED__')
        .map(([label, items]) => ({
          label,
          count: items.length,
          bytes: bytes(items),
          // three real samples so he can hear what he is about to retire
          samples: items.slice(0, 3).map((f) => ({
            id: f.id,
            text: String(f.verdict || f.text || '').slice(0, 220),
            when: (f.verified || f.updatedAt || '').slice(0, 10),
          })),
          ids: items.map((f) => f.id),
        }))
        .sort((a, b) => b.bytes - a.bytes);

      const prot = map.get('__PROTECTED__') || [];
      res.statusCode = 200;
      return res.end(JSON.stringify({
        ok: true,
        protectedCount: prot.length,
        protectedNote: 'These are marked DO NOT REOPEN. They are not shown and cannot be retired.',
        totalLive: live.length,
        totalBytes: bytes(live),
        retiredAlready: all.filter((f) => f.retired).length,
        groups,
      }, null, 2));
    }

    if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'GET or POST' })); }

    const b = body(req);
    const action = b.action === 'restore' ? 'restore' : 'retire';
    let targets = [];

    if (Array.isArray(b.ids) && b.ids.length) {
      targets = all.filter((f) => b.ids.includes(f.id));
    } else if (b.group) {
      targets = all.filter((f) => !f.retired && groupOf(f) === b.group);
    } else {
      throw new Error('give me ids or a group');
    }

    // THE GATE. Refuse the whole request rather than half-do it.
    const blocked = targets.filter(protectedFact).map((f) => f.id);
    if (blocked.length) {
      res.statusCode = 403;
      return res.end(JSON.stringify({
        ok: false,
        error: 'Refused. These are marked DO NOT REOPEN and cannot be retired.',
        blocked,
      }));
    }
    if (!targets.length) throw new Error('nothing matched — nothing was changed');

    const stamp = new Date().toISOString();
    const done = [];
    for (const f of targets) {
      const out = await store.put('facts', f.id, action === 'retire'
        ? { retired: true, retiredAt: stamp, retiredBy: 'AJ' }
        : { retired: false, restoredAt: stamp });
      if (out.ok) done.push(f.id);
    }

    // A 200 is not proof. Read it back.
    const after = await store.readAll('facts', 1000);
    const check = after.filter((f) => done.includes(f.id));
    const landed = check.filter((f) => (action === 'retire' ? f.retired === true : !f.retired)).length;

    await store.add('audit', { act: `facts.${action}`, count: done.length, group: b.group || null, by: 'AJ' });

    res.statusCode = landed === done.length ? 200 : 500;
    res.end(JSON.stringify({
      ok: landed === done.length,
      action,
      asked: targets.length,
      changed: done.length,
      confirmedByReadBack: landed,
      stillStored: true,
      message: action === 'retire'
        ? `${landed} facts retired. They are out of your canon and nothing will load them again. They are still stored in full — press SHOW ME WHAT I RETIRED to see or restore any of them.`
        : `${landed} facts restored. They are back in your canon.`,
    }, null, 2));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
}

module.exports = Object.assign(handler, { default: handler });
