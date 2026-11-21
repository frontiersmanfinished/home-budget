// Budget maths on made-up data. Run: node tests/engine.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

// Money and dates
assert.equal(E.parseMoney('$1,234.50'), 123450); assert.equal(E.parseMoney('-3'), -300); assert.equal(E.parseMoney('(12.34)'), -1234); assert.equal(E.parseMoney('abc'), null); assert.equal(E.parseMoney('0.1'), 10);
assert.equal(E.fmt(-123456), '−$1,234.56'); assert.equal(E.fmt(500, { sign: true }), '+$5.00');
assert.equal(E.localDateTime('2026-11-30T14:00:00Z').date, '2026-12-01'); // 12:30 am in Adelaide: next month, not UTC's
assert.equal(E.localDateTime('2026-06-30T14:00:00Z').date, '2026-06-30'); // winter: UTC+9:30
assert.equal(E.addMonths('2026-11', 3), '2027-02'); assert.equal(E.addMonths('2026-01', -1), '2025-12'); assert.equal(E.monthDiff('2026-11', '2027-02'), 3);
assert.equal(E.addMonthsToDate('2026-01-31', 1), '2026-02-28'); assert.equal(E.nextDate('2026-11-20', 'everyOtherWeek'), '2026-12-04'); assert.equal(E.nextDate('2026-11-20', 'yearly'), '2027-11-20');
assert.deepEqual(E.occurrences({ next: '2026-11-25', freq: 'weekly' }, '2026-12-10'), ['2026-11-25', '2026-12-02', '2026-12-09']);

// A small household
const accounts = [
  { id: 'chq', name: 'Everyday', type: 'checking', onBudget: true },
  { id: 'card', name: 'Card', type: 'credit', onBudget: true },
  { id: 'loan', name: 'Home loan', type: 'loan', onBudget: false },
];
const categories = [
  { id: 'groc', groupId: 'g1', name: 'Groceries', order: 0 },
  { id: 'fun', groupId: 'g1', name: 'Fun', order: 1 },
  { id: 'mort', groupId: 'g1', name: 'Mortgage', order: 2 },
  { id: 'cc', groupId: 'gcc', name: 'Card', kind: 'cc', accountId: 'card' },
];
let n = 0; const tx = (date, accountId, amount, categoryId, extra = {}) => ({ id: 't' + n++, date, accountId, amount, categoryId, cleared: 'c', ...extra });

// Income, assigning, rollover
let txns = [tx('2026-09-01', 'chq', 500000, E.RTA), tx('2026-09-10', 'chq', -30000, 'groc')];
let assigned = { '2026-09': { groc: 40000, fun: 10000 } };
let b = E.computeBudget({ accounts, categories, assigned, txns }, { through: '2026-11' });
assert.equal(b.months['2026-09'].cats.groc.available, 10000);
assert.equal(b.months['2026-10'].cats.groc.carried, 10000); assert.equal(b.months['2026-10'].cats.fun.available, 10000);
assert.equal(E.readyToAssign(b, '2026-09'), 450000);

// Cash overspending: the category resets next month and Ready to Assign pays for it
txns.push(tx('2026-10-05', 'chq', -25000, 'groc'));
b = E.computeBudget({ accounts, categories, assigned, txns }, { through: '2026-11' });
assert.equal(b.months['2026-10'].cats.groc.available, -15000); assert.equal(b.months['2026-10'].cats.groc.cashOver, 15000);
assert.equal(b.months['2026-11'].cats.groc.carried, 0); assert.equal(E.readyToAssign(b, '2026-11'), 435000);

// Card spending that's covered moves money to the card payment category
txns.push(tx('2026-11-02', 'card', -4000, 'fun'));
b = E.computeBudget({ accounts, categories, assigned, txns }, { through: '2026-12' });
assert.equal(b.months['2026-11'].cats.fun.available, 6000); assert.equal(b.months['2026-11'].cats.cc.available, 4000);
// Credit overspending becomes debt: it doesn't come out of Ready to Assign
txns.push(tx('2026-11-03', 'card', -9000, 'fun'));
b = E.computeBudget({ accounts, categories, assigned, txns }, { through: '2026-12' });
assert.equal(b.months['2026-11'].cats.fun.creditOver, 3000); assert.equal(b.months['2026-11'].cats.fun.cashOver, 0);
assert.equal(b.months['2026-11'].cats.cc.available, 10000); assert.equal(E.readyToAssign(b, '2026-12'), 435000);
// Paying the card from the bank uses the payment category
txns.push(tx('2026-11-20', 'chq', -10000, null, { transferAccountId: 'card' }), tx('2026-11-20', 'card', 10000, null, { transferAccountId: 'chq' }));
b = E.computeBudget({ accounts, categories, assigned, txns }, { through: '2026-12' });
assert.equal(b.months['2026-11'].cats.cc.available, 0); assert.equal(b.months['2026-11'].cats.cc.activity, 0);
// A cash advance lands in Ready to Assign; Ready to Assign lines on the card are left out
txns.push(tx('2026-11-21', 'card', -5000, null, { transferAccountId: 'chq' }), tx('2026-11-21', 'chq', 5000, null, { transferAccountId: 'card' }), tx('2026-11-30', 'card', -123, E.RTA));
b = E.computeBudget({ accounts, categories, assigned, txns }, { through: '2026-12' });
assert.equal(E.readyToAssign(b, '2026-12'), 440000);
// Transfers to a tracking account need a category, like spending
txns.push(tx('2026-11-25', 'chq', -200000, 'mort', { transferAccountId: 'loan' }));
b = E.computeBudget({ accounts, categories, assigned: { ...assigned, '2026-11': { mort: 200000 } }, txns }, { through: '2026-12' });
assert.equal(b.months['2026-11'].cats.mort.available, 0); assert.equal(E.readyToAssign(b, '2026-12'), 240000);
// Splits
const split = tx('2026-12-01', 'chq', -5000, null, { splits: [{ amount: -3000, categoryId: 'groc' }, { amount: -2000, categoryId: 'fun' }] });
b = E.computeBudget({ accounts, categories, assigned, txns: [...txns, split] }, { through: '2026-12' });
assert.equal(b.months['2026-12'].cats.groc.activity, -3000); assert.equal(b.months['2026-12'].cats.fun.activity, -2000);
// Later months' assignments come out of what's ready now
b = E.computeBudget({ accounts, categories, assigned: { ...assigned, '2027-01': { groc: 1000 } }, txns }, { through: '2027-01' });
assert.equal(E.readyToAssign(b, '2026-12'), 239000); // includes November's $2,000 mortgage overspend

