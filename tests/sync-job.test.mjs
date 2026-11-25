// The sync job against stand-in Up and Firebase servers. Run: node tests/sync-job.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const db = {}; // path -> fields (Firestore JSON)
const ROOT = 'projects/p/databases/(default)/documents/households/budget';
const up = { accounts: [{ id: 'A1', attributes: { displayName: '2Up Spending', accountType: 'TRANSACTIONAL', ownershipType: 'JOINT', balance: { valueInBaseUnits: 123456 }, createdAt: '2024-01-01T00:00:00+10:30' } }],
  txns: Array.from({ length: 130 }, (_, i) => ({ id: 'T' + i, attributes: { status: i < 3 ? 'HELD' : 'SETTLED', description: i % 2 ? 'Woolworths' : 'Coffee Shop', rawText: null, message: null, amount: { valueInBaseUnits: -(i + 1) * 100, value: String(-(i + 1)) }, foreignAmount: i === 5 ? { currencyCode: 'USD', value: '-3.50' } : null, createdAt: '2026-11-19T23:45:00+10:30', settledAt: null, transactionType: null, performingCustomer: { displayName: i % 2 ? 'Sam' : 'Alex' }, cardPurchaseMethod: { cardNumberSuffix: '1234' }, roundUp: i === 7 ? { amount: { valueInBaseUnits: -45 } } : null, holdInfo: null, cashback: null, note: null }, relationships: { transferAccount: { data: null } } })),
  hooks: [{ id: 'W1', attributes: { url: 'https://evil.example.com/hook', createdAt: '2026-11-01T00:00:00Z' } }] };
let tokenSeen = null, upCalls = 0;
const srv = http.createServer(async (q, r) => {
  let body = ''; for await (const c of q) body += c;
  const u = new URL(q.url, 'http://x'), send = (code, obj) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(obj)); };
  if (u.pathname.startsWith('/v1/accounts:signInWithPassword')) { const b = JSON.parse(body); return b.password === 'pw' ? send(200, { idToken: 'ID' }) : send(400, {}); }
  if (u.pathname.startsWith('/up/')) {
    upCalls++; tokenSeen = q.headers.authorization; const p = u.pathname.slice(3);
    if (p === '/accounts') return send(200, { data: up.accounts, links: { next: null } });
    if (p === '/webhooks') return send(200, { data: up.hooks, links: { next: null } });
    const m = p.match(/^\/accounts\/(\w+)\/transactions$/);
    if (m) { const held = u.searchParams.get('filter[status]') === 'HELD'; const all = (held ? up.txns.filter(t => t.attributes.status === 'HELD') : up.txns).filter(t => !up.hidden?.includes(t.id)); const page = +(u.searchParams.get('page[after]') || 0); const next = page + 100 < all.length ? `http://localhost:${srv.address().port}/up${p}?page[after]=${page + 100}` : null; return send(200, { data: all.slice(page, page + 100), links: { next } }); }
    const one = p.match(/^\/transactions\/(\w+)$/); if (one) { const t = up.txns.find(x => x.id === one[1]); return t ? send(200, { data: t }) : send(404, {}); }
    return send(404, {});
  }
  if (q.headers.authorization !== 'Bearer ID') return send(403, {});
  const path = decodeURIComponent(u.pathname).replace(/^\/fs\/v1\//, '');
  if (path.endsWith(':commit')) { for (const w of JSON.parse(body).writes) { if (w.update) db[w.update.name] = w.update.fields; else delete db[w.delete]; } return send(200, {}); }
  if (db[path]) return send(200, { name: path, fields: db[path] });
  const docs = Object.keys(db).filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1);
  if (docs.length || /upInbox$|accounts$|groups$|categories$|scheduled$|assigned$|txns$|months$|bnpl$/.test(path)) return send(200, { documents: docs.map(k => ({ name: k, fields: db[k] })) });
  return send(404, {});
}).listen(0);
const port = srv.address().port, key = randomBytes(32).toString('base64'), dir = mkdtempSync(tmpdir() + '/hb-');
Object.assign(process.env, { UP_TOKEN: 'up:secret', SYNC_EMAIL: 's@x', SYNC_PASSWORD: 'pw', FIREBASE_API_KEY: 'k', FIREBASE_PROJECT: 'p', IDENTITY_URL: `http://localhost:${port}`, FIRESTORE_URL: `http://localhost:${port}/fs/v1`, UP_URL: `http://localhost:${port}/up`, BACKUP_KEY: key, BACKUP_DIR: dir });
const { run, toFs, fromFs } = await import('../sync/up-sync.mjs');
const { decrypt } = await import('../sync/decrypt-backup.mjs');
const data = path => { const f = db[`projects/p/databases/(default)/documents/households/budget/${path}`]; return f ? fromFs({ mapValue: { fields: f } }) : null; };
const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
// Round trip of Firestore values
assert.deepEqual(fromFs(toFs({ a: 1, b: 'x', c: [1, { d: null }], e: true, f: 1.5 })), { a: 1, b: 'x', c: [1, { d: null }], e: true, f: 1.5 });

