// VerifyMate — active functional tester.
// Opens a URL in a real browser, clicks every button, follows every link one hop
// (including buy/checkout links so it can read the actual product + price a customer
// would be charged), exercises inputs/calculators, and captures every error.
// Safe by design: it NEVER submits payment, signs up, or clicks destructive controls.

const DESTRUCTIVE = /(logout|log-?out|sign-?out|delete|remove|destroy|cancel|unsubscribe|deactivate|close account)/i;
const PAY = /\b(pay|place order|complete (order|purchase)|confirm (and )?pay|subscribe now)\b/i;
const CHECKOUT_HOST = /(buy\.stripe\.com|checkout\.stripe\.com|paypal\.com|gumroad\.com|lemonsqueezy)/i;

// Cross-flavour sleep: puppeteer v22+ removed page.waitForTimeout().
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Launch a browser that works both locally (Playwright chromium) and on Vercel
// (@sparticuz/chromium + puppeteer-core). Returns a Playwright-like page API subset.
async function getBrowser() {
  // Vercel/serverless path
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // puppeteer-core v23+ is ESM-only, so load both via dynamic import (works from CJS).
    const chromiumMod = await import('@sparticuz/chromium');
    const chromium = chromiumMod.default || chromiumMod;
    const puppeteerMod = await import('puppeteer-core');
    const puppeteer = puppeteerMod.default || puppeteerMod;
    const browser = await puppeteer.launch({
      args: [...chromium.args, '--lang=en-AU,en'],
      defaultViewport: { width: 1400, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless === undefined ? true : chromium.headless,
    });
    return { browser, flavour: 'puppeteer' };
  }
  // Local path
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
  });
  return { browser, flavour: 'playwright' };
}

