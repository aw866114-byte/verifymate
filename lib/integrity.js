/*
 * VerifyMate — integrity & deliverability checks.
 *
 * The eyes the base engine lacked. VerifyMate graded "does it work + is it feature-complete",
 * so a checkout that charges the wrong product, a retired-name/brand leak, a stale claim, an
 * OLD file shipping to customers, an orphaned page, or a domain that can't land email all
 * scored ZERO impact — which is exactly how a broken empire dogfooded to 100/100.
 *
 * These checks find those. The engine folds them into the score and CAPS the grade when a
 * critical one fires, so a perfect score is no longer possible while checkout or email is broken.
 * Read-only and safe: never submits, pays, or clicks. DNS pass is a plain public lookup.
 */

const SEV = { CRITICAL: 40, HIGH: 20, MEDIUM: 8, LOW: 3 };

function finding(check, severity, detail, evidence, advice) {
  return { check, severity, detail, evidence: evidence || "", advice: advice || "" };
}

function collectLinks(data) {
  const links = [];
  for (const p of data.pages || []) {
    for (const h of (p.links || [])) links.push({ href: String(h), page: p.url || "", title: p.title || "" });
  }
  return links;
}

const STRIPE_ID_RE = /(?:buy|checkout)\.stripe\.com\/([a-z0-9_]+)/i;
const PLACEHOLDER_RE = /(xxxx+|your-?link-?here|your_link|link-here|\btbd\b|\bpending\b|example\.com|replace-?me|\btodo\b)/i;

// ---- Checkout integrity: the wrong-product / dead-checkout family ----
function checkoutFindings(data) {
  const out = [];
  const links = collectLinks(data);

  for (const l of links) {
    const buyish = /stripe\.com|\/checkout|\/buy|\/pay\b|payment/i.test(l.href) || /buy|checkout|pay now|purchase|subscribe|get now/i.test(l.title);
    if (buyish && PLACEHOLDER_RE.test(l.href)) {
      out.push(finding("checkout.placeholder", "CRITICAL",
        "A buy/checkout link is a placeholder — customers cannot pay.",
        l.href + "  (on " + l.page + ")",
        "Replace with the real Stripe payment link before selling."));
    }
    if (/(buy|checkout|pay now|purchase|subscribe)/i.test(l.title) && (l.href === "#" || /^mailto:/i.test(l.href))) {
      out.push(finding("checkout.dead", "CRITICAL",
        "A buy button points at " + (l.href === "#" ? "'#' (nothing)" : "a mailto: link") + " instead of a checkout.",
        (l.title || "buy") + " -> " + l.href + "  (on " + l.page + ")",
        "Wire it to a real Stripe checkout."));
    }
  }

  // Shared / double-duty payment link — same link on more than one product.
  const byId = {};
  for (const l of links) {
    const m = l.href.match(STRIPE_ID_RE);
    if (!m) continue;
    (byId[m[1]] = byId[m[1]] || []).push(l);
  }
  for (const id of Object.keys(byId)) {
    const uses = byId[id];
    if (uses.length >= 2) {
      const pages = [...new Set(uses.map((u) => u.page))];
      out.push(finding("checkout.shared_link", "HIGH",
        "One Stripe link (" + id.slice(0, 16) + ") is used " + uses.length + " times across " + pages.length + " page(s) — a shared checkout can charge and receipt buyers for the WRONG product. Verify each use is an intentional upsell.",
        pages.slice(0, 4).join("  ;  "),
        "If not a deliberate shared/free-upsell link, create a separate payment link per product."));
    }
  }
  return out;
}

// ---- Copy / brand / file integrity ----
function corpusFindings(data, cfg) {
  const out = [];
  const corpus = String(data.corpus || "");
  const forbidden = (cfg.forbidden || ["andrew walker", "andrew@"]).map((s) => String(s).toLowerCase());
  for (const f of forbidden) {
    if (f && corpus.includes(f)) {
      out.push(finding("naming.leak", "HIGH",
        'Customer-facing copy contains a retired/leaked identity or brand: "' + f + '".',
        "found in the rendered corpus",
        "Remove/replace per the naming rule (AJ / Andy, never Andrew Walker; no personal-brand leaks)."));
    }
  }
  for (const sc of (cfg.staleClaims || [])) {
    const phrase = String(sc.phrase != null ? sc.phrase : sc).toLowerCase();
    if (phrase && corpus.includes(phrase)) {
      out.push(finding("copy.stale", sc.severity || "MEDIUM",
        'Stale/contradictory claim present: "' + (sc.phrase != null ? sc.phrase : sc) + '"' + (sc.reason ? " — " + sc.reason : ""),
        "found in the rendered corpus",
        sc.advice || "Update to the current, correct figure."));
    }
  }
  const OLD_RE = /(_old\b|old[_-]?sales|archived?|_v\d+[_-]complete|\.bak\b|_backup|superseded|deprecated)/i;
  for (const p of (data.pages || [])) {
    if (OLD_RE.test(p.url || "") || OLD_RE.test(p.title || "")) {
      out.push(finding("file.superseded", "MEDIUM",
        "A superseded/OLD/archived file is reachable by customers.",
        p.url || p.title,
        "Remove OLD/ARCHIVED/backup files from what ships to buyers."));
    }
  }
  if (Array.isArray(cfg.sitemap) && cfg.sitemap.length) {
    const linked = new Set();
    for (const p of (data.pages || [])) for (const h of (p.links || [])) {
      try { linked.add(new URL(h, p.url).href.replace(/\/$/, "")); } catch (e) { /* skip */ }
    }
    const orphans = cfg.sitemap.map((u) => String(u).replace(/\/$/, "")).filter((u) => !linked.has(u));
    if (orphans.length) {
      out.push(finding("seo.orphans", "MEDIUM",
        orphans.length + " sitemap URL(s) are linked from nowhere (orphaned pages) — published but unreachable, so they get no internal link equity.",
        orphans.slice(0, 6).join("  ;  "),
        "Link every published page from an index."));
    }
  }
  return out;
}

