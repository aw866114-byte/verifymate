// VerifyMate — auth. Every operator route requires this from its first line.
// Fail closed: no VERIFYMATE_AGENT_KEY set means NOTHING authenticates.
// The public product demo (/api/verify) is the only deliberate exception.

const crypto = require('crypto');

/** Constant-time string compare. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Require a valid agent key (or, when allowCron is true, the Vercel CRON_SECRET).
 * Returns true when authorised; otherwise writes the 401 and returns false.
 * @param {import('http').IncomingMessage & {headers: any}} req
 * @param {import('http').ServerResponse} res
 * @param {{allowCron?: boolean}} [opts]
 */
function requireAgent(req, res, opts = {}) {
  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const agentKey = process.env.VERIFYMATE_AGENT_KEY || '';
  const cronSecret = process.env.CRON_SECRET || '';

  let ok = false;
  if (token && agentKey && safeEqual(token, agentKey)) ok = true;
  if (!ok && opts.allowCron && token && cronSecret && safeEqual(token, cronSecret)) ok = true;

  if (!ok) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: false,
      error: agentKey
        ? 'Unauthorised. Send Authorization: Bearer <VERIFYMATE_AGENT_KEY>.'
        : 'Locked. VERIFYMATE_AGENT_KEY is not set in Vercel, so every operator route refuses. Set it, redeploy, retry.',
    }));
    return false;
  }
  return true;
}

module.exports = { requireAgent, safeEqual };