async function runFunctional(url, opts = {}) {
  const maxButtons = opts.maxButtons || 25;
  const maxLinks = opts.maxLinks || 15; const maxCheckouts = opts.maxCheckouts || 24; const deadline = Date.now() + (opts.budgetMs || 240000);
  const report = {
    url, loaded: false, blocked: false, title: '', httpNote: '',
    consoleErrors: [], pageErrors: [], failedRequests: [],
    buttons: { total: 0, clicked: 0, actions: [] },
    links: { total: 0, followed: [], checkout: [] },
    inputs: { total: 0, exercised: false, domReacted: null },
    screenshotBase64: null, verdict: 'unknown', issues: [],
  };
  const { browser, flavour } = await getBrowser();
  try {
    const ctx = flavour === 'playwright'
      ? await browser.newContext({ viewport: { width: 1200, height: 900 } })
      : browser;
    const page = flavour === 'playwright' ? await ctx.newPage() : (await browser.newPage());
    if (flavour === 'puppeteer') {
      await page.setViewport({ width: 1400, height: 900 });
      // Identify honestly. If a WAF blocks us we say so — we do not disguise the scanner.
      await page.setUserAgent('Mozilla/5.0 (compatible; VerifyMate/1.0; +https://verifymate.vercel.app) ' +
        'HeadlessChrome/143.0.0.0');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-AU,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
      });
    }

    page.on('console', m => { const t = m.type ? m.type() : m._type; if (t === 'error') report.consoleErrors.push(String(m.text ? m.text() : m).slice(0, 240)); });
    page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 240)));
    page.on('requestfailed', r => {
      try { const u = (r.url && r.url()) || ''; const f = (r.failure && r.failure()) || {}; report.failedRequests.push((u + ' :: ' + (f.errorText || 'failed')).slice(0, 200)); } catch {}
    });

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    report.loaded = true;
    if (resp && resp.status) report.httpNote = 'HTTP ' + resp.status();
    await sleep(600);
    report.title = await page.title();

    // ---- bot / WAF challenge detection -------------------------------------
    // A Cloudflare (or Akamai/Incapsula) interstitial returns HTTP 200 with a real
    // DOM, so every check below would "pass" while never seeing the actual site.
    // Detect it and bail out honestly instead of reporting a false clean bill.
    const chall = await page.evaluate(() => {
      const t = document.title || '';
      const b = (document.body ? document.body.innerText : '').slice(0, 4000);
      const h = (document.documentElement ? document.documentElement.outerHTML : '').slice(0, 30000);
      const marks = [
        /just a moment/i,
        /checking your browser/i,
        /verify(ing)? (that )?you are (a )?human/i,
        /enable javascript and cookies to continue/i,
        /attention required!?\s*\|\s*cloudflare/i,
        /ddos protection by cloudflare/i,
        /pardon our interruption/i,
        /request unsuccessful[\s\S]{0,80}incapsula/i,
        /__cf_chl|cf-browser-verification|challenge-platform|cf-turnstile/i,
      ];
      const hit = marks.find(r => r.test(t) || r.test(b) || r.test(h));
      return hit ? { blocked: true, marker: String(hit) } : { blocked: false };
    }).catch(() => ({ blocked: false }));

    if (chall.blocked) {
      // Interstitials usually clear themselves — give it one honest chance before giving up.
      await sleep(6000);
      const recheck = await page.evaluate(() => /just a moment|checking your browser|verify you are/i
        .test(document.title + ' ' + (document.body ? document.body.innerText.slice(0, 800) : ''))).catch(() => true);
      if (!recheck) { chall.blocked = false; report.title = await page.title(); }
    }
    if (chall.blocked) {
      report.blocked = true;
      report.verdict = 'BLOCKED';
      report.issues.push(
        'Blocked by a bot/WAF challenge' + (report.title ? ' ("' + report.title + '")' : '') +
        ' — the scan never reached the real page, so NOTHING below was actually tested. ' +
        'Run VerifyMate from a trusted IP (the local CLI), or allow-list the scanner in Cloudflare.'
      );
      try { const b0 = await page.screenshot({ fullPage: false }); report.screenshotBase64 = Buffer.from(b0).toString('base64'); } catch {}
      await page.close();
      return report;
    }


    // ---- inventory ----
    const inv = await page.evaluate(() => {
      const q = s => Array.from(document.querySelectorAll(s));
      const btns = q('button, input[type=button], input[type=submit], [role=button], a.btn, a[class*="buy"], a[class*="cta"]');
      const links = q('a[href]');
      return {
        inputs: q('input, textarea, select').filter(e => !['hidden'].includes(e.type)).length,
        buttonTexts: btns.map(b => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 60),
        linkList: links.map(a => ({ text: (a.innerText || '').trim().slice(0, 60), href: a.href })).filter(l => l.href && !l.href.startsWith('javascript')).slice(0, 120),
      };
    });
    report.inputs.total = inv.inputs;
    report.buttons.total = inv.buttonTexts.length;
    report.links.total = inv.linkList.length;

    // ---- exercise inputs (fill, watch DOM react = calculator/live form works) ----
    if (inv.inputs > 0) {
      const before = await page.evaluate(() => document.body.innerText);
      await page.evaluate(() => {
        document.querySelectorAll('input[type=number]').forEach((el, i) => { el.value = String(100 * (i + 1)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
        document.querySelectorAll('input[type=text], input:not([type]), textarea').forEach(el => { el.value = 'VerifyMate test'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
        document.querySelectorAll('input[type=range]').forEach(el => { el.value = el.max || '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      });
      await sleep(300);
      const after = await page.evaluate(() => document.body.innerText);
      report.inputs.exercised = true;
      report.inputs.domReacted = after !== before;
    }

    // ---- click buttons: test each from a FRESH page load so a prior toggle/filter can't
    // pollute the next button's result. Dialogs (print/alert/confirm) are auto-dismissed
    // so they can't block. This gives an accurate per-button verdict.
    if (flavour === 'playwright') page.on('dialog', d => d.dismiss().catch(() => {}));
    const BTN_SEL = 'button, input[type=button], [role=button]';
    const labels = await page.$$eval(BTN_SEL, els => els.map(el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
    const nBtns = Math.min(labels.length, maxButtons);
    for (let i = 0; i < nBtns; i++) {
      const label = labels[i] || '(unlabelled)';
      if (PAY.test(label) || DESTRUCTIVE.test(label)) { report.buttons.actions.push({ label: label.slice(0, 50), result: 'skipped (pay/destructive — safe)' }); continue; }
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const handles = await page.$$(BTN_SEL);
        const h = handles[i]; if (!h) { report.buttons.actions.push({ label: label.slice(0, 50), result: 'not found on reload' }); continue; }
        const urlBefore = page.url();
        const htmlBefore = await page.evaluate(() => document.body.innerHTML.length);
        const box = await h.boundingBox().catch(() => null);
        const reachable = box && box.height > 2 && box.width > 2;
        let result, fired = false;
        if (reachable) {
          try { await h.click({ timeout: 2000 }); fired = true; }
          catch { /* fall through to handler test */ }
        }
        if (!fired) {
          // collapsed/hidden in default view — fire the button's own handler to test it still works
          await h.evaluate(el => el.click()).catch(() => {});
        }
        await sleep(200);
        const urlAfter = page.url();
        const htmlAfter = await page.evaluate(() => document.body.innerHTML.length).catch(() => htmlBefore);
        const changed = urlAfter !== urlBefore || Math.abs(htmlAfter - htmlBefore) > 30;
        if (urlAfter !== urlBefore) result = 'navigated → ' + urlAfter;
        else if (changed) result = reachable ? 'works — updated the page' : 'works — action fires (collapsed in default view)';
        else result = reachable ? 'clicked — no visible change' : 'collapsed in default view (expand to use)';
        report.buttons.clicked++;
        report.buttons.actions.push({ label: label.slice(0, 50), result });
      } catch (e) {
        report.buttons.actions.push({ label: label.slice(0, 50), result: 'could not click: ' + String(e).slice(0, 45) });
      }
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

    // ---- follow links one hop; if a link goes to a checkout host, read product + price ----
    const seen = new Set();
    for (const l of inv.linkList) {
      if (Date.now() > deadline) { report.issues.push('Stopped early - time budget reached, so some links were not checked.'); break; } if (CHECKOUT_HOST.test(l.href) ? report.links.checkout.length >= maxCheckouts : report.links.followed.length >= maxLinks) continue;
      if (seen.has(l.href)) continue; seen.add(l.href);
      const isCheckout = CHECKOUT_HOST.test(l.href);
      if (!isCheckout && (l.href.startsWith('mailto:') || l.href.startsWith('tel:'))) { report.links.followed.push({ text: l.text, href: l.href, status: 'mailto/tel (ok)' }); continue; }
      try {
        const p2 = flavour === 'playwright' ? await ctx.newPage() : await browser.newPage();
        const r2 = await p2.goto(l.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const status = r2 && r2.status ? r2.status() : 0;
        if (isCheckout) {
          // Wait for Stripe's app to actually render the line item. A fixed sleep read some
          // pages before the product existed and fell back to the merchant name and a blank price.
          for (let w = 0; w < 20; w++) { const ready = await p2.evaluate((sel) => !!document.querySelector(sel), '[data-testid="product-summary-name"], [class*="ProductSummary-name"], [class*="LineItem-productName"]').catch(() => false); if (ready) break; await sleep(250); }
          await sleep(200);
          const cd = await p2.evaluate(() => {
            const txt = document.body.innerText;
            const price = (txt.match(/(US\$|A\$|\$|USD|AUD)\s?[0-9][0-9,]*(\.[0-9]{2})?/) || [])[0] || '';
            const h = document.querySelector('[data-testid="product-summary-name"]') || document.querySelector('[class*="ProductSummary-name"]') || document.querySelector('[class*="LineItem-productName"]') || document.querySelector('h1'); // priority order: querySelector with a comma-list returns the first match in DOCUMENT order, and on Stripe the h1 is the MERCHANT name, so it always beat the product
            return { product: (h ? h.innerText : document.title || '').trim().slice(0, 120), price };
          });
          report.links.checkout.push({ text: l.text, href: l.href, product: cd.product, price: cd.price, status });
        } else {
          const bad = status >= 400;
          report.links.followed.push({ text: l.text.slice(0, 40), href: l.href, status: bad ? 'DEAD (HTTP ' + status + ')' : 'ok (' + status + ')' });
          if (bad) report.issues.push('Dead link: ' + l.href + ' (HTTP ' + status + ')');
        }
        await p2.close();
      } catch (e) {
        report.links.followed.push({ text: l.text.slice(0, 40), href: l.href, status: 'unreachable' });
      }
    }

    // ---- screenshot ----
    const buf = await page.screenshot({ fullPage: false });
    report.screenshotBase64 = Buffer.from(buf).toString('base64');

    // ---- verdict ----
    if (report.pageErrors.length) report.issues.unshift(report.pageErrors.length + ' uncaught JavaScript error(s)');
    if (report.inputs.total > 0 && report.inputs.domReacted === false && report.buttons.clicked === 0)
      report.issues.push('Has inputs but nothing reacted — interactive features may be broken');
    report.verdict = report.issues.length === 0 ? 'PASS' : (report.pageErrors.length ? 'FAIL' : 'WARN');
    await page.close();
  } catch (e) {
    report.issues.push('Could not load/test: ' + String(e).slice(0, 160));
    report.verdict = 'FAIL';
  } finally {
    try { await browser.close(); } catch {}
  }
  return report;
}

module.exports = { runFunctional };
