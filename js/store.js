// Live budget data, and every change the app can make to it.
// Storage: completed months are one record each (all their transactions in a map keyed by id), so a new phone
// loads about 80 records instead of 10,000+. The current and previous month stay as individual transactions.
import * as E from './engine.js';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 20);
/** Drop empty fields so stored records stay small. */
export const compact = o => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? undefined : v)));
const clean = o => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));
const noId = ({ id, ...rest }) => rest;
const TXN_FIELDS = ['date', 'time', 'amount', 'accountId', 'payeeId', 'categoryId', 'memo', 'cleared', 'approved', 'flags', 'splits', 'transferAccountId', 'transferId', 'importId', 'importPayee', 'upId', 'upStatus', 'who', 'bnpl', 'receipt', 'matchedFrom', 'source', 'createdBy', 'createdAt', 'updatedAt', 'updatedBy', 'deletedAt', 'scheduledId'];
const txnData = t => { const o = {}; for (const k of TXN_FIELDS) if (t[k] !== undefined) o[k] = t[k]; if (o.approved === true) delete o.approved; return compact(o); };

export const DEFAULT_FLAGS = [{ id: 'f-reimburse', name: 'Reimburse', color: 'orange' }, { id: 'f-follow-up', name: 'Follow up', color: 'yellow' }];
// Each person in Settings → People gets a tax flag of their own.
const taxFlags = () => (S.config.people || []).filter(p => p.name).map((p, i) => ({ id: `f-tax-${p.id}`, name: `Tax – ${p.name}`, color: ['blue', 'purple', 'green'][i % 3] }));
export const S = {
  phase: 'loading', user: null, config: {}, accounts: [], groups: [], categories: [], payees: {}, scheduled: [], assigned: {}, open: [], months: {}, audit: [], bnpl: [],
  online: navigator.onLine, pending: false, synced: {}, error: null, v: 0,
};
let api, listeners = [], changed = () => {};
export const onChange = fn => { changed = fn; };
let queued = false;
const notify = () => { S.v++; if (queued) return; queued = true; queueMicrotask(() => { queued = false; changed(); }); };
export const backendKind = () => api?.kind;

