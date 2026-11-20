import * as E from './engine.js';
import * as D from './store.js';
import { S } from './store.js';
import { connect, configured, isTestEnv } from './backend.js';
import { connectLocal } from './backend-local.js';
import { $, $$, esc, icon, toast, applyFontSize, sheetOpen, closeSheet, openSheet, local } from './ui.js';
import { V, viewHome, viewBudget, viewAccounts, viewRegister, registerList, viewInsights, goalBar } from './views.js';
import { openTxn, openCategory, openAfford, openReconcile, editAccount, bulk } from './sheets.js';
import { viewSettings, wireSettings, viewDeleted, viewActivity } from './pages.js';

const root = $('#root');
const TABS = [['home', 'Home', 'house'], ['budget', 'Budget', 'wallet'], ['accounts', 'Accounts', 'landmark'], ['insights', 'Insights', 'trending-up']];
const WAVE = '<svg class="wave" viewBox="0 0 400 44" preserveAspectRatio="none" aria-hidden="true"><path d="M0 26 C 80 2, 150 8, 230 26 S 350 42, 400 14 V44 H0Z"/></svg>';
let shell = false, dirty = false;
const isLocal = () => new URLSearchParams(location.search).has('local') || localStorage.getItem('hb.mode') === 'local' || !configured();

function gate(title, text, btn = '') {
  shell = false;
  root.innerHTML = `<main class="gate"><span class="logo">${icon('wallet')}</span><h1>${esc(title)}</h1><p>${esc(text)}</p>${btn}</main>`;
}
function drawShell() {
  shell = true;
  root.innerHTML = `<header class="top" id="top"></header><main id="view"></main><button class="fab" id="fab" aria-label="Add transaction">${icon('plus')}</button><nav class="nav" id="nav" aria-label="Main">${TABS.map(([v, l, i]) => `<button data-tab="${v}">${icon(i)}<span>${l}</span></button>`).join('')}</nav><div class="selbar" id="selbar"></div>`;
}
const title = () => ({ home: D.me().name && D.backendKind() !== 'local' ? `Hello ${D.me().name}` : 'Home', budget: 'Budget', accounts: 'Accounts', insights: 'Insights', settings: 'Settings', deleted: 'Recently deleted', activity: 'Activity', register: V.account === '__all' ? 'All transactions' : V.account === '__approve' ? 'To approve' : D.account(V.account)?.name || 'Transactions' }[V.view]);
const parentOf = v => ({ register: 'accounts', deleted: 'settings', activity: 'settings', settings: 'home' }[v]);

