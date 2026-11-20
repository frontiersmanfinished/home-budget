// Sheets that slide up: adding and editing transactions, picking a category, a category's details,
// "Can we afford this?", reconciling, and editing several transactions at once.
import * as E from './engine.js';
import * as D from './store.js';
import { S } from './store.js';
import { $, $$, esc, icon, openSheet, closeSheet, toast, confirmBox, pickFrom } from './ui.js';
import { V, goal, flagColour, upAccountFor } from './views.js';
import * as Q from './search.js';

const money = c => esc(E.fmt(c));
const amountText = c => (c ? (Math.abs(c) / 100).toFixed(2) : '');

// ---- Category picker: full height, searchable ----
export function pickCategory(title, onPick, { rta = false, m = E.thisMonth(), none = false } = {}) {
  const groups = [...S.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const b = openSheet(`<h2>${esc(title)}</h2><label class="search">${icon('search')}<input id="pk-q" type="search" placeholder="Type to filter" autocomplete="off"></label><div class="picker-list" id="pk-list"></div>`);
  const draw = q => {
    q = q.trim().toLowerCase(); let html = '';
    if (rta && (!q || 'ready to assign income'.includes(q))) html += `<button class="prow" data-id="${E.RTA}"><span>Ready to Assign <small>(income)</small></span><small>${money(D.rta(m))}</small></button>`;
    if (none && !q) html += `<button class="prow" data-id=""><span>No category</span></button>`;
    for (const g of groups) {
      if (g.kind === 'cc') continue;
      const cats = S.categories.filter(c => c.groupId === g.id && !c.hidden && (!q || c.name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q))).sort((a, b2) => (a.order ?? 0) - (b2.order ?? 0));
      if (cats.length) html += `<div class="lbl">${esc(g.name)}</div>` + cats.map(c => { const av = D.catMonth(c.id, m).available; return `<button class="prow" data-id="${esc(c.id)}"><span>${esc(c.name)}</span><small class="${av < 0 ? 'over' : ''}">${money(av)}</small></button>`; }).join('');
    }
    $('#pk-list', b).innerHTML = html || '<p class="muted pad">No matching category.</p>';
  };
  draw('');
  $('#pk-q', b).oninput = e => draw(e.target.value);
  b.addEventListener('click', e => { const r = e.target.closest('.prow'); if (r) { closeSheet(); setTimeout(() => onPick(r.dataset.id || null), 10); } });
}

