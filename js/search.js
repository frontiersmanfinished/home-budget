// Search, YNAB style: payee:Foodland category:Groceries >100 on:yesterday -is:transfer "swimming lesson" OR …
// Also Australian day/month/year dates that can be typed in part. Pure functions; no screen, no database.
import * as E from './engine.js';

// ---- Dates ----
/** '19' → 19th of this month, '19/10' → 19 Oct this year, '19/10/26' or '19/10/2026', 'today', 'yesterday'. Null if not a date. */
export function parseDate(s, today = E.today()) {
  const t = String(s ?? '').trim().toLowerCase();
  if (t === 'today') return today;
  if (t === 'yesterday') return E.addDays(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})(?:[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?)?$/); if (!m) return null;
  const d = +m[1], mo = m[2] ? +m[2] : +today.slice(5, 7); let y = m[3] ? +m[3] : +today.slice(0, 4); if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > E.daysInMonth(`${y}-${String(mo).padStart(2, '0')}`)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** The dates a partly typed entry could mean: this month's day, plus last month's when this month's is still ahead. */
export function dateChoices(s, today = E.today()) {
  const t = String(s ?? '').trim(), d = parseDate(t, today);
  if (!d) { // "31" in November: the 31st of last month
    if (!/^\d{1,2}$/.test(t)) return [];
    const prev = E.addMonths(E.monthOf(today), -1); return +t >= 1 && +t <= E.daysInMonth(prev) ? [`${prev}-${t.padStart(2, '0')}`] : [];
  }
  const out = [d];
  if (/^\d{1,2}$/.test(t) && d > today) { const prev = E.addMonths(E.monthOf(today), -1); if (+t <= E.daysInMonth(prev)) out.push(`${prev}-${t.padStart(2, '0')}`); }
  if (/^\d{1,2}[/.-]\d{1,2}$/.test(t) && d > today) out.push(`${+d.slice(0, 4) - 1}${d.slice(4)}`);
  return out;
}
export const auDate = d => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
export const longDate = d => new Date(d + 'T00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function parseMonth(s, today) {
  const t = String(s).trim(); let m = t.match(/^(\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) { let y = +m[2]; if (y < 100) y += 2000; return +m[1] >= 1 && +m[1] <= 12 ? `${y}-${m[1].padStart(2, '0')}` : null; }
  if (/^\d{1,2}$/.test(t) && +t >= 1 && +t <= 12) return `${today.slice(0, 4)}-${t.padStart(2, '0')}`;
  if (t === 'this') return E.monthOf(today); if (t === 'last') return E.addMonths(E.monthOf(today), -1);
  return null;
}

// ---- The search terms, as listed behind the ? button ----
export const OPERATORS = [
  ['Free text', 'Foodland', 'The text in any field'],
  ['payee:', 'payee:Foodland', 'Transactions with that payee'],
  ['category:', 'category:Groceries', 'Transactions in that category'],
  ['memo:', 'memo:lunch', 'Text in the memo'],
  ['account:', 'account:Essentials', 'Transactions in that account'],
  ['flag:', 'flag:Reimburse', 'Transactions with that flag'],
  ['who:', 'who:Name', '2Up transactions made by that person'],
  ['Amount', '27.99', 'That exact amount'],
  ['> and <', '>100 or <20', 'Amounts above or below a figure'],
  ['on:', 'on:19/11/2026 or on:yesterday', 'One day'],
  ['before: and after:', 'before:01/11/2026', 'Dates before or after a day'],
  ['between:', 'between:01/11/2026..15/11/2026', 'A date range'],
  ['month:', 'month:11/2026', 'A whole month'],
  ['is:uncleared and is:cleared', 'is:uncleared', 'By cleared status'],
  ['is:reconciled and is:unreconciled', 'is:unreconciled', 'By reconciled status'],
  ['is:cleared-or-reconciled', 'is:cleared-or-reconciled', 'Cleared or reconciled'],
  ['is:matched', 'is:matched', 'Manual or scheduled entries matched to an import'],
  ['is:approved and is:unapproved', 'is:unapproved', 'By approval status'],
  ['is:needs-category', 'is:needs-category', 'Uncategorised transactions'],
  ['is:unapproved-or-needs-category', 'is:unapproved-or-needs-category', 'Either of those'],
  ['is:held', 'is:held', 'Up transactions not yet settled'],
  ['is:split', 'is:split', 'Split transactions'],
  ['is:transfer', 'is:transfer', 'Transfers between accounts'],
  ['is:bnpl', 'is:bnpl', 'Buy now, pay later instalments'],
  ['is:scheduled', 'is:scheduled', 'Scheduled transactions'],
  ['is:income', 'is:income', 'Inflows to Ready to Assign'],
  ['has:receipt', 'has:receipt', 'Transactions with a receipt'],
  ['has:memo', 'has:memo', 'Transactions with a memo'],
  ['AND', 'flag:Tax is:unreconciled', 'All terms; the default when terms are separated by spaces'],
  ['OR', 'payee:Foodland OR payee:Coles', 'Either term'],
  ['-', '-is:transfer', 'Excludes a term'],
  ['Quotes', '"swimming lesson"', 'An exact phrase'],
];
export const FIELDS = ['payee', 'category', 'memo', 'account', 'flag', 'who', 'on', 'before', 'after', 'between', 'month', 'is', 'has'];
export const IS = ['uncleared', 'cleared', 'reconciled', 'unreconciled', 'cleared-or-reconciled', 'matched', 'approved', 'unapproved', 'needs-category', 'unapproved-or-needs-category', 'held', 'split', 'transfer', 'bnpl', 'scheduled', 'income'];
export const HAS = ['receipt', 'memo'];

/** Split into words, keeping "quoted phrases" and field:"quoted values" whole. */
export function tokens(q) {
  const out = []; const re = /(-?)(?:(\w+):)?("([^"]*)"?|\S+)/g; let m;
  while ((m = re.exec(q))) {
    const raw = m[0], neg = m[1] === '-', field = m[2]?.toLowerCase(), quoted = m[4] !== undefined, value = quoted ? m[4] : m[3];
    if (!field && !quoted && !neg && value === 'OR') { out.push({ or: true }); continue; }
    out.push({ raw, neg, field: FIELDS.includes(field) ? field : null, value: FIELDS.includes(field) ? value : (field ? `${field}:${value}` : value), quoted });
  }
  return out;
}
/** Parse a search into AND-ed groups of OR-ed terms. Unknown terms are listed so the screen can point them out. */
export function parse(q, today = E.today()) {
  const groups = [], bad = []; let joinNext = false;
  for (const t of tokens(q)) {
    if (t.or) { joinNext = groups.length > 0; continue; }
    const term = toTerm(t, today); if (!term) { bad.push(t.raw); continue; }
    if (joinNext) groups.at(-1).push(term); else groups.push([term]);
    joinNext = false;
  }
  const onG = groups.find(g => g.length === 1 && g[0].kind === 'on' && !g[0].neg);
  return { groups, bad, on: onG ? onG[0].date : null };
}
function toTerm(t, today) {
  const v = t.value, low = String(v).toLowerCase(), neg = t.neg;
  switch (t.field) {
    case 'payee': case 'category': case 'memo': case 'account': case 'flag': case 'who': return v ? { kind: t.field, text: low, neg } : null;
    case 'on': { const d = parseDate(v, today); return d ? { kind: 'on', date: d, neg } : null; }
    case 'before': { const d = parseDate(v, today); return d ? { kind: 'range', to: E.addDays(d, -1), neg } : null; }
    case 'after': { const d = parseDate(v, today); return d ? { kind: 'range', from: E.addDays(d, 1), neg } : null; }
    case 'between': { const [a, b] = String(v).split('..').map(x => parseDate(x, today)); return a && b ? { kind: 'range', from: a < b ? a : b, to: a < b ? b : a, neg } : null; }
    case 'month': { const m = parseMonth(v, today); return m ? { kind: 'month', month: m, neg } : null; }
    case 'is': return IS.includes(low) ? { kind: 'is', what: low, neg } : null;
    case 'has': return HAS.includes(low) ? { kind: 'has', what: low, neg } : null;
  }
  if (!t.quoted) {
    let m = String(v).match(/^([<>])=?\$?([\d,]*\.?\d+)$/); if (m) return { kind: 'cmp', op: m[1], cents: E.parseMoney(m[2]), eq: String(v).includes('='), neg };
    if (/^\$?[\d,]*\.\d{1,2}$|^\$[\d,]+$/.test(v)) return { kind: 'amount', cents: Math.abs(E.parseMoney(v)), neg };
    if (/^\d+$/.test(v)) return { kind: 'text', text: low, cents: E.parseMoney(v), neg }; // "45": text, or $45.00
  }
  return { kind: 'text', text: low, neg };
}

