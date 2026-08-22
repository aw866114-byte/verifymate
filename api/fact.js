// api/fact.js
// Read ONE record by id, or an index of every id in a collection.
// Added 22 Aug 2026. Before this there was no way to read a single record at all:
// /api/verdict is POST only, so /api/context had to carry every fact in full to
// show you anything, which is what pushed the payload past a megabyte.
const { requireAgent } = require('../lib/auth');
const store = require('../lib/store');

// what the caller may ask for -> the real collection name
const ALIAS = {
  settled: 'facts', fact: 'facts', facts: 'facts',
  errata: 'errata', erratum: 'errata',
  queue: 'queue',
  followups: 'followups', followup: 'followups',
  clocks: 'clocks', clock: 'clocks',
  incidents: 'incidents', incident: 'incidents', failing: 'incidents',
  inventory: 'inventory',
  coverage: 'coverage',
  rules: 'rules',
};

// where the same list lives inside state-seed.json
const SEED_KEY = {
  facts: 'settled', errata: 'errata', queue: 'queue', followups: 'followups',
  clocks: 'clocks', incidents: 'failing', inventory: 'inventory', rules: 'rules',
};

// the field that carries the words, per collection
const TEXT_FIELD = {
  facts: ['verdict'], errata: ['claim', 'correction'], queue: ['title', 'what'],
  followups: ['about', 'next'], clocks: ['what', 'action'], incidents: ['evidence', 'impact'],
  inventory: ['what', 'title'], rules: ['text'], coverage: ['sweep'],
};

function headline(rec, name) {
  const fields = TEXT_FIELD[name] || ['verdict', 'title', 'what', 'text'];
  let t = '';
  for (const f of fields) { if (rec && typeof rec[f] === 'string' && rec[f].trim()) { t = rec[f].trim(); break; } }
  if (!t) return '';
  t = t.replace(/\s+/g, ' ');
  // AJ's records open with a summary sentence, so the first sentence IS the headline
  const cut = t.search(/[.!?](\s|$)/);
  if (cut > 20 && cut < 220) t = t.slice(0, cut + 1);
  return t.length > 240 ? t.slice(0, 237) + '...' : t;
}

function seedList(name) {
  const k = SEED_KEY[name];
  const arr = k && store.SEED ? store.SEED[k] : null;
  return Array.isArray(arr) ? arr : [];
}

function mergeById(seedArr, liveArr) {
  const m = new Map();
  for (const s of seedArr || []) m.set(s.id, s);
  for (const l of liveArr || []) m.set(l.id, l);
  return [...m.values()];
}

async function handler(req, res) {
  if (!requireAgent(req, res)) return;
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'GET only. Use /api/verdict to write.' }));
  }

  const q = req.query || {};
  const asked = String(q.collection || q.type || 'settled').trim().toLowerCase();
  const name = ALIAS[asked];
  if (!name) {
    res.statusCode = 400;
    return res.end(JSON.stringify({
      ok: false,
      error: 'unknown collection: ' + asked,
      try: Object.keys(ALIAS).sort(),
    }));
  }

  const id = String(q.id || '').trim();

  try {
    // ---- one record ----
    if (id) {
      let rec = null, from = 'seed';
      if (store.writable()) {
        try { rec = await store.get(name, id); } catch (e) { rec = null; }
        if (rec) from = 'live';
      }
      if (!rec) rec = seedList(name).find((x) => x && x.id === id) || null;
      if (!rec) {
        res.statusCode = 404;
        return res.end(JSON.stringify({
          ok: false, error: 'no record with that id', collection: asked, id,
          hint: 'call /api/fact?collection=' + asked + ' with no id for the full list of ids',
        }));
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, collection: asked, id, from, record: rec }, null, 2));
    }

    // ---- index of every id ----
    const live = store.writable() ? await store.readAll(name, 5000) : [];
    const all = mergeById(seedList(name), (live || []).filter((r) => !r.retired));
    const index = all.map((r) => {
      const row = { id: r.id, headline: headline(r, name) };
      if (r.verified) row.verified = r.verified;
      if (r.withdrawn) row.withdrawn = r.withdrawn;
      if (r.status) row.status = r.status;
      if (r.do_not_reopen) row.do_not_reopen = true;
      return row;
    });
    index.sort((a, b) => String(b.verified || b.withdrawn || '').localeCompare(String(a.verified || a.withdrawn || '')));
    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: true, collection: asked, count: index.length,
      readOne: '/api/fact?collection=' + asked + '&id=<id>',
      index,
    }, null, 2));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 300) }));
  }
}

module.exports = handler;
