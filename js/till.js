// Amount entry like a till: digits fill from the right, so 1, 2, 5, 0 gives 12.50. Backspace removes the
// last digit. + and − make simple sums. A "." switches the current figure to an ordinary decimal (45.5 = $45.50),
// for people typing on a computer. Typing over an amount already there replaces it; backspace edits it instead.
const MAX = 9;
const term = (s = '', d = null) => ({ s, d });
// In a sum where any figure has a point, figures without one are whole dollars: 45+12.50 is $57.50.
const centsOf = (t, dollars = false) => {
  if (t.d === null) return parseInt(t.s || '0', 10) * (dollars ? 100 : 1);
  const whole = t.s.slice(0, t.s.length - t.d) || '0', frac = (t.s.slice(t.s.length - t.d) + '00').slice(0, 2);
  return parseInt(whole, 10) * 100 + parseInt(frac, 10);
};
const show = (t, dollars = false) => {
  if (t.d === null && dollars) return Number(t.s || '0').toLocaleString('en-AU');
  if (t.d !== null) { const whole = t.s.slice(0, t.s.length - t.d) || '0'; return `${Number(whole).toLocaleString('en-AU')}.${t.s.slice(t.s.length - t.d)}`; }
  const c = centsOf(t); return (c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function till(initialCents = 0) {
  const st = { terms: [term(initialCents ? String(Math.abs(initialCents)) : '')], ops: [], fresh: !!initialCents };
  const cur = () => st.terms.at(-1);
  const reset = () => { st.terms = [term()]; st.ops = []; st.fresh = false; };
  const api = {
    key(k) {
      if (/^\d$/.test(k)) {
        if (st.fresh) reset();
        const t = cur(); if (t.d !== null && t.d >= 2) return api; if (t.s.replace(/^0+/, '').length >= MAX) return api;
        t.s = t.s === '0' && t.d === null ? k : t.s + k; if (t.d !== null) t.d++;
      } else if (k === '.' || k === ',') {
        if (st.fresh) reset();
        const t = cur(); if (t.d === null) { t.d = 0; if (!t.s) t.s = '0'; }
      } else if (k === '+' || k === '-' || k === '−') {
        st.fresh = false; const op = k === '+' ? '+' : '-';
        if (!cur().s && st.ops.length) st.ops[st.ops.length - 1] = op; else if (cur().s) { st.ops.push(op); st.terms.push(term()); }
      } else if (k === 'Backspace') {
        st.fresh = false; const t = cur();
        if (t.d !== null) { if (t.d > 0) { t.s = t.s.slice(0, -1); t.d--; } else { t.d = null; if (t.s === '0') t.s = ''; } }
        else if (t.s) t.s = t.s.slice(0, -1);
        else if (st.ops.length) { st.ops.pop(); st.terms.pop(); }
      } else if (k === 'Clear') reset();
      return api;
    },
    type(text) { for (const ch of String(text)) api.key(ch); return api; },
    /** Paste or autofill: an ordinary amount like "$1,234.50" or a sum. */
    paste(text) { reset(); const clean = String(text).replace(/[$\s]/g, '').replace(/,(?=\d{3}\b)/g, ''); for (const ch of clean) api.key(/[\d.+\-−]/.test(ch) ? ch : ''); return api; },
    get cents() { const dl = st.terms.some(t => t.d !== null); return st.terms.reduce((sum, t, i) => sum + (i && st.ops[i - 1] === '-' ? -1 : 1) * centsOf(t, dl), 0); },
    get isSum() { return st.ops.length > 0; },
    get fresh() { return st.fresh; },
    set fresh(v) { st.fresh = !!v && api.cents !== 0; },
    get text() { const dl = st.terms.some(t => t.d !== null); return st.terms.map((t, i) => (i ? ` ${st.ops[i - 1] === '-' ? '−' : '+'} ` : '') + (t.s || i ? (t.s ? show(t, dl) : '') : '')).join('') || ''; },
  };
  return api;
}

/** Make an input behave like a till. onChange(cents, isSum) runs after each change. */
export function bindTill(el, initialCents, onChange = () => {}) {
  let t = till(initialCents);
  const draw = () => { el.value = t.text; requestAnimationFrame(() => { try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not focused */ } }); onChange(t.cents, t.isSum); };
  el.setAttribute('inputmode', 'tel'); el.setAttribute('autocomplete', 'off'); el.setAttribute('placeholder', '0.00');
  el.value = initialCents ? t.text : '';
  el.addEventListener('focus', () => { t.fresh = true; });
  el.addEventListener('beforeinput', e => {
    e.preventDefault();
    const all = el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length;
    if (e.inputType === 'insertFromPaste' || e.inputType === 'insertReplacementText') t.paste(e.data ?? e.dataTransfer?.getData('text') ?? '');
    else if (e.inputType.startsWith('insert')) { if (all && !t.fresh) t.key('Clear'); t.type(e.data || ''); }
    else if (e.inputType.startsWith('delete')) t.key(all ? 'Clear' : 'Backspace');
    draw();
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
  return { get cents() { return t.cents; }, get isSum() { return t.isSum; }, key(k) { t.key(k); draw(); }, set(c) { t = till(c); draw(); } };
}
