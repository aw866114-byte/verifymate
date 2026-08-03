// STAGE 20 — GUARD. Brand locks as executable checks. Run any outgoing text or
// HTML through this BEFORE it ships. A regression gets caught by a machine,
// not by AJ reading his own site at midnight.

const RULES = [
  {
    id: 'name-rule',
    severity: 'block',
    test: (t) => /Andrew\s+Walker/.test(t.replace(/andrew@[a-z.]+/gi, '')),
    message: 'Says "Andrew Walker". The name is AJ Walker or Andy — always. (andrew@ mailboxes are exempt as addresses.)',
  },
  {
    id: 'credential-gate',
    severity: 'block',
    test: (t) => /\b(as a (compliance|AML|fintech) (expert|professional|practitioner)|years? (of|in) (compliance|AML|fintech)|my (compliance|AML|audit) (career|experience))\b/i.test(t),
    message: 'Claims field experience. AJ is the builder; practitioners bring the judgement. "Built from public frameworks, you bring the judgement."',
  },
  {
    id: 'no-fake-urgency',
    severity: 'warn',
    test: (t) => /\b(only \d+ left|offer ends (tonight|today)|last chance|act now|don'?t miss out)\b/i.test(t),
    message: 'Urgency bait. The brand does not do it.',
  },
  {
    id: 'no-fake-social-proof',
    severity: 'block',
    test: (t) => /\b(trusted by (thousands|hundreds)|\d{3,}\+? (happy )?(customers|clients|companies))\b/i.test(t),
    message: 'Social-proof claim that is not measured. One real review (All Care: 9× 5.0) beats an invented thousand.',
  },
  {
    id: 'spam-act-footer',
    severity: 'warn',
    appliesTo: 'outreach',
    test: (t) => !(/unsubscribe/i.test(t) && /ABN/i.test(t)),
    message: 'Outreach without Spam Act sender identification (name, ABN 25 543 370 493, address) + unsubscribe.',
  },
  {
    id: 'no-resend-for-cold',
    severity: 'block',
    appliesTo: 'outreach',
    test: (t) => /resend\.com|api\.resend/i.test(t),
    message: 'Cold outreach referencing Resend. Cold runs on Maildoso only.',
  },
  {
    id: 'tpc-not-saas',
    severity: 'warn',
    test: (t) => /Protocol Collective[^.]{0,120}\bSaaS\b/i.test(t),
    message: 'Calls TPC SaaS. TPC is pay-once, owned forever, sold direct.',
  },
];

/**
 * @param {string} text  content about to ship
 * @param {string} [kind] 'general' | 'outreach'
 */
function guard(text, kind = 'general') {
  const violations = [];
  for (const r of RULES) {
    if (r.appliesTo && r.appliesTo !== kind) continue;
    if (r.test(String(text))) violations.push({ id: r.id, severity: r.severity, message: r.message });
  }
  return {
    pass: !violations.some((v) => v.severity === 'block'),
    violations,
    verdict: violations.length === 0 ? 'CLEAN' : violations.some((v) => v.severity === 'block') ? 'BLOCKED — do not ship' : 'WARN — ship with eyes open',
  };
}

module.exports = { guard, RULES };
