// VerifyMate — DELIVERABILITY OF THE PRODUCT ITSELF.
//
// A working button is only half the question. The other half is: if someone
// actually pays, is there something to send them?
//
// This takes the checkout links VerifyMate found on the live page and answers
// that, without ever paying: every Stripe payment link is looked up against the
// fulfilment inventory, and each one comes back as READY (a real file exists and
// this is what they'd receive) or NOTHING TO SEND (you'd take the money with
// nothing staged).

const MAP = require('./fulfilment-map.json');

const byLink = MAP.map || {};
const unmapped = new Set((MAP.unmapped || []).map(u => u.stripe_link_id));

function linkId(href) {
  const m = /buy\.stripe\.com\/([A-Za-z0-9]+)/.exec(href || '');
  return m ? m[1] : null;
}

/**
 * @param {Array<{text?:string, href:string, product?:string, price?:string}>} checkoutLinks
 * @returns {{checked:number, ready:number, nothingToSend:number, unknown:number, rows:Array, issues:Array<string>}}
 */
function checkFulfilment(checkoutLinks = []) {
  const out = { checked: 0, ready: 0, nothingToSend: 0, unknown: 0, rows: [], issues: [] };
  const seen = new Set();

  for (const l of checkoutLinks) {
    const id = linkId(l.href);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.checked++;

    const entry = byLink[id];
    if (entry) {
      const files = entry.files || [];
      if (files.length) {
        out.ready++;
        out.rows.push({
          button: l.text || entry.product,
          product: entry.product,
          price: entry.price_usd ? '$' + entry.price_usd : '',
          status: 'READY',
          detail: files.length === 1
            ? files[0]
            : `${files.length} files (${Math.round((entry.bytes || 0) / 1024)} KB)`,
          folder: entry.folder,
        });
      } else {
        out.nothingToSend++;
        out.issues.push(`"${entry.product}" is buyable but its fulfilment folder is empty — a buyer gets nothing.`);
        out.rows.push({ button: l.text || entry.product, product: entry.product,
          price: entry.price_usd ? '$' + entry.price_usd : '', status: 'NOTHING TO SEND',
          detail: 'folder is empty', folder: entry.folder });
      }
    } else if (unmapped.has(id)) {
      out.nothingToSend++;
      const u = (MAP.unmapped || []).find(x => x.stripe_link_id === id) || {};
      out.issues.push(`"${u.product || l.text}" takes payment but has no fulfilment folder — nothing is staged to send.`);
      out.rows.push({ button: l.text || u.product, product: u.product || '(unknown)',
        price: u.price_usd ? '$' + u.price_usd : '', status: 'NOTHING TO SEND',
        detail: 'no fulfilment folder', folder: '—' });
    } else {
      out.unknown++;
      out.rows.push({ button: l.text || '(button)', product: '(not in inventory)', price: '',
        status: 'UNKNOWN', detail: 'link ' + id + ' not in the fulfilment map', folder: '—' });
    }
  }
  return out;
}

module.exports = { checkFulfilment, inventorySize: Object.keys(byLink).length };
