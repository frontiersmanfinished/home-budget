// Browser test at phone size, on made-up data: import, add, split, transfer, assign, reconcile, delete and undo,
// with a second tab standing in for the other phone. Needs Playwright and Chrome.
// Run: node tests/app.test.cjs   (screenshots go to $SHOTS, default /tmp/hb-shots)
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), SHOTS = process.env.SHOTS || '/tmp/hb-shots'; fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURI(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'text/plain' }); r.end(b); }); }).listen(0);

// A tiny YNAB-shaped export (amounts in milliunits).
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = { chq: id(1), card: id(2), save: id(3) }, G = { needs: id(10), wants: id(11), cc: id(12), int: id(13) }, C = { rta: id(20), groc: id(21), fun: id(22), cc: id(23), kids: id(24) };
const P = { pay: id(30), shop: id(31), cafe: id(32) };
const m0 = new Date().toISOString().slice(0, 7);
const sample = { data: { server_knowledge: 1, plan: {
  id: id(99), name: 'Sample Budget', accounts: [
    { id: A.chq, name: 'Everyday', type: 'checking', on_budget: true, closed: false, deleted: false, balance: 0 },
    { id: A.card, name: 'Card', type: 'creditCard', on_budget: true, closed: false, deleted: false, balance: 0 },
    { id: A.save, name: 'Savings', type: 'savings', on_budget: true, closed: false, deleted: false, balance: 0 }],
  payees: [{ id: P.pay, name: 'Employer', deleted: false }, { id: P.shop, name: 'Grocer', deleted: false }, { id: P.cafe, name: 'Cafe', deleted: false }],
  category_groups: [{ id: G.int, name: 'Internal Master Category', internal: true, deleted: false, hidden: false }, { id: G.cc, name: 'Credit Card Payments', internal: true, deleted: false, hidden: false }, { id: G.needs, name: 'Needs', internal: false, deleted: false, hidden: false }, { id: G.wants, name: 'Wants', internal: false, deleted: false, hidden: false }],
  categories: [{ id: C.rta, category_group_id: G.int, name: 'Inflow: Ready to Assign', deleted: false, hidden: false },
    { id: C.groc, category_group_id: G.needs, name: 'Groceries', deleted: false, hidden: false, goal_type: 'NEED', goal_cadence: 1, goal_cadence_frequency: 1, goal_target: 800000, goal_needs_whole_amount: true },
    { id: C.fun, category_group_id: G.wants, name: 'Fun', deleted: false, hidden: false }, { id: C.kids, category_group_id: G.wants, name: 'Kids Extras', deleted: false, hidden: false },
    { id: C.cc, category_group_id: G.cc, name: 'Card', deleted: false, hidden: false }],
  months: [{ month: m0 + '-01', deleted: false, income: 0, to_be_budgeted: 0, categories: [{ id: C.groc, budgeted: 500000, activity: 0, balance: 0, deleted: false }, { id: C.fun, budgeted: 100000, activity: 0, balance: 0, deleted: false }] }],
  transactions: [
    { id: id(50), date: m0 + '-01', amount: 3000000, account_id: A.chq, payee_id: P.pay, category_id: C.rta, cleared: 'cleared', approved: true, deleted: false },
    { id: id(51), date: m0 + '-02', amount: -120000, account_id: A.chq, payee_id: P.shop, category_id: C.groc, cleared: 'cleared', approved: true, deleted: false },
    { id: id(52), date: m0 + '-03', amount: -15500, account_id: A.card, payee_id: P.cafe, category_id: C.fun, cleared: 'uncleared', approved: false, deleted: false }],
  subtransactions: [], scheduled_transactions: [], scheduled_subtransactions: [],
} } };
const file = path.join(os.tmpdir(), 'hb-sample-export.json'); fs.writeFileSync(file, JSON.stringify(sample));

