// Turns a YNAB API full plan export (GET /v1/plans/{id}) into the app's data. Pure: no Firebase, no screen.
import { RTA } from './engine.js';

const cents = mu => { if (mu % 10) throw new Error(`Amount ${mu} has fractions of a cent`); return mu / 10; };
const ACCOUNT_TYPES = { checking: 'checking', savings: 'savings', cash: 'cash', creditCard: 'credit', lineOfCredit: 'credit', otherAsset: 'asset', otherLiability: 'loan', mortgage: 'loan', autoLoan: 'loan', studentLoan: 'loan', personalLoan: 'loan', medicalDebt: 'loan', otherDebt: 'loan' };
const CLEARED = { cleared: 'c', uncleared: 'u', reconciled: 'r' };
const FLAG_NAMES = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' };
const CADENCE = { 2: 'week', 13: 'year' };

/** YNAB goal fields → this app's target, or null. */
export function targetFrom(c) {
  if (!c.goal_type) return null;
  const amount = cents(c.goal_target || 0), date = c.goal_target_date || c.goal_target_month || null;
  switch (c.goal_type) {
    case 'TB': return { type: 'balance', amount };
    case 'TBD': return { type: 'balance', amount, date };
    case 'MF': return { type: 'monthly', amount };
    case 'DEBT': return { type: 'debt', amount };
    case 'NEED': {
      const cad = c.goal_cadence ?? 1, f = c.goal_cadence_frequency || 1, t = { type: 'need', amount, refill: c.goal_needs_whole_amount === false };
      if (cad === 0) return date ? { type: 'byDate', amount, date } : { ...t, every: 'month' };
      if (cad === 1) return f > 1 ? { ...t, every: 'months', everyMonths: f, due: date } : { ...t, every: 'month', day: c.goal_day ?? null };
      if (cad === 2) return { ...t, every: 'week', weekday: c.goal_day ?? 1, everyWeeks: f };
      if (cad === 13) return { ...t, every: 'year', everyYears: f, due: date };
      if (cad >= 3 && cad <= 12) return { ...t, every: 'months', everyMonths: cad - 1, due: date };
      if (cad === 14) return { ...t, every: 'year', everyYears: 2, due: date };
      return { ...t, every: CADENCE[cad] || 'month' };
    }
    default: return null;
  }
}

