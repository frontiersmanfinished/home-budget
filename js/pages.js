// Settings, the YNAB import, backups, recently deleted and the activity log.
import * as E from './engine.js';
import * as D from './store.js';
import { S } from './store.js';
import { convertYnab, ynabFigures } from './ynab.js';
import { $, $$, esc, icon, openSheet, closeSheet, toast, confirmBox, local, applyFontSize } from './ui.js';
import { flagColour, ago } from './views.js';
import { pickCategory } from './sheets.js';

const money = c => esc(E.fmt(c));
const people = () => S.config.people || [];

function upSection() {
  const st = S.syncState, set = S.syncSettings || {}, links = D.upLinks(), every = set.everyHours || 6, people = (S.config.people || []).filter(x => x.email);
  const status = !st ? 'The sync job hasn\'t run yet. Once it\'s set up in the private repository, the first run appears here within about an hour.'
    : `${st.lastOk ? `Last synced ${ago(st.lastOk)}` : 'Not synced yet'}${st.lastRun && st.lastRun !== st.lastOk ? `; last checked ${ago(st.lastRun)}` : ''}.${st.error ? ` The last attempt failed: ${st.error}` : ''}${set.paused ? ' Paused.' : ''}`;
  const acctOpts = (sel, upId) => D.accountsSorted().filter(a => !a.closed).map(a => { const taken = Object.entries(links).some(([u, l]) => u !== upId && l.accountId === a.id); return `<option value="${esc(a.id)}"${sel === a.id ? ' selected' : ''}${taken ? ' disabled' : ''}>Link to ${esc(a.name)}</option>`; }).join('');
  const rows = (st?.accounts || []).map(u => { const l = links[u.id], acc = l && l.accountId !== 'ignore' ? D.account(l.accountId) : null;
    const suggest = acc ? '' : D.accountsSorted().find(a => !a.closed && a.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(u.name.toLowerCase().replace(/^2up|[^a-z0-9]/g, '')))?.id;
    const def = suggest && !l ? (D.account(suggest).reconciledAt ? E.addDays(D.account(suggest).reconciledAt.slice(0, 10), 1) : E.today()) : E.today();
    return `<div class="card" style="padding:.7rem .8rem;margin:.5rem 0;box-shadow:none;background:var(--bg)"><div class="row"><b class="grow">${esc(u.name)}</b><span class="money">${esc(E.fmt(u.balance))}</span></div>
      ${l ? `<small class="muted">${l.accountId === 'ignore' ? 'Ignored' : `${esc(acc?.name || '?')} · ${l.from ? `from ${esc(l.from.split('-').reverse().join('/'))}` : 'from when it was added'}`}</small> <button class="pill" data-unlink-up="${esc(u.id)}" style="min-height:30px">Change</button>`
      : `<select data-up-choice="${esc(u.id)}" style="margin-top:.4rem"><option value="">Choose…</option>${acctOpts(suggest, u.id)}<option value="budget">Add as a new budget account</option><option value="track">Add as a tracking account</option><option value="ignore">Ignore it</option></select>
         <label class="fld sub" data-up-from-wrap="${esc(u.id)}"${suggest ? '' : ' hidden'}><span>Bring in transactions from</span><input type="date" data-up-from="${esc(u.id)}" value="${def}"></label><p class="muted f-sub" style="margin:.2rem 0 0">Earlier transactions are already here from YNAB. Hand-entered ones after this date are matched, not doubled.</p>
         <button class="btn primary" data-up-save="${esc(u.id)}" style="margin-top:.4rem">Save</button>`}</div>`; }).join('');
  return `<h2 class="sec">Up sync</h2><section class="card">
    <p class="f-sub" style="margin-top:0">${esc(status)}</p>
    ${(st?.webhooks || []).length ? `<div class="banner">${icon('triangle-alert')}<span>Up has webhooks the app didn't create: ${st.webhooks.map(w => esc(w.host)).join(', ')}. If you didn't set these up, revoke the Up token in the Up app, make a new one for the GitHub secret, and delete the webhooks.</span></div>` : ''}
    <div class="row in" style="margin-top:.6rem"><span class="grow" style="font-weight:400">Sync every</span><select data-sync-every style="width:8rem">${[1, 2, 3, 6, 12, 24].map(h => `<option value="${h}"${h === every ? ' selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('')}</select></div>
    <div class="row" style="margin-top:.6rem"><button class="btn ghost" data-sync-now>${icon('refresh-cw')} Sync now</button><label class="mini"><input type="checkbox" data-sync-pause${set.paused ? ' checked' : ''}> Paused</label></div>
    <p class="muted f-sub">Sync now is picked up within about an hour, when the job next wakes.</p>
    ${rows ? `<div class="lbl" style="margin-top:.8rem">Joint Up accounts</div>${rows}` : ''}
    ${people.length > 1 ? `<label class="fld"><span>Who approves new transactions</span><select data-approver>${people.map(x => `<option value="${esc(x.email)}"${(S.config.up?.approver || people[0].email) === x.email ? ' selected' : ''}>${esc(x.name || x.email)}</option>`).join('')}</select></label>` : ''}
    ${(S.config.payeeRules || []).length ? `<div class="lbl" style="margin-top:.8rem">Renaming rules</div>${S.config.payeeRules.map((r, i) => `<div class="set-row"><span class="grow" style="font-weight:400">"${esc(r.match)}" → ${esc(D.payeeName(r.payeeId))}</span><button class="x" data-del-rule="${i}" aria-label="Remove">${icon('x')}</button></div>`).join('')}` : ''}
  </section>`;
}
export function viewSettings() {
  const g = S.config.goal || {}, simple = S.config.simple?.catIds || [], probs = D.integrityProblems();
  const kind = D.backendKind();
  return `
  <h2 class="sec">Our goal</h2>
  <section class="card">
    <label class="fld" style="margin-top:0"><span>Name</span><input data-cfg="goal.name" value="${esc(g.name || '')}" placeholder="Our home fund"></label>
    <label class="fld"><span>Target</span><input data-cfg-money="goal.target" inputmode="decimal" value="${g.target ? (g.target / 100).toFixed(0) : ''}" placeholder="e.g. 100000"></label>
    <div class="fld"><span class="lbl">Counts towards it</span><div class="pills wrap">${(g.catIds || []).map(id => `<button class="pill on" data-unpick="goal.catIds" data-id="${esc(id)}">${esc(D.category(id)?.name || '?')} ${icon('x')}</button>`).join('')}${(g.accountIds || []).map(id => `<button class="pill on" data-unpick="goal.accountIds" data-id="${esc(id)}">${esc(D.account(id)?.name || '?')} ${icon('x')}</button>`).join('')}<button class="pill" data-pick-cat="goal.catIds">${icon('plus')} Category</button><button class="pill" data-pick-acct="goal.accountIds">${icon('plus')} Tracking account</button></div><p class="muted f-sub">Savings already held count from the start, so progress never begins at zero. Choose the name together.</p></div>
  </section>
  <h2 class="sec">Home screen</h2>
  <section class="card"><div class="fld" style="margin-top:0"><span class="lbl">Categories shown on Home</span><div class="pills wrap">${simple.map(id => `<button class="pill on" data-unpick="simple.catIds" data-id="${esc(id)}">${esc(D.category(id)?.name || '?')} ${icon('x')}</button>`).join('')}<button class="pill" data-pick-cat="simple.catIds">${icon('plus')} Add</button></div></div>
    <label class="sw-row"><span>Show the goal bar at the top<small>On this phone</small></span><input type="checkbox" data-local="cue.header"${local.get('cue.header', true) ? ' checked' : ''}><i></i></label>
    <label class="sw-row"><span>Show goal effect in "Can we afford this?"<small>On this phone, for amounts over ${money(S.config.cues?.bigAmount ?? 20000)}</small></span><input type="checkbox" data-local="cue.afford"${local.get('cue.afford', true) ? ' checked' : ''}><i></i></label>
  </section>
  <h2 class="sec">People</h2>
  <section class="card">${people().map((p, i) => `<div class="set-row"><input data-person="${i}" data-k="name" value="${esc(p.name)}" placeholder="Name" style="flex:1"><input data-person="${i}" data-k="email" value="${esc(p.email || '')}" placeholder="Google email" style="flex:2"><button class="x" data-del-person="${i}" aria-label="Remove">${icon('x')}</button></div><div class="row" style="margin:-.1rem 0 .6rem"><small class="muted">Spending money:</small><button class="pill" data-person-cat="${i}">${esc(D.category(p.catId)?.name || 'Choose category')}</button></div>`).join('')}
    <button class="btn ghost" data-add-person>${icon('user-plus')} Add person</button><p class="muted f-sub">Each person's email must also be in the database rules (see SETUP.md).</p></section>
  <h2 class="sec">Flags</h2>
  <section class="card">${D.flags().map((f, i) => `<div class="set-row"><i class="fdot" style="background:${esc(flagColour(f.color))};width:1rem;height:1rem"></i><input data-flag-name="${i}" value="${esc(f.name)}" style="flex:1"><select data-flag-color="${i}" style="width:7rem">${['red', 'orange', 'yellow', 'green', 'blue', 'purple'].map(c => `<option${c === f.color ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`).join('')}<button class="btn ghost" data-add-flag>${icon('plus')} Add flag</button></section>
  ${upSection()}
  <h2 class="sec">Data</h2>
  <section class="card stack">
    <label class="btn ghost wide file">${icon('upload')} Import from YNAB<input type="file" id="imp-ynab" hidden></label>
    <button class="btn ghost wide" data-backup>${icon('download')} Download a backup</button>
    <label class="btn ghost wide file">${icon('rotate-ccw')} Restore a backup<input type="file" id="imp-backup" hidden></label>
    <button class="btn ghost wide" data-go="structure">${icon('layout-grid')} Accounts and categories</button>
    <button class="btn ghost wide" data-go="deleted">${icon('trash')} Recently deleted</button>
    <button class="btn ghost wide" data-go="archives">${icon('archive')} Archives${S.archives.length ? ` (${S.archives.length})` : ''}</button>
    <button class="btn ghost wide" data-go="activity">${icon('clock')} Activity</button>
    ${probs.length ? `<div class="banner">${icon('triangle-alert')}<span style="flex:1">Stored totals don't match for ${probs.map(esc).join(', ')}.</span><button class="btn ghost" data-repair>Recheck</button></div>` : `<p class="muted f-sub">${icon('circle-check')} Month records checked: totals match.</p>`}
  </section>
  <h2 class="sec">Start again</h2>
  <section class="card stack">
    <button class="btn ghost wide" data-fresh>${icon('sprout')} Fresh start from today</button><p class="muted f-sub">Archives the budget as it is, so it stays searchable, then starts from today's balances.</p>
    <button class="btn danger wide" data-reset>${icon('triangle-alert')} Complete reset</button><p class="muted f-sub">Deletes everything, with a backup saved first.</p>
  </section>
  <h2 class="sec">This phone</h2>
  <section class="card"><label class="fld" style="margin-top:0"><span>Text size</span><input type="range" min="90" max="130" step="5" data-font value="${local.get('font', 100)}"></label>
    <p class="muted f-sub">${kind === 'local' ? 'Running on this phone only. This copy is separate from our shared budget and isn\'t backed up.' : `Signed in as ${esc(S.user?.email || '')}${new URLSearchParams(location.search).has('test') ? ' (test budget)' : ''}.`}</p>
    ${kind === 'local' ? '<button class="btn primary wide" data-shared>Switch to our shared budget</button>' : ''}
    <button class="btn ghost wide" data-signout>${icon('log-out')} ${kind === 'local' ? 'Leave' : 'Sign out'}</button></section>`;
}

const setCfgPath = (path, value) => { const [a, b] = path.split('.'); const cur = { ...(S.config[a] || {}) }; cur[b] = value; D.patchConfig({ [a]: cur }); };
const getCfgPath = path => { const [a, b] = path.split('.'); return (S.config[a] || {})[b]; };
export function wireSettings(view, render) {
  view.onchange = e => {
    const x = e.target, d = x.dataset;
    if (d.cfg) setCfgPath(d.cfg, x.value.trim());
    if (d.cfgMoney) setCfgPath(d.cfgMoney, Math.abs(E.parseMoney(x.value) || 0));
    if (d.local) local.set(d.local, x.checked);
    if (d.syncEvery !== undefined) D.saveSyncSettings({ everyHours: +x.value }, `Up sync set to every ${x.value} hours`);
    if (d.syncPause !== undefined) D.saveSyncSettings({ paused: x.checked, pausedBy: x.checked ? 'person' : null }, x.checked ? 'Paused the Up sync' : 'Resumed the Up sync');
    if (d.approver !== undefined) D.setUp({ approver: x.value }, 'Changed who approves new transactions');
    if (d.upChoice !== undefined) { const w = view.querySelector(`[data-up-from-wrap="${d.upChoice}"]`); if (w) w.hidden = ['', 'budget', 'track', 'ignore'].includes(x.value); }
    if (d.person !== undefined) { const ps = people().map(p => ({ ...p })); ps[+d.person][d.k] = x.value.trim(); D.patchConfig({ people: ps }, 'Edited people'); }
    if (d.flagName !== undefined || d.flagColor !== undefined) { const fs = D.flags().map(f => ({ ...f })), i = +(d.flagName ?? d.flagColor); if (d.flagName !== undefined) fs[i].name = x.value.trim() || fs[i].name; else fs[i].color = x.value; D.patchConfig({ flags: fs }, 'Edited flags'); }
    if (x.id === 'imp-ynab' && x.files[0]) importYnab(x.files[0]);
    if (x.id === 'imp-backup' && x.files[0]) restoreBackup(x.files[0]);
    x.value = x.type === 'file' ? '' : x.value;
  };
  view.oninput = e => { if (e.target.dataset.font !== undefined) { local.set('font', +e.target.value); applyFontSize(); } };
  view.onclick = e => {
    const x = e.target.closest('button'); if (!x) return; const d = x.dataset;
    if (d.syncNow !== undefined) { D.syncNow(); return toast('Asked for a sync. It starts within about an hour.'); }
    if (d.upSave) { const u = (S.syncState?.accounts || []).find(a => a.id === d.upSave), sel = view.querySelector(`[data-up-choice="${d.upSave}"]`).value; if (!sel) return toast('Choose what to do with it'); D.linkUp(u, sel, view.querySelector(`[data-up-from="${d.upSave}"]`)?.value || E.today()); return toast('Saved'); }
    if (d.unlinkUp) { const links = { ...D.upLinks() }; delete links[d.unlinkUp]; return D.setUp({ links }, 'Changed an Up account link'); }
    if (d.delRule !== undefined) return D.patchConfig({ payeeRules: (S.config.payeeRules || []).filter((_, i) => i !== +d.delRule) }, 'Removed a renaming rule');
    if (d.unpick) { setCfgPath(d.unpick, (getCfgPath(d.unpick) || []).filter(i => i !== d.id)); return; }
    if (d.pickCat) return pickCategory('Choose a category', id => { if (id) setCfgPath(d.pickCat, [...new Set([...(getCfgPath(d.pickCat) || []), id])]); });
    if (d.pickAcct) { const list = D.accountsSorted().filter(a => !a.closed); const b = openSheet(`<h2>Choose an account</h2><div class="pick">${list.map(a => `<button class="pick-row" data-a="${esc(a.id)}"><span>${esc(a.name)}</span></button>`).join('')}</div>`); b.onclick = ev => { const r = ev.target.closest('[data-a]'); if (r) { closeSheet(); setCfgPath(d.pickAcct, [...new Set([...(getCfgPath(d.pickAcct) || []), r.dataset.a])]); } }; return; }
    if (d.addPerson !== undefined) return D.patchConfig({ people: [...people(), { id: D.uid(), name: '', email: '' }] });
    if (d.delPerson !== undefined) return D.patchConfig({ people: people().filter((_, i) => i !== +d.delPerson) });
    if (d.personCat !== undefined) return pickCategory('Their spending money', id => { const ps = people().map(p => ({ ...p })); ps[+d.personCat].catId = id; D.patchConfig({ people: ps }); });
    if (d.addFlag !== undefined) return D.patchConfig({ flags: [...D.flags(), { id: 'f-' + D.uid().slice(0, 8), name: 'New flag', color: 'green' }] });
    if (d.fresh !== undefined) return import('./setup.js').then(m => m.freshStartLater());
    if (d.reset !== undefined) return import('./setup.js').then(m => m.openReset());
    if (d.backup !== undefined) return download(`home-budget-backup-${E.today()}.json`, JSON.stringify(D.backupData()));
    if (d.repair !== undefined) { D.repairTotals(D.integrityProblems()); return toast('Rechecked'); }
    if (d.signout !== undefined) return D.signOut();
    if (d.shared !== undefined) { localStorage.removeItem('hb.mode'); location.href = location.pathname; }
  };
}
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---- YNAB import, checked against YNAB's own figures before anything is saved ----
export function checkImport(d, figures) {
  const b = E.computeBudget(d, { through: Object.keys(figures).sort().at(-1) }), diffs = [], name = new Map(d.categories.map(c => [c.id, c.name]));
  for (const m of Object.keys(figures).sort()) {
    const mine = b.months[m]; if (!mine) continue;
    for (const [id, f] of Object.entries(figures[m].cats)) { const c = mine.cats[id]; if (c && c.available !== f.available) diffs.push(`${m} ${name.get(id)}: ${E.fmt(c.available)} here, ${E.fmt(f.available)} in YNAB`); }
    if (mine.rtaEnd !== figures[m].rta) diffs.push(`${m} Ready to Assign: ${E.fmt(mine.rtaEnd)} here, ${E.fmt(figures[m].rta)} in YNAB`);
  }
  return { budget: b, diffs, months: Object.keys(figures).length };
}
function problem(title, text, detail) {
  openSheet(`<h2>${esc(title)}</h2><p>${esc(text)}</p>${detail ? `<div class="diffs">${esc(detail)}</div><p class="muted f-sub">Send a screenshot of this if you want help with it.</p>` : ''}<div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}
export async function importYnabFile(file) { return importYnab(file); }
async function importYnab(file) {
  let json, d;
  const wait = openSheet(`<h2>Reading ${esc(file.name)}</h2><p class="muted">${(file.size / 1048576).toFixed(1)} MB. Checking it against YNAB's figures…</p>`);
  await new Promise(r => setTimeout(r, 50));
  try { json = JSON.parse(await file.text()); }
  catch (e) { closeSheet(); return setTimeout(() => problem('That file isn\'t readable', `${file.name} isn't a JSON file, or it was cut short while downloading. The YNAB export should be about 7 MB.`, `${e.name}: ${e.message}`), 250); }
  try { d = convertYnab(json); }
  catch (e) { closeSheet(); return setTimeout(() => problem('That isn\'t a full YNAB export', 'Use the file saved from the YNAB API (GET /v1/plans/{id}), not the CSV export.', `${e.name}: ${e.message}`), 250); }
  closeSheet(); await new Promise(r => setTimeout(r, 250));
  const fig = ynabFigures(json), chk = checkImport(d, fig), bal = E.accountBalances(d.accounts, d.txns);
  const p = json.data.plan || json.data.budget, acctDiffs = p.accounts.filter(a => !a.deleted && bal[a.id] && bal[a.id].working !== a.balance / 10).map(a => `${a.name}: ${E.fmt(bal[a.id].working)} here, ${E.fmt(a.balance / 10)} in YNAB`);
  const diffs = [...acctDiffs, ...chk.diffs];
  const b = openSheet(`<h2>Import ${esc(d.name)}</h2>
    <div class="kv"><span>Accounts</span><b>${d.accounts.length}</b><span>Categories</span><b>${d.categories.length}</b><span>Transactions</span><b>${d.txns.length.toLocaleString('en-AU')}</b><span>Payees</span><b>${d.payees.length.toLocaleString('en-AU')}</b><span>Scheduled</span><b>${d.scheduled.length}</b><span>Months</span><b>${chk.months}</b><span>Targets</span><b>${d.categories.filter(c => c.target).length}</b></div>
    <div class="banner ${diffs.length ? '' : 'info'}">${icon(diffs.length ? 'triangle-alert' : 'circle-check')}<span>${diffs.length ? `${diffs.length} difference${diffs.length > 1 ? 's' : ''} from YNAB's own figures:` : 'Every account balance, every category in every month, and Ready to Assign match YNAB to the cent.'}</span></div>
    ${diffs.length ? `<div class="diffs">${diffs.map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
    <p class="muted f-sub">Importing replaces everything in this budget${D.isEmpty() ? '' : ', including changes made here since the last import'}. YNAB is not changed.</p>
    <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="imp-go">Import</button></div>`);
  $('#imp-go', b).onclick = async () => {
    const go = $('#imp-go', b); go.disabled = true; go.textContent = 'Importing…';
    $('.row.end', b).insertAdjacentHTML('beforebegin', `<p class="muted f-sub" id="imp-prog">${D.backendKind() === 'local' ? 'Saving on this phone…' : 'Sending to Firebase. On a phone connection this can take a minute; keep the app open.'}</p>`);
    try { await D.replaceAll(d, `Imported ${d.txns.length} transactions from YNAB (${d.name})`, n => { const pr = $('#imp-prog', b); if (pr) pr.textContent = `Saved ${n.done} of ${n.total} parts…`; }); closeSheet(); setTimeout(() => toast('Imported'), 250); }
    catch (e) { console.error(e); closeSheet(); setTimeout(() => problem('The import didn\'t finish', e.code === 'permission-denied' ? 'Firebase refused it. Check the database rules list this Google account\'s email exactly, then try again.' : e.name === 'QuotaExceededError' ? 'This phone ran out of room for the local copy. Use the shared budget (Firebase) instead.' : 'Something stopped the import part-way. Importing again replaces everything, so it\'s safe to retry.', `${e.code || e.name || 'Error'}: ${e.message}`), 250); }
  };
}
async function restoreBackup(file) {
  let d; try { d = D.fromBackup(JSON.parse(await file.text())); } catch (e) { return toast(e.message || 'That file could not be read.'); }
  confirmBox('Restore this backup?', `It has ${d.txns.length.toLocaleString('en-AU')} transactions and replaces everything in this budget.`, 'Restore', async () => { await D.replaceAll(d, 'Restored a backup'); toast('Restored'); });
}

export function viewDeleted() {
  const rows = D.deletedTxns().sort((a, b) => b.deletedAt - a.deletedAt).slice(0, 200);
  return rows.length ? `<div class="list">${rows.map(t => `<div class="tx"><span class="txt"><b>${esc(D.payeeName(t.payeeId) || 'No payee')}</b><small>${esc(t.date)} · ${esc(D.account(t.accountId)?.name || '')} · deleted ${esc(new Date(t.deletedAt).toLocaleDateString('en-AU'))}</small></span><span class="money">${money(t.amount)}</span><button class="btn ghost" data-restore="${esc(t.id)}">Restore</button></div>`).join('')}</div>` : '<p class="muted pad">Nothing deleted.</p>';
}
export function viewActivity() {
  const rows = S.audit.slice(0, 300);
  return rows.length ? `<ul class="log card">${rows.map(a => `<li><b>${esc(a.text)}</b><small>${esc(a.by || '')} · ${esc(new Date(a.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}</small></li>`).join('')}</ul>` : '<p class="muted pad">No changes recorded yet.</p>';
}
