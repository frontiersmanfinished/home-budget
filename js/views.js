// What each screen shows. Each view returns HTML; taps are handled in main.js.
import * as E from './engine.js';
import * as D from './store.js';
import { S } from './store.js';
import { esc, icon, local } from './ui.js';
import * as Q from './search.js';

export const V = { view: 'home', month: E.thisMonth(), account: null, filter: null, search: '', selected: new Set(), shown: 120, shut: new Set(local.get('shut', [])), showHidden: false, showClosed: false };
const money = (c, o) => `<span class="money">${esc(E.fmt(c, o))}</span>`;
const goalCfg = () => S.config.goal || {};

// ---- Goal (the home fund) ----
export function goal() {
  const g = goalCfg(), cats = g.catIds || [], accts = g.accountIds || [];
  if (!cats.length && !accts.length) return null;
  const m = E.thisMonth(), bal = D.balances();
  const amount = E.sum(cats, id => D.catMonth(id, m).available) + E.sum(accts, id => bal[id]?.working || 0);
  const target = g.target || 0, pct = target ? Math.max(0, Math.min(1, amount / target)) : 0;
  const steps = (g.milestones || [0.1, 0.25, 0.5, 0.75, 1]).map(f => Math.round(target * f)).filter(Boolean);
  const next = steps.find(s => s > amount) || null;
  // Average added each month over the last three, for "days of progress".
  const prev = [1, 2, 3].map(n => E.addMonths(m, -n));
  const added = E.sum(prev, k => E.sum(cats, id => D.catMonth(id, k).assigned)) / 3;
  return { name: g.name || 'Our home fund', amount, target, pct, next, perDay: added > 0 ? added / 30.4 : 0 };
}
export function goalBar() {
  const g = goal(); if (!g || !g.target || local.get('cue.header', true) === false) return '';
  return `<div class="goalbar">${icon('house')}<span class="bar"><i style="width:${(g.pct * 100).toFixed(1)}%"></i></span><span>${Math.round(g.pct * 100)}%</span></div>`;
}

// ---- Home: the simple view ----
export function viewHome() {
  const g = goal(), m = E.thisMonth(), cfg = S.config.simple || {};
  const catIds = (cfg.catIds && cfg.catIds.length ? cfg.catIds : S.categories.filter(c => /grocer|food|lifestyle|kids/i.test(c.name)).map(c => c.id)).filter(id => D.category(id));
  const mine = (S.config.people || []).find(p => p.email && p.email.toLowerCase() === (S.user?.email || '').toLowerCase());
  const hero = g ? `<section class="card hero"><div class="muted">${esc(g.name)}</div><div class="bignum">${money(g.amount, { cents: false })}</div>${g.target ? `<span class="bar"><i style="width:${(g.pct * 100).toFixed(1)}%"></i></span><div class="next-ms">${g.next ? `${money(g.next - g.amount, { cents: false })} to our next step of ${money(g.next, { cents: false })}` : 'We reached our target!'}</div>` : ''}</section>`
    : `<section class="card hero"><div class="mid">Our goal</div><p class="muted" style="margin:.4rem 0 .9rem">Name the goal and choose what counts towards it, and its progress will show here.</p><button class="btn primary" data-go="settings">Set up our goal</button></section>`;
  const cards = catIds.map(id => {
    const c = D.category(id), st = D.catMonth(id, m), left = st.available, budgeted = st.carried + st.assigned, spentPct = budgeted > 0 ? Math.min(1, -Math.min(0, st.activity) / budgeted) : 0;
    return `<button class="card lcard" data-cat="${esc(id)}"><span class="txt"><b>${left >= 0 ? `${money(left)} left` : `${money(-left)} over`}</b><small>for ${esc(c.name.toLowerCase())}</small><span class="bar${left < 0 ? ' late' : ''}"><i style="width:${(100 - spentPct * 100).toFixed(0)}%"></i></span></span></button>`;
  }).join('');
  const personal = mine?.catId && D.category(mine.catId) ? `<button class="card lcard" data-cat="${esc(mine.catId)}"><span class="tile sm" style="--tile:#F4C7AB">${icon('wallet')}</span><span class="txt"><b>${money(D.catMonth(mine.catId, m).available)}</b><small>your spending money</small></span></button>` : '';
  const waiting = D.queue().length;
  return `${hero}
  <button class="btn primary wide big" data-afford>${icon('scale')} Can we afford this?</button>
  <h2 class="sec">This month</h2><div class="cards">${personal}${cards || '<p class="muted pad">Choose which categories show here in Settings.</p>'}</div>
  ${waiting ? `<button class="banner" data-tab="accounts">${icon('inbox')}<span>${waiting} new transaction${waiting > 1 ? 's' : ''} to approve</span></button>` : ''}`;
}

