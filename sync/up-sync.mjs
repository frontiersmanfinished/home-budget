// Up → Home Budget sync. Runs hourly in a PRIVATE GitHub repository (job logs must not be public).
// Plain Node 20+, no packages. Never prints the Up token, the sync password, or anything derived from them.
//
// It signs in to Firebase as a limited sync account (not an admin key), reads the household's sync settings,
// and only when a sync is due: fetches joint Up accounts and recent transactions, writes them to an inbox the
// app turns into transactions, records which transactions are still held, and lists Up webhooks.
// Weekly, it also saves an encrypted backup of the budget into the repository.
//
// Environment: UP_TOKEN, SYNC_EMAIL, SYNC_PASSWORD (secrets); FIREBASE_API_KEY, FIREBASE_PROJECT (public);
// BACKUP_KEY (secret, optional: base64 of 32 random bytes); FORCE=true to sync now; BACKUP_DIR (default ./backups).
import { createCipheriv, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const env = k => { const v = process.env[k]; if (!v) throw new Error(`Missing setting ${k}`); return v; };
const UP = 'https://api.up.com.au/api/v1';
const DAY = 864e5, INBOX_DAYS = 60, FIRST_DAYS = 30, OVERLAP_DAYS = 3;

// ---- Firestore over REST, signed in as the sync account ----
let idToken = null, base = null, docRoot = null;
async function signIn() {
  const r = await fetch(`${process.env.IDENTITY_URL || 'https://identitytoolkit.googleapis.com'}/v1/accounts:signInWithPassword?key=${env('FIREBASE_API_KEY')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: env('SYNC_EMAIL'), password: env('SYNC_PASSWORD'), returnSecureToken: true }) });
  if (!r.ok) throw new Error(`Firebase sign-in failed (HTTP ${r.status}). Check SYNC_EMAIL and SYNC_PASSWORD, and that email sign-in is turned on.`);
  idToken = (await r.json()).idToken;
  docRoot = `projects/${env('FIREBASE_PROJECT')}/databases/(default)/documents/households/budget`;
  base = `${process.env.FIRESTORE_URL || 'https://firestore.googleapis.com/v1'}/${docRoot}`;
}
const fsHeaders = () => ({ authorization: `Bearer ${idToken}`, 'content-type': 'application/json' });
export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toFs(x)])) } };
}
export function fromFs(v) {
  if (!v) return null;
  if ('nullValue' in v) return null; if ('booleanValue' in v) return v.booleanValue; if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue; if ('stringValue' in v) return v.stringValue; if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
}
const docData = d => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromFs(v)]));
async function getDoc(path) {
  const r = await fetch(`${base}/${path}`, { headers: fsHeaders() });
  if (r.status === 404) return null; if (!r.ok) throw new Error(`Reading ${path} failed (HTTP ${r.status})`);
  return docData(await r.json());
}
async function listDocs(col) {
  const out = []; let token = '';
  do {
    const r = await fetch(`${base}/${col}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { headers: fsHeaders() });
    if (!r.ok) throw new Error(`Listing ${col} failed (HTTP ${r.status})`);
    const j = await r.json(); for (const d of j.documents || []) out.push({ id: d.name.split('/').pop(), ...docData(d) }); token = j.nextPageToken || '';
  } while (token);
  return out;
}
/** writes: [{ set: [col, id, data] } | { del: [col, id] }], sent 200 at a time. */
async function commit(writes) {
  for (let i = 0; i < writes.length; i += 200) {
    const body = { writes: writes.slice(i, i + 200).map(w => w.set ? { update: { name: `${docRoot}/${w.set[0]}/${w.set[1]}`, fields: toFs(w.set[2]).mapValue.fields } } : { delete: `${docRoot}/${w.del[0]}/${w.del[1]}` }) };
    const r = await fetch(`${base.slice(0, base.indexOf('/documents/') + '/documents'.length)}:commit`, { method: 'POST', headers: fsHeaders(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Saving to Firebase failed (HTTP ${r.status}): ${(await r.text()).slice(0, 300)}`);
  }
}

// ---- Up ----
async function up(path) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(path.startsWith('http') ? path : `${process.env.UP_URL || UP}${path}`, { headers: { authorization: `Bearer ${env('UP_TOKEN')}` } });
    if (r.status === 429 && attempt < 4) { await new Promise(res => setTimeout(res, 2000 * 2 ** attempt)); continue; }
    if (r.status === 401) throw new Error('Up refused the token (HTTP 401). It may have been revoked or replaced: update the UP_TOKEN secret.');
    if (!r.ok) throw new Error(`Up request failed (HTTP ${r.status}) for ${path.split('?')[0].replace(/[0-9a-f-]{36}/g, '…')}`);
    return r.json();
  }
}
async function upAll(path) { const out = []; let next = path; while (next) { const j = await up(next); out.push(...j.data); next = j.links?.next || null; } return out; }
const cents = m => (m ? m.valueInBaseUnits : null);
/** One Up transaction → a compact inbox record. */
export function inboxRecord(t, accountId) {
  const a = t.attributes, rel = t.relationships || {};
  return {
    upId: t.id, acct: accountId, status: a.status, desc: a.description || '', raw: a.rawText || null, msg: a.message || null, note: a.note?.text || null,
    amt: cents(a.amount), fx: a.foreignAmount ? `${a.foreignAmount.currencyCode} ${Math.abs(Number(a.foreignAmount.value)).toFixed(2)}` : null,
    created: a.createdAt, settled: a.settledAt || null, type: a.transactionType || null,
    xfer: rel.transferAccount?.data?.id || null, who: a.performingCustomer?.displayName || null, card: a.cardPurchaseMethod?.cardNumberSuffix || null,
    ru: a.roundUp ? cents(a.roundUp.amount) : null, hold: a.holdInfo ? cents(a.holdInfo.amount) : null,
    cashback: a.cashback ? cents(a.cashback.amount) : null,
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Backup: gzip, then AES-256-GCM with BACKUP_KEY ----
export function encrypt(obj, keyB64) {
  const key = Buffer.from(keyB64, 'base64'); if (key.length !== 32) throw new Error('BACKUP_KEY must be 32 bytes, base64');
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([c.update(gzipSync(JSON.stringify(obj))), c.final()]);
  return JSON.stringify({ kind: 'home-budget-encrypted-backup', v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}
async function backup(state) {
  const key = process.env.BACKUP_KEY; if (!key) { console.log('No BACKUP_KEY: weekly backup skipped.'); return null; }
  const cols = ['accounts', 'groups', 'categories', 'scheduled', 'assigned', 'txns', 'months', 'bnpl'], got = {};
  for (const c of cols) got[c] = await listDocs(c);
  const config = await getDoc('config/main') || {}, payees = await getDoc('lists/payees') || {};
  const txns = [...got.txns];
  for (const m of got.months) { const map = m.json ? JSON.parse(m.json) : (m.txns || {}); for (const [id, t] of Object.entries(map)) txns.push({ ...t, id }); }
  const data = { config, accounts: got.accounts, groups: got.groups, categories: got.categories, scheduled: got.scheduled, assigned: Object.fromEntries(got.assigned.map(({ id, ...x }) => [id, x])), payees: Object.entries(payees).map(([id, p]) => ({ ...p, id })), txns, bnpl: got.bnpl };
  const day = new Date().toISOString().slice(0, 10), dir = process.env.BACKUP_DIR || 'backups';
  mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${day}.hbbak`, encrypt({ kind: 'home-budget-backup', version: 1, exportedAt: new Date().toISOString(), data }, key));
  console.log(`Backup saved: ${day}.hbbak (${txns.length} transactions).`);
  return Date.now();
}

// ---- The run ----
export async function run(now = Date.now()) {
  await signIn();
  const settings = await getDoc('sync/settings') || {}, state = await getDoc('sync/state') || {};
  const out = { lastRun: now };
  const backupDue = !state.lastBackup || now - state.lastBackup >= 7 * DAY - 3600e3;
  if (settings.paused) console.log('Sync is paused in the app.');
  const every = [1, 2, 3, 6, 12, 24].includes(settings.everyHours) ? settings.everyHours : 6;
  const due = !settings.paused && (process.env.FORCE === 'true' || !state.lastOk || (settings.requestNow || 0) > (state.lastRun || 0) || now - state.lastOk >= every * 3600e3 - 10 * 60e3);
  if (!due && !settings.paused) console.log(`Not due: last synced ${Math.round((now - state.lastOk) / 60e3)} minutes ago, every ${every} hours.`);
  if (due) {
    try {
      const accounts = await upAll('/accounts?filter[ownershipType]=JOINT&page[size]=100');
      out.accounts = accounts.map(a => ({ id: a.id, name: a.attributes.displayName, type: a.attributes.accountType, balance: cents(a.attributes.balance), created: a.attributes.createdAt }));
      const sinceMs = state.lastOk ? state.lastOk - OVERLAP_DAYS * DAY : (settings.startDate ? Date.parse(settings.startDate + 'T00:00:00+10:30') : now - FIRST_DAYS * DAY);
      const since = new Date(Math.max(sinceMs, now - INBOX_DAYS * DAY)).toISOString();
      const existing = new Map((await listDocs('upInbox')).map(d => [d.id, d]));
      const writes = [], held = [];
      let added = 0, changed = 0;
      for (const a of accounts) {
        if (a.attributes.accountType === 'HOME_LOAN') continue; // tracked by balance only
        const list = await upAll(`/accounts/${a.id}/transactions?filter[since]=${encodeURIComponent(since)}&page[size]=100`);
        for (const t of list) {
          const rec = inboxRecord(t, a.id); if (rec.status === 'HELD') held.push(rec.upId);
          const was = existing.get(t.id); if (was) { const { id, ...w } = was; if (same(Object.keys(rec).map(k => w[k] ?? null), Object.keys(rec).map(k => rec[k]))) continue; changed++; } else added++;
          writes.push({ set: ['upInbox', t.id, rec] });
        }
        // Holds older than the window are still needed to spot holds the bank released.
        for (const t of await upAll(`/accounts/${a.id}/transactions?filter[status]=HELD&page[size]=100`)) if (!held.includes(t.id)) held.push(t.id);
      }
      const cutoff = new Date(now - INBOX_DAYS * DAY).toISOString();
      for (const d of existing.values()) if (d.created && d.created < cutoff) writes.push({ del: ['upInbox', d.id] });
      await commit(writes);
      const hooks = await upAll('/webhooks?page[size]=50');
      Object.assign(out, { lastOk: now, error: null, heldIds: held, added, changed, webhooks: hooks.map(h => ({ id: h.id, host: (() => { try { return new URL(h.attributes.url).host; } catch { return '?'; } })(), created: h.attributes.createdAt })) });
      console.log(`Synced ${accounts.length} joint accounts: ${added} new, ${changed} changed, ${held.length} held.${hooks.length ? ` WARNING: ${hooks.length} webhook(s) exist on Up.` : ''}`);
    } catch (e) { out.error = String(e.message || e).slice(0, 300); console.log(`Sync failed: ${out.error}`); process.exitCode = 1; }
  }
  if (backupDue) { try { const at = await backup(state); if (at) out.lastBackup = at; } catch (e) { console.log(`Backup failed: ${String(e.message).slice(0, 200)}`); process.exitCode = 1; } }
  await commit([{ set: ['sync', 'state', { ...state, ...out }] }]);
}

if (import.meta.url === `file://${process.argv[1]}`) run().catch(e => { console.log(`Sync stopped: ${String(e.message || e).slice(0, 300)}`); process.exitCode = 1; });