// Balances
const bal = E.accountBalances(accounts, [tx('2026-11-01', 'chq', 1000, E.RTA), tx('2026-11-02', 'chq', -300, 'groc', { cleared: 'u' })]);
assert.deepEqual(bal.chq, { working: 700, cleared: 1000, uncleared: -300 });

// Targets
const st = (carried, asg) => ({ carried, assigned: asg, activity: 0, available: carried + asg });
assert.equal(E.targetFor({ target: { type: 'need', amount: 50000, every: 'month' } }, '2026-11', st(20000, 10000)).under, 40000); // set aside another
assert.equal(E.targetFor({ target: { type: 'need', amount: 50000, every: 'month', refill: true } }, '2026-11', st(20000, 10000)).under, 20000); // refill up to
assert.equal(E.targetFor({ target: { type: 'need', amount: 10000, every: 'week', weekday: 1 } }, '2026-11', st(0, 0)).need, 50000); // five Mondays in Nov 2026
assert.equal(E.targetFor({ target: { type: 'need', amount: 120000, every: 'year', due: '2027-04-30' } }, '2026-11', st(0, 0)).need, 20000); // rego over six months
assert.equal(E.targetFor({ target: { type: 'balance', amount: 100000 } }, '2026-11', st(30000, 0)).under, 70000);
assert.equal(E.targetFor({ target: { type: 'monthly', amount: 25000 } }, '2026-11', st(90000, 5000)).under, 20000);
const cats2 = [{ id: 'a', groupId: 'g', order: 0, target: { type: 'need', amount: 30000, every: 'month' } }, { id: 'b', groupId: 'g', order: 1, target: { type: 'need', amount: 30000, every: 'month' } }];
assert.deepEqual(E.assignUnderfunded(cats2, [{ id: 'g', order: 0 }], { months: {} }, '2026-11', 45000), { a: 30000, b: 15000 });

// Matching a bank record to a hand-entered one
const manual = [{ id: 'm1', accountId: 'chq', amount: -4550, date: '2026-11-18', cleared: 'u' }, { id: 'm2', accountId: 'chq', amount: -4550, date: '2026-11-10', cleared: 'u' }];
assert.equal(E.findMatch({ accountId: 'chq', amount: -4550, date: '2026-11-19' }, manual).id, 'm1');
assert.equal(E.findMatch({ accountId: 'chq', amount: -4551, date: '2026-11-19' }, manual), null);
assert.equal(E.findMatch({ accountId: 'chq', amount: -4550, date: '2026-12-19' }, manual), null);
assert.equal(E.findMatch({ accountId: 'chq', amount: -999, date: '2026-11-18' }, [{ id: 'y', accountId: 'chq', amount: -999, date: '2026-11-17', cleared: 'c', importId: 'YNAB:-999:2026-11-17:1', source: 'ynab' }]).id, 'y'); // imported into YNAB from a file
assert.equal(E.findMatch({ accountId: 'chq', amount: -999, date: '2026-11-18' }, [{ id: 'z', accountId: 'chq', amount: -999, date: '2026-11-17', cleared: 'c', upId: 'U9' }]), null); // already from Up

// Lifestyle creep
const spend = { '2026-01': { fun: 100 }, '2026-02': { fun: 100 }, '2026-03': { fun: 100 }, '2026-04': { fun: 100 }, '2026-05': { fun: 100 }, '2026-06': { fun: 100 }, '2026-07': { fun: 100 }, '2026-08': { fun: 100 }, '2026-09': { fun: 100 }, '2026-10': { fun: 400 } };
assert.equal(E.creepAlerts([{ id: 'fun' }], spend, '2026-11')[0].id, 'fun');
console.log('engine tests passed');