// ---- Budget ----
function catRow(c, m) {
  const st = D.catMonth(c.id, m), t = E.targetFor(c, m, st);
  const cls = st.available < 0 ? (st.creditOver && !st.cashOver ? 'credit' : 'neg') : st.available === 0 ? 'zero' : '';
  const sub = st.available < 0 ? `<small class="over">${st.creditOver && !st.cashOver ? 'Card spending not covered' : `Overspent: move ${esc(E.fmt(-st.available))} to cover it?`}</small>`
    : t && t.under > 0 ? `<small class="needs">${esc(E.fmt(t.under))} more needed this month</small>`
    : `<small class="muted">Assigned ${esc(E.fmt(st.assigned))}</small>`;
  return `<button class="cat" data-cat="${esc(c.id)}"><span class="txt"><b>${esc(c.name)}</b>${sub}${t ? `<span class="bar${t.pct < 1 ? ' part' : ''}"><i style="width:${(t.pct * 100).toFixed(0)}%"></i></span>` : ''}</span><span class="pillv ${cls}">${money(st.available)}</span></button>`;
}
export function viewBudget() {
  const m = V.month, r = D.rta(m), b = D.budget();
  const groups = [...S.groups].sort((a, b2) => (a.order ?? 0) - (b2.order ?? 0));
  const under = E.sum(S.categories.filter(c => !c.hidden && c.target), c => E.targetFor(c, m, D.catMonth(c.id, m))?.under || 0);
  const over = b.months[E.addMonths(m, -1)]?.cashOverspent || 0;
  let html = `<div class="monthnav"><button data-month="-1" aria-label="Previous month">${icon('chevron-left')}</button><b>${esc(E.monthName(m))}</b><button data-month="1" aria-label="Next month">${icon('chevron-right')}</button></div>
  <section class="card rta ${r < 0 ? 'neg' : r === 0 ? 'zero' : ''}"><div><small>${r < 0 ? 'Assigned more than we have' : 'Ready to Assign'}</small><b class="mid">${money(r)}</b>${over && m === E.thisMonth() ? `<small>After covering ${esc(E.fmt(over))} overspent in ${esc(E.monthName(E.addMonths(m, -1), false).split(' ')[0])}</small>` : ''}</div>${under > 0 && r > 0 ? `<button class="btn ghost" data-assign-under>${icon('target')} Fund targets<br><small class="muted">${esc(E.fmt(under))} needed</small></button>` : ''}</section>`;
  for (const g of groups) {
    const cats = S.categories.filter(c => c.groupId === g.id && !c.hidden).sort((a, b2) => (a.order ?? 0) - (b2.order ?? 0));
    if (!cats.length || g.hidden) continue;
    const shut = V.shut.has(g.id), total = E.sum(cats, c => D.catMonth(c.id, m).available);
    html += `<section class="grp${shut ? ' shut' : ''}"><button class="grp-h" data-grp="${esc(g.id)}">${icon('chevron-down', 'chev')}<span class="gname">${esc(g.name)}</span>${money(total)}</button>${shut ? '' : `<div class="catlist">${cats.map(c => catRow(c, m)).join('')}</div>`}</section>`;
  }
  const hidden = S.categories.filter(c => c.hidden);
  if (hidden.length) html += `<button class="btn ghost wide" data-hidden>${V.showHidden ? 'Hide' : 'Show'} ${hidden.length} hidden categor${hidden.length > 1 ? 'ies' : 'y'}</button>${V.showHidden ? `<div class="catlist" style="margin-top:.5rem">${hidden.map(c => catRow(c, m)).join('')}</div>` : ''}`;
  return html;
}

