// Budget maths. Pure functions only: no Firebase, no screen. Every amount is whole cents.
// Works the YNAB way: income goes to Ready to Assign, money is assigned to categories,
// category balances roll over, and overspending is handled at the end of each month.

export const RTA = 'rta';              // category id for "Inflow: Ready to Assign"
export const TZ = 'Australia/Adelaide';

// ---- Money ----
export const fmt = (c, { sign = false, cents = true } = {}) => {
  const n = Math.abs(c) / 100, s = n.toLocaleString('en-AU', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (c < 0 ? '−' : sign && c > 0 ? '+' : '') + '$' + s;
};
/** "12.5", "$1,234.50", "-3" → cents. Returns null when it isn't a number. */
export function parseMoney(s) {
  const t = String(s ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace('−', '-');
  if (!/^[-+]?\d*(\.\d{0,})?$/.test(t) || !/\d/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
export const sum = (a, f = x => x) => a.reduce((s, x) => s + f(x), 0);

// ---- Dates (strings: 'YYYY-MM-DD' and months 'YYYY-MM') ----
const pad = n => String(n).padStart(2, '0');
const partsIn = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
/** Local Adelaide date and time for an instant (ISO string or Date). */
export function localDateTime(at, tz = TZ) { const p = partsIn(new Date(at), tz); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; }
export const today = (now = new Date()) => localDateTime(now).date;
export const monthOf = d => d.slice(0, 7);
export const thisMonth = (now = new Date()) => monthOf(today(now));
export function addMonths(m, n) { let [y, mo] = m.split('-').map(Number); mo += n; y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12 + 12) % 12 + 1; return `${y}-${pad(mo)}`; }
export const monthDiff = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
export const daysInMonth = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const utc = d => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
export const addDays = (d, n) => new Date(utc(d) + n * 864e5).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
export const weekday = d => new Date(utc(d)).getUTCDay();
export function addMonthsToDate(d, n) { const m = addMonths(monthOf(d), n), day = Math.min(+d.slice(8), daysInMonth(m)); return `${m}-${pad(day)}`; }
export const monthName = (m, long = true) => new Date(utc(m + '-01')).toLocaleDateString('en-AU', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
export const shortDate = d => new Date(utc(d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export function monthRange(a, b) { const out = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; }

// ---- Transactions ----
/** The budget lines a transaction contributes: one per split, or the transaction itself. */
export function linesOf(t) {
  if (t.splits && t.splits.length) return t.splits.map(s => ({ amount: s.amount, categoryId: s.categoryId ?? null, transferAccountId: s.transferAccountId ?? null, payeeId: s.payeeId ?? t.payeeId, memo: s.memo ?? '' }));
  return [{ amount: t.amount, categoryId: t.categoryId ?? null, transferAccountId: t.transferAccountId ?? null, payeeId: t.payeeId, memo: t.memo ?? '' }];
}
export const live = t => !t.deletedAt;

/**
 * The whole budget, month by month.
 * data: { accounts, categories, assigned: { 'YYYY-MM': { catId: cents } }, txns }
 * Returns { months: { 'YYYY-MM': { income, assigned, activity, rtaEnd, cashOverspent, cats: { id: { assigned, activity, available, carried, creditOver, cashOver } } } }, first, last, rta }
 */
export function computeBudget({ accounts, categories, assigned = {}, txns }, opts = {}) {
  const acct = new Map(accounts.map(a => [a.id, a]));
  const onBudget = id => !!acct.get(id)?.onBudget;
  const isCredit = id => acct.get(id)?.type === 'credit';
  const ccCatFor = new Map(categories.filter(c => c.kind === 'cc').map(c => [c.accountId, c.id]));
  const normal = categories.filter(c => c.kind !== 'cc');

  // Per month: income, activity per category (cash and credit), card payments.
  const act = {}; // month -> catId -> { cash, credit: Map(accountId -> amount) }
  const income = {}, payments = {}, advances = {}; // payments: month -> ccCatId -> amount paid (positive)
  let first = null, last = null;
  const touch = m => { if (!first || m < first) first = m; if (!last || m > last) last = m; };
  for (const t of txns) {
    if (!live(t) || !onBudget(t.accountId)) continue;
    const m = monthOf(t.date); touch(m);
    for (const l of linesOf(t)) {
      if (l.transferAccountId && onBudget(l.transferAccountId)) {
        if (isCredit(t.accountId)) {
          const cc = ccCatFor.get(t.accountId), pay = v => { if (cc) (payments[m] ??= {})[cc] = (payments[m][cc] || 0) + v; };
          if (!isCredit(l.transferAccountId)) {
            if (l.amount > 0) pay(l.amount);                               // paying the card from a bank account
            else advances[m] = (advances[m] || 0) - l.amount;              // cash advance: the money arrives in Ready to Assign
          }                                                                // a card paying another card only moves the debt
        }
        continue;
      }
      if (l.categoryId === RTA) {
        // YNAB leaves Ready to Assign lines on a card (interest, small rewards) out of the budget: they only change the debt.
        if (!isCredit(t.accountId)) income[m] = (income[m] || 0) + l.amount;
        continue;
      }
      const cid = l.categoryId || 'uncategorized';
      const a = ((act[m] ??= {})[cid] ??= { cash: 0, credit: new Map() });
      if (isCredit(t.accountId)) a.credit.set(t.accountId, (a.credit.get(t.accountId) || 0) + l.amount);
      else a.cash += l.amount;
    }
  }
  for (const m of Object.keys(assigned)) if (Object.values(assigned[m] || {}).some(v => v)) touch(m);
  const end = opts.through && (!last || opts.through > last) ? opts.through : last;
  const months = {};
  if (!first) return { months, first: null, last: null, rta: 0, rtaByMonth: {} };

  const carry = {}; let rtaEnd = 0, cashOverPrev = 0;
  for (const m of monthRange(first, end)) {
    const A = assigned[m] || {}, out = { cats: {}, income: income[m] || 0, assigned: 0, activity: 0, cashOverspentPrev: cashOverPrev };
    const moved = {}; // ccCatId -> funded card spending moved this month
    let cashOver = 0;
    for (const c of normal) {
      const a = act[m]?.[c.id], cash = a ? a.cash : 0;
      let creditTotal = 0; if (a) for (const v of a.credit.values()) creditTotal += v;
      const asg = A[c.id] || 0, carried = carry[c.id] || 0;
      const activity = cash + creditTotal, available = carried + asg + activity;
      let creditOver = 0, co = 0;
      if (available < 0) { const over = -available, creditSpend = Math.max(0, -creditTotal); creditOver = Math.min(over, creditSpend); co = over - creditOver; }
      // Card spending that the category could cover moves to that card's payment category.
      if (a && a.credit.size) {
        let overLeft = creditOver;
        for (const [accId, v] of a.credit) {
          const spend = -v; let fund = spend;
          if (spend > 0 && overLeft > 0) { const cut = Math.min(spend, overLeft); fund -= cut; overLeft -= cut; }
          const cc = ccCatFor.get(accId); if (cc) moved[cc] = (moved[cc] || 0) + fund;
        }
      }
      cashOver += co; out.assigned += asg; out.activity += activity;
      out.cats[c.id] = { assigned: asg, activity, available, carried, creditOver, cashOver: co };
      carry[c.id] = available > 0 ? available : 0;
    }
    for (const c of categories.filter(c => c.kind === 'cc')) {
      const asg = A[c.id] || 0, carried = carry[c.id] || 0;
      const activity = (moved[c.id] || 0) - (payments[m]?.[c.id] || 0);
      const available = carried + asg + activity;
      const co = available < 0 ? -available : 0;
      cashOver += co; out.assigned += asg;
      out.cats[c.id] = { assigned: asg, activity, available, carried, creditOver: 0, cashOver: co };
      carry[c.id] = available > 0 ? available : 0;
    }
    out.advances = advances[m] || 0;
    rtaEnd = rtaEnd + out.income + out.advances - out.assigned - cashOverPrev;
    out.rtaEnd = rtaEnd; out.cashOverspent = cashOver;
    months[m] = out; cashOverPrev = cashOver;
  }
  return { months, first, last: end };
}

/** Ready to Assign as YNAB shows it for a month: money not yet given a job, after later months' assignments. */
export function readyToAssign(budget, m) {
  const ms = Object.keys(budget.months).sort(); if (!ms.length) return 0;
  const at = budget.months[m] || budget.months[m < ms[0] ? ms[0] : ms.at(-1)];
  let later = 0; for (const k of ms) if (k > m) later += budget.months[k].assigned;
  // Income dated in later months isn't available yet.
  return at.rtaEnd - later;
}

/** Account balances: { working, cleared, uncleared } in cents. */
export function accountBalances(accounts, txns, asOf) {
  const out = Object.fromEntries(accounts.map(a => [a.id, { working: 0, cleared: 0, uncleared: 0 }]));
  for (const t of txns) {
    if (!live(t) || !out[t.accountId] || (asOf && t.date > asOf)) continue;
    const b = out[t.accountId]; b.working += t.amount; if (t.cleared === 'u') b.uncleared += t.amount; else b.cleared += t.amount;
  }
  return out;
}

// ---- Targets ----
// Types: need (cadence month|week|year|custom months, setAside or refill), byDate (save a total by a date, repeating),
// balance (have a balance of, optional date), monthly (savings builder), debt (fixed monthly payment).
export function targetFor(cat, m, b, opts = {}) {
  const t = cat.target; if (!t) return null;
  const st = b || { assigned: 0, activity: 0, available: 0, carried: 0 };
  const startBal = st.carried;
  let need = 0, overall = t.amount;
  const monthsUntil = date => Math.max(1, monthDiff(m, monthOf(date)) + 1);
  if (t.type === 'need') {
    if (t.every === 'week') { const wd = t.weekday ?? 1; let n = 0; for (let d = 1; d <= daysInMonth(m); d++) if (weekday(`${m}-${pad(d)}`) === wd) n++; overall = t.amount * n; }
    else if (t.every === 'year' || (t.everyMonths || 1) > 1) {
      const due = t.due || `${m}-${pad(daysInMonth(m))}`; let dm = monthOf(due); const step = t.every === 'year' ? 12 * (t.everyYears || 1) : t.everyMonths;
      while (dm < m) dm = addMonths(dm, step);
      const left = monthDiff(m, dm) + 1; overall = t.amount;
      need = Math.max(0, Math.ceil((t.amount - startBal) / left));
      const under = Math.max(0, need - st.assigned);
      return { need, under, overall, funded: st.assigned, pct: need ? Math.min(1, st.assigned / need) : 1, due: `${dm}-${due.slice(8)}` };
    }
    need = t.refill ? Math.max(0, overall - startBal) : overall;
  } else if (t.type === 'byDate') {
    const left = monthsUntil(t.date); need = Math.max(0, Math.ceil((t.amount - startBal) / left));
  } else if (t.type === 'balance') {
    if (t.date) { const left = monthsUntil(t.date); need = Math.max(0, Math.ceil((t.amount - startBal) / left)); }
    else need = Math.max(0, t.amount - startBal);
    const have = st.carried + st.assigned; return { need, under: Math.max(0, need - st.assigned), overall: t.amount, funded: have, pct: t.amount ? Math.min(1, Math.max(0, have) / t.amount) : 1 };
  } else if (t.type === 'monthly' || t.type === 'debt') need = t.amount;
  const under = Math.max(0, need - st.assigned);
  return { need, under, overall, funded: st.assigned, pct: need ? Math.min(1, Math.max(0, st.assigned) / need) : 1 };
}

/** Assign to every underfunded category in display order until Ready to Assign runs out. Returns { catId: newAssigned }. */
export function assignUnderfunded(cats, groups, budget, m, rta) {
  const order = new Map(groups.map(g => [g.id, g.order ?? 0]));
  const list = cats.filter(c => c.target && !c.hidden).sort((a, b) => (order.get(a.groupId) ?? 0) - (order.get(b.groupId) ?? 0) || (a.order ?? 0) - (b.order ?? 0));
  const out = {}; let left = rta;
  for (const c of list) {
    if (left <= 0) break;
    const st = budget.months[m]?.cats[c.id], t = targetFor(c, m, st); if (!t || t.under <= 0) continue;
    const add = Math.min(t.under, left); out[c.id] = (st?.assigned || 0) + add; left -= add;
  }
  return out;
}

/** How far through the month spending is, against what's available to spend. */
export function pacing(st, m, day) {
  if (!st) return null;
  const budgeted = st.carried + st.assigned, spent = -Math.min(0, st.activity);
  if (budgeted <= 0) return null;
  const frac = monthOf(day) > m ? 1 : monthOf(day) < m ? 0 : (+day.slice(8)) / daysInMonth(m);
  return { spent, budgeted, expected: Math.round(budgeted * frac), ahead: spent - Math.round(budgeted * frac) };
}

// ---- Matching bank records to entries made by hand ----
/** Find the hand-entered transaction a bank record should merge into. Same account, same amount, within a week, not already matched. */
export function findMatch(rec, txns) {
  let best = null, bestGap = 99;
  for (const t of txns) {
    if (!live(t) || t.accountId !== rec.accountId || t.upId || t.importId || t.cleared === 'r' || t.amount !== rec.amount) continue;
    const gap = Math.abs(diffDays(t.date, rec.date)); if (gap <= 7 && gap < bestGap) { best = t; bestGap = gap; }
  }
  return best;
}

// ---- Scheduled transactions ----
export const FREQS = { never: 'Once', daily: 'Daily', weekly: 'Weekly', everyOtherWeek: 'Fortnightly', twiceAMonth: 'Twice a month', every4Weeks: 'Every 4 weeks', monthly: 'Monthly', everyOtherMonth: 'Every 2 months', every3Months: 'Every 3 months', every4Months: 'Every 4 months', twiceAYear: 'Twice a year', yearly: 'Yearly', everyOtherYear: 'Every 2 years' };
export function nextDate(d, freq) {
  switch (freq) {
    case 'daily': return addDays(d, 1); case 'weekly': return addDays(d, 7); case 'everyOtherWeek': return addDays(d, 14); case 'every4Weeks': return addDays(d, 28);
    case 'twiceAMonth': return +d.slice(8) < 15 ? `${d.slice(0, 8)}${pad(Math.min(+d.slice(8) + 15, daysInMonth(monthOf(d))))}` : addMonthsToDate(`${d.slice(0, 8)}${pad(+d.slice(8) - 15 || 1)}`, 1);
    case 'monthly': return addMonthsToDate(d, 1); case 'everyOtherMonth': return addMonthsToDate(d, 2); case 'every3Months': return addMonthsToDate(d, 3);
    case 'every4Months': return addMonthsToDate(d, 4); case 'twiceAYear': return addMonthsToDate(d, 6); case 'yearly': return addMonthsToDate(d, 12); case 'everyOtherYear': return addMonthsToDate(d, 24);
    default: return null;
  }
}
/** Dates a schedule falls on, from its next date up to `until`. */
export function occurrences(s, until) { const out = []; let d = s.next; for (let i = 0; d && d <= until && i < 400; i++) { out.push(d); d = nextDate(d, s.freq); } return out; }

// ---- Reports ----
const spendingLine = (l, acct) => l.categoryId && l.categoryId !== RTA && !(l.transferAccountId && acct.get(l.transferAccountId)?.onBudget);
/** Spending (positive cents) per category per month, excluding transfers, income and Reimburse-flagged lines. */
export function spendingByMonth(accounts, txns, { excludeFlags = [], excludeTracking = false } = {}) {
  const acct = new Map(accounts.map(a => [a.id, a])), out = {};
  for (const t of txns) {
    if (!live(t) || !acct.get(t.accountId)?.onBudget) continue;
    if (excludeFlags.some(f => (t.flags || []).includes(f))) continue;
    const m = monthOf(t.date);
    for (const l of linesOf(t)) if (spendingLine(l, acct) && !(excludeTracking && l.transferAccountId)) { const o = (out[m] ??= {}); o[l.categoryId] = (o[l.categoryId] || 0) - l.amount; }
  }
  return out;
}
export function incomeByMonth(accounts, txns) {
  const acct = new Map(accounts.map(a => [a.id, a])), out = {};
  for (const t of txns) { if (!live(t) || !acct.get(t.accountId)?.onBudget) continue; for (const l of linesOf(t)) if (l.categoryId === RTA) out[monthOf(t.date)] = (out[monthOf(t.date)] || 0) + l.amount; }
  return out;
}
/** Categories whose recent spending has crept above their longer-run average or their target. */
export function creepAlerts(cats, spend, m, { recent = 3, long = 12, margin = 0.1 } = {}) {
  const months = n => monthRange(addMonths(m, -n), addMonths(m, -1));
  const avg = (id, ms) => Math.round(sum(ms, k => spend[k]?.[id] || 0) / ms.length);
  const out = [];
  for (const c of cats) {
    if (c.kind === 'cc' || c.hidden) continue;
    const r = avg(c.id, months(recent)), l = avg(c.id, months(long)), tgt = c.target?.type === 'need' && (c.target.every || 'month') === 'month' ? c.target.amount : null;
    if (r <= 0) continue;
    if (l > 0 && r > l * (1 + margin)) out.push({ id: c.id, recent: r, long: l, by: r - l, vs: 'average' });
    else if (tgt && r > tgt * (1 + margin)) out.push({ id: c.id, recent: r, long: tgt, by: r - tgt, vs: 'target' });
  }
  return out.sort((a, b) => b.by - a.by);
}
/** Days of buffering: how long the money in budget accounts would last at the average daily spend. */
export function daysOfBuffering(accounts, txns, day, lookbackDays = 90) {
  const on = accounts.filter(a => a.onBudget && !a.closed && a.type !== 'credit'), ids = new Set(on.map(a => a.id)), all = new Map(accounts.map(a => [a.id, a]));
  let cash = 0, out = 0; const from = addDays(day, -lookbackDays);
  for (const t of txns) {
    if (!live(t) || !ids.has(t.accountId) || t.date > day) continue; cash += t.amount;
    if (t.date > from) for (const l of linesOf(t)) if (l.amount < 0 && spendingLine(l, all)) out -= l.amount;
  }
  const perDay = out / lookbackDays; return perDay > 0 ? Math.floor(cash / perDay) : null;
}
