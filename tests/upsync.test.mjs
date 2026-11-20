// Turning Up records into transactions. Run: node tests/upsync.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { planSync, upTxnId } from '../js/upsync.js';

const accounts = { spend: { onBudget: true }, saver: { onBudget: true }, loan: { onBudget: false } };
const payees = {}; const usual = { 'pu-woolworths': 'groc', 'pu-sapol': E.RTA };
const ctx = { now: Date.parse('2026-11-20T02:00:00Z'), payeeId: n => { const id = 'pu-' + n.toLowerCase().replace(/\W+/g, '-'); payees[id] = n; return id; }, transferPayee: a => 'tp-' + a, rename: d => (/^woolworths/i.test(d) ? 'Woolworths' : null),
  usualCategory: (p, amt) => usual[p] || null, onBudget: a => !!accounts[a]?.onBudget, whoFor: i => i.who || ({ 1234: 'Alex' }[i.card] || null), instalment: t => (/afterpay/i.test(payees[t.payeeId] || '') ? { bnpl: { planId: 'P', n: 2 }, categoryId: 'fun' } : null) };
const links = { U1: { accountId: 'spend', from: '2026-11-01' }, U2: { accountId: 'saver', from: '2026-11-01' }, U3: { accountId: 'ignore' } };
const it = (o) => ({ upId: 'X', acct: 'U1', status: 'SETTLED', desc: 'Woolworths 1234 Marion', amt: -4550, created: '2026-11-19T10:00:00+10:30', xfer: null, who: 'Sam', ...o });
const plan = (items, txns = [], heldIds = null) => planSync({ items, txns, links, heldIds, ctx });

