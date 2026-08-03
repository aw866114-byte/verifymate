// The first adapter — Stripe, via a RESTRICTED key from the vault
// (secret name: "stripe_restricted"). Create it at dashboard.stripe.com/apikeys
// with ONLY Payment Links + Products + Prices (write) and Charges (read).
// It cannot refund and cannot pay out — the worst outcome is a wrong link,
// never a wrong transfer.

const { useSecret } = require('../vault');

async function stripeFetch(path, method = 'GET', form = null) {
  const key = await useSecret('stripe_restricted');
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// ---- MONEY (stage 16): read-only revenue truth ----
async function revenueSummary(days = 7) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const charges = await stripeFetch(`/charges?limit=100&created[gte]=${since}`);
  const paid = (charges.data || []).filter((c) => c.paid && !c.refunded);
  const total = paid.reduce((s, c) => s + c.amount, 0);
  return {
    days,
    count: paid.length,
    total: (total / 100).toFixed(2),
    currency: paid[0] ? paid[0].currency.toUpperCase() : '—',
    latest: paid.slice(0, 10).map((c) => ({ when: new Date(c.created * 1000).toISOString().slice(0, 10), amount: (c.amount / 100).toFixed(2), currency: c.currency.toUpperCase(), desc: c.description || (c.billing_details && c.billing_details.name) || c.id })),
    summary: `${paid.length} paid charge${paid.length === 1 ? '' : 's'} in ${days}d totalling ${(total / 100).toFixed(2)} ${paid[0] ? paid[0].currency.toUpperCase() : ''}`,
  };
}

// ---- ACT: dry-run + execute, always as a pair ----
const ACTIONS = {
  'stripe.deactivate_link': {
    async dryRun({ link_id }) {
      const link = await stripeFetch('/payment_links/' + link_id);
      return {
        diff: [`− payment link ${link_id} active: true`, `+ payment link ${link_id} active: false`],
        detail: `URL ${link.url} — currently ${link.active ? 'ACTIVE' : 'already inactive'}`,
        rollback: { type: 'stripe.reactivate_link', params: { link_id } },
        blastRadius: '1 payment link; anyone holding the URL sees a deactivated page',
      };
    },
    async execute({ link_id }) {
      const r = await stripeFetch('/payment_links/' + link_id, 'POST', { active: 'false' });
      return { done: true, evidence: `payment link ${link_id} active=${r.active}` };
    },
  },
  'stripe.reactivate_link': {
    async dryRun({ link_id }) {
      const link = await stripeFetch('/payment_links/' + link_id);
      return { diff: [`+ payment link ${link_id} active: true`], detail: `URL ${link.url}`, rollback: { type: 'stripe.deactivate_link', params: { link_id } }, blastRadius: '1 payment link' };
    },
    async execute({ link_id }) {
      const r = await stripeFetch('/payment_links/' + link_id, 'POST', { active: 'true' });
      return { done: true, evidence: `payment link ${link_id} active=${r.active}` };
    },
  },
  'stripe.create_link': {
    async dryRun({ price_id, product_hint }) {
      const price = await stripeFetch('/prices/' + price_id);
      return {
        diff: [`+ new payment link for price ${price_id} (${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()})${product_hint ? ' — ' + product_hint : ''}`],
        detail: 'Creates a link; changes nothing existing.',
        rollback: { type: 'stripe.deactivate_link', params: { link_id: '(the new link id)' } },
        blastRadius: 'additive only',
      };
    },
    async execute({ price_id }) {
      const r = await stripeFetch('/payment_links', 'POST', { 'line_items[0][price]': price_id, 'line_items[0][quantity]': '1' });
      return { done: true, evidence: `created ${r.id} → ${r.url}`, link_id: r.id, url: r.url };
    },
  },
};

module.exports = { revenueSummary, ACTIONS, stripeFetch };