export function convertYnab(json) {
  const p = json.data?.plan || json.data?.budget || json.plan || json.budget;
  if (!p || !p.accounts || !p.transactions) throw new Error('This isn\'t a full YNAB plan export.');
  const groupsIn = p.category_groups.filter(g => !g.deleted);
  const internal = new Set(groupsIn.filter(g => g.internal).map(g => g.id));
  const ccGroup = groupsIn.find(g => g.name === 'Credit Card Payments');
  const rtaId = p.categories.find(c => c.name === 'Inflow: Ready to Assign' || c.name === 'Inflow: To be Budgeted')?.id;
  const uncatId = p.categories.find(c => c.internal && c.name === 'Uncategorized')?.id;
  const accounts = p.accounts.filter(a => !a.deleted).map((a, i) => ({
    id: a.id, name: a.name, type: ACCOUNT_TYPES[a.type] || 'checking', onBudget: a.on_budget, closed: a.closed, order: i, note: a.note || '',
    rates: a.debt_interest_rates && Object.keys(a.debt_interest_rates).length ? Object.fromEntries(Object.entries(a.debt_interest_rates).map(([k, v]) => [k.slice(0, 7), v / 1000])) : null,
    reconciledAt: a.last_reconciled_at || null,
  }));
  const acctByName = new Map(accounts.map(a => [a.name, a]));
  const groups = groupsIn.filter(g => !g.internal || g.id === ccGroup?.id).map((g, i) => ({ id: g.id, name: g.name, order: g.id === ccGroup?.id ? -1 : i, hidden: g.hidden, kind: g.id === ccGroup?.id ? 'cc' : null }));
  const groupIds = new Set(groups.map(g => g.id));
  const catOrder = {};
  const categories = p.categories.filter(c => !c.deleted && c.id !== rtaId && c.id !== uncatId && (!internal.has(c.category_group_id) || c.category_group_id === ccGroup?.id || c.original_category_group_id)).map(c => {
    const groupId = groupIds.has(c.original_category_group_id) ? c.original_category_group_id : c.category_group_id;
    const isCc = groupId === ccGroup?.id, acc = isCc ? acctByName.get(c.name) : null;
    catOrder[groupId] = (catOrder[groupId] ?? -1) + 1;
    return { id: c.id, groupId, name: c.name, order: catOrder[groupId], hidden: !!c.hidden || internal.has(c.category_group_id) && !isCc, note: c.note || '', target: isCc ? null : targetFrom(c), kind: isCc ? 'cc' : null, accountId: acc?.id || null };
  });
  const catIds = new Set(categories.map(c => c.id));
  const catMap = id => id === rtaId ? RTA : catIds.has(id) ? id : null;

  const assigned = {};
  for (const m of p.months) {
    if (m.deleted) continue; const k = m.month.slice(0, 7);
    for (const c of m.categories) if (c.budgeted && catIds.has(c.id)) (assigned[k] ??= {})[c.id] = cents(c.budgeted);
  }
  const flagIds = new Map();
  const flagFor = (color, name) => { if (!color) return []; const label = name || FLAG_NAMES[color] || color, id = `f-${color}${name ? '-' + name.toLowerCase().replace(/\W+/g, '-') : ''}`; if (!flagIds.has(id)) flagIds.set(id, { id, name: label, color }); return [id]; };

  const subs = new Map();
  for (const s of p.subtransactions) if (!s.deleted) (subs.get(s.transaction_id) || subs.set(s.transaction_id, []).get(s.transaction_id)).push(s);
  const payeeName = new Map(p.payees.map(x => [x.id, x.name]));
  const txns = p.transactions.filter(t => !t.deleted).map(t => {
    const sp = subs.get(t.id);
    return {
      id: t.id, date: t.date, amount: cents(t.amount), accountId: t.account_id, payeeId: t.payee_id || null, memo: t.memo || '',
      categoryId: sp ? null : catMap(t.category_id), transferAccountId: t.transfer_account_id || null, transferId: t.transfer_transaction_id || null,
      cleared: CLEARED[t.cleared] || 'u', approved: t.approved !== false, flags: flagFor(t.flag_color, t.flag_name),
      splits: sp ? sp.map(s => ({ amount: cents(s.amount), categoryId: catMap(s.category_id), transferAccountId: s.transfer_account_id || null, payeeId: s.payee_id || null, memo: s.memo || '' })) : null,
      importId: t.import_id || null, importPayee: t.import_payee_name_original || t.import_payee_name || null, source: 'ynab',
    };
  });
  const payees = p.payees.filter(x => !x.deleted).map(x => ({ id: x.id, name: x.name, transferAccountId: x.transfer_account_id || null }));
  // Each payee remembers the category it was last used with.
  const lastCat = new Map();
  for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date))) if (t.payeeId && t.categoryId && t.categoryId !== RTA) lastCat.set(t.payeeId, t.categoryId);
  payees.forEach(x => { x.categoryId = lastCat.get(x.id) || null; });
  const scheduled = p.scheduled_transactions.filter(s => !s.deleted).map(s => ({
    id: s.id, next: s.date_next, freq: s.frequency, amount: cents(s.amount), accountId: s.account_id, payeeId: s.payee_id || null, categoryId: s.subtransactions?.length ? null : catMap(s.category_id),
    transferAccountId: s.transfer_account_id || null, memo: s.memo || '', flags: flagFor(s.flag_color, s.flag_name),
    splits: s.subtransactions?.length ? s.subtransactions.filter(x => !x.deleted).map(x => ({ amount: cents(x.amount), categoryId: catMap(x.category_id), transferAccountId: x.transfer_account_id || null, memo: x.memo || '' })) : null,
  }));
  return { name: p.name, accounts, groups, categories, assigned, txns, payees, scheduled, flags: [...flagIds.values()], payeeName };
}

/** YNAB's own month figures from the export, for checking the import: { 'YYYY-MM': { rta, income, cats: { id: { assigned, activity, available } } } } */
export function ynabFigures(json) {
  const p = json.data?.plan || json.data?.budget || json.plan || json.budget, out = {};
  for (const m of p.months) {
    if (m.deleted) continue;
    out[m.month.slice(0, 7)] = { rta: cents(m.to_be_budgeted), income: cents(m.income), cats: Object.fromEntries(m.categories.filter(c => !c.deleted).map(c => [c.id, { assigned: cents(c.budgeted), activity: cents(c.activity), available: cents(c.balance) }])) };
  }
  return out;
}