// ---- Add or edit a transaction ----
export function openTxn(id, preset = {}) {
  const was = id ? D.txn(id) : null;
  const lastAcct = localStorage.getItem('hb.lastAcct');
  const firstAcct = D.accountsSorted().find(a => a.onBudget && !a.closed)?.id;
  const t = { date: E.today(), amount: 0, accountId: (V.account && !V.account.startsWith('__') ? V.account : null) || (D.account(lastAcct) && !D.account(lastAcct).closed ? lastAcct : firstAcct), cleared: 'u', flags: [], ...preset, ...(was ? JSON.parse(JSON.stringify(was)) : {}) };
  let inflow = t.amount > 0, splits = t.splits ? t.splits.map(s => ({ ...s })) : null;
  let payeeText = t.transferAccountId ? '' : D.payeeName(t.payeeId);
  const locked = was && was.cleared === 'r';
  const accts = D.accountsSorted().filter(a => !a.closed || a.id === t.accountId);
  const b = openSheet(`<div class="f-head"><b class="f-title grow">${was ? 'Transaction' : 'New transaction'}</b><button class="x" data-close aria-label="Close">${icon('x')}</button></div>
    ${locked ? `<div class="banner">${icon('lock')}<span>Reconciled. Changes here alter a balance the bank has confirmed.</span></div>` : ''}
    <div class="seg two" id="t-dir" style="margin-top:.6rem"><button data-dir="out">Money out</button><button data-dir="in">Money in</button></div>
    <input class="amount-in" id="t-amt" inputmode="decimal" placeholder="0.00" value="${amountText(t.amount)}" aria-label="Amount" autocomplete="off">
    <label class="fld"><span>Payee</span><div class="ac"><input id="t-payee" value="${esc(payeeText)}" placeholder="Who was it?" autocomplete="off"><div class="ac-list" id="t-ac" hidden></div></div></label>
    <div id="t-catbox"></div>
    <label class="fld"><span>Account</span><select id="t-acct">${accts.map(a => `<option value="${esc(a.id)}"${a.id === t.accountId ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <div class="row in" style="gap:.6rem;align-items:flex-end"><label class="fld" style="flex:1;margin-top:.6rem"><span>Date</span><div class="row in" style="margin:0;gap:.3rem"><input id="t-date-txt" value="${esc(Q.auDate(t.date))}" inputmode="numeric" autocomplete="off" aria-describedby="t-date-show"><button class="x" id="t-cal" aria-label="Calendar">${icon('calendar')}</button><input type="date" id="t-date" value="${esc(t.date)}" tabindex="-1" style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"></div></label><label class="sw-row"><span>Cleared</span><input type="checkbox" id="t-clr"${t.cleared !== 'u' ? ' checked' : ''}${locked ? ' disabled' : ''}><i></i></label></div>
    <div id="t-date-show" class="datechips"></div>
    <label class="fld"><span>Memo</span><input id="t-memo" value="${esc(t.memo || '')}" placeholder="Optional note" autocomplete="off"></label>
    <div class="fld"><span class="lbl">Flags</span><div class="pills wrap" id="t-flags">${D.flags().map(f => `<button class="pill${(t.flags || []).includes(f.id) ? ' on' : ''}" data-flag="${esc(f.id)}"><i class="fdot" style="background:${esc(flagColour(f.color))}"></i>${esc(f.name)}</button>`).join('')}</div></div>
    ${was ? `<p class="muted f-sub">${esc([was.createdBy && `Added by ${was.createdBy}`, was.updatedBy && was.updatedAt && `changed by ${was.updatedBy} ${new Date(was.updatedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}`, was.who && `spent by ${was.who}`, was.time && `bank time ${was.time}`, was.importPayee && `bank name: ${was.importPayee}`, was.upStatus === 'HELD' && 'held by Up, not settled yet', was.upStatus === 'GONE' && 'Up no longer shows this hold: it may have been released'].filter(Boolean).join(', '))}</p>` : ''}
    <div class="row end sticky">${was ? `<button class="btn danger" id="t-del">${icon('trash-2')} Delete</button><span class="grow"></span>` : ''}${was?.approved === false ? `<button class="btn ghost" id="t-approve">Approve</button>` : ''}<button class="btn primary" id="t-save">Save</button></div>`);
  const amt = $('#t-amt', b), payee = $('#t-payee', b), ac = $('#t-ac', b);
  const setDir = d => { inflow = d === 'in'; $$('#t-dir button', b).forEach(x => x.classList.toggle('on', x.dataset.dir === d)); drawCat(); };
  const signed = () => { const v = Math.abs(E.parseMoney(amt.value) || 0); return inflow ? v : -v; };
  function drawCat() {
    const box = $('#t-catbox', b);
    if (t.transferAccountId) {
      const needs = D.account(t.accountId || $('#t-acct', b)?.value)?.onBudget && !D.account(t.transferAccountId)?.onBudget;
      box.innerHTML = needs ? `<div class="fld"><span class="lbl">Category (money leaving the budget)</span><button class="btn ghost wide" id="t-cat">${esc(D.categoryLabel(t.categoryId) || 'Choose a category')}</button></div>` : '<p class="muted f-sub">Transfers between budget accounts don\'t need a category.</p>';
      return;
    }
    if (splits) {
      const total = signed(), used = E.sum(splits, s => s.amount), left = total - used;
      box.innerHTML = `<div class="fld"><span class="lbl">Split</span>${splits.map((s, i) => `<div class="splitrow"><button class="btn ghost" data-split-cat="${i}">${esc(D.categoryLabel(s.categoryId) || 'Category')}</button><input inputmode="decimal" data-split-amt="${i}" value="${amountText(s.amount)}" placeholder="0.00"><button class="x" data-split-del="${i}" aria-label="Remove">${icon('x')}</button></div>`).join('')}
        <div class="row" style="margin-top:.5rem"><button class="btn ghost" id="t-split-add">${icon('plus')} Add line</button><span class="grow"></span><small class="${left ? 'needs' : 'muted'}">${left ? `${money(Math.abs(left))} left to split` : 'All split'}</small></div><button class="btn ghost" id="t-unsplit" style="margin-top:.3rem">Don't split</button></div>`;
      return;
    }
    box.innerHTML = `<div class="fld"><span class="lbl">Category</span><div class="row in"><button class="btn ghost grow" id="t-cat" style="justify-content:flex-start">${esc(D.categoryLabel(t.categoryId) || 'Choose a category')}</button><button class="btn ghost" id="t-split" aria-label="Split">${icon('split')}</button></div></div>`;
  }
  setDir(inflow ? 'in' : 'out');
  // Dates can be typed in part: "19" is the 19th of this month, "19/10" is 19 October.
  const dTxt = $('#t-date-txt', b), dIso = $('#t-date', b), dShow = $('#t-date-show', b);
  const showDate = () => {
    const ch = Q.dateChoices(dTxt.value);
    if (!ch.length) { dShow.innerHTML = dTxt.value.trim() ? '<small class="needs">Not a date. Try 19 or 19/10.</small>' : ''; return; }
    if (!ch.includes(dIso.value)) dIso.value = ch[0];
    dShow.innerHTML = ch.map(d => `<button class="pill${d === dIso.value ? ' on' : ''}" data-date="${d}">${esc(Q.longDate(d))}</button>`).join('');
  };
  dTxt.oninput = () => { dIso.value = ''; showDate(); };
  dTxt.onfocus = () => dTxt.select();
  dIso.onchange = () => { if (dIso.value) { dTxt.value = Q.auDate(dIso.value); showDate(); } };
  const drawBnpl = () => {
    let box = $('#t-bnpl', b); if (!box) { box = document.createElement('div'); box.id = 't-bnpl'; $('#t-catbox', b).after(box); }
    const show = !t.transferAccountId && !inflow && (t.bnpl || D.isBnplName(payee.value));
    box.innerHTML = show ? `<button class="pill${t.bnpl ? ' on' : ''}" id="t-bnpl-btn" style="margin-top:.5rem">${icon('receipt')} ${t.bnpl ? esc(D.bnplLabel(t) || 'Buy now, pay later') : 'Buy now, pay later: which purchase?'}</button>` : '';
  };
  drawBnpl();
  if (!was) setTimeout(() => { if (!b.contains(document.activeElement)) amt.focus(); }, 250);
  // Payee autocomplete: payees, then transfers.
  const drawAc = () => {
    const q = payee.value.trim().toLowerCase(); if (!q) { ac.hidden = true; return; }
    const ps = Object.entries(S.payees).filter(([, p]) => !p.hidden && !p.transferAccountId && p.name.toLowerCase().includes(q)).sort((a, c) => (a[1].name.toLowerCase().startsWith(q) ? 0 : 1) - (c[1].name.toLowerCase().startsWith(q) ? 0 : 1) || a[1].name.localeCompare(c[1].name)).slice(0, 7);
    const tr = D.accountsSorted().filter(a => !a.closed && a.id !== $('#t-acct', b).value && ('transfer ' + a.name).toLowerCase().includes(q)).slice(0, 4);
    ac.innerHTML = ps.map(([pid, p]) => `<button data-payee="${esc(pid)}"><span>${esc(p.name)}</span><small>${esc(D.categoryLabel(D.usualCategory(pid)))}</small></button>`).join('') + tr.map(a => `<button data-xfer="${esc(a.id)}"><span>Transfer ${inflow ? 'from' : 'to'} ${esc(a.name)}</span>${icon('arrow-left-right')}</button>`).join('');
    ac.hidden = !ac.innerHTML;
  };
  payee.oninput = () => { t.payeeId = null; if (t.transferAccountId) { t.transferAccountId = null; drawCat(); } drawAc(); drawBnpl(); };
  payee.onblur = () => setTimeout(() => { ac.hidden = true; }, 150);
  b.addEventListener('input', e => { const i = e.target.dataset.splitAmt; if (i !== undefined) { const v = Math.abs(E.parseMoney(e.target.value) || 0); splits[i].amount = inflow ? v : -v; const left = signed() - E.sum(splits, s => s.amount); const sm = $('#t-catbox small', b); if (sm) { sm.textContent = left ? `${E.fmt(Math.abs(left))} left to split` : 'All split'; sm.className = left ? 'needs' : 'muted'; } } });
  amt.addEventListener('input', () => { if (splits) drawCat(); });
  $('#t-acct', b).onchange = () => { t.accountId = $('#t-acct', b).value; drawCat(); };
  b.addEventListener('click', e => {
    const x = e.target.closest('button'); if (!x) return; const d = x.dataset;
    if (d.dir) { setDir(d.dir); return drawBnpl(); }
    if (d.date) { dIso.value = d.date; dTxt.value = Q.auDate(d.date); return showDate(); }
    if (x.id === 't-cal') { try { dIso.showPicker(); } catch { dIso.focus(); } return; }
    if (x.id === 't-bnpl-btn') return bnplSheet({ amount: signed(), payeeText: payee.value, date: dIso.value || E.today(), accountId: $('#t-acct', b).value, current: t.bnpl }, r => { t.bnpl = r.bnpl; if (r.categoryId && !splits) t.categoryId = r.categoryId; drawCat(); drawBnpl(); });
    if (d.payee) { t.payeeId = d.payee; t.transferAccountId = null; payee.value = S.payees[d.payee].name; ac.hidden = true; const pc = D.usualCategory(d.payee); if (pc && !splits && D.category(pc) && !D.isBnplName(payee.value)) t.categoryId = pc; drawCat(); drawBnpl(); return; }
    if (d.xfer) { t.transferAccountId = d.xfer; t.payeeId = null; payee.value = `Transfer ${inflow ? 'from' : 'to'} ${D.account(d.xfer).name}`; ac.hidden = true; splits = null; drawCat(); return; }
    if (d.flag) { const f = t.flags || (t.flags = []); const i = f.indexOf(d.flag); i >= 0 ? f.splice(i, 1) : f.push(d.flag); x.classList.toggle('on'); return; }
    if (x.id === 't-cat') return pickCategory('Category', id => { t.categoryId = id; drawCat(); }, { rta: true, m: E.monthOf($('#t-date', b).value || E.today()) });
    if (x.id === 't-split') { splits = [{ amount: signed(), categoryId: t.categoryId }, { amount: 0, categoryId: null }]; return drawCat(); }
    if (x.id === 't-split-add') { splits.push({ amount: signed() - E.sum(splits, s => s.amount), categoryId: null }); return drawCat(); }
    if (x.id === 't-unsplit') { t.categoryId = splits[0]?.categoryId || null; splits = null; return drawCat(); }
    if (d.splitDel !== undefined) { splits.splice(+d.splitDel, 1); return drawCat(); }
    if (d.splitCat !== undefined) return pickCategory('Category', id => { splits[+d.splitCat].categoryId = id; drawCat(); }, { rta: true });
    if (x.id === 't-del') { closeSheet(); const undo = D.deleteTxns([was.id]); return toast('Deleted', { label: 'Undo', run: undo }); }
    if (x.id === 't-approve') { D.approve([was.id]); closeSheet(); return toast('Approved'); }
    if (x.id === 't-save') return save();
  });
  function save() {
    const amount = signed();
    if (!amount && !splits) return toast('Enter an amount');
    if (!$('#t-acct', b).value) return toast('Choose an account');
    if (splits) { const left = amount - E.sum(splits, s => s.amount); if (left) return toast(`${E.fmt(Math.abs(left))} still to split`); if (splits.some(s => s.categoryId === undefined)) return toast('Choose a category for each line'); }
    if (t.transferAccountId === $('#t-acct', b).value) return toast('Pick a different account to transfer to');
    if (!dIso.value) return toast('Check the date: try 19 or 19/10');
    const out = { ...t, amount, accountId: $('#t-acct', b).value, date: dIso.value, memo: $('#t-memo', b).value.trim(), splits, cleared: locked ? 'r' : $('#t-clr', b).checked ? (t.cleared === 'r' ? 'r' : 'c') : 'u', approved: was?.approved === false ? false : true };
    if (!out.transferAccountId && !out.payeeId && payee.value.trim()) out.payeeText = payee.value.trim();
    const go = () => {
      localStorage.setItem('hb.lastAcct', out.accountId);
      const { payeeText: ptxt, ...rest } = out;
      const undo = ptxt ? D.addWithPayee(rest, ptxt) : D.saveTxn(rest);
      closeSheet(); toast(was ? 'Saved' : 'Added', { label: 'Undo', run: undo });
    };
    if (locked && (amount !== was.amount || out.accountId !== was.accountId)) return confirmBox('Change a reconciled transaction?', 'This changes a balance that has been checked against the bank.', 'Change it', go);
    go();
  }
}

// ---- A category this month ----
export function openCategory(id, m = V.month) {
  const c = D.category(id); if (!c) return;
  const st = D.catMonth(id, m), t = E.targetFor(c, m, st), pace = E.pacing(st, m, E.today());
  const b = openSheet(`<div class="f-head"><b class="f-title grow">${esc(c.name)}</b><button class="x" data-close aria-label="Close">${icon('x')}</button></div>
    <p class="muted f-sub">${esc(E.monthName(m))}</p>
    <div class="hero" style="padding:.6rem 0"><div class="muted">${st.available < 0 ? 'Over by' : 'Available'}</div><div class="bignum ${st.available < 0 ? 'over' : ''}">${money(Math.abs(st.available))}</div></div>
    <label class="fld"><span>Assigned this month</span><div class="row in"><input id="c-asg" inputmode="decimal" value="${(st.assigned / 100).toFixed(2)}" autocomplete="off"><button class="btn primary" id="c-asg-save">Set</button></div></label>
    <div class="kv"><span>From last month</span><b>${money(st.carried)}</b><span>Spent and received</span><b>${money(st.activity)}</b>${t ? `<span>Target this month</span><b>${money(t.need)}</b>${t.under ? `<span>Still needed</span><b class="needs">${money(t.under)}</b>` : ''}` : ''}${pace && m === E.thisMonth() ? `<span>Spending pace</span><b>${pace.ahead > 0 ? `${money(pace.ahead)} ahead of the month` : 'On track'}</b>` : ''}</div>
    ${c.note ? `<p class="muted" style="font-size:.86rem;white-space:pre-line">${esc(c.note)}</p>` : ''}
    <div class="row acts">${t && t.under ? `<button class="btn ghost" id="c-fund">${icon('target')} Assign ${money(t.under)}</button>` : ''}<button class="btn ghost" id="c-move">${icon('arrow-left-right')} Move money</button></div>
    <div class="row acts"><button class="btn ghost" id="c-txns">${icon('list')} Transactions</button><button class="btn ghost" id="c-target">${icon('target')} ${t ? 'Edit target' : 'Add target'}</button></div>`);
  const setTo = cents => { const undo = D.setAssigned(id, m, cents); closeSheet(); if (undo) toast(`Assigned ${E.fmt(cents)}`, { label: 'Undo', run: undo }); };
  $('#c-asg-save', b).onclick = () => { const v = E.parseMoney($('#c-asg', b).value); if (v === null) return toast('Enter an amount'); setTo(v); };
  $('#c-asg', b).onkeydown = e => { if (e.key === 'Enter') $('#c-asg-save', b).click(); };
  $('#c-fund', b) && ($('#c-fund', b).onclick = () => setTo(st.assigned + t.under));
  $('#c-move', b).onclick = () => { closeSheet(); setTimeout(() => moveMoney(id, m, st.available < 0 ? -st.available : 0), 230); };
  $('#c-txns', b).onclick = () => { closeSheet(); setTimeout(() => { V.view = 'register'; V.account = '__all'; V.filter = { categoryId: id, month: m }; V.search = ''; V.shown = 120; dispatchEvent(new Event('hb:render')); }, 230); };
  $('#c-target', b).onclick = () => { closeSheet(); setTimeout(() => editTarget(c), 230); };
}
export function moveMoney(toId, m, suggested = 0) {
  const to = D.category(toId);
  const b = openSheet(`<h2>Move money ${suggested ? 'to' : 'with'} ${esc(to.name)}</h2><label class="fld"><span>Amount</span><input id="mv-amt" inputmode="decimal" value="${suggested ? (suggested / 100).toFixed(2) : ''}" placeholder="0.00"></label><div class="seg two" style="margin-top:.7rem" id="mv-dir"><button data-d="in" class="on">Into ${esc(to.name)}</button><button data-d="out">Out of ${esc(to.name)}</button></div><button class="btn primary wide" id="mv-pick">Choose the other category</button>`);
  let dir = 'in';
  $('#mv-dir', b).onclick = e => { const x = e.target.closest('button'); if (!x) return; dir = x.dataset.d; $$('#mv-dir button', b).forEach(y => y.classList.toggle('on', y === x)); };
  $('#mv-pick', b).onclick = () => {
    const cents = Math.abs(E.parseMoney($('#mv-amt', b).value) || 0); if (!cents) return toast('Enter an amount');
    closeSheet(); setTimeout(() => pickCategory(dir === 'in' ? 'Take it from' : 'Move it to', other => { if (!other || other === toId) return; const undo = dir === 'in' ? D.moveMoney(other, toId, m, cents) : D.moveMoney(toId, other, m, cents); toast(`Moved ${E.fmt(cents)}`, { label: 'Undo', run: undo }); }, { m }), 230);
  };
}
export function editTarget(c) {
  const t = c.target || { type: 'need', every: 'month', amount: 0 };
  const kind = t.type === 'need' ? (t.every === 'week' ? 'week' : t.every === 'year' || t.every === 'months' ? 'date' : 'month') : t.type === 'byDate' ? 'date' : t.type === 'balance' ? 'balance' : 'month';
  const b = openSheet(`<h2>Target for ${esc(c.name)}</h2>
    <div class="seg four" id="tg-kind"><button data-k="month">Monthly</button><button data-k="week">Weekly</button><button data-k="date">By a date</button><button data-k="balance">Balance</button></div>
    <label class="fld"><span id="tg-amt-l">Amount</span><input id="tg-amt" inputmode="decimal" value="${t.amount ? (t.amount / 100).toFixed(2) : ''}" placeholder="0.00"></label>
    <div id="tg-extra"></div>
    <div class="row end">${c.target ? '<button class="btn danger" id="tg-del">Remove target</button><span class="grow"></span>' : ''}<button class="btn primary" id="tg-save">Save</button></div>`);
  let k = kind;
  const draw = () => {
    $$('#tg-kind button', b).forEach(x => x.classList.toggle('on', x.dataset.k === k));
    $('#tg-amt-l', b).textContent = { month: 'Needed each month', week: 'Needed each week', date: 'Total needed', balance: 'Balance to keep' }[k];
    $('#tg-extra', b).innerHTML = k === 'month' ? `<label class="sw-row"><span>Refill up to the amount<small>Off: set aside the full amount every month</small></span><input type="checkbox" id="tg-refill"${t.refill ? ' checked' : ''}><i></i></label>`
      : k === 'week' ? `<label class="fld"><span>Day of the week</span><select id="tg-wd">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}"${(t.weekday ?? 1) === i ? ' selected' : ''}>${d}</option>`).join('')}</select></label>`
      : k === 'date' ? `<label class="fld"><span>Due</span><input type="date" id="tg-date" value="${esc(t.due || t.date || '')}"></label><label class="fld"><span>Repeats</span><select id="tg-rep"><option value="0">Doesn't repeat</option><option value="12"${t.every === 'year' ? ' selected' : ''}>Every year</option><option value="6"${t.everyMonths === 6 ? ' selected' : ''}>Every 6 months</option><option value="3"${t.everyMonths === 3 ? ' selected' : ''}>Every 3 months</option></select></label>`
      : `<label class="fld"><span>By (optional)</span><input type="date" id="tg-date" value="${esc(t.date || '')}"></label>`;
  };
  draw();
  $('#tg-kind', b).onclick = e => { const x = e.target.closest('button'); if (x) { k = x.dataset.k; draw(); } };
  $('#tg-del', b) && ($('#tg-del', b).onclick = () => { D.setField('categories', c.id, ['target'], null, `Removed the target for ${c.name}`); closeSheet(); });
  $('#tg-save', b).onclick = () => {
    const amount = Math.abs(E.parseMoney($('#tg-amt', b).value) || 0); if (!amount) return toast('Enter an amount');
    let target;
    if (k === 'month') target = { type: 'need', every: 'month', amount, refill: $('#tg-refill', b).checked };
    else if (k === 'week') target = { type: 'need', every: 'week', amount, weekday: +$('#tg-wd', b).value };
    else if (k === 'date') { const due = $('#tg-date', b).value; if (!due) return toast('Choose a due date'); const rep = +$('#tg-rep', b).value; target = rep === 12 ? { type: 'need', every: 'year', amount, due } : rep ? { type: 'need', every: 'months', everyMonths: rep, amount, due } : { type: 'byDate', amount, date: due }; }
    else target = { type: 'balance', amount, date: $('#tg-date', b).value || null };
    D.setField('categories', c.id, ['target'], target, `Set a target for ${c.name}`); closeSheet(); toast('Target saved');
  };
}