// First run: due, fetches 30 days, writes 130 inbox records (two pages), state, backup.
const now = Date.parse('2026-11-20T12:00:00Z');
await run(now);
let st = data('sync/state');
assert.equal(st.error, null); assert.equal(st.lastOk, now); assert.equal(st.added, 130); assert.deepEqual(st.heldIds, ['T0', 'T1', 'T2']);
assert.equal(st.accounts[0].balance, 123456); assert.equal(st.webhooks[0].host, 'evil.example.com');
const t5 = data('upInbox/T5'); assert.equal(t5.fx, 'USD 3.50'); assert.equal(t5.amt, -600); assert.equal(t5.who, 'Sam'); assert.equal(data('upInbox/T7').ru, -45);
assert.equal(tokenSeen, 'Bearer up:secret');
const files = readdirSync(dir); assert.equal(files.length, 1); assert.equal(decrypt(readFileSync(`${dir}/${files[0]}`, 'utf8'), key).kind, 'home-budget-backup');
// Second run an hour later: not due, no Up calls.
const calls = upCalls; await run(now + 3600e3); assert.equal(upCalls, calls); assert.equal(data('sync/state').lastRun, now + 3600e3);
// Sync now from the app: due; nothing changed, so nothing rewritten. Then a hold settles at a new amount.
db[`${ROOT}/sync/settings`] = toFs({ requestNow: now + 2 * 3600e3, everyHours: 6 }).mapValue.fields;
up.txns[0].attributes.status = 'SETTLED'; up.txns[0].attributes.amount.valueInBaseUnits = -150;
await run(now + 2.5 * 3600e3); st = data('sync/state');
assert.equal(st.added, 0); assert.equal(st.changed, 1); assert.deepEqual(st.heldIds, ['T1', 'T2']); assert.equal(data('upInbox/T0').amt, -150);
// Up's lists leave out a hold that still exists: looked up on its own, it stays held. A released hold (404) is marked.
up.hidden = ['T1']; up.txns.splice(2, 1);
db[`${ROOT}/sync/settings`] = toFs({ requestNow: now + 3 * 3600e3, everyHours: 6 }).mapValue.fields;
await run(now + 3.5 * 3600e3); st = data('sync/state');
assert.deepEqual(st.heldIds, ['T1']); assert.equal(data('upInbox/T1').status, 'HELD'); assert.equal(data('upInbox/T2').status, 'RELEASED');
// Paused: nothing fetched.
db[`${ROOT}/sync/settings`] = toFs({ paused: true }).mapValue.fields;
const c2 = upCalls; await run(now + 20 * 3600e3); assert.equal(upCalls, c2);
// The token never appears in output.
console.log = orig;
assert.ok(!logs.join('\n').includes('up:secret') && !logs.join('\n').includes('pw'));
srv.close(); console.log('sync job tests passed');