// ---- Accounts and registers ----
const acctRow = (a, bal) => `<button class="acct" data-acct="${esc(a.id)}"><span class="tile sm" style="--tile:${a.type === 'credit' ? '#F4C7AB' : a.onBudget ? '#B9D6C8' : '#C7B8E0'}">${icon(a.type === 'credit' ? 'credit-card' : a.type === 'loan' ? 'landmark' : a.onBudget ? 'wallet' : 'piggy-bank')}</span><span class="txt"><b>${esc(a.name)}</b>${bal.uncleared ? `<small>${esc(E.fmt(bal.uncleared))} not yet cleared</small>` : ''}</span><span class="money">${esc(E.fmt(bal.working))}</span></button>`;
export function viewAccounts() {
  const bal = D.balances(), list = D.accountsSorted(), waiting = D.queue();
  const sect = (title, accts) => accts.length ? `<h2 class="sec">${title}<small>${esc(E.fmt(E.sum(accts, a => bal[a.id].working)))}</small></h2><div class="list">${accts.map(a => acctRow(a, bal[a.id])).join('')}</div>` : '';
  const closed = list.filter(a => a.closed);
  return `${upBanners()}${waiting.length ? `<section class="banner">${icon('inbox')}<span style="flex:1">${waiting.length} transaction${waiting.length > 1 ? 's' : ''} waiting for approval</span><button class="btn ghost" data-acct="__approve">Review</button></section>` : ''}
  ${D.openPlans().length ? `<button class="card lcard" data-bnpl style="margin-top:.5rem">${icon('receipt')}<span class="txt"><b>Buy now, pay later</b><small>${D.openPlans().length} plan${D.openPlans().length > 1 ? 's' : ''} still being paid off</small></span><span class="money">${esc(E.fmt(D.bnplOutstanding()))}</span></button>` : ''}
  <button class="card lcard" data-acct="__all" style="margin-top:.5rem">${icon('search')}<span class="txt"><b>All transactions</b><small>Search every account</small></span>${icon('chevron-right')}</button>
  ${sect('Budget accounts', list.filter(a => a.onBudget && !a.closed))}${sect('Tracking accounts', list.filter(a => !a.onBudget && !a.closed))}
  ${closed.length ? `<button class="btn ghost wide" data-closed>${V.showClosed ? 'Hide' : 'Show'} ${closed.length} closed accounts</button>${V.showClosed ? `<div class="list" style="margin-top:.5rem">${closed.map(a => acctRow(a, bal[a.id])).join('')}</div>` : ''}` : ''}`;
}
export function searchCtx() {
  const cats = new Map(S.categories.map(c => [c.id, c.name])), accts = new Map(S.accounts.map(a => [a.id, a])), fl = new Map(D.flags().map(f => [f.id, f.name]));
  return { payee: D.payeeName, category: id => (id === E.RTA ? 'Ready to Assign' : cats.get(id) || ''), account: id => accts.get(id)?.name || '', flag: id => fl.get(id) || '', who: t => t.who || '', onBudget: id => !!accts.get(id)?.onBudget, bnpl: t => (t.bnpl ? D.bnplLabel(t) : '') };
}
let rowsMemo = {};
export function registerRows() {
  const key = [S.v, V.account, V.search, JSON.stringify(V.filter)].join('|'); if (rowsMemo.key === key) return rowsMemo.rows;
  const id = V.account;
  let rows = D.txns();
  if (id === '__approve') rows = rows.filter(t => t.approved === false);
  else if (id && id !== '__all') rows = rows.filter(t => t.accountId === id);
  if (V.filter?.categoryId) rows = rows.filter(t => t.categoryId === V.filter.categoryId || (t.splits || []).some(s => s.categoryId === V.filter.categoryId));
  if (V.filter?.month) rows = rows.filter(t => E.monthOf(t.date) === V.filter.month);
  if (V.search.trim()) rows = rows.filter(Q.matcher(V.search, searchCtx()));
  rows.sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '') || (b.createdAt || 0) - (a.createdAt || 0));
  rowsMemo = { key, rows }; return rows;
}
const nameLists = () => ({ payee: Object.values(S.payees).filter(p => !p.hidden && !p.transferAccountId).map(p => p.name), category: S.categories.map(c => c.name), account: S.accounts.filter(a => !a.closed).map(a => a.name), flag: D.flags().map(f => f.name), who: (S.config.people || []).map(p => p.name).filter(Boolean) });
/** Under the search box: suggestions, saved searches, unknown terms, a day bar for on: searches, and select-all. */
export function registerExtras() {
  const q = V.search, p = Q.parse(q), rows = q.trim() ? registerRows() : null;
  const sugg = Q.suggest(q, nameLists());
  const saved = S.config.savedSearches || [];
  let html = '';
  if (sugg.length) html += `<div class="pills">${sugg.map(s => `<button class="pill" data-q="${esc(s.text)}">${esc(s.label)}</button>`).join('')}</div>`;
  else if (!q.trim() && saved.length) html += `<div class="pills">${saved.map((s, i) => `<button class="pill" data-q="${esc(s.q)}">${icon('star')}${esc(s.name)}</button>`).join('')}</div>`;
  if (p.bad.length) html += `<p class="muted f-sub">Not understood: ${p.bad.map(esc).join(', ')}. Tap ? for the search terms.</p>`;
  if (p.on) {
    const cleared = E.sum(rows.filter(t => t.cleared !== 'u'), t => t.amount);
    html += `<div class="card daybar"><button data-day="-1" aria-label="Previous day">${icon('chevron-left')}</button><div><b>${esc(Q.longDate(p.on))}</b><small>Cleared that day: ${esc(E.fmt(cleared, { sign: true }))} · ${rows.length} transaction${rows.length === 1 ? '' : 's'}</small></div><button data-day="1" aria-label="Next day">${icon('chevron-right')}</button></div>`;
  }
  if (rows && rows.length) html += `<div class="row" style="margin:.3rem 0"><small class="muted grow" style="font-weight:400">${rows.length.toLocaleString('en-AU')} found${rows.length > 1 ? `, ${esc(E.fmt(E.sum(rows, t => t.amount), { sign: true }))} in total` : ''}</small><button class="btn ghost" data-select-all style="min-height:38px;font-size:.84rem">Select all</button></div>`;
  return html;
}
function txRow(t, showAcct) {
  const cat = t.splits ? 'Split' : t.transferAccountId && !t.categoryId ? `Transfer ${t.amount < 0 ? 'to' : 'from'} ${D.account(t.transferAccountId)?.name || ''}` : D.categoryLabel(t.categoryId) || '<span class="needs">Needs a category</span>';
  const fl = (t.flags || []).map(f => D.flag(f)).filter(Boolean).map(f => `<i class="fdot" style="background:${esc(flagColour(f.color))}" title="${esc(f.name)}"></i>`).join('');
  return `<div class="tx${V.selected.has(t.id) ? ' sel' : ''}${t.approved === false ? ' unapp' : ''}" data-tx="${esc(t.id)}" role="button" tabindex="0"><span class="txt"><b>${fl}${esc(D.bnplLabel(t) || D.payeeName(t.payeeId) || t.importPayee || 'No payee')}</b><small>${cat.includes('<span') ? cat : esc(cat)}${showAcct ? ` · ${esc(D.account(t.accountId)?.name || '')}` : ''}${t.memo ? ` · ${esc(t.memo)}` : ''}</small></span><span class="money${t.amount > 0 ? ' amt-in' : ''}">${esc(E.fmt(t.amount, { sign: true }))}</span><button class="clr ${t.cleared}" data-clr="${esc(t.id)}" aria-label="${t.cleared === 'r' ? 'Reconciled' : t.cleared === 'c' ? 'Cleared' : 'Not cleared'}"><i></i></button></div>`;
}
export const flagColour = c => ({ red: '#E09F8D', orange: '#F4B183', yellow: '#EBC97F', green: '#8FB9A8', blue: '#A7C4D9', purple: '#C7B8E0' }[c] || '#B4BFC6');
export function registerList() {
  const rows = registerRows(), showAcct = !V.account || V.account.startsWith('__');
  let html = '', day = null;
  for (const t of rows.slice(0, V.shown)) { if (t.date !== day) { if (day) html += '</div>'; day = t.date; html += `<div class="reg-day">${esc(new Date(t.date + 'T00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</div><div class="list">`; } html += txRow(t, showAcct); }
  if (day) html += '</div>';
  if (rows.length > V.shown) html += `<button class="btn ghost wide" data-more>Show more (${rows.length - V.shown} older)</button>`;
  return html || '<p class="muted pad">No transactions here.</p>';
}
export function viewRegister() {
  const a = D.account(V.account), bal = a ? D.balances()[a.id] : null;
  const filt = V.filter?.categoryId ? `<div class="pills"><button class="pill on" data-clear-filter>${esc(D.categoryLabel(V.filter.categoryId))}${V.filter.month ? ', ' + esc(E.monthName(V.filter.month, false)) : ''} ${icon('x')}</button></div>` : '';
  const head = a ? `<section class="card"><div class="kv">${(u => u ? `<span>Balance, including held</span><b>${money(bal.working)}</b><span>Up says</span><b>${money(u.balance)}${u.balance !== bal.working ? ` <small class="needs">(${esc(E.fmt(u.balance - bal.working, { sign: true }))})</small>` : ' ✓'}</b>${bal.uncleared ? `<span>Not settled yet</span><b>${money(bal.uncleared)}</b>` : ''}` : `<span>Working balance</span><b>${money(bal.working)}</b><span>Cleared</span><b>${money(bal.cleared)}</b>`)(upAccountFor(a.id))}${a.reconciledAt ? `<span>Last reconciled</span><b>${esc(new Date(a.reconciledAt).toLocaleDateString('en-AU'))}</b>` : ''}</div><div class="row"><button class="btn ghost" data-reconcile="${esc(a.id)}">${icon('check-check')} Reconcile</button><button class="btn ghost" data-edit-acct="${esc(a.id)}">${icon('pencil')} Account</button></div></section>`
    : V.account === '__approve' ? `<section class="card"><p>New transactions arrive with a suggested payee and category. They already count in balances.</p><button class="btn primary" data-approve-all>${icon('check-check')} Approve all</button></section>` : '';
  return `${head}${filt}<div class="search">${icon('search')}<input id="reg-q" type="search" placeholder="Search, e.g. payee:Foodland >50" value="${esc(V.search)}" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="x" data-save-search aria-label="Save this search">${icon('star')}</button><button class="x" data-search-help aria-label="Search terms">${icon('circle-help')}</button></div><div id="reg-extra">${registerExtras()}</div><div id="reg-list">${registerList()}</div>`;
}