(async () => {
  const base = `http://localhost:${srv.address().port}/?local`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, timezoneId: 'Australia/Adelaide', serviceWorkers: 'block', acceptDownloads: true });
  const errs = [], watch = p => { p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); return p; };
  const a = watch(await ctx.newPage());
  await a.goto(base); await a.click('#signin'); await a.waitForSelector('.v-welcome');
  const [fc0] = await Promise.all([a.waitForEvent('filechooser'), a.click('[data-start=import]')]); await fc0.setFiles(file); await a.waitForSelector('#imp-go'); await a.click('#imp-go'); await a.waitForTimeout(800);
  const rta = async p => { await p.click('[data-tab=budget]'); await p.waitForTimeout(150); return (await p.textContent('.rta .mid')).trim(); };
  const avail = async (p, cat) => { await rta(p); return (await p.textContent(`[data-cat="${cat}"] .pillv`)).trim(); };
  assert.equal(await rta(a), '$2,400.00'); assert.equal(await avail(a, C.groc), '$380.00'); assert.equal(await avail(a, C.cc), '$15.50');
  await a.screenshot({ path: SHOTS + '/budget.png' });
  const b = watch(await ctx.newPage()); await b.goto(base); await b.waitForSelector('#nav');

  // Add by hand: the payee fills its category; the other phone sees it.
  await a.click('#fab'); await a.fill('#t-amt', '45.50'); await a.fill('#t-payee', 'groc'); await a.click('#t-ac button >> nth=0'); await a.waitForTimeout(100);
  assert.equal((await a.textContent('#t-cat')).trim(), 'Groceries');
  await a.click('#t-save'); await a.waitForTimeout(200);
  assert.equal(await avail(a, C.groc), '$334.50'); await b.waitForTimeout(200); assert.equal(await avail(b, C.groc), '$334.50');
  await a.click('#toast button'); await a.waitForTimeout(200); assert.equal(await avail(a, C.groc), '$380.00'); // undo

  // Split, then transfer (no budget effect), then assign.
  await a.click('#fab'); await a.fill('#t-amt', '100'); await a.fill('#t-payee', 'New Shop'); await a.click('#t-split'); await a.fill('[data-split-amt="0"]', '60'); await a.fill('[data-split-amt="1"]', '40');
  await a.click('[data-split-cat="0"]'); await a.fill('#pk-q', 'groc'); await a.click('.prow >> nth=0'); await a.waitForTimeout(250);
  await a.click('[data-split-cat="1"]'); await a.fill('#pk-q', 'kids'); await a.click('.prow >> nth=0'); await a.waitForTimeout(250);
  await a.click('#t-save'); await a.waitForTimeout(200);
  assert.equal(await avail(a, C.groc), '$320.00'); assert.equal(await avail(a, C.kids), '−$40.00');
  await a.click('#fab'); await a.fill('#t-amt', '500'); await a.fill('#t-payee', 'savings'); await a.click('[data-xfer] >> nth=0'); await a.click('#t-save'); await a.waitForTimeout(200);
  assert.equal(await rta(a), '$2,400.00');
  await a.click(`[data-cat="${C.kids}"]`); await a.fill('#c-asg', '40'); await a.click('#c-asg-save'); await a.waitForTimeout(200);
  assert.equal(await avail(a, C.kids), '$0.00'); assert.equal(await rta(a), '$2,360.00');
  await a.click('[data-assign-under]'); await a.waitForTimeout(200); assert.equal(await avail(a, C.groc), '$620.00'); // groceries target $800 set aside: +$300

  // Approve the card transaction, reconcile Everyday, delete and undo.
  await a.click('[data-tab=accounts]'); await a.click('[data-acct=__approve]'); await a.click('[data-approve-all]'); await a.waitForTimeout(200);
  await a.click('[data-tab=accounts]'); await a.click(`[data-acct="${A.chq}"]`); await a.click('[data-reconcile]'); await a.click('#rc-yes'); await a.waitForTimeout(200);
  assert.equal(await a.locator('.clr.r').count(), 2);
  await a.click('[data-tab=accounts]'); await a.click('[data-acct=__all]'); await a.fill('#reg-q', 'new shop'); await a.waitForTimeout(200);
  await a.click('.tx >> nth=0'); await a.click('#t-del'); await a.waitForTimeout(200); assert.equal(await avail(a, C.groc), '$680.00');
  await a.click('#toast button'); await a.waitForTimeout(200); assert.equal(await avail(a, C.groc), '$620.00');
  assert.equal(await rta(b), await rta(a));

  // Search: terms, suggestions, the ? list, a day at a time, select all.
  await a.click('[data-tab=accounts]'); await a.click('[data-acct=__all]'); await a.fill('#reg-q', '');
  await a.type('#reg-q', 'cat'); await a.waitForTimeout(200); await a.click('#reg-extra [data-q="category:"]');
  await a.type('#reg-q', 'groc'); await a.waitForTimeout(200); await a.click('#reg-extra .pill >> nth=0'); await a.waitForTimeout(200);
  assert.equal(await a.inputValue('#reg-q'), 'category:Groceries ');
  assert.equal(await a.locator('#reg-list .tx').count(), 2);
  await a.fill('#reg-q', `on:02/${m0.slice(5)}/${m0.slice(0, 4)}`); await a.waitForTimeout(250);
  assert.ok((await a.textContent('.daybar')).includes('Cleared that day: −$120.00'));
  await a.click('[data-day="1"]'); await a.waitForTimeout(250); assert.ok((await a.inputValue('#reg-q')).includes(`on:03/${m0.slice(5)}`));
  await a.fill('#reg-q', 'payee:grocer OR payee:cafe'); await a.waitForTimeout(250); assert.equal(await a.locator('#reg-list .tx').count(), 2);
  await a.click('[data-select-all]'); assert.equal((await a.textContent('#selbar b')).trim(), '2'); await a.click('[data-bulk=cancel]');
  await a.click('[data-search-help]'); await a.waitForTimeout(250); assert.ok(await a.locator('.qhelp .qrow').count() > 25);
  await a.screenshot({ path: SHOTS + '/search-help.png' }); await a.click('[data-ex="is:unapproved"]'); await a.waitForTimeout(300);
  assert.equal(await a.inputValue('#reg-q'), 'is:unapproved ');

  // A date typed in part; Afterpay: start a plan, then the next payment links itself.
  await a.click('#fab'); await a.fill('#t-amt', '25'); await a.fill('#t-payee', 'Afterpay'); await a.fill('#t-date-txt', '1'); await a.waitForTimeout(150);
  assert.ok((await a.textContent('#t-date-show')).length > 0);
  await a.click('#t-bnpl-btn'); await a.fill('#bn-shop', 'Anaconda'); await a.fill('#bn-total', '100'); await a.click('#bn-cat'); await a.fill('#pk-q', 'fun'); await a.click('.prow >> nth=0'); await a.waitForTimeout(250);
  await a.click('#bn-start'); await a.waitForTimeout(250);
  assert.ok((await a.textContent('#t-bnpl')).includes('Anaconda (Afterpay 1 of 4)'));
  await a.screenshot({ path: SHOTS + '/bnpl.png' }); await a.click('#t-save'); await a.waitForTimeout(250);
  await a.click('#fab'); await a.fill('#t-amt', '25'); await a.fill('#t-payee', 'Afterpay'); await a.click('#t-save'); await a.waitForTimeout(250);
  await a.click('[data-tab=accounts]'); await a.waitForTimeout(150); assert.ok((await a.textContent('[data-bnpl]')).includes('$50.00'));
  await a.click('[data-acct=__all]'); await a.fill('#reg-q', 'is:bnpl'); await a.waitForTimeout(250);
  assert.deepEqual((await a.locator('#reg-list .tx b').allTextContents()).sort(), ['Anaconda (Afterpay 1 of 4)', 'Anaconda (Afterpay 2 of 4)']);
  await a.click('[data-tab=home]'); await a.screenshot({ path: SHOTS + '/home.png' });

  // Complete reset (backup first, type RESET), then start again with basic categories.
  await a.click('#menu'); await a.click('[data-m=settings]'); await a.click('[data-reset]'); assert.ok(await a.isDisabled('#rs-go'));
  await a.fill('#rs-word', 'RESET'); const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#rs-go')]); assert.ok(dl.suggestedFilename().startsWith('home-budget-before-reset'));
  await a.waitForSelector('.v-welcome'); await b.waitForSelector('.v-welcome');
  await a.click('[data-start=template]'); await a.click('[data-src=basic]'); await a.waitForTimeout(300);
  await a.click('#af-add'); await a.fill('[data-i="0"][data-k="name"]', 'Everyday'); await a.click('#af-go'); await a.waitForTimeout(500);
  assert.equal(await rta(a), '$0.00'); assert.equal(await a.locator('.cat').count(), 17);
  assert.deepEqual(errs, []);
  console.log('app tests passed');
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