// ---- Can we afford this? ----
export function openAfford() {
  const m = E.thisMonth(); let catId = (S.config.simple?.catIds || [])[0] || null;
  const b = openSheet(`<h2>Can we afford this?</h2><label class="fld"><span>How much?</span><input class="amount-in" id="af-amt" inputmode="decimal" placeholder="0.00" autocomplete="off"></label><div class="fld"><span class="lbl">What's it for?</span><button class="btn ghost wide" id="af-cat">${esc(D.categoryLabel(catId) || 'Choose a category')}</button></div><div id="af-out" aria-live="polite"></div>`);
  setTimeout(() => $('#af-amt', b).focus(), 250);
  const answer = () => {
    const cents = Math.abs(E.parseMoney($('#af-amt', b).value) || 0), out = $('#af-out', b);
    if (!cents || !catId) { out.innerHTML = ''; return; }
    const st = D.catMonth(catId, m), left = st.available - cents, name = D.category(catId).name;
    let html;
    if (left >= 0) html = `<p class="answer yes">Yes</p><p>${esc(name)} would still have ${money(left)} this month.</p>`;
    else {
      const goalIds = new Set(S.config.goal?.catIds || []), spare = S.categories.filter(c => c.id !== catId && !c.hidden && c.kind !== 'cc' && !goalIds.has(c.id) && !/^(needs|savings)$/i.test(D.group(c.groupId)?.name || '')).map(c => ({ c, av: D.catMonth(c.id, m).available })).filter(x => x.av > 0).sort((a, c) => c.av - a.av).slice(0, 2);
      html = `<p class="answer no">Not from ${esc(name)} alone</p><p>It has ${money(Math.max(0, st.available))}, so it's ${money(-left)} short.${spare.length ? ` We could move money from ${spare.map(x => `${esc(x.c.name)} (${money(x.av)})`).join(' or ')}.` : ''}</p>`;
    }
    const g = goal(), big = (S.config.cues?.bigAmount ?? 20000);
    if (g && g.perDay > 0 && cents >= big && localStorage.getItem('hb.cue.afford') !== 'false') { const days = Math.round(cents / g.perDay); html += `<p class="muted" style="margin-top:.5rem">${icon('house')} That's about ${days} day${days === 1 ? '' : 's'} of progress on ${esc(g.name.replace(/^our /i, 'our '))}.</p>`; }
    out.innerHTML = html;
  };
  $('#af-amt', b).oninput = answer;
  $('#af-cat', b).onclick = () => pickCategory("What's it for?", id => { catId = id; $('#af-cat', b).textContent = D.categoryLabel(id); answer(); });
}

