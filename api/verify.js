// VerifyMate API — runs deliverability + active functional verification for a target URL.
// Works as a Vercel serverless function (module.exports = handler) and under the local dev server.
const { runDeliverability } = require('../lib/integrity');
const { runFunctional } = require('../lib/functional');
const { checkFulfilment } = require('../lib/fulfilment');

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  try {
    let url = (req.query && req.query.url) || '';
    if (!url && req.body) { const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; url = b.url; }
    if (!url) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Provide ?url=' })); }
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    const domain = new URL(url).hostname.replace(/^www\./, '');

    const [deliv, func] = await Promise.all([
      runDeliverability([domain], {}).catch(e => ({ error: String(e) })),
      runFunctional(url, {}).catch(e => ({ error: String(e), verdict: 'FAIL', issues: ['engine error: ' + String(e)] })),
    ]);

    // ---- can what's for sale actually be delivered? ----
    const fulfilment = checkFulfilment((func && func.links && func.links.checkout) || []);
    if (fulfilment.issues.length && func && func.issues) func.issues.push(...fulfilment.issues);

    // compose a top-line score
    let score = 100;
    if (func.pageErrors && func.pageErrors.length) score -= 30;
    if (func.issues) score -= Math.min(40, func.issues.length * 8);
    if (deliv && deliv.findings)
      score -= Math.min(20, deliv.findings.length * 5);
    score = Math.max(0, score);
    // A blocked scan has no score to give — never report a pass we didn't earn.
    if (func && func.blocked) score = null;

    res.statusCode = 200;
    if (fulfilment.nothingToSend) score = Math.max(0, score - 25 * fulfilment.nothingToSend);

    res.statusCode = 200;
    res.end(JSON.stringify({ url, domain, score, fulfilment, deliverability: deliv, functional: func, ranAt: new Date ? undefined : undefined }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e) }));
  }
}
module.exports = handler;
module.exports.default = handler;