/**
 * ctx gives names for ids: { payee(id), category(id), account(id), flag(id), who(t), onBudget(accountId), bnpl(t) }.
 */
export function matcher(q, ctx, today = E.today()) {
  const p = parse(q, today);
  const test = (term, t) => {
    const lines = E.linesOf(t), has = (s, x) => String(s || '').toLowerCase().includes(x);
    switch (term.kind) {
      case 'payee': return has(ctx.payee(t.payeeId), term.text) || has(t.importPayee, term.text) || has(ctx.bnpl?.(t), term.text);
      case 'category': return lines.some(l => has(ctx.category(l.categoryId), term.text));
      case 'memo': return has(t.memo, term.text) || lines.some(l => has(l.memo, term.text));
      case 'account': return has(ctx.account(t.accountId), term.text);
      case 'flag': return (t.flags || []).some(f => has(ctx.flag(f), term.text));
      case 'who': return has(ctx.who(t), term.text);
      case 'on': return t.date === term.date;
      case 'range': return (!term.from || t.date >= term.from) && (!term.to || t.date <= term.to);
      case 'month': return E.monthOf(t.date) === term.month;
      case 'amount': return Math.abs(t.amount) === term.cents || lines.some(l => Math.abs(l.amount) === term.cents);
      case 'cmp': { const a = Math.abs(t.amount); return term.op === '>' ? (term.eq ? a >= term.cents : a > term.cents) : (term.eq ? a <= term.cents : a < term.cents); }
      case 'has': return term.what === 'memo' ? !!(t.memo || lines.some(l => l.memo)) : !!t.receipt;
      case 'is': return isTest(term.what, t, ctx);
      case 'text': return (term.cents != null && Math.abs(t.amount) === term.cents) || [ctx.payee(t.payeeId), t.importPayee, t.memo, ctx.account(t.accountId), ctx.bnpl?.(t), ...lines.map(l => ctx.category(l.categoryId) + ' ' + (l.memo || '')), ...(t.flags || []).map(ctx.flag)].some(s => has(s, term.text));
    }
    return false;
  };
  const fn = t => p.groups.every(g => g.some(term => test(term, t) !== term.neg));
  fn.parsed = p; return fn;
}
function isTest(what, t, ctx) {
  const lines = E.linesOf(t), xfer = !!t.transferAccountId || lines.some(l => l.transferAccountId);
  const needsCat = ctx.onBudget(t.accountId) && lines.some(l => !l.categoryId && !(l.transferAccountId && ctx.onBudget(l.transferAccountId)));
  switch (what) {
    case 'uncleared': return t.cleared === 'u'; case 'cleared': return t.cleared === 'c'; case 'reconciled': return t.cleared === 'r'; case 'unreconciled': return t.cleared !== 'r';
    case 'cleared-or-reconciled': return t.cleared !== 'u';
    case 'matched': return !!t.matchedFrom || ((t.source === 'manual' || t.source === 'scheduled') && !!(t.upId || t.importId));
    case 'approved': return t.approved !== false; case 'unapproved': return t.approved === false;
    case 'needs-category': return needsCat; case 'unapproved-or-needs-category': return t.approved === false || needsCat;
    case 'held': return t.upStatus === 'HELD'; case 'split': return !!(t.splits && t.splits.length);
    case 'transfer': return xfer; case 'bnpl': return !!t.bnpl; case 'scheduled': return !!t.scheduledId || t.source === 'scheduled';
    case 'income': return lines.some(l => l.categoryId === E.RTA);
  }
  return false;
}