// ---- Reconcile ----
export function openReconcile(accountId) {
  const a = D.account(accountId), bal = D.balances()[accountId], upAcc = upAccountFor(accountId);
  const b = openSheet(`<h2>Reconcile ${esc(a.name)}</h2><p>Cleared balance here: <b>${money(bal.cleared)}</b></p><p class="muted">Does it match the bank? If not, enter the balance the bank shows${a.type === 'credit' ? ' (as a negative amount for money owed)' : ''}.</p>
    <div class="row end" style="margin-top:.4rem"><button class="btn primary" id="rc-yes">${icon('check')} Yes, it matches</button></div>
    <label class="fld"><span>Bank's balance</span><input id="rc-bal" inputmode="decimal" placeholder="${esc((bal.cleared / 100).toFixed(2))}" value="${upAcc && upAcc.balance !== bal.cleared ? (upAcc.balance / 100).toFixed(2) : ''}"></label>${upAcc ? `<p class="muted f-sub">Filled in from Up at the last sync (${esc(E.fmt(upAcc.balance))}). Up's balance includes held transactions, which aren't cleared yet.</p>` : ''}
    <div class="row end"><button class="btn ghost" id="rc-no">Use this balance</button></div>`);
  $('#rc-yes', b).onclick = () => { D.reconcile(accountId, bal.cleared); closeSheet(); toast('Reconciled and locked'); };
  $('#rc-no', b).onclick = () => {
    const v = E.parseMoney($('#rc-bal', b).value); if (v === null) return toast('Enter the bank balance');
    const diff = v - bal.cleared; if (!diff) { D.reconcile(accountId, v); closeSheet(); return toast('Reconciled and locked'); }
    confirmBox('Add an adjustment?', `The bank is ${E.fmt(Math.abs(diff))} ${diff > 0 ? 'higher' : 'lower'}. Check for missing or uncleared transactions first. Adjust and lock anyway?`, 'Adjust and lock', () => { D.reconcile(accountId, v); closeSheet(); toast('Reconciled with an adjustment'); }, false);
  };
}
export function editAccount(id) {
  const a = D.account(id);
  const b = openSheet(`<h2>Account</h2><label class="fld"><span>Name</span><input id="ea-name" value="${esc(a.name)}"></label>
    <label class="sw-row"><span>Closed<small>Hidden from lists; history kept</small></span><input type="checkbox" id="ea-closed"${a.closed ? ' checked' : ''}><i></i></label>
    <div class="row end"><button class="btn primary" id="ea-save">Save</button></div>`);
  $('#ea-save', b).onclick = () => { D.saveItem('accounts', id, { name: $('#ea-name', b).value.trim() || a.name, closed: $('#ea-closed', b).checked }, `Edited account ${a.name}`); closeSheet(); };
}

