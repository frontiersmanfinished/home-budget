// Search terms and partial dates. Run: node tests/search.test.mjs
import assert from 'node:assert/strict';
import * as Q from '../js/search.js';
const T = '2026-11-20';
// Dates
assert.equal(Q.parseDate('19', T), '2026-11-19'); assert.equal(Q.parseDate('19/10', T), '2026-10-19'); assert.equal(Q.parseDate('19/10/25', T), '2025-10-19');
assert.equal(Q.parseDate('yesterday', T), '2026-11-19'); assert.equal(Q.parseDate('31/11', T), null); assert.equal(Q.parseDate('abc', T), null);
assert.deepEqual(Q.dateChoices('25', T), ['2026-11-25', '2026-10-25']); // still ahead this month: last month offered too
assert.deepEqual(Q.dateChoices('5', T), ['2026-11-05']);
assert.deepEqual(Q.dateChoices('31', T), ['2026-10-31']); // no 31 November
assert.deepEqual(Q.dateChoices('25/12', T), ['2026-12-25', '2025-12-25']);
// Transactions to search
const names = { p1: 'Foodland', p2: 'Coles', p3: 'Blue Dolphin Swim Centre' }, cats = { c1: 'Groceries & Household', c2: 'Kids Extras', rta: 'Ready to Assign' }, accts = { a1: '2UP - Essentials', a2: 'PCU - Credit Card', a3: 'Month Ahead Savings' }, flags = { f1: 'Reimburse', f2: 'Tax – Sam' };
const ctx = { payee: id => names[id] || '', category: id => cats[id] || '', account: id => accts[id] || '', flag: id => flags[id] || '', who: t => t.who || '', onBudget: () => true, bnpl: t => (t.bnpl ? 'Anaconda (Afterpay 2 of 4)' : '') };
const tx = [
  { id: 'x1', date: '2026-11-19', amount: -2799, payeeId: 'p1', categoryId: 'c1', accountId: 'a1', cleared: 'c', memo: 'lunch', who: 'Alex' },
  { id: 'x2', date: '2026-11-18', amount: -15000, payeeId: 'p2', categoryId: 'c1', accountId: 'a2', cleared: 'u', flags: ['f1', 'f2'] },
  { id: 'x3', date: '2026-11-01', amount: -6300, payeeId: 'p3', categoryId: 'c2', accountId: 'a1', cleared: 'r', memo: 'Percy swimming lesson', approved: false },
  { id: 'x4', date: '2026-10-30', amount: 500000, payeeId: null, categoryId: 'rta', accountId: 'a1', cleared: 'r' },
  { id: 'x5', date: '2026-11-02', amount: -20000, payeeId: null, categoryId: null, transferAccountId: 'a3', accountId: 'a1', cleared: 'c' },
  { id: 'x6', date: '2026-11-03', amount: -3000, payeeId: 'p1', categoryId: null, accountId: 'a1', cleared: 'u', splits: [{ amount: -1000, categoryId: 'c1' }, { amount: -2000, categoryId: 'c2', memo: 'treat' }] },
  { id: 'x7', date: '2026-11-04', amount: -4999, payeeId: null, categoryId: 'c2', accountId: 'a1', cleared: 'u', bnpl: { planId: 'b', n: 2 } },
];
const find = q => tx.filter(Q.matcher(q, ctx, T)).map(t => t.id).join(',');
assert.equal(find('foodland'), 'x1,x6');
assert.equal(find('payee:Foodland'), 'x1,x6'); assert.equal(find('category:groceries'), 'x1,x2,x6'); assert.equal(find('category:"kids extras"'), 'x3,x6,x7');
assert.equal(find('memo:lunch'), 'x1'); assert.equal(find('memo:treat'), 'x6'); assert.equal(find('account:essentials'), 'x1,x3,x4,x5,x6,x7');
assert.equal(find('flag:reimburse'), 'x2'); assert.equal(find('flag:tax is:unreconciled'), 'x2'); assert.equal(find('who:alex'), 'x1');
assert.equal(find('27.99'), 'x1'); assert.equal(find('$150'), 'x2'); assert.equal(find('>100'), 'x2,x4,x5'); assert.equal(find('<30'), 'x1'); assert.equal(find('<=30'), 'x1,x6');
assert.equal(find('on:19/11/2026'), 'x1'); assert.equal(find('on:yesterday'), 'x1'); assert.equal(find('before:01/11/2026'), 'x4'); assert.equal(find('after:18/11/2026'), 'x1');
assert.equal(find('between:01/11/2026..02/11/2026'), 'x3,x5'); assert.equal(find('month:10/2026'), 'x4');
assert.equal(find('is:uncleared'), 'x2,x6,x7'); assert.equal(find('is:cleared-or-reconciled'), 'x1,x3,x4,x5'); assert.equal(find('is:unapproved'), 'x3');
assert.equal(find('is:split'), 'x6'); assert.equal(find('is:transfer'), 'x5'); assert.equal(find('is:income'), 'x4'); assert.equal(find('is:bnpl'), 'x7'); assert.equal(find('afterpay'), 'x7');
assert.equal(find('payee:Foodland OR payee:Coles'), 'x1,x2,x6'); assert.equal(find('category:groceries -is:split'), 'x1,x2'); assert.equal(find('"swimming lesson"'), 'x3');
assert.equal(find('has:memo'), 'x1,x3,x6'); assert.equal(Q.parse('on:19 payee:x', T).on, '2026-11-19'); assert.deepEqual(Q.parse('is:nonsense', T).bad, ['is:nonsense']);
// Suggestions and day stepping
assert.equal(Q.suggest('cat', {})[0].text, 'category:'); assert.equal(Q.suggest('is:unr', {})[0].text, 'is:unreconciled ');
assert.equal(Q.suggest('category:kid', { category: ['Kids Extras'] })[0].text, 'category:"Kids Extras" ');
assert.equal(Q.withOn('account:x on:19/11/2026', '2026-11-18'), 'account:x on:18/11/2026');
console.log('search tests passed');
