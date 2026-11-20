// Turns Up records from the sync inbox into budget transactions. Pure: no screen, no database.
// The same inbox always gives the same result, so either phone can do it, any number of times.
import * as E from './engine.js';

export const upTxnId = upId => 'up-' + String(upId).replace(/[^\w-]/g, '');
const isRoundUp = it => !!it.roundUpOf || /^round ?up/i.test(it.desc || '');
export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/**
 * items: inbox records (see sync/up-sync.mjs). txns: every transaction, deleted ones included.
 * links: { upAccountId: { accountId | 'ignore', from: 'YYYY-MM-DD' } }. heldIds: upIds Up still holds.
 * ctx: { payeeId(name) → id (creating it if needed), transferPayee(accountId) → id, usualCategory(payeeId, amount) → id|null,
 *        rename(desc) → payee name, onBudget(accountId), whoFor(item) → name|null, instalment(txn) → { bnpl, categoryId }|null, now }
 * Returns { creates: [txn], updates: [{ id, fields }] }.
 */
export function planSync({ items, txns, links, heldIds = null, ctx }) {
  const creates = [], updates = [], work = txns.map(t => ({ ...t }));
  const byUp = new Map(work.filter(t => t.upId).map(t => [t.upId, t]));
  const held = new Set(heldIds || []), settledIds = new Set(items.filter(i => i.status === 'SETTLED').map(i => i.upId));
  const linkOf = a => { const l = links?.[a]; return l && l.accountId && l.accountId !== 'ignore' ? l : null; };
  const update = (t, fields) => { const f = {}; for (const [k, v] of Object.entries(fields)) if (JSON.stringify(t[k] ?? null) !== JSON.stringify(v ?? null)) f[k] = v; if (Object.keys(f).length) { Object.assign(t, f); const u = updates.find(x => x.id === t.id); u ? Object.assign(u.fields, f) : updates.push({ id: t.id, fields: f }); } };
  const memoOf = it => [it.fx && `${it.fx} (foreign amount)`, it.msg, it.note].filter(Boolean).join(' · ');

  // Round-ups leave the spending account as their own small transfer.
  const all = [];
  for (const it of [...items].sort((a, b) => a.created.localeCompare(b.created) || a.upId.localeCompare(b.upId))) {
    all.push(it);
    if (it.ru && it.ru < 0) all.push({ ...it, upId: `${it.upId}-ru`, amt: it.ru, desc: 'Round Up', raw: null, msg: null, note: null, fx: null, xfer: null, ru: null, roundUpOf: it.upId });
  }
  for (const it of all) {
    const link = linkOf(it.acct); if (!link) continue;
    const { date, time } = E.localDateTime(it.created); if ((link.from && date < link.from) || (link.fromAt && Date.parse(it.created) < link.fromAt)) continue;
    const accountId = link.accountId, cleared = it.status === 'SETTLED' ? 'c' : 'u';
    let t = byUp.get(it.upId);
    if (t) { // Already here: settle, adjust the amount, never undo a reconcile.
      if (t.deletedAt) continue;
      const f = { upStatus: it.status, cleared: t.cleared === 'r' ? 'r' : cleared };
      if (t.amount !== it.amt) { if (t.splits) f.approved = false; else f.amount = it.amt; }
      update(t, f); continue;
    }
    // A hold that settled under a new id.
    if (it.status === 'SETTLED') {
      t = work.find(x => x.upStatus === 'HELD' && x.accountId === accountId && !x.deletedAt && !held.has(x.upId) && !settledIds.has(x.upId) && x.importPayee === it.desc && Math.abs(E.diffDays(x.date, date)) <= 5 && x.amount * it.amt > 0 && Math.abs(x.amount - it.amt) <= Math.abs(x.amount) * 0.3);
      if (t) { byUp.delete(t.upId); update(t, { upId: it.upId, upStatus: it.status, cleared: t.cleared === 'r' ? 'r' : cleared, ...(t.splits ? {} : { amount: it.amt }) }); byUp.set(it.upId, t); continue; }
    }
    // Something entered by hand or scheduled: the bank record merges into it, keeping its payee, category and memo.
    t = E.findMatch({ accountId, amount: it.amt, date }, work.filter(x => !x.deletedAt));
    if (t) { update(t, { upId: it.upId, upStatus: it.status, cleared: t.cleared === 'r' ? 'r' : cleared, time, who: ctx.whoFor(it) || t.who || null, importPayee: it.desc, matchedFrom: t.source || 'manual' }); byUp.set(it.upId, t); continue; }
    // New.
    const n = { id: upTxnId(it.upId), date, time, amount: it.amt, accountId, upId: it.upId, upStatus: it.status, cleared, importPayee: it.desc, memo: memoOf(it), who: ctx.whoFor(it), source: 'up', approved: false, createdAt: ctx.now, createdBy: 'Up sync' };
    const other = it.xfer ? linkOf(it.xfer) : null;
    // The other side of a transfer, if it's already here (a round-up's partner is the saver's incoming "Round Up").
    const pair = work.find(x => !x.deletedAt && !x.transferId && x.amount === -it.amt && Math.abs(E.diffDays(x.date, date)) <= 1 && x.accountId !== accountId &&
      (other ? x.accountId === other.accountId && (!x.transferAccountId || x.transferAccountId === accountId)
        : isRoundUp(it) ? x.source === 'up' && (x.transferAccountId === accountId || (!x.transferAccountId && (String(x.upId).endsWith('-ru') || /round ?up/i.test(x.importPayee || '')))) : false));
    const toAccount = other?.accountId || (pair ? pair.accountId : null);
    if (toAccount) {
      Object.assign(n, { transferAccountId: toAccount, payeeId: ctx.transferPayee(toAccount), approved: true });
      if (ctx.onBudget(accountId) && !ctx.onBudget(toAccount)) { n.categoryId = ctx.usualCategory(n.payeeId, n.amount); n.approved = false; }
      if (pair) { n.transferId = pair.id; update(pair, { transferId: n.id, transferAccountId: accountId, payeeId: ctx.transferPayee(accountId), approved: true, ...(ctx.onBudget(pair.accountId) && !ctx.onBudget(accountId) ? {} : { categoryId: null }) }); }
    } else {
      n.payeeId = ctx.payeeId(ctx.rename(it.desc) || it.desc);
      n.categoryId = /^interest\b/i.test(it.desc) && it.amt > 0 ? E.RTA : ctx.usualCategory(n.payeeId, n.amount);
      const inst = it.amt < 0 ? ctx.instalment?.(n) : null; if (inst) { n.bnpl = inst.bnpl; n.categoryId = inst.categoryId || n.categoryId; }
    }
    creates.push(n); work.push(n); byUp.set(it.upId, n);
  }
  // Holds the bank has dropped without settling go back to the approval queue to be checked.
  for (const t of work) if (t.upStatus === 'HELD' && !t.deletedAt && !held.has(t.upId) && !settledIds.has(t.upId) && heldIds && E.diffDays(t.date, E.localDateTime(ctx.now).date) >= 1) update(t, { upStatus: 'GONE', approved: false });
  // Changes to transactions created in this same pass go straight into them.
  const made = new Map(creates.map(c => [c.id, c]));
  return { creates, updates: updates.filter(u => { const c = made.get(u.id); if (c) { Object.assign(c, u.fields); return false; } return true; }) };
}