// ---- Several transactions at once ----
export function bulk(kind, done) {
  const ids = [...V.selected];
  if (kind === 'category') return pickCategory(`Category for ${ids.length}`, id => { const undo = D.bulkEdit(ids, { categoryId: id }, `Set ${ids.length} transactions to ${D.categoryLabel(id)}`); done(); toast('Updated', { label: 'Undo', run: undo }); }, { rta: true });
  if (kind === 'payee') {
    const bank = ids.map(id => D.txn(id)?.importPayee || D.payeeName(D.txn(id)?.payeeId) || '').filter(Boolean);
    const common = bank.length ? bank.reduce((a, c) => { let i = 0; while (i < a.length && i < c.length && a[i].toLowerCase() === c[i].toLowerCase()) i++; return a.slice(0, i); }).trim() : '';
    const b = openSheet(`<h2>Payee for ${ids.length} transactions</h2><label class="fld"><span>Payee</span><input id="bp-name" placeholder="Payee name" autocomplete="off" value="${esc(common)}"></label><p class="muted f-sub">Useful after an import, when one shop appears under many bank names.</p>
      <label class="sw-row"><span>Use it for future bank names too<small>Up names containing the text below get this payee</small></span><input type="checkbox" id="bp-rule"${common.length >= 4 ? ' checked' : ''}><i></i></label><input id="bp-match" value="${esc(common)}" placeholder="Text in the bank's name" autocomplete="off">
      <div class="row end"><button class="btn primary" id="bp-save">Set payee</button></div>`);
    $('#bp-save', b).onclick = () => {
      const n = $('#bp-name', b).value.trim(); if (!n) return; const pid = D.ensurePayee(n); const undo = D.bulkEdit(ids, { payeeId: pid }, `Set ${ids.length} transactions to ${n}`);
      const match = $('#bp-match', b).value.trim(); if ($('#bp-rule', b).checked && match.length >= 3) D.patchConfig({ payeeRules: [...(S.config.payeeRules || []).filter(r => r.match.toLowerCase() !== match.toLowerCase()), { match, payeeId: pid }] }, `Renaming rule: "${match}" → ${n}`);
      closeSheet(); done(); toast('Updated', { label: 'Undo', run: undo });
    };
    return;
  }
  if (kind === 'memo') {
    const b = openSheet(`<h2>Memo for ${ids.length} transactions</h2><input id="bm-memo" autocomplete="off"><div class="row end"><button class="btn primary" id="bm-save">Set memo</button></div>`);
    $('#bm-save', b).onclick = () => { const undo = D.bulkEdit(ids, { memo: $('#bm-memo', b).value.trim() }); closeSheet(); done(); toast('Updated', { label: 'Undo', run: undo }); };
    return;
  }
  if (kind === 'flag') return pickFrom('Add or remove a flag', D.flags().map(f => ({ label: f.name, value: f.id })), fid => { const all = ids.every(id => (D.txn(id).flags || []).includes(fid)); ids.forEach(id => { const t = D.txn(id), f = new Set(t.flags || []); all ? f.delete(fid) : f.add(fid); D.bulkEdit([id], { flags: [...f] }, null); }); done(); toast(all ? 'Flag removed' : 'Flag added'); });
  if (kind === 'approve') { D.approve(ids); done(); return toast('Approved'); }
  if (kind === 'delete') return confirmBox(`Delete ${ids.length} transactions?`, 'They go to Recently deleted, where they can be restored.', 'Delete', () => { const undo = D.deleteTxns(ids); done(); toast('Deleted', { label: 'Undo', run: undo }); });
}

