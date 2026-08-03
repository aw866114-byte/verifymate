// STAGE 15 — SECRETS. Paste a key in once; nothing ever shows it again.
//
// AES-256-GCM, key from VERIFYMATE_VAULT_KEY (64 hex chars). Values are
// encrypted at rest in Firestore, decrypted ONLY in-process by adapters that
// need to call a provider. There is no API path that returns a value. Not one.

const crypto = require('crypto');
const store = require('./store');

function vaultKey() {
  const hex = process.env.VERIFYMATE_VAULT_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  const key = vaultKey();
  if (!key) throw new Error('VERIFYMATE_VAULT_KEY missing or not 64 hex chars — generate one on the dashboard (it is created in your browser, never sent anywhere) and set it in Vercel.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + cipher.getAuthTag().toString('hex') + ':' + enc.toString('hex');
}

function decrypt(blob) {
  const key = vaultKey();
  if (!key) throw new Error('VERIFYMATE_VAULT_KEY not set');
  const [ivh, tagh, ench] = String(blob).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivh, 'hex'));
  decipher.setAuthTag(Buffer.from(tagh, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ench, 'hex')), decipher.final()]).toString('utf8');
}

/** Store a secret. Returns only metadata — never echoes the value. */
async function putSecret(name, value, note) {
  const blob = encrypt(value);
  const out = await store.put('secrets', name, { blob, note: note || '', length: String(value).length, sha8: crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8) });
  return out.ok ? { ok: true, name, stored: true, length: String(value).length } : out;
}

/** List names + metadata only. */
async function listSecrets() {
  const all = await store.readAll('secrets');
  return all.map(({ id, note, length, sha8, updatedAt }) => ({ name: id, note, length, sha8, updatedAt }));
}

/** In-process read for adapters. NEVER wire this to a route. */
async function useSecret(name) {
  const doc = await store.get('secrets', name);
  if (!doc) throw new Error(`secret "${name}" not in vault — paste it once on the dashboard`);
  return decrypt(doc.blob);
}

module.exports = { putSecret, listSecrets, useSecret, encrypt, decrypt };