// ---- Insights ----
export function viewInsights() {
  const m = E.thisMonth(), spend = E.spendingByMonth(S.accounts, D.txns(), { excludeFlags: ['f-reimburse'] }), inc = E.incomeByMonth(S.accounts, D.txns());
  const prev3 = [1, 2, 3].map(n => E.addMonths(m, -n));
  const cats = S.categories.filter(c => c.kind !== 'cc' && !c.hidden);
  const rows = cats.map(c => ({ c, now: spend[m]?.[c.id] || 0, avg: Math.round(E.sum(prev3, k => spend[k]?.[c.id] || 0) / 3) })).filter(r => r.now || r.avg).sort((a, b) => b.avg - a.avg);
  const max = Math.max(1, ...rows.map(r => Math.max(r.now, r.avg)));
  const creep = E.creepAlerts(cats, spend, m);
  const buf = E.daysOfBuffering(S.accounts, D.txns(), E.today());
  const last6 = Array.from({ length: 6 }, (_, i) => E.addMonths(m, i - 6));
  const kept = E.spendingByMonth(S.accounts, D.txns(), { excludeFlags: ['f-reimburse'], excludeTracking: true });
  const rate = k => { const i = inc[k] || 0, s = E.sum(Object.values(kept[k] || {})); return i > 0 ? (i - s) / i : null; };
  const lastRate = rate(E.addMonths(m, -1));
  const ie = last6.map(k => ({ k, i: inc[k] || 0, s: E.sum(Object.values(spend[k] || {})) })), ieMax = Math.max(1, ...ie.map(x => Math.max(x.i, x.s)));
  return `<section class="stats"><div class="card"><b>${lastRate === null ? '–' : Math.round(lastRate * 100) + '%'}</b><small>of income kept last month, incl. loan &amp; investments</small></div><div class="card"><b>${buf ?? '–'}</b><small>days our money would last</small></div><div class="card"><b>${esc(E.fmt(E.sum(Object.values(spend[m] || {})), { cents: false }))}</b><small>spent so far this month</small></div></section>
  ${creep.length ? `<h2 class="sec">Worth a look</h2><div class="cards">${creep.slice(0, 4).map(x => `<div class="card"><b>${esc(D.category(x.id)?.name)}</b><p class="muted" style="font-size:.86rem">Averaging ${esc(E.fmt(x.recent, { cents: false }))} a month lately, compared with ${esc(E.fmt(x.long, { cents: false }))} ${x.vs === 'target' ? 'targeted' : 'over the year'}.</p></div>`).join('')}</div>` : ''}
  <h2 class="sec">This month against the last three<small>bar: this month, line: average</small></h2>
  <section class="card hbars">${rows.map(r => `<div class="hb"><span>${esc(r.c.name)}</span><i style="position:relative"><i style="width:${(r.now / max * 100).toFixed(1)}%"></i><em style="position:absolute;top:-3px;bottom:-3px;left:${(r.avg / max * 100).toFixed(1)}%;width:2px;background:var(--text);opacity:.5"></em></i><b class="money">${esc(E.fmt(r.now, { cents: false }))}</b></div>`).join('') || '<p class="muted">No spending yet.</p>'}</section>
  <h2 class="sec">Income and spending</h2>
  <section class="card">${ie.map(x => `<div class="hb"><span>${esc(E.monthName(x.k, false))}</span><span style="display:grid;gap:3px"><i style="display:block;height:7px;border-radius:9px;background:var(--sage-d);width:${(x.i / ieMax * 100).toFixed(1)}%"></i><i style="display:block;height:7px;border-radius:9px;background:var(--coral);width:${(x.s / ieMax * 100).toFixed(1)}%"></i></span><b class="money" style="font-size:.78rem">${esc(E.fmt(x.i - x.s, { sign: true, cents: false }))}</b></div>`).join('')}<p class="muted" style="font-size:.78rem;margin-top:.4rem">Green: income. Coral: spending. Right: what was left.</p></section>`;
}