// ---- Search help and saved searches ----
export function searchHelp(use) {
  const b = openSheet(`<h2>Search terms</h2><p class="muted f-sub">Tap an example to use it. Dates are day/month/year and can be typed in part: <code>19</code> or <code>19/10</code>.</p><div class="qhelp">${Q.OPERATORS.map(([op, ex, what]) => [op, ex.replace('who:Name', 'who:' + ((S.config.people || []).find(p => p.name && p.email !== S.user?.email)?.name || 'Name')), what]).map(([op, ex, what]) => `<div class="qrow"><div><b>${esc(op)}</b> <span class="muted">${esc(what)}</span></div><div class="pills wrap" style="padding:0">${ex.split(' or ').map(x => `<button class="pill" data-ex="${esc(x)}" style="min-height:34px"><code>${esc(x)}</code></button>`).join('')}</div></div>`).join('')}</div>`);
  b.onclick = e => { const x = e.target.closest('[data-ex]'); if (x) { closeSheet(); setTimeout(() => use(x.dataset.ex + ' '), 230); } };
}
export function saveSearch(q) {
  q = q.trim(); if (!q) return toast('Type a search first');
  const list = S.config.savedSearches || [], i = list.findIndex(s => s.q === q);
  if (i >= 0) return confirmBox('Remove this saved search?', list[i].name, 'Remove', () => D.patchConfig({ savedSearches: list.filter((_, k) => k !== i) }, 'Removed a saved search'));
  const b = openSheet(`<h2>Save this search</h2><p><code>${esc(q)}</code></p><label class="fld"><span>Name</span><input id="ss-name" value="${esc(q.slice(0, 30))}" autocomplete="off"></label><p class="muted f-sub">Saved searches show under the search box on both phones.</p><div class="row end"><button class="btn primary" id="ss-save">Save</button></div>`);
  $('#ss-save', b).onclick = () => { D.patchConfig({ savedSearches: [...list, { name: $('#ss-name', b).value.trim() || q, q }] }, 'Saved a search'); closeSheet(); toast('Saved'); };
}

