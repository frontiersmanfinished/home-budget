// Starting a budget (import, fresh start, template), fresh start later, archives, complete reset,
// and managing accounts, groups and categories.
import * as E from './engine.js';
import * as D from './store.js';
import { S } from './store.js';
import * as Q from './search.js';
import { convertYnab } from './ynab.js';
import { $, $$, esc, icon, openSheet, closeSheet, toast, confirmBox } from './ui.js';
import { V, flagColour } from './views.js';

const money = c => esc(E.fmt(c));
const pause = (ms = 240) => new Promise(r => setTimeout(r, ms));

// ---- Welcome: three ways to start ----
export function viewWelcome() {
  const r = S.reset, mine = r && r.email && r.email.toLowerCase() === (S.user?.email || '').toLowerCase();
  const notice = r && !mine && localStorage.getItem('hb.resetSeen') !== String(r.at) ? `<div class="banner">${icon('info')}<span style="flex:1">${esc(r.by || 'Someone')} reset the budget on ${esc(new Date(r.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}. Everything was deleted and a backup was saved first.</span><button class="x" data-seen-reset="${r.at}" aria-label="Dismiss">${icon('x')}</button></div>` : '';
  const opt = (k, ic, title, text) => `<button class="card lcard" data-start="${k}" style="margin-bottom:.6rem"><span class="tile" style="--tile:#B9D6C8">${icon(ic)}</span><span class="txt"><b>${title}</b><small>${text}</small></span>${icon('chevron-right')}</button>`;
  return `${notice}<p class="muted pad">How would you like to start?</p>
  ${opt('import', 'upload', 'Bring across our YNAB history', 'All transactions, targets and months, checked against YNAB\'s own figures before saving.')}
  ${opt('fresh', 'sprout', 'Fresh start from today', 'An empty budget. Today\'s account balances become opening balances.')}
  ${opt('template', 'layout-grid', 'Our categories, no transactions', 'Category structure and targets only, ready to fill in.')}
  <input type="file" id="start-file" hidden>`;
}

/** Where the structure comes from: a YNAB export file, or the basic categories. */
export function startFlow(kind) {
  if (kind === 'import') return $('#imp-ynab') ? $('#imp-ynab').click() : (pickFile(f => import('./pages.js').then(m => m.importYnabFile(f))));
  const b = openSheet(`<h2>${kind === 'fresh' ? 'Fresh start' : 'Categories only'}</h2><p class="muted">Where should the categories${kind === 'fresh' ? ' and accounts' : ''} come from?</p>
    <div class="pick"><button class="pick-row" data-src="file">${icon('upload')}<span>From our YNAB export<small>Groups, categories and targets${kind === 'fresh' ? ', plus open accounts' : ''}. No transactions are brought across.</small></span></button>
    <button class="pick-row" data-src="basic">${icon('layout-grid')}<span>Basic household categories<small>Needs, Wants and Savings, with no amounts. You can change them later.</small></span></button></div>`);
  b.onclick = e => {
    const x = e.target.closest('[data-src]'); if (!x) return;
    closeSheet();
    if (x.dataset.src === 'basic') return pause().then(() => accountsForm(kind, { ...D.BASIC_TEMPLATE, accounts: [], payees: [], scheduled: [] }));
    pickFile(async f => {
      let d; try { d = convertYnab(JSON.parse(await f.text())); } catch (err) { return toast('That isn\'t a full YNAB export'); }
      const bal = E.accountBalances(d.accounts, d.txns);
      const accounts = d.accounts.filter(a => !a.closed).map(a => ({ id: a.id, name: a.name, type: a.type, onBudget: a.onBudget, balance: bal[a.id].working }));
      accountsForm(kind, { groups: d.groups, categories: d.categories, accounts, payees: d.payees, scheduled: [] }, `Balances are from the YNAB export of ${new Date(JSON.parse(await f.text()).data.plan?.last_modified_on || Date.now()).toLocaleDateString('en-AU')}. Check each one against the bank today.`);
    });
  };
}
function pickFile(fn) { const i = document.createElement('input'); i.type = 'file'; i.onchange = () => i.files[0] && fn(i.files[0]); i.click(); }