export function render() {
  if (S.phase === 'signin') return gate('Home Budget', D.backendKind() === 'local' ? 'Try the budget on this phone. Nothing leaves it until Firebase is set up.' : 'Sign in with your Google account to open our budget.', `<button class="btn primary big" id="signin">${D.backendKind() === 'local' ? 'Start' : 'Sign in with Google'}</button><p class="err" id="err"></p>`);
  if (S.phase === 'denied') return gate('Not on the list', `${S.user?.email || 'This account'} isn't allowed to open this budget.`, '<button class="btn ghost" id="signout2">Use another account</button>');
  if (S.phase === 'loading') return gate('Home Budget', 'Loading our budget…');
  if (S.phase === 'nosdk') return gate('Needs a connection', 'Home Budget has to be online the first time it opens.', '<button class="btn primary" onclick="location.reload()">Try again</button>');
  if (!shell) drawShell();
  if (D.isEmpty() && !['settings', 'activity', 'deleted'].includes(V.view)) V.view = 'welcome';
  const view = $('#view'), active = document.activeElement, main = TABS.some(t => t[0] === V.view) || V.view === 'welcome';
  const offline = !S.online || S.pending, waiting = D.unapproved().length;
  $('#top').innerHTML = `<div class="top-in"><div><div class="brand">${main ? icon('wallet') : `<button class="back" data-back aria-label="Back">${icon('chevron-left')}</button>`}<span>Home Budget</span>${D.backendKind() === 'local' ? '<span class="mode">This phone only</span>' : isTestEnv() ? '<span class="mode">Test</span>' : ''}${offline ? `<span class="sync">${icon('cloud-off')}<em>${S.online ? 'Syncing' : 'Offline'}</em></span>` : ''}</div><h1>${esc(V.view === 'welcome' ? 'Welcome' : title())}</h1>${goalBar()}</div><button class="menu" id="menu" aria-label="Menu">${icon('ellipsis-vertical')}</button></div>${WAVE}`;
  $$('#nav button').forEach(b => { const on = b.dataset.tab === V.view || (b.dataset.tab === 'accounts' && V.view === 'register'); b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); const bd = $('.badge', b); if (b.dataset.tab === 'accounts' && waiting) { if (!bd) b.insertAdjacentHTML('beforeend', `<span class="badge">${waiting}</span>`); else bd.textContent = waiting; } else bd?.remove(); });
  const selecting = V.selected.size > 0;
  root.classList.toggle('selecting', selecting);
  $('#selbar').innerHTML = selecting ? `<b>${V.selected.size}</b><button data-bulk="category">Category</button><button data-bulk="payee">Payee</button><button data-bulk="flag">Flag</button>${D.unapproved().some(t => V.selected.has(t.id)) ? '<button data-bulk="approve">Approve</button>' : '<button data-bulk="memo">Memo</button>'}<button data-bulk="delete" aria-label="Delete">${icon('trash-2')}</button><button data-bulk="cancel" aria-label="Cancel">${icon('x')}</button>` : '';
  $('#fab').hidden = V.view === 'welcome' || ['settings', 'activity', 'deleted'].includes(V.view);
  // Don't redraw under someone's typing; just refresh the list.
  if (active && view.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && active.type !== 'range' && active.type !== 'checkbox') {
    dirty = true; if (active.id === 'reg-q') $('#reg-list').innerHTML = registerList(); return;
  }
  dirty = false;
  const html = { home: viewHome, budget: viewBudget, accounts: viewAccounts, register: viewRegister, insights: viewInsights, settings: viewSettings, deleted: viewDeleted, activity: viewActivity, welcome: viewWelcome }[V.view]();
  const y = scrollY; view.innerHTML = html; view.className = `v-${V.view}`;
  if (V.view === 'settings') wireSettings(view, render); else { view.onchange = view.oninput = view.onclick = null; }
  if (S.error) { toast(S.error); S.error = null; }
  if (Math.abs(scrollY - y) > 2) scrollTo(0, y);
}
function viewWelcome() {
  return `<section class="card hero"><div class="mid">Let's bring the budget across</div><p class="muted" style="margin:.5rem 0 1rem">Import the full export from YNAB. It's checked against YNAB's own figures before anything is saved.</p><button class="btn primary" data-go="settings">${icon('upload')} Go to import</button></section>`;
}
const go = v => { V.view = v; V.selected.clear(); if (v !== 'register') { V.filter = null; V.search = ''; } render(); scrollTo(0, 0); };
addEventListener('hb:render', () => { render(); scrollTo(0, 0); });

function menu() {
  const b = openSheet(`<h2>Menu</h2><div class="pick"><button class="pick-row" data-m="settings">${icon('settings')}<span>Settings</span></button><button class="pick-row" data-m="activity">${icon('clock')}<span>Activity</span></button><button class="pick-row" data-m="deleted">${icon('trash')}<span>Recently deleted</span></button></div>`);
  b.onclick = e => { const r = e.target.closest('[data-m]'); if (r) { closeSheet(); go(r.dataset.m); } };
}