// ---- Derived data, worked out once per change ----
let memo = { v: -1 };
function derive() {
  if (memo.v === S.v) return memo;
  const txns = [];
  for (const [key, rec] of Object.entries(S.months)) for (const [id, t] of Object.entries(rec.txns || {})) txns.push({ ...t, id, _m: key });
  for (const t of S.open) txns.push(t);
  const liveTxns = txns.filter(E.live);
  memo = { v: S.v, txns: liveTxns, deleted: txns.filter(t => t.deletedAt), byId: new Map(txns.map(t => [t.id, t])), budget: null, balances: null };
  return memo;
}
export const txns = () => derive().txns;
export const txn = id => derive().byId.get(id);
export const deletedTxns = () => derive().deleted;
export const accountsSorted = () => [...S.accounts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
export const account = id => S.accounts.find(a => a.id === id);
export const category = id => S.categories.find(c => c.id === id);
export const group = id => S.groups.find(g => g.id === id);
export const payee = id => (id && S.payees[id] ? { ...S.payees[id], id } : null);
export const payeeName = id => S.payees[id]?.name || '';
export const flags = () => { const own = S.config.flags || DEFAULT_FLAGS, tax = taxFlags().filter(t => !own.some(f => f.id === t.id)); return [...own, ...tax]; };
export const flag = id => flags().find(f => f.id === id);
export function budget() {
  const d = derive();
  if (!d.budget) d.budget = E.computeBudget({ accounts: S.accounts, categories: S.categories, assigned: S.assigned, txns: d.txns }, { through: E.addMonths(E.thisMonth(), 1) });
  return d.budget;
}
export function balances() { const d = derive(); if (!d.balances) d.balances = E.accountBalances(S.accounts, d.txns); return d.balances; }
export const rta = m => E.readyToAssign(budget(), m || E.thisMonth());
export const catMonth = (id, m) => budget().months[m]?.cats[id] || { assigned: 0, activity: 0, available: 0, carried: 0, creditOver: 0, cashOver: 0 };
export const categoryLabel = id => id === E.RTA ? 'Ready to Assign' : category(id)?.name || '';
export const me = () => (S.config.people || []).find(p => p.email && p.email.toLowerCase() === (S.user?.email || '').toLowerCase()) || { id: S.user?.uid, name: (S.user?.displayName || S.user?.email || 'Me').split(/[\s@]/)[0], email: S.user?.email };
/** A payee's usual category: the most common one across its last ten transactions. */
export function usualCategory(pid) {
  const recent = txns().filter(t => t.payeeId === pid && t.categoryId && t.categoryId !== E.RTA).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const n = new Map(); recent.forEach(t => n.set(t.categoryId, (n.get(t.categoryId) || 0) + 1));
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || S.payees[pid]?.categoryId || null;
}
export const unapproved = () => txns().filter(t => t.approved === false);
const openFrom = () => E.addMonths(E.thisMonth(), -1);
const storedIn = date => (E.monthOf(date) < openFrom() ? E.monthOf(date) : null);

// ---- Starting up ----
export async function start(backend) {
  api = backend;
  addEventListener('online', () => { S.online = true; notify(); });
  addEventListener('offline', () => { S.online = false; notify(); });
  api.onUser(u => {
    listeners.forEach(off => off()); listeners = [];
    Object.assign(S, { user: u, config: {}, accounts: [], groups: [], categories: [], payees: {}, scheduled: [], assigned: {}, open: [], months: {}, audit: [], bnpl: [], synced: {} });
    S.phase = u ? 'loading' : 'signin';
    if (u) listenAll();
    notify();
  });
}
export const signIn = () => api.signIn();
export const signOut = () => api.signOut();
function denied(e) { console.error(e); if (e.code === 'permission-denied') { S.phase = 'denied'; notify(); } }
const NEEDED = ['config', 'accounts', 'groups', 'categories', 'lists', 'assigned', 'txns', 'months', 'scheduled', 'bnpl'];
function listenAll() {
  const pendingBy = {};
  const seen = (name, m) => {
    if (!m.fromCache) S.synced[name] = true; S.synced['_' + name] = true;
    pendingBy[name] = m.pending; S.pending = Object.values(pendingBy).some(Boolean);
    if (S.phase === 'loading' && NEEDED.every(n => S.synced['_' + n])) { S.phase = 'app'; setTimeout(housekeeping, 50); }
    notify();
  };
  const col = (name, fn) => listeners.push(api.listen(name, (rows, m) => { fn(rows); seen(name, m); }, denied));
  col('accounts', r => { S.accounts = r; }); col('groups', r => { S.groups = r; }); col('categories', r => { S.categories = r; });
  col('scheduled', r => { S.scheduled = r; }); col('txns', r => { S.open = r; });
  col('assigned', r => { S.assigned = Object.fromEntries(r.map(({ id, ...cats }) => [id, cats])); });
  col('months', r => { S.months = Object.fromEntries(r.map(x => [x.id, x])); });
  col('audit', r => { S.audit = r.sort((a, b) => b.at - a.at); });
  col('bnpl', r => { S.bnpl = r.sort((a, b) => (a.start || '').localeCompare(b.start || '')); });
  listeners.push(api.listenDoc('lists', 'payees', (d, m) => { S.payees = d || {}; seen('lists', m); }, denied));
  listeners.push(api.listenDoc('config', 'main', (d, m) => { S.config = d || {}; seen('config', m); }, denied));
}
export const isEmpty = () => !S.accounts.length && !S.categories.length;

/** Tidy-ups any phone can do safely: enter due scheduled transactions, fold old months into month records. */
let housekept = false;
function housekeeping() {
  if (housekept || isEmpty()) return; housekept = true;
  const day = E.today(), ops = [];
  // Scheduled transactions that have come due are entered. The id is fixed per date, so two phones can't double up.
  for (const s of S.scheduled) {
    if (!s.next || s.next > day) continue;
    let next = s.next;
    for (const d of E.occurrences(s, day)) { const id = `s${s.id.slice(0, 12)}${d.replace(/-/g, '')}`; if (!txn(id)) ops.push(...placeOps({ ...schedToTxn(s, d), id }, undefined)); next = E.nextDate(d, s.freq); }
    ops.push(next ? { type: 'update', col: 'scheduled', id: s.id, data: { next } } : { type: 'delete', col: 'scheduled', id: s.id });
  }
  // Months that have finished are kept as one record each.
  for (const t of S.open) if (storedIn(t.date)) ops.push(...placeOps(t, null));
  if (ops.length) commit(ops);
}
const schedToTxn = (s, date) => ({ date, amount: s.amount, accountId: s.accountId, payeeId: s.payeeId, categoryId: s.categoryId, memo: s.memo, flags: s.flags, splits: s.splits, transferAccountId: s.transferAccountId, cleared: 'u', approved: true, scheduledId: s.id, source: 'scheduled', createdAt: Date.now() });

// ---- Writing ----
const write = (ops, text) => {
  if (text) ops = [...ops, { type: 'set', col: 'audit', id: uid(), data: { at: Date.now(), by: me().name || '', text } }];
  return api.write(ops).catch(e => { S.error = e.code === 'permission-denied' ? 'This account can\'t save changes.' : 'A change could not be saved.'; console.error(e); notify(); });
};
/** Where a transaction is stored now: a month key, null (on its own), or undefined (nowhere yet). */
function locate(id) { if (S.open.some(t => t.id === id)) return null; for (const [k, r] of Object.entries(S.months)) if (r.txns && r.txns[id]) return k; return undefined; }
/** Ops to store a transaction where it belongs (a month record, or on its own), removing it from `from` if it moves. */
function placeOps(t, from = locate(t.id)) {
  const ops = [], to = storedIn(t.date), data = txnData(t);
  if (from !== undefined && from !== to) ops.push(...removeOps(t.id, from));
  if (to) ops.push({ type: 'setFields', col: 'months', id: to, fields: [[['txns', t.id], data]] });
  else ops.push({ type: 'set', col: 'txns', id: t.id, data });
  return ops;
}
const removeOps = (id, from) => (from ? [{ type: 'unsetFields', col: 'months', id: from, paths: [['txns', id]] }] : [{ type: 'delete', col: 'txns', id }]);
/** Keep each month record's count and total current, for the integrity check. */
function withTotals(ops) {
  const touched = new Set(ops.filter(o => o.col === 'months').map(o => o.id)); if (!touched.size) return ops;
  const after = {}; for (const k of touched) after[k] = { ...(S.months[k]?.txns || {}) };
  for (const o of ops) if (o.col === 'months') { (o.fields || []).forEach(([p, v]) => { if (p[0] === 'txns') after[o.id][p[1]] = v; }); (o.paths || []).forEach(p => { if (p[0] === 'txns') delete after[o.id][p[1]]; }); }
  return [...ops, ...[...touched].map(k => { const list = Object.values(after[k]).filter(E.live); return { type: 'set', col: 'months', id: k, data: { count: list.length, total: E.sum(list, t => t.amount) }, merge: true }; })];
}
const commit = (ops, text) => write(withTotals(ops), text);

/** Month records whose stored count or total no longer match their transactions. */
export function integrityProblems() {
  const out = [];
  for (const [k, rec] of Object.entries(S.months)) { const list = Object.values(rec.txns || {}).filter(E.live); if (rec.count !== list.length || rec.total !== E.sum(list, t => t.amount)) out.push(k); }
  return out;
}
export const repairTotals = ks => commit(ks.map(k => ({ type: 'setFields', col: 'months', id: k, fields: [] })), 'Rechecked month totals');

// ---- Transactions ----
/**
 * Save a transaction (new or edited). Transfers keep a matching transaction in the other account.
 * Returns an undo function.
 */
export function saveTxn(input, { text } = {}) {
  const now = Date.now(), who = me().name, was = input.id ? txn(input.id) : null;
  const t = { cleared: 'u', ...was, ...input, id: input.id || uid(), updatedAt: now, updatedBy: who };
  if (!was) Object.assign(t, { createdAt: now, createdBy: who, source: t.source || 'manual' });
  if (t.splits && t.splits.length < 2) { if (t.splits.length === 1) { t.categoryId = t.splits[0].categoryId; } t.splits = null; }
  if (t.splits) t.categoryId = null;
  if (!was && !t.bnpl && !t.transferAccountId) { const l = autoInstalment(t); if (l) { t.bnpl = l.bnpl; if (!t.categoryId && !t.splits) t.categoryId = l.categoryId; } }
  const ops = [], undo = [];
  // The other side of a transfer.
  const pairWas = was?.transferId ? txn(was.transferId) : null;
  if (t.transferAccountId && !t.splits) {
    const pid = pairWas?.id || t.transferId || uid();
    const pair = { ...(pairWas || {}), id: pid, date: t.date, amount: -t.amount, accountId: t.transferAccountId, transferAccountId: t.accountId, transferId: t.id, payeeId: transferPayee(t.accountId, ops), memo: t.memo, cleared: pairWas?.cleared || 'u', categoryId: needsCategory(t.transferAccountId, t.accountId) ? t.categoryId : null, updatedAt: now, updatedBy: who, createdAt: pairWas?.createdAt || now, createdBy: pairWas?.createdBy || who, source: pairWas?.source || 'manual' };
    t.transferId = pid; t.payeeId = transferPayee(t.transferAccountId, ops);
    if (!needsCategory(t.accountId, t.transferAccountId)) t.categoryId = null;
    ops.push(...placeOps(pair)); undo.push(...(pairWas ? placeOps(pairWas, storedIn(pair.date)) : removeOps(pid, storedIn(pair.date))));
  } else if (pairWas) { ops.push(...removeOps(pairWas.id, locate(pairWas.id))); undo.push(...placeOps(pairWas, undefined)); t.transferId = null; }
  ops.push(...placeOps(t)); undo.push(...(was ? placeOps(was, storedIn(t.date)) : removeOps(t.id, storedIn(t.date))));
  // The payee remembers its category.
  if (t.payeeId && t.categoryId && t.categoryId !== E.RTA && S.payees[t.payeeId] && S.payees[t.payeeId].categoryId !== t.categoryId) ops.push({ type: 'setFields', col: 'lists', id: 'payees', fields: [[[t.payeeId, 'categoryId'], t.categoryId]] });
  commit(ops, text || `${was ? 'Edited' : 'Added'} ${payeeName(t.payeeId) || 'a transaction'} ${E.fmt(t.amount)}`);
  return () => commit(undo, `Undid a change to ${payeeName(t.payeeId) || 'a transaction'}`);
}
const needsCategory = (from, to) => !!account(from)?.onBudget && !account(to)?.onBudget;
function transferPayee(accountId, ops) {
  const found = Object.entries(S.payees).find(([, p]) => p.transferAccountId === accountId); if (found) return found[0];
  const id = 'tp-' + accountId.slice(0, 16); ops.push({ type: 'setFields', col: 'lists', id: 'payees', fields: [[[id], { name: `Transfer : ${account(accountId)?.name || ''}`, transferAccountId: accountId }]] });
  S.payees[id] = { name: `Transfer : ${account(accountId)?.name}`, transferAccountId: accountId }; return id;
}
/** Find or create a payee by name. */
export function payeeFor(name, ops) {
  const n = name.trim(); if (!n) return null;
  const found = Object.entries(S.payees).find(([, p]) => !p.transferAccountId && p.name.toLowerCase() === n.toLowerCase()); if (found) return found[0];
  const id = uid(); ops.push({ type: 'setFields', col: 'lists', id: 'payees', fields: [[[id], { name: n }]] }); S.payees[id] = { name: n }; return id;
}
export function ensurePayee(name) { const ops = []; const id = payeeFor(name, ops); if (ops.length) write(ops); return id; }
/** Replace one field (or nested field) whole, so nothing from its old value lingers. */
export const setField = (col, id, path, value, text) => write([{ type: 'setFields', col, id, fields: [[path, value]] }], text);
export function addWithPayee(input, payeeText) { const ops = []; const payeeId = input.transferAccountId ? null : payeeFor(payeeText, ops); if (ops.length) write(ops); return saveTxn({ ...input, payeeId: payeeId ?? input.payeeId }); }
export function deleteTxns(ids) {
  const ops = [], undo = [], now = Date.now(), seen = new Set();
  for (const id of ids) { const t = txn(id); if (!t || seen.has(id)) continue; seen.add(id); for (const x of [t, t.transferId && txn(t.transferId)].filter(Boolean)) { seen.add(x.id); ops.push(...placeOps({ ...x, deletedAt: now })); undo.push(...placeOps({ ...x, deletedAt: null })); } }
  commit(ops, `Deleted ${ids.length} transaction${ids.length > 1 ? 's' : ''}`);
  return () => commit(undo, 'Restored deleted transactions');
}
export const restoreTxn = id => { const t = txn(id); if (t) commit(placeOps({ ...t, deletedAt: null }), `Restored ${payeeName(t.payeeId)}`); };
/** Change several transactions at once (payee, category, memo, date, flags, cleared, approved). */
export function bulkEdit(ids, fields, text) {
  const ops = [], undo = [], now = Date.now();
  for (const id of ids) { const t = txn(id); if (!t) continue; const n = { ...t, ...fields, updatedAt: now, updatedBy: me().name }; if (fields.categoryId !== undefined && t.splits) continue; ops.push(...placeOps(n)); undo.push(...placeOps(t, storedIn(n.date))); }
  commit(ops, text || `Edited ${ids.length} transactions`);
  return () => commit(undo, 'Undid a bulk edit');
}
export const approve = ids => bulkEdit(ids, { approved: true }, `Approved ${ids.length} transaction${ids.length > 1 ? 's' : ''}`);
export function setCleared(id) { const t = txn(id); if (!t || t.cleared === 'r') return; return bulkEdit([id], { cleared: t.cleared === 'c' ? 'u' : 'c' }, `Marked ${payeeName(t.payeeId)} ${t.cleared === 'c' ? 'uncleared' : 'cleared'}`); }

/** Reconcile: lock cleared transactions; add an adjustment if the bank balance differs. */
export function reconcile(accountId, bankBalance) {
  const b = balances()[accountId], diff = bankBalance - b.cleared, ops = [], day = E.today(), now = Date.now();
  if (diff) { const ops2 = []; const pid = payeeFor('Reconciliation Balance Adjustment', ops2); write(ops2); ops.push(...placeOps({ id: uid(), date: day, amount: diff, accountId, payeeId: pid, categoryId: account(accountId)?.onBudget ? E.RTA : null, memo: 'Entered automatically by reconciling', cleared: 'r', createdAt: now, createdBy: me().name, source: 'reconcile' }, undefined)); }
  for (const t of txns()) if (t.accountId === accountId && t.cleared === 'c') ops.push(...placeOps({ ...t, cleared: 'r' }));
  ops.push({ type: 'update', col: 'accounts', id: accountId, data: { reconciledAt: new Date().toISOString(), reconciledBalance: bankBalance } });
  commit(ops, `Reconciled ${account(accountId)?.name} at ${E.fmt(bankBalance)}${diff ? ` (adjusted ${E.fmt(diff, { sign: true })})` : ''}`);
}

// ---- Budget ----
export function setAssigned(catId, m, cents) {
  const was = S.assigned[m]?.[catId] || 0; if (was === cents) return;
  write([{ type: 'set', col: 'assigned', id: m, data: { [catId]: cents }, merge: true }], `Assigned ${E.fmt(cents)} to ${category(catId)?.name} for ${E.monthName(m)}`);
  return () => write([{ type: 'set', col: 'assigned', id: m, data: { [catId]: was }, merge: true }], `Undid assigning to ${category(catId)?.name}`);
}
export function setManyAssigned(m, map, text) {
  const was = {}; for (const k of Object.keys(map)) was[k] = S.assigned[m]?.[k] || 0;
  write([{ type: 'set', col: 'assigned', id: m, data: map, merge: true }], text);
  return () => write([{ type: 'set', col: 'assigned', id: m, data: was, merge: true }], 'Undid assigning');
}
export function moveMoney(from, to, m, cents) {
  const a = S.assigned[m] || {};
  return setManyAssigned(m, { [from]: (a[from] || 0) - cents, [to]: (a[to] || 0) + cents }, `Moved ${E.fmt(cents)} from ${category(from)?.name} to ${category(to)?.name}`);
}
export const saveItem = (col, id, data, text) => { const key = id || uid(); write([{ type: 'set', col, id: key, data: clean(data), merge: true }], text); return key; };
export const patchConfig = (data, text) => write([{ type: 'set', col: 'config', id: 'main', data: clean(data), merge: true }], text);
export const savePayee = (id, data, text) => write([{ type: 'setFields', col: 'lists', id: 'payees', fields: Object.entries(data).map(([k, v]) => [[id, k], v]) }], text);

// ---- Import, backup ----
/** Replace the whole budget with converted data (from a YNAB export or a backup). */
export async function replaceAll(d, text, progress) {
  const ops = [];
  // Add the new budget.
  for (const a of d.accounts) ops.push({ type: 'set', col: 'accounts', id: a.id, data: compact(noId(a)) });
  for (const g of d.groups) ops.push({ type: 'set', col: 'groups', id: g.id, data: compact(noId(g)) });
  for (const c of d.categories) ops.push({ type: 'set', col: 'categories', id: c.id, data: clean(noId(c)) });
  for (const s of d.scheduled) ops.push({ type: 'set', col: 'scheduled', id: s.id, data: compact(noId(s)) });
  for (const [m, cats] of Object.entries(d.assigned)) ops.push({ type: 'set', col: 'assigned', id: m, data: cats });
  ops.push({ type: 'set', col: 'lists', id: 'payees', data: Object.fromEntries(d.payees.map(p => [p.id, compact(noId(p))])) });
  const recs = {};
  for (const t of d.txns) { const m = storedIn(t.date); if (m) ((recs[m] ??= {})[t.id] = txnData(t)); else ops.push({ type: 'set', col: 'txns', id: t.id, data: txnData(t) }); }
  for (const [m, map] of Object.entries(recs)) { const list = Object.values(map); ops.push({ type: 'set', col: 'months', id: m, data: { txns: map, count: list.length, total: E.sum(list, t => t.amount) } }); }
  // Clear what's there now and isn't replaced (sets below overwrite the rest whole).
  const keep = new Set(ops.map(o => o.col + '/' + o.id)), gone = (col, id) => { if (!keep.has(col + '/' + id)) ops.unshift({ type: 'delete', col, id }); };
  S.accounts.forEach(a => gone('accounts', a.id)); S.groups.forEach(g => gone('groups', g.id)); S.categories.forEach(c => gone('categories', c.id)); S.scheduled.forEach(x => gone('scheduled', x.id));
  Object.keys(S.assigned).forEach(k => gone('assigned', k)); Object.keys(S.months).forEach(k => gone('months', k)); S.open.forEach(t => gone('txns', t.id));
  const cfg = { flags: d.flags?.length ? mergeFlags(d.flags) : flags(), importedAt: Date.now(), importedFrom: d.name || '' };
  ops.push({ type: 'set', col: 'config', id: 'main', data: clean(cfg), merge: true });
  housekept = false;
  // Sent in parts so progress can be shown, and so a failure is reported rather than swallowed.
  // Firebase limits each write by how many indexed values it changes (each completed month has thousands),
  // so parts are sized by that count, not just by bytes.
  const parts = []; let part = [], weight = 0, bytes = 0;
  for (const o of ops) {
    const w = opWeight(o), n = JSON.stringify(o).length;
    if (part.length && (part.length >= 400 || weight + w > 8000 || bytes + n > 1.5e6)) { parts.push(part); part = []; weight = 0; bytes = 0; }
    part.push(o); weight += w; bytes += n;
  }
  if (part.length) parts.push(part);
  for (let i = 0; i < parts.length; i++) { await api.write(parts[i]); progress?.({ done: i + 1, total: parts.length }); }
  return ops.length;
}
/** Roughly how many indexed values a write changes: two per stored value, more for deleting a whole month. */
export function opWeight(o) {
  const leaves = x => (x && typeof x === 'object' ? (Array.isArray(x) ? 1 : Object.values(x).reduce((n, v) => n + leaves(v), 0)) : 1);
  if (o.type === 'delete') return o.col === 'months' ? 6000 : o.col === 'lists' ? 5000 : 20;
  return 2 * leaves(o.data ?? Object.fromEntries((o.fields || []).map(([p, v], i) => [i, v])));
}
const mergeFlags = fs => { const have = flags(); return [...have, ...fs.filter(f => !have.some(h => h.id === f.id))]; };
export function backupData() {
  return { kind: 'home-budget-backup', version: 1, exportedAt: new Date().toISOString(), data: { config: S.config, accounts: S.accounts, groups: S.groups, categories: S.categories, scheduled: S.scheduled, assigned: S.assigned, payees: Object.entries(S.payees).map(([id, p]) => ({ ...p, id })), txns: [...txns(), ...deletedTxns()].map(({ _m, ...t }) => t) } };
}
export function fromBackup(b) {
  if (b?.kind !== 'home-budget-backup') throw new Error('That isn\'t a Home Budget backup.');
  const d = b.data; return { ...d, flags: d.config?.flags || [], name: 'backup' };
}

// ---- Buy now, pay later ----
// A plan is one purchase paid in instalments. Each instalment is an ordinary transaction (it hits the budget when
// the money leaves) carrying { planId, n }. Later instalments link automatically by provider and amount.
export const BNPL_RE = /afterpay|zip ?pay|zip ?money|klarna|humm|latitude ?pay|paypal pay in 4|openpay|bundll/i;
export const isBnplName = s => BNPL_RE.test(s || '');
export const plan = id => S.bnpl.find(p => p.id === id);
export const instalments = id => txns().filter(t => t.bnpl?.planId === id).sort((a, b) => a.bnpl.n - b.bnpl.n);
export const planPaid = p => instalments(p.id).length;
export const planLeft = p => Math.max(0, p.total - E.sum(instalments(p.id), t => -t.amount));
export const openPlans = () => S.bnpl.filter(p => !p.closedAt && planPaid(p) < p.count);
export const bnplOutstanding = () => E.sum(openPlans(), planLeft);
export function bnplLabel(t) { const p = t?.bnpl && plan(t.bnpl.planId); return p ? `${p.shop} (${p.provider} ${t.bnpl.n} of ${p.count})` : ''; }
const nextAmount = p => { const paid = planPaid(p); return paid >= p.count - 1 ? planLeft(p) : p.instalment; };
/** The open plans a payment could belong to: same provider (if known) and the next instalment's amount. */
export function plansFor(amount, providerText = '') {
  const prov = (providerText.match(BNPL_RE) || [''])[0].toLowerCase().replace(/\s/g, '');
  return openPlans().filter(p => Math.abs(nextAmount(p) - Math.abs(amount)) <= 1 && (!prov || p.provider.toLowerCase().replace(/\s/g, '').includes(prov.slice(0, 3))));
}
function autoInstalment(t) {
  const name = payeeName(t.payeeId) || t.payeeText || t.importPayee || ''; if (!isBnplName(name) || t.amount >= 0) return null;
  const ps = plansFor(t.amount, name); if (ps.length !== 1) return null;
  return { bnpl: { planId: ps[0].id, n: planPaid(ps[0]) + 1 }, categoryId: ps[0].categoryId };
}
/** Start a plan from its first instalment. Returns the plan id. */
export function startPlan({ provider, shop, total, count, categoryId, accountId, start }) {
  const id = uid(), instalment = Math.round(total / count);
  write([{ type: 'set', col: 'bnpl', id, data: clean({ provider, shop, total, count, instalment, categoryId, accountId, start, createdAt: Date.now(), createdBy: me().name }) }], `Started a ${provider} plan: ${shop}, ${E.fmt(total)} in ${count}`);
  S.bnpl = [...S.bnpl, { id, provider, shop, total, count, instalment, categoryId, accountId, start }];
  return id;
}
export const closePlan = id => write([{ type: 'update', col: 'bnpl', id, data: { closedAt: Date.now() } }], `Closed the ${plan(id)?.shop} plan`);