function scoreFrom(findings) {
  let score = 100;
  for (const f of findings) score -= (SEV[f.severity] || 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function runIntegrity(data, cfg) {
  cfg = cfg || {};
  const findings = [].concat(checkoutFindings(data), corpusFindings(data, cfg));
  const critical = findings.some((f) => f.severity === "CRITICAL");
  return { score: scoreFrom(findings), findings, critical, links: collectLinks(data).length };
}

// ---- Deliverability (live DNS over HTTPS) ----
async function dohQuery(name, type) {
  try {
    const r = await fetch("https://dns.google/resolve?name=" + encodeURIComponent(name) + "&type=" + type, { headers: { accept: "application/dns-json" } });
    if (!r.ok) return { error: "http " + r.status, answers: [] };
    const j = await r.json();
    return { answers: (j.Answer || []).map((a) => a.data) };
  } catch (e) { return { error: String((e && e.message) || e), answers: [] }; }
}

async function domainDeliverability(domain, cfg) {
  const forbidden = (cfg.forbidden || ["andrew@"]).map((s) => String(s).toLowerCase());
  const [dmarc, mx, dkim, sendspf] = await Promise.all([
    dohQuery("_dmarc." + domain, "TXT"),
    dohQuery(domain, "MX"),
    dohQuery("resend._domainkey." + domain, "TXT"),
    dohQuery("send." + domain, "TXT"),
  ]);
  const findings = [];
  const dmarcTxt = (dmarc.answers || []).join(" ");
  const hasDmarc = /dmarc1/i.test(dmarcTxt);
  const parking = /uixie\.porkbun|link-in-bio/i.test(dmarcTxt);
  if (!hasDmarc) {
    findings.push(finding("dns.dmarc_missing", "HIGH",
      "No DMARC record on " + domain + " — Google/Yahoo require it for bulk senders; a mechanical cause of poor inbox placement.",
      dmarcTxt || "(no _dmarc record)",
      "Add TXT _dmarc = v=DMARC1; p=none; rua=mailto:<your inbox>."));
  } else {
    if (!/rua=/i.test(dmarcTxt)) findings.push(finding("dns.dmarc_no_rua", "LOW", "DMARC on " + domain + " has no rua — you get no reports.", dmarcTxt, "Add rua=mailto:<your inbox>."));
    for (const bad of forbidden) if (bad && dmarcTxt.toLowerCase().includes(bad)) findings.push(finding("dns.dmarc_leak", "MEDIUM", "DMARC rua on " + domain + " names a retired identity (" + bad + ").", dmarcTxt, "Point rua at the current inbox."));
  }
  if (parking) findings.push(finding("dns.parking_remnant", "MEDIUM", "_dmarc on " + domain + " resolves to a parking/link-in-bio host — a leftover wildcard shadowing the record.", dmarcTxt, "Remove the wildcard, then add the DMARC TXT."));
  const hasMx = (mx.answers || []).length > 0;
  if (!hasMx) findings.push(finding("dns.no_mx", "MEDIUM", "No root MX on " + domain + " — replies to a From@" + domain + " address bounce.", "(no MX)", "Add MX / email forwarding, or use a deliverable From address."));
  const okSpf = /spf1/i.test((sendspf.answers || []).join(" "));
  const okDkim = ((dkim.answers || []).join("").length > 0);
  return { domain, hasDmarc, hasMx, okSpf, okDkim, parking, findings };
}

async function runDeliverability(domains, cfg) {
  cfg = cfg || {};
  if (!domains || !domains.length) return null;
  const rows = [];
  for (const d of domains) rows.push(await domainDeliverability(d, cfg));
  const findings = [].concat(...rows.map((r) => r.findings));
  return { score: scoreFrom(findings), findings, rows, dmarcMissing: rows.filter((r) => !r.hasDmarc).length };
}

module.exports = { runIntegrity, runDeliverability, SEV };