/** Suggestions for the word being typed: field names, is:/has: values, or names from the budget. */
export function suggest(q, names) {
  const m = q.match(/(-?)(?:(\w+):)?("?[^"\s]*)$/); if (!m) return [];
  const [, neg, field, partRaw] = m, part = partRaw.replace(/^"/, '').toLowerCase(), head = q.slice(0, q.length - m[0].length);
  const make = (label, text) => ({ label, text: head + neg + text + ' ' });
  if (!field) return part ? FIELDS.filter(f => f.startsWith(part)).map(f => ({ label: f + ':', text: head + neg + f + ':' })) : [];
  const f = field.toLowerCase(), quote = s => (/\s/.test(s) ? `"${s}"` : s);
  if (f === 'is') return IS.filter(x => x.startsWith(part)).slice(0, 8).map(x => make('is:' + x, 'is:' + x));
  if (f === 'has') return HAS.filter(x => x.startsWith(part)).map(x => make('has:' + x, 'has:' + x));
  if (f === 'on' || f === 'before' || f === 'after') return ['today', 'yesterday'].filter(x => x.startsWith(part)).map(x => make(`${f}:${x}`, `${f}:${x}`));
  const list = names[f]; if (!list || !part) return [];
  return [...new Set(list)].filter(n => n.toLowerCase().includes(part)).sort((a, b) => (a.toLowerCase().startsWith(part) ? 0 : 1) - (b.toLowerCase().startsWith(part) ? 0 : 1) || a.localeCompare(b)).slice(0, 8).map(n => make(`${f}:${n}`, `${f}:${quote(n)}`));
}
/** Replace (or add) the on: term, for stepping a day at a time. */
export function withOn(q, date) {
  const term = `on:${auDate(date)}`;
  return /(^|\s)on:\S+/.test(q) ? q.replace(/(^|\s)on:\S+/, `$1${term}`) : (q.trim() + ' ' + term).trim();
}
