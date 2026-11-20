// The only file that talks to Firebase. The settings in firebase-config.js are public by design:
// the database rules are what keep the data private.
import { FIREBASE, TEST_FIREBASE } from './firebase-config.js';
const VERSION = '12.18.0';
export const SDK_BASE = `https://www.gstatic.com/firebasejs/${VERSION}/`;
const ROOT = ['households', 'budget'];
export const isTestEnv = () => new URLSearchParams(location.search).has('test') || localStorage.getItem('hb.env') === 'test';
export const configured = () => !!(isTestEnv() ? TEST_FIREBASE : FIREBASE)?.apiKey;

export async function connect() {
  const cfg = isTestEnv() ? TEST_FIREBASE : FIREBASE;
  const [A, U, F] = await Promise.all(['app', 'auth', 'firestore'].map(n => import(/* @vite-ignore */ `${SDK_BASE}firebase-${n}.js`)));
  const app = A.initializeApp(cfg);
  const auth = U.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  const colRef = name => F.collection(db, ...ROOT, name);
  const docRef = (name, id) => F.doc(db, ...ROOT, name, id);
  const rows = snap => snap.docs.map(d => ({ ...d.data(), id: d.id }));
  const meta = snap => ({ fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
  U.getRedirectResult(auth).catch(() => {});
  return {
    kind: 'firebase',
    onUser: cb => U.onAuthStateChanged(auth, cb),
    async signIn() {
      const provider = new U.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try { await U.signInWithPopup(auth, provider); }
      catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') return U.signInWithRedirect(auth, provider);
        throw e;
      }
    },
    signOut: () => U.signOut(auth),
    listen(name, cb, onError) { return F.onSnapshot(colRef(name), { includeMetadataChanges: true }, s => cb(rows(s), meta(s)), onError); },
    listenDoc(name, id, cb, onError) { return F.onSnapshot(docRef(name, id), { includeMetadataChanges: true }, s => cb(s.exists() ? s.data() : null, meta(s)), onError); },
    async getAll(name) { return rows(await F.getDocs(colRef(name))); },
    /** ops: [{type:'set'|'update'|'delete'|'setFields'|'unsetFields', col, id, data, merge, fields:[[path[], value]], paths:[path[]]}].
     *  Queued on the phone straight away and sent in order when online. setFields replaces just the named fields,
     *  so two people editing different transactions in one month never overwrite each other. */
    write(ops) {
      const out = []; let b = null, n = 0, bytes = 0;
      const flush = () => { if (b && n) out.push(b.commit()); b = F.writeBatch(db); n = 0; bytes = 0; };
      flush();
      for (const o of ops) {
        const size = JSON.stringify(o).length;
        if (n >= 400 || bytes + size > 4e6) flush();
        const r = docRef(o.col, o.id); n++; bytes += size;
        if (o.type === 'set') b.set(r, o.data, o.merge ? { merge: true } : {});
        else if (o.type === 'update') b.update(r, o.data);
        else if (o.type === 'setFields') { if (!o.fields.length) { n--; continue; } const obj = {}; for (const [p, v] of o.fields) { let x = obj; p.slice(0, -1).forEach(k => { x = (x[k] ??= {}); }); x[p.at(-1)] = v; } b.set(r, obj, { mergeFields: o.fields.map(([p]) => new F.FieldPath(...p)) }); }
        else if (o.type === 'unsetFields') b.update(r, ...o.paths.flatMap(p => [new F.FieldPath(...p), F.deleteField()]));
        else b.delete(r);
      }
      flush();
      return Promise.all(out);
    },
  };
}