// ---- Taps ----
let suppressClick = false;
root.addEventListener('click', async e => {
  if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
  const t = e.target, b = t.closest('button'), d = b?.dataset || {};
  if (t.closest('#signin')) { try { await D.signIn(); } catch (x) { if ($('#err') && x.code !== 'auth/popup-closed-by-user') $('#err').textContent = 'Sign-in didn\'t finish. Please try again.'; } return; }
  if (t.closest('#signout2')) return D.signOut();
  if (t.closest('#fab')) return openTxn(null);
  if (t.closest('#menu')) return menu();
  if (d.back !== undefined) return go(parentOf(V.view) || 'home');
  if (d.tab) return go(d.tab);
  if (d.go) return go(d.go);
  if (d.bulk) { if (d.bulk === 'cancel') { V.selected.clear(); return render(); } return bulk(d.bulk, () => { V.selected.clear(); render(); }); }
  if (V.view === 'settings') return;
  if (d.afford !== undefined) return openAfford();
  if (d.cat) return openCategory(d.cat, V.view === 'budget' ? V.month : E.thisMonth());
  if (d.month) { V.month = E.addMonths(V.month, +d.month); return render(); }
  if (d.grp) { V.shut.has(d.grp) ? V.shut.delete(d.grp) : V.shut.add(d.grp); local.set('shut', [...V.shut]); return render(); }
  if (d.hidden !== undefined) { V.showHidden = !V.showHidden; return render(); }
  if (d.closed !== undefined) { V.showClosed = !V.showClosed; return render(); }
  if (d.assignUnder !== undefined) { const m = V.month, map = E.assignUnderfunded(S.categories, S.groups, D.budget(), m, D.rta(m)); const n = Object.keys(map).length; if (!n) return toast('Nothing to fund'); const undo = D.setManyAssigned(m, map, `Funded targets for ${n} categories`); return toast(`Funded ${n} target${n > 1 ? 's' : ''}`, { label: 'Undo', run: undo }); }
  if (d.acct) { V.account = d.acct; V.view = 'register'; V.search = ''; V.filter = null; V.shown = 120; V.selected.clear(); render(); return scrollTo(0, 0); }
  if (d.clearFilter !== undefined) { V.filter = null; return render(); }
  if (d.more !== undefined) { V.shown += 200; return render(); }
  if (d.reconcile) return openReconcile(d.reconcile);
  if (d.editAcct) return editAccount(d.editAcct);
  if (d.approveAll !== undefined) { const ids = D.unapproved().map(x => x.id); D.approve(ids); return toast(`Approved ${ids.length}`); }
  if (d.restore) { D.restoreTxn(d.restore); return toast('Restored'); }
  if (d.clr) { const x = D.txn(d.clr); if (x?.cleared === 'r') return toast('Reconciled transactions are locked'); D.setCleared(d.clr); return; }
  const row = t.closest('.tx[data-tx]'); if (row) { if (V.selected.size) return toggleSel(row.dataset.tx); return openTxn(row.dataset.tx); }
});
root.addEventListener('input', e => { if (e.target.id === 'reg-q') { V.search = e.target.value; V.shown = 120; $('#reg-list').innerHTML = registerList(); } });
root.addEventListener('focusout', () => setTimeout(() => { if (dirty) render(); }, 50));
function toggleSel(id) { V.selected.has(id) ? V.selected.delete(id) : V.selected.add(id); render(); }

// Long-press a transaction to start selecting several.
let hold = null;
root.addEventListener('pointerdown', e => {
  const row = e.target.closest('.tx[data-tx]'); if (!row || e.button || e.target.closest('.clr')) return;
  const x = e.clientX, y = e.clientY;
  hold = { x, y, timer: setTimeout(() => { navigator.vibrate?.(15); suppressClick = true; toggleSel(row.dataset.tx); hold = null; }, 480) };
});
addEventListener('pointermove', e => { if (hold && (Math.abs(e.clientX - hold.x) > 10 || Math.abs(e.clientY - hold.y) > 10)) { clearTimeout(hold.timer); hold = null; } }, { passive: true });
addEventListener('pointerup', () => { if (hold) { clearTimeout(hold.timer); hold = null; } setTimeout(() => { suppressClick = false; }, 400); });
addEventListener('pointercancel', () => { if (hold) { clearTimeout(hold.timer); hold = null; } });
addEventListener('popstate', () => { if (!sheetOpen() && V.selected.size) { V.selected.clear(); render(); } });

// Re-draw when the day changes or the app comes back.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// ---- Start ----
applyFontSize();
D.onChange(render);
const params = new URLSearchParams(location.search);
if (params.get('add') === '1') setTimeout(() => S.phase === 'app' && openTxn(null), 600);
if (params.get('afford') === '1') setTimeout(() => S.phase === 'app' && openAfford(), 600);
(async () => {
  if (isLocal()) { if (params.has('local')) localStorage.setItem('hb.mode', 'local'); return D.start(connectLocal()); }
  try { D.start(await connect()); } catch (e) { console.error(e); S.phase = 'nosdk'; render(); }
})();

// ---- Updates: the new version waits until you choose to reload ----
if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
  navigator.serviceWorker?.register('sw.js').then(reg => {
    const offer = w => toast('An update is ready', { label: 'Reload', run: () => { w.postMessage('activate'); } }, 15000);
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
    let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
}
