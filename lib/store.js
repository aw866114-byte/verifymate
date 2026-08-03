// VerifyMate — the store. One place state lives; chats die, this doesn't.
//
// Backend: Firestore via FIREBASE_SERVICE_ACCOUNT_KEY (same var the other apps
// use — copy it from the walker-works Vercel project). Collections are prefixed
// vm_ so nothing collides.
//
// FAIL CLOSED: with no key set, reads serve the committed seed (still useful,
// clearly marked readOnly) and every write returns an error naming the fix.
// Nothing pretends to remember what it cannot persist.

const fs = require('fs');
const path = require('path');

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'state-seed.json'), 'utf8'));

let _db = null;
let _dbTried = false;
let _initError = null;

/** @returns {import('firebase-admin/firestore').Firestore | null} */
function db() {
  if (_dbTried) return _db;
  _dbTried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) { _initError = 'env var not present at runtime'; return null; }
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    }
    _db = admin.firestore();
  } catch (e) {
    _initError = String(e).slice(0, 300);
    console.error('store: Firestore init failed:', _initError);
    _db = null;
  }
  return _db;
}

function NOT_WRITABLE_NOW() {
  db();
  return {
    ok: false,
    error: 'State store not writable. Diagnosis: ' + (_initError || 'FIREBASE_SERVICE_ACCOUNT_KEY not set') + '. Fix the key on the verifymate Vercel project and redeploy; writes refuse rather than silently drop.',
  };
}
const NOT_WRITABLE = { ok: false, error: 'store not writable' };

const COLLECTIONS = [
  'facts',      // settled verdicts (stage 6 RECORD) — id, verdict, evidence, verified, do_not_reopen, expires
  'errata',     // stage 10 — wrong claims, withdrawn, with correction
  'queue',      // stages 4 + 13 — {kind:'work'|'aj', title, steps, status, due}
  'followups',  // stage 17 — {who, about, next, due, status}
  'clocks',     // stage 18 — {what, due, action, status}
  'inventory',  // stage 12 — finished-but-unshipped assets
  'coverage',   // stage 19 — {sweep, checked, total, skipped[]}
  'sessions',   // session protocol — start/ack/handoff
  'journal',    // stage 5 WORK — append-only action log
  'checks',     // stage 5/8/11/14 — latest results per check id
  'incidents',  // open/closed failures with evidence
  'approvals',  // stage 7 — pending/decided actions
  'audit',      // immutable act log
  'money',      // stage 16 — daily revenue snapshots
  'secrets',    // stage 15 — encrypted blobs, names listable, values never returned
];

function col(name) {
  if (!COLLECTIONS.includes(name)) throw new Error('unknown collection: ' + name);
  const d = db();
  return d ? d.collection('vm_' + name) : null;
}

function writable() { return !!db(); }

/** Read every doc in a collection (bounded). @returns {Promise<any[]>} */
async function readAll(name, limit = 500) {
  const c = col(name);
  if (!c) return [];
  const snap = await c.limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Upsert one doc. @returns {Promise<{ok:boolean,id?:string,error?:string}>} */
async function put(name, id, data) {
  const c = col(name);
  if (!c) return NOT_WRITABLE_NOW();
  await c.doc(String(id)).set({ ...data, updatedAt: new Date().toISOString() }, { merge: true });
  return { ok: true, id: String(id) };
}

/** Append-only add (journal, audit). @returns {Promise<{ok:boolean,id?:string,error?:string}>} */
async function add(name, data) {
  const c = col(name);
  if (!c) return NOT_WRITABLE_NOW();
  const ref = await c.add({ ...data, at: new Date().toISOString() });
  return { ok: true, id: ref.id };
}

/** @returns {Promise<any>} */
async function get(name, id) {
  const c = col(name);
  if (!c) return null;
  const d = await c.doc(String(id)).get();
  return d.exists ? { id: d.id, ...d.data() } : null;
}

/**
 * The merged view every session loads (stage 1). Seed underneath, live overlay
 * on top; a live doc with the same id wins over the seed entry.
 */
async function fullState() {
  const live = writable();
  const overlay = {};
  if (live) {
    const names = ['facts', 'errata', 'queue', 'followups', 'clocks', 'inventory', 'coverage', 'incidents'];
    await Promise.all(names.map(async (n) => { overlay[n] = await readAll(n); }));
  }
  const mergeById = (seedArr, liveArr) => {
    const m = new Map();
    for (const s of seedArr || []) m.set(s.id, s);
    for (const l of liveArr || []) m.set(l.id, l);
    return [...m.values()];
  };
  return {
    readOnly: !live,
    seedVersion: SEED.seedVersion,
    rules: SEED.rules,
    settled: mergeById(SEED.settled, (overlay.facts || []).filter((f) => !f.retired)),
    errata: mergeById(SEED.errata, overlay.errata),
    failing: mergeById(SEED.failing, (overlay.incidents || []).filter((i) => i.status !== 'closed')),
    blocked: SEED.blocked,
    queue: mergeById(SEED.queue, overlay.queue),
    followups: mergeById(SEED.followups, overlay.followups),
    clocks: mergeById(SEED.clocks, overlay.clocks),
    inventory: mergeById(SEED.inventory, overlay.inventory),
    coverage: overlay.coverage || [],
  };
}

module.exports = { db, col, writable, readAll, put, add, get, fullState, SEED, NOT_WRITABLE, NOT_WRITABLE_NOW };