// ---- Buy now, pay later ----
export function openPlans() {
  const ps = D.openPlans();
  const b = openSheet(`<h2>Buy now, pay later</h2><p class="muted f-sub">${money(D.bnplOutstanding())} still to pay. Each instalment comes out of the budget when it's paid.</p><div class="vlist">${ps.map(p => { const paid = D.planPaid(p); return `<div class="card" style="padding:.7rem .85rem"><div class="row"><b class="grow">${esc(p.shop)}</b><span class="money">${money(D.planLeft(p))} left</span></div><small class="muted">${esc(p.provider)} · ${paid} of ${p.count} paid · ${esc(D.categoryLabel(p.categoryId))} · ${money(p.total)} total</small><span class="bar"><i style="width:${(paid / p.count * 100).toFixed(0)}%"></i></span><div class="row end" style="margin-top:.4rem"><button class="btn ghost" data-close-plan="${esc(p.id)}" style="min-height:38px">Mark finished</button></div></div>`; }).join('') || '<p class="muted">No plans being paid off.</p>'}</div>`);
  b.onclick = e => { const x = e.target.closest('[data-close-plan]'); if (x) confirmBox('Mark this plan finished?', 'Use this if it was paid off early or cancelled.', 'Mark finished', () => { D.closePlan(x.dataset.closePlan); closeSheet(); }, false); };
}
/** Link a payment to a plan, or start one. Calls back with { bnpl, categoryId }. */
export function bnplSheet({ amount, payeeText, date, accountId, current }, done) {
  const cents = Math.abs(amount), provider = (payeeText.match(D.BNPL_RE) || ['Afterpay'])[0].replace(/^./, c => c.toUpperCase());
  const matches = D.plansFor(cents, payeeText);
  let catId = null;
  const b = openSheet(`<h2>Buy now, pay later</h2>
    ${current ? `<p>Linked to <b>${esc(D.bnplLabel({ bnpl: current }))}</b>.</p><button class="btn ghost wide" id="bn-unlink">Unlink</button>` : ''}
    ${matches.length ? `<div class="lbl" style="margin-top:.6rem">Next payment on</div><div class="pick">${matches.map(p => `<button class="pick-row" data-plan="${esc(p.id)}"><span>${esc(p.shop)}<small>${esc(p.provider)} ${D.planPaid(p) + 1} of ${p.count} · ${esc(D.categoryLabel(p.categoryId))}</small></span></button>`).join('')}</div>` : ''}
    <div class="lbl" style="margin-top:.8rem">${matches.length ? 'Or a new purchase' : 'First payment on a new purchase'}</div>
    <label class="fld"><span>Shop</span><input id="bn-shop" placeholder="e.g. Anaconda" autocomplete="off"></label>
    <div class="row in" style="gap:.6rem"><label class="fld" style="flex:1"><span>Total price</span><input id="bn-total" inputmode="decimal" value="${cents ? (cents * 4 / 100).toFixed(2) : ''}"></label><label class="fld" style="width:7rem"><span>Payments</span><input id="bn-count" inputmode="numeric" value="4"></label></div>
    <div class="fld"><span class="lbl">Category</span><button class="btn ghost wide" id="bn-cat">Choose a category</button></div>
    <div class="row end"><button class="btn primary" id="bn-start">Start plan</button></div>`);
  b.addEventListener('click', e => {
    const x = e.target.closest('button'); if (!x) return;
    if (x.id === 'bn-unlink') { closeSheet(); done({ bnpl: null }); }
    if (x.dataset.plan) { const p = D.plan(x.dataset.plan); closeSheet(); done({ bnpl: { planId: p.id, n: D.planPaid(p) + 1 }, categoryId: p.categoryId }); }
    if (x.id === 'bn-cat') pickCategory('What was bought?', id => { catId = id; $('#bn-cat', b).textContent = D.categoryLabel(id); });
    if (x.id === 'bn-start') {
      const shop = $('#bn-shop', b).value.trim(), total = Math.abs(E.parseMoney($('#bn-total', b).value) || 0), count = Math.max(2, Math.min(52, parseInt($('#bn-count', b).value, 10) || 4));
      if (!shop || !total || !catId) return toast('Add the shop, total and category');
      const planId = D.startPlan({ provider, shop, total, count, categoryId: catId, accountId, start: date });
      closeSheet(); done({ bnpl: { planId, n: 1 }, categoryId: catId });
    }
  });
}