// ---- Up sync notices ----
export const ago = ms => { const m = Math.round((Date.now() - ms) / 60e3); return m < 2 ? 'just now' : m < 90 ? `${m} minutes ago` : m < 36 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
export function upBanners() {
  const st = S.syncState, links = D.upLinks(), out = [];
  if (!st) return '';
  const fresh = (st.accounts || []).filter(a => !links[a.id]);
  if (fresh.length && D.isApprover()) out.push(`<button class="banner" data-go="settings">${icon('landmark')}<span>${fresh.length === 1 ? `New Up account: ${esc(fresh[0].name)}.` : `${fresh.length} Up accounts aren't set up yet.`} Choose budget, track or ignore in Settings.</span></button>`);
  if (Object.keys(links).length && st.lastOk && Date.now() - st.lastOk > 26 * 3600e3) out.push(`<button class="banner" data-go="settings">${icon('cloud-off')}<span>Up hasn't synced since ${esc(new Date(st.lastOk).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}.${st.error ? ' ' + esc(st.error) : ''}</span></button>`);
  if ((st.webhooks || []).length) out.push(`<button class="banner" data-go="settings">${icon('triangle-alert')}<span>Up has ${st.webhooks.length} webhook${st.webhooks.length > 1 ? 's' : ''} the app didn't create. Check Settings.</span></button>`);
  return out.join('');
}
export const upAccountFor = accountId => { const id = Object.entries(D.upLinks()).find(([, l]) => l.accountId === accountId)?.[0]; return id ? (S.syncState?.accounts || []).find(a => a.id === id) || null : null; };
