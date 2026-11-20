// Checks the budget maths against YNAB's own month-end figures, using a real export.
// The export stays on your computer: node tests/verify-ynab.mjs path/to/ynab-full-export.json
import fs from 'node:fs';
import * as E from '../js/engine.js';
import { convertYnab, ynabFigures } from '../js/ynab.js';

const file = process.argv[2]; if (!file) { console.error('Usage: node tests/verify-ynab.mjs <export.json>'); process.exit(2); }
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
const d = convertYnab(json), y = ynabFigures(json), b = E.computeBudget(d, { through: Object.keys(y).sort().at(-1) });
let bad = 0; const show = Number(process.env.SHOW || 25), name = new Map(d.categories.map(c => [c.id, c.name]));
for (const m of Object.keys(y).sort()) {
  const mine = b.months[m], theirs = y[m];
  if (!mine) { console.log(`${m}: missing`); bad++; continue; }
  for (const [id, t] of Object.entries(theirs.cats)) {
    const c = mine.cats[id]; if (!c) continue;
    for (const k of ['assigned', 'activity', 'available']) if (c[k] !== t[k]) { if (bad++ < show) console.log(`${m} ${name.get(id)} ${k}: app ${E.fmt(c[k])}, YNAB ${E.fmt(t[k])}`); }
  }
  const rta = mine.rtaEnd;
  if (rta !== theirs.rta) { if (bad++ < show) console.log(`${m} Ready to Assign: app ${E.fmt(rta)}, YNAB ${E.fmt(theirs.rta)}`); }
  if (mine.income !== theirs.income) { if (bad++ < show) console.log(`${m} income: app ${E.fmt(mine.income)}, YNAB ${E.fmt(theirs.income)}`); }
}
const bal = E.accountBalances(d.accounts, d.txns), p = json.data.plan;
for (const a of p.accounts) if (!a.deleted && bal[a.id].working !== a.balance / 10) { bad++; console.log(`Account ${a.name}: app ${E.fmt(bal[a.id].working)}, YNAB ${E.fmt(a.balance / 10)}`); }
console.log(bad ? `${bad} differences` : `All ${Object.keys(y).length} months, every category, Ready to Assign and every account balance match YNAB to the cent.`);
process.exit(bad ? 1 : 0);