// New purchase: Adelaide date, renaming rule, usual category, who, waiting for approval.
let p = plan([it({ upId: 'A', created: '2026-11-30T14:00:00Z' })]);
let t = p.creates[0];
assert.equal(t.id, upTxnId('A')); assert.equal(t.date, '2026-12-01'); assert.equal(t.time, '00:30'); assert.equal(t.payeeId, 'pu-woolworths'); assert.equal(t.categoryId, 'groc');
assert.equal(t.approved, false); assert.equal(t.cleared, 'c'); assert.equal(t.who, 'Sam'); assert.equal(t.importPayee, 'Woolworths 1234 Marion');
// Held is uncleared; who falls back to the card number.
t = plan([it({ upId: 'H', status: 'HELD', who: null, card: '1234' })]).creates[0]; assert.equal(t.cleared, 'u'); assert.equal(t.upStatus, 'HELD'); assert.equal(t.who, 'Alex');
// Ignored accounts and dates before the link's start are left out.
assert.equal(plan([it({ acct: 'U3' }), it({ upId: 'B', created: '2026-10-30T10:00:00+10:30' })]).creates.length, 0);
// Settling with a tip: amount and status update, approval isn't asked for again.
const held = { ...plan([it({ upId: 'T', status: 'HELD', amt: -5000 })]).creates[0], approved: true };
p = plan([it({ upId: 'T', amt: -5750 })], [held]);
assert.deepEqual(p.updates, [{ id: held.id, fields: { upStatus: 'SETTLED', cleared: 'c', amount: -5750 } }]); assert.equal(p.creates.length, 0);
// Running again changes nothing.
assert.deepEqual(plan([it({ upId: 'T', amt: -5750 })], [{ ...held, upStatus: 'SETTLED', cleared: 'c', amount: -5750 }]).updates, []);
// Reconciled stays reconciled; deleted stays deleted.
p = plan([it({ upId: 'T' })], [{ ...held, cleared: 'r', amount: -4550, upStatus: 'HELD' }]); assert.deepEqual(p.updates[0].fields, { upStatus: 'SETTLED' });
assert.equal(plan([it({ upId: 'T' })], [{ ...held, deletedAt: 1 }]).creates.length, 0);
// A hold that settles under a new id joins the old one.
p = plan([it({ upId: 'NEW', desc: 'Cafe', amt: -1210 })], [{ id: 'up-OLD', upId: 'OLD', upStatus: 'HELD', accountId: 'spend', amount: -1100, date: '2026-11-18', importPayee: 'Cafe', cleared: 'u', categoryId: 'fun' }], []);
assert.equal(p.creates.length, 0); assert.deepEqual(p.updates[0].fields, { upId: 'NEW', upStatus: 'SETTLED', cleared: 'c', amount: -1210 });
// Hand-entered and scheduled entries are matched, keeping their payee, category and memo.
const manual = { id: 'm1', accountId: 'spend', amount: -4550, date: '2026-11-17', payeeId: 'pX', categoryId: 'kids', memo: 'swimming', cleared: 'u', source: 'manual' };
p = plan([it({ upId: 'M' })], [manual]);
assert.equal(p.creates.length, 0); assert.equal(p.updates[0].id, 'm1'); assert.equal(p.updates[0].fields.upId, 'M'); assert.equal(p.updates[0].fields.matchedFrom, 'manual'); assert.equal(p.updates[0].fields.payeeId, undefined);
assert.equal(plan([it({ upId: 'M' })], [{ ...manual, scheduledId: 's', source: 'scheduled' }]).updates[0].fields.matchedFrom, 'scheduled');
// Moves between linked 2Up accounts are transfers, paired, approved, with no category.
p = plan([it({ upId: 'O', amt: -20000, desc: 'Transfer to Saver', xfer: 'U2' }), it({ upId: 'I', acct: 'U2', amt: 20000, desc: 'Transfer from Spending', xfer: 'U1' })]);
const o = p.creates.find(x => x.upId === 'O'), i = p.creates.find(x => x.upId === 'I'); assert.equal(o.transferAccountId, 'saver'); assert.equal(i.transferAccountId, 'spend'); assert.equal(o.transferId, i.id); assert.equal(i.transferId, o.id); assert.equal(o.categoryId, undefined); assert.ok(o.approved && i.approved);
// A transfer to an account we don't sync (an individual Up account) is spending, with a payee.
t = plan([it({ upId: 'P', amt: -5000, desc: 'Transfer to Alex', xfer: 'INDIVIDUAL' })]).creates[0]; assert.equal(t.transferAccountId, undefined); assert.equal(t.payeeId, 'pu-transfer-to-alex');
// Interest is income; pays use the payee's history (Ready to Assign); foreign amounts are noted.
assert.equal(plan([it({ upId: 'R', desc: 'Interest', amt: 123 })]).creates[0].categoryId, E.RTA);
assert.equal(plan([it({ upId: 'S', desc: 'SAPOL', amt: 400000 })]).creates[0].categoryId, E.RTA);
assert.equal(plan([it({ upId: 'F', desc: 'Steam', fx: 'USD 12.00', msg: null })]).creates[0].memo, 'USD 12.00 (foreign amount)');
// Round-ups: the purchase plus a separate transfer to the saver that received it.
p = plan([it({ upId: 'Q', amt: -455, ru: -45 }), it({ upId: 'QR', acct: 'U2', amt: 45, desc: 'Round Up', created: '2026-11-19T10:00:05+10:30' })]);
const ru = p.creates.find(x => x.upId === 'Q-ru'), sav = p.creates.find(x => x.upId === 'QR');
assert.equal(ru.amount, -45); assert.equal(ru.transferAccountId, 'saver'); assert.equal(sav.transferAccountId, 'spend'); assert.equal(sav.transferId, ru.id);
// Buy now, pay later instalments link themselves.
t = plan([it({ upId: 'BN', desc: 'Afterpay', amt: -2500 })]).creates[0]; assert.deepEqual(t.bnpl, { planId: 'P', n: 2 }); assert.equal(t.categoryId, 'fun');
// A hold the bank dropped goes back for checking.
p = plan([], [{ id: 'up-G', upId: 'G', upStatus: 'HELD', accountId: 'spend', amount: -900, date: '2026-11-17', approved: true }], []);
assert.deepEqual(p.updates[0].fields, { upStatus: 'GONE', approved: false });
assert.equal(plan([], [{ id: 'up-G', upId: 'G', upStatus: 'HELD', accountId: 'spend', amount: -900, date: '2026-11-17' }], ['G']).updates.length, 0);
console.log('up sync tests passed');
