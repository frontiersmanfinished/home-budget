// A stand-in for Firebase that keeps everything in this browser only. Used for trying the app before
// Firebase is set up (?local), and by the tests. Tabs on the same device share it, like two phones sharing a budget.
const KEY = 'hb.local.db', USER = 'hb.local.user';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
let db = load();
const subs = new Set();
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hb-local') : null;
const fire = () => setTimeout(() => subs.forEach(f => f()), 0);
if (chan) chan.onmessage = () => { db = load(); fire(); };
addEventListener('storage', e => { if (e.key === KEY) { db = load(); fire(); } });
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.error('Local storage is full', e); throw e; } chan?.postMessage(1); fire(); };
const clone = x => JSON.parse(JSON.stringify(x));

function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => { o = (o[k] ??= {}); }); o[ks.at(-1)] = val; }
function unsetPath(obj, path) { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) { o = o?.[k]; if (!o) return; } delete o[ks.at(-1)]; }
function deepMerge(a, b) { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], v); else a[k] = v; } return a; }

export function connectLocal({ user = { uid: 'local', email: 'you@this.phone', displayName: 'You' } } = {}) {
  return {
    kind: 'local',
    onUser(cb) { setTimeout(() => cb(localStorage.getItem(USER) ? JSON.parse(localStorage.getItem(USER)) : null), 0); this._cb = cb; return () => {}; },
    async signIn() { localStorage.setItem(USER, JSON.stringify(user)); this._cb?.(user); },
    async signOut() { localStorage.removeItem(USER); this._cb?.(null); },
    listen(name, cb) { const f = () => cb(Object.entries(db[name] || {}).map(([id, d]) => ({ ...clone(d), id })), { fromCache: false, pending: false }); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
    listenDoc(name, id, cb) { const f = () => cb(db[name]?.[id] ? clone(db[name][id]) : null, { fromCache: false, pending: false }); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
    async getDoc(name, id) { return db[name]?.[id] ? clone(db[name][id]) : null; },
    async getAll(name) { return Object.entries(db[name] || {}).map(([id, d]) => ({ ...clone(d), id })); },
    async write(ops) {
      db = load();
      for (const o of ops) {
        const c = (db[o.col] ??= {});
        if (o.type === 'delete') delete c[o.id];
        else if (o.type === 'set') c[o.id] = o.merge ? deepMerge(c[o.id] || {}, clone(o.data)) : clone(o.data);
        else if (o.type === 'setFields') { const doc = (c[o.id] ??= {}); for (const [p, v] of o.fields) { let x = doc; p.slice(0, -1).forEach(k => { x = (x[k] ??= {}); }); x[p.at(-1)] = clone(v); } }
        else if (o.type === 'unsetFields') { const doc = c[o.id]; if (!doc) throw Object.assign(new Error('No document to update'), { code: 'not-found' }); for (const p of o.paths) { let x = doc; for (const k of p.slice(0, -1)) x = x?.[k]; if (x) delete x[p.at(-1)]; } }
        else { if (!c[o.id]) throw Object.assign(new Error('No document to update'), { code: 'not-found' }); for (const [k, v] of Object.entries(o.data || {})) setPath(c[o.id], k, clone(v)); (o.unset || []).forEach(k => unsetPath(c[o.id], k)); }
      }
      save();
    },
    wipe() { db = {}; save(); },
  };
}