/** List the accounts, with today's balances for a fresh start. */
export function accountsForm(kind, st, note = '', { later = false } = {}) {
  const rows = st.accounts.map(a => ({ ...a }));
  const withBal = kind !== 'template';
  const b = openSheet(`<div class="f-head"><b class="f-title grow">${later ? 'Fresh start from today' : kind === 'fresh' ? 'Today\'s balances' : 'Accounts'}</b><button class="x" data-close aria-label="Close">${icon('x')}</button></div>
    ${later ? `<p class="f-sub">The budget as it is now is archived first. It stays searchable and can be exported. Categories, targets, payees and settings carry over; assigned amounts and transactions start again.</p>` : ''}
    <p class="muted f-sub">${withBal ? `Enter each balance as the bank shows it today. Money owed on a card or loan is negative. ${esc(note)} The 2Up balances will come from Up once the sync is running.` : 'Balances can be added later. Each account starts at $0.'}</p>
    <div id="af-rows"></div><button class="btn ghost" id="af-add">${icon('plus')} Add account</button>
    <div class="row end sticky"><button class="btn primary" id="af-go">${later ? 'Archive and start fresh' : 'Start'}</button></div>`);
  const draw = () => {
    $('#af-rows', b).innerHTML = rows.map((a, i) => `<div class="card" style="padding:.6rem .7rem;margin:.5rem 0;box-shadow:none;background:var(--bg)"><div class="row in" style="margin:0"><input data-i="${i}" data-k="name" value="${esc(a.name)}" placeholder="Account name" style="flex:1"><button class="x" data-del="${i}" aria-label="Remove">${icon('x')}</button></div>
      <div class="row in"><select data-i="${i}" data-k="type" style="flex:1">${Object.entries(D.ACCOUNT_KINDS).map(([k, l]) => `<option value="${k}"${k === a.type ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${withBal ? `<input data-i="${i}" data-k="balance" inputmode="decimal" value="${(a.balance / 100).toFixed(2)}" style="width:8.5rem;text-align:right" aria-label="Balance today">` : ''}</div>
      <label class="mini" style="margin-top:.35rem"><input type="checkbox" data-i="${i}" data-k="onBudget"${a.onBudget ? ' checked' : ''}> In the budget (off for loans and investments we only track)</label></div>`).join('') || '<p class="muted pad">No accounts yet.</p>';
  };
  draw();
  b.addEventListener('change', e => {
    const x = e.target, i = x.dataset.i, k = x.dataset.k; if (i === undefined) return; const a = rows[+i];
    if (k === 'onBudget') a.onBudget = x.checked; else if (k === 'balance') a.balance = E.parseMoney(x.value) ?? 0; else a[k] = x.value;
    if (k === 'type') { a.onBudget = !['loan', 'asset'].includes(x.value); draw(); }
  });
  b.addEventListener('click', async e => {
    const x = e.target.closest('button'); if (!x) return;
    if (x.dataset.del !== undefined) { rows.splice(+x.dataset.del, 1); return draw(); }
    if (x.id === 'af-add') { rows.push({ name: '', type: 'checking', onBudget: true, balance: 0 }); draw(); return $$('#af-rows input[data-k="name"]', b).at(-1)?.focus(); }
    if (x.id !== 'af-go') return;
    const list = rows.filter(a => a.name.trim()).map(a => ({ ...a, name: a.name.trim() }));
    if (!list.length) return toast('Add at least one account');
    x.disabled = true; x.textContent = later ? 'Archiving…' : 'Setting up…';
    try {
      if (later) await D.freshStart({ accounts: list });
      else await D.replaceAll(D.newBudget({ ...st, accounts: list, withBalances: withBal, name: kind }), kind === 'fresh' ? 'Started fresh from today\'s balances' : 'Started from our categories and targets');
      localStorage.removeItem('hb.resetSeen');
      closeSheet(); await pause(); toast(later ? 'Archived. Fresh start ready' : 'Ready'); V.view = 'budget'; dispatchEvent(new Event('hb:render'));
    } catch (err) { console.error(err); x.disabled = false; x.textContent = 'Try again'; toast(`That didn't finish: ${err.message}`); }
  });
}
export const freshStartLater = () => accountsForm('fresh', D.currentStructure(), '', { later: true });

// ---- Archives ----
let archiveView = null;
export function viewArchives() {
  if (!S.archives.length) return '<p class="muted pad">No archives. A fresh start keeps the budget as it was here.</p>';
  return `<div class="list">${S.archives.map(a => `<button class="acct" data-archive="${esc(a.id)}">${icon('archive')}<span class="txt"><b>${esc(a.name)}</b><small>${a.count.toLocaleString('en-AU')} transactions${a.from ? `, ${esc(Q.auDate(a.from))} to ${esc(Q.auDate(a.to))}` : ''} · archived by ${esc(a.by)} ${esc(new Date(a.createdAt).toLocaleDateString('en-AU'))}</small></span>${icon('chevron-right')}</button>`).join('')}</div>`;
}
export async function openArchive(id) {
  const b = openSheet('<h2>Opening the archive…</h2>');
  try { archiveView = await D.loadArchive(id); } catch (e) { closeSheet(); return toast(e.message); }
  closeSheet(); await pause();
  const { meta, ctx, txns } = archiveView, cats = new Map(ctx.categories.map(c => [c.id, c.name])), accts = new Map(ctx.accounts.map(a => [a.id, a])), fl = new Map((ctx.flags || []).map(f => [f.id, f.name]));
  const sctx = { payee: id2 => ctx.payees[id2]?.name || '', category: c => (c === E.RTA ? 'Ready to Assign' : cats.get(c) || ''), account: a => accts.get(a)?.name || '', flag: f => fl.get(f) || '', who: t => t.who || '', onBudget: a => !!accts.get(a)?.onBudget, bnpl: () => '' };
  const s = openSheet(`<div class="f-head"><b class="f-title grow">${esc(meta.name)}</b><button class="x" data-close aria-label="Close">${icon('x')}</button></div><p class="muted f-sub">Read-only. ${txns.length.toLocaleString('en-AU')} transactions.</p>
    <div class="search">${icon('search')}<input id="ar-q" type="search" placeholder="Search, e.g. payee:Foodland month:03/2025" autocomplete="off" autocapitalize="off"></div><div id="ar-sum" class="muted f-sub"></div><div id="ar-list"></div>
    <div class="row end sticky"><button class="btn ghost" id="ar-csv">${icon('download')} Export CSV</button><button class="btn danger" id="ar-del">${icon('trash-2')}</button></div>`);
  let rows = txns;
  const draw = () => {
    const q = $('#ar-q', s).value; rows = (q.trim() ? txns.filter(Q.matcher(q, sctx)) : txns).filter(t => !t.deletedAt).sort((a, c) => c.date.localeCompare(a.date));
    $('#ar-sum', s).textContent = `${rows.length.toLocaleString('en-AU')} found, ${E.fmt(E.sum(rows, t => t.amount), { sign: true })} in total`;
    $('#ar-list', s).innerHTML = `<div class="list">${rows.slice(0, 200).map(t => `<div class="tx"><span class="txt"><b>${esc(sctx.payee(t.payeeId) || 'No payee')}</b><small>${esc(Q.auDate(t.date))} · ${esc(t.splits ? 'Split' : sctx.category(t.categoryId))} · ${esc(sctx.account(t.accountId))}${t.memo ? ' · ' + esc(t.memo) : ''}</small></span><span class="money${t.amount > 0 ? ' amt-in' : ''}">${esc(E.fmt(t.amount, { sign: true }))}</span></div>`).join('')}</div>${rows.length > 200 ? '<p class="muted f-sub">Showing the latest 200. Search to narrow it, or export everything.</p>' : ''}`;
  };
  draw(); let tm; $('#ar-q', s).oninput = () => { clearTimeout(tm); tm = setTimeout(draw, 150); };
  $('#ar-csv', s).onclick = () => import('./pages.js').then(m => m.download(`${meta.name.replace(/[^\w-]+/g, '-')}.csv`, toCsv(rows, sctx), 'text/csv'));
  $('#ar-del', s).onclick = () => confirmBox('Delete this archive?', 'It can\'t be brought back. Export it first if you might need it.', 'Delete', async () => { await D.deleteArchive(id); closeSheet(); toast('Archive deleted'); });
}
export function toCsv(rows, c) {
  const q = v => { const s2 = String(v ?? ''); return /[",\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2; };
  const lines = ['Date,Account,Payee,Category,Memo,Amount,Cleared,Flags'];
  for (const t of rows) for (const l of E.linesOf(t)) lines.push([Q.auDate(t.date), c.account(t.accountId), c.payee(l.payeeId || t.payeeId), c.category(l.categoryId), l.memo || t.memo, (l.amount / 100).toFixed(2), { u: 'Uncleared', c: 'Cleared', r: 'Reconciled' }[t.cleared], (t.flags || []).map(c.flag).join(' ')].map(q).join(','));
  return lines.join('\n');
}

// ---- Complete reset ----
export function openReset() {
  const other = (S.config.people || []).find(p => p.email && p.email.toLowerCase() !== (S.user?.email || '').toLowerCase());
  const b = openSheet(`<h2 class="over">Complete reset</h2>
    <p>This deletes everything: every transaction, the history, settings, saved searches and archives, on every phone. Nothing is kept. To keep the history and start again, use <b>Fresh start</b> instead.</p>
    <ol style="padding-left:1.2rem;font-size:.92rem;margin:.6rem 0"><li>A full backup downloads to this device first.</li><li>Everything is deleted and the app returns to the start screen.</li><li>${other ? esc(other.name) + ' sees' : 'The other phone shows'} a note saying who reset it and when.</li><li>The Up sync, once it's running, pauses until a new start is chosen. The Up token isn't touched.</li></ol>
    <label class="fld"><span>Type RESET to confirm</span><input id="rs-word" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn coral" id="rs-go" disabled>Back up and reset</button></div>`);
  const word = $('#rs-word', b), go = $('#rs-go', b);
  word.oninput = () => { go.disabled = word.value.trim() !== 'RESET'; };
  go.onclick = async () => {
    go.disabled = true; go.textContent = 'Saving backup…';
    try {
      const backup = await D.fullBackup();
      (await import('./pages.js')).download(`home-budget-before-reset-${E.today()}.json`, JSON.stringify(backup));
      await pause(800); go.textContent = 'Deleting…';
      await D.completeReset();
      closeSheet(); await pause(); V.view = 'welcome'; dispatchEvent(new Event('hb:render')); toast('Reset. The backup is in your downloads.');
    } catch (e) { console.error(e); go.textContent = 'Try again'; go.disabled = false; toast(`The reset didn't finish: ${e.message}. Nothing more will be deleted until you try again.`); }
  };
}

// ---- Accounts, groups and categories ----
export function viewStructure() {
  const groups = [...S.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const bal = D.balances();
  return `<h2 class="sec">Accounts</h2><div class="list">${D.accountsSorted().map(a => `<button class="acct" data-edit-acct="${esc(a.id)}"><span class="txt"><b>${esc(a.name)}</b><small>${esc(D.ACCOUNT_KINDS[a.type] || a.type)}${a.onBudget ? '' : ' · tracking'}${a.closed ? ' · closed' : ''}</small></span><span class="money">${money(bal[a.id]?.working || 0)}</span></button>`).join('')}</div>
  <button class="btn ghost wide" data-new-acct>${icon('plus')} Add account</button>
  <h2 class="sec">Categories</h2>
  ${groups.map(g => { const cats = S.categories.filter(c => c.groupId === g.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); return `<section class="grp"><div class="grp-h"><span class="gname">${esc(g.name)}</span>${g.kind === 'cc' ? '' : `<button class="x" data-edit-group="${esc(g.id)}" aria-label="Edit group">${icon('pencil')}</button><button class="x" data-new-cat="${esc(g.id)}" aria-label="Add category">${icon('plus')}</button>`}</div><div class="catlist">${cats.map(c => `<button class="cat" data-edit-cat="${esc(c.id)}"${g.kind === 'cc' ? ' disabled' : ''}><span class="txt"><b>${esc(c.name)}</b><small class="muted">${c.hidden ? 'Hidden' : c.target ? 'Has a target' : ''}</small></span>${g.kind === 'cc' ? '' : icon('pencil')}</button>`).join('') || '<p class="muted pad">No categories.</p>'}</div></section>`; }).join('')}
  <button class="btn ghost wide" data-new-group>${icon('plus')} Add group</button>`;
}
export function newAccount() {
  const b = openSheet(`<h2>Add account</h2><label class="fld"><span>Name</span><input id="na-name" autocomplete="off"></label>
    <label class="fld"><span>Type</span><select id="na-type">${Object.entries(D.ACCOUNT_KINDS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
    <label class="sw-row"><span>In the budget<small>Off for loans and investments we only track</small></span><input type="checkbox" id="na-on" checked><i></i></label>
    <label class="fld"><span>Balance today</span><input id="na-bal" inputmode="decimal" placeholder="0.00"></label><p class="muted f-sub">Money owed is negative. The balance is added as an opening balance today.</p>
    <div class="row end"><button class="btn primary" id="na-go">Add</button></div>`);
  $('#na-type', b).onchange = e => { $('#na-on', b).checked = !['loan', 'asset'].includes(e.target.value); };
  $('#na-go', b).onclick = () => {
    const name = $('#na-name', b).value.trim(); if (!name) return toast('Name the account');
    const type = $('#na-type', b).value, onBudget = $('#na-on', b).checked, bal = E.parseMoney($('#na-bal', b).value) || 0;
    const id = D.saveItem('accounts', null, { name, type, onBudget, closed: false, order: S.accounts.length }, `Added the account ${name}`);
    if (type === 'credit' && onBudget) {
      let g = S.groups.find(x => x.kind === 'cc'); const gid = g?.id || D.saveItem('groups', 'g-cc', { name: 'Credit Card Payments', order: -1, kind: 'cc' });
      D.saveItem('categories', 'cc-' + id.slice(0, 16), { groupId: gid, name, kind: 'cc', accountId: id, order: 0, hidden: false, target: null });
    }
    if (bal) { S.accounts.push({ id, name, type, onBudget }); D.addWithPayee({ date: E.today(), amount: bal, accountId: id, categoryId: onBudget && type !== 'credit' ? E.RTA : null, cleared: 'c', memo: 'Opening balance', source: 'start' }, 'Starting Balance'); }
    closeSheet(); toast('Account added');
  };
}
export function editGroup(id) {
  const g = id ? D.group(id) : null;
  const b = openSheet(`<h2>${g ? 'Group' : 'New group'}</h2><label class="fld"><span>Name</span><input id="eg-name" value="${esc(g?.name || '')}" autocomplete="off"></label>
    ${g ? `<label class="sw-row"><span>Hidden</span><input type="checkbox" id="eg-hide"${g.hidden ? ' checked' : ''}><i></i></label>` : ''}
    <div class="row end"><button class="btn primary" id="eg-go">Save</button></div>`);
  $('#eg-go', b).onclick = () => {
    const name = $('#eg-name', b).value.trim(); if (!name) return toast('Name the group');
    D.saveItem('groups', id, { name, ...(g ? { hidden: $('#eg-hide', b).checked } : { order: Math.max(0, ...S.groups.map(x => x.order ?? 0)) + 1 }) }, `${g ? 'Edited' : 'Added'} the group ${name}`); closeSheet();
  };
}
export function editCategory(id, groupId) {
  const c = id ? D.category(id) : null, used = id && D.txns().some(t => t.categoryId === id || (t.splits || []).some(x => x.categoryId === id));
  const groups = S.groups.filter(g => g.kind !== 'cc');
  const b = openSheet(`<h2>${c ? 'Category' : 'New category'}</h2><label class="fld"><span>Name</span><input id="ec-name" value="${esc(c?.name || '')}" autocomplete="off"></label>
    <label class="fld"><span>Group</span><select id="ec-group">${groups.map(g => `<option value="${esc(g.id)}"${g.id === (c?.groupId || groupId) ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
    <label class="fld"><span>Note</span><textarea id="ec-note" rows="2">${esc(c?.note || '')}</textarea></label>
    ${c ? `<label class="sw-row"><span>Hidden<small>Kept for history, left off the budget</small></span><input type="checkbox" id="ec-hide"${c.hidden ? ' checked' : ''}><i></i></label>` : ''}
    <div class="row end">${c && !used ? '<button class="btn danger" id="ec-del">Delete</button><span class="grow"></span>' : ''}<button class="btn primary" id="ec-go">Save</button></div>${c && used ? '<p class="muted f-sub">It has transactions, so it can be hidden but not deleted.</p>' : ''}`);
  $('#ec-go', b).onclick = () => {
    const name = $('#ec-name', b).value.trim(); if (!name) return toast('Name the category');
    const gid = $('#ec-group', b).value, order = c && c.groupId === gid ? c.order : S.categories.filter(x => x.groupId === gid).length;
    D.saveItem('categories', id, { name, groupId: gid, order, note: $('#ec-note', b).value.trim(), ...(c ? { hidden: $('#ec-hide', b).checked } : { hidden: false, target: null }) }, `${c ? 'Edited' : 'Added'} the category ${name}`); closeSheet();
  };
  $('#ec-del', b) && ($('#ec-del', b).onclick = () => { D.removeItem('categories', id, `Deleted the category ${c.name}`); closeSheet(); });
}
