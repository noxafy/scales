'use strict';
// The address is the state: #tab&s=…&j=… holds what this browser tab has, live. A reload reads it back, so tabs
// don't overwrite each other; copying it shares it. See "The link" in REFERENCE.md.
// Fields: a anchor,Hz,1/1 · s scale · m its silent notes · h tone · hc its Custom · j Just intonation's notes ·
// jc their Custom · l 0: not linked with the scale · c the Cycle · cc its Custom · p the Spiral · pc its Custom ·
// x the Lattice's axes, up then right (3/2,5/4 left out) · ln its labels (ratio, cents) · lc 1: Chords · lv its plane;up;right
// once moved by hand · d the Diamond's numbers, in the order added · do its order (pitch, size, added; prime,then).
// A preset goes by its exact label.
S.link = (() => {
  const KEYS = ['settings', 'scale', 'silent', 'customAmps', 'customSlot', 'jiSet', 'jiLink', 'scaleSlot', 'cycle', 'cycleSlot', 'spiral', 'spiralSlot', 'latAxes', 'latView', 'diamond'];
  const DEF = { a: [69, 440, 60], s: ['1/1'], j: '1/1', c: '12-TET', tone: 'saw' };
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const LEVELS = 4095;   // two characters a partial
  const SHAPE_NAME = { pure: 'sine' };
  const shapeKey = (t) => (t === 'sine' ? 'pure' : t === 'pure' ? null : t);

  /* notes and steps */
  const noteOut = (str) => {
    const r = S.ratio(str);
    if (!r.temp) return str;
    return r.edo ? `${r.edo[0]}_${r.edo[1]}` : str.slice(1);
  };
  // 5/4, 700 (cents), 7_12 (k of N); null if it is none of them
  const noteIn = (t) => S.parseNote(t.replace('_', '\\'));
  const notesIn = (v) => {
    const parts = v.split(',');
    if (parts.length > RUN_MAX) return null;   // a link with a hundred thousand notes would freeze the tab
    const list = parts.map(noteIn);
    return list.every(Boolean) ? list : null;
  };
  const stepIn = (t) => {
    const p = S.parseStep(t.replace('_', '\\'));
    return p ? p.t : null;
  };
  // equal neighbours as one run, its count first as the Spiral's chips read: 12x3/2 (an empty one, a free step: 10x)
  const runsOut = (list) => {
    const runs = [];
    list.forEach((x) => { const l = runs[runs.length - 1]; if (l && l[0] === x) l[1]++; else runs.push([x, 1]); });
    return runs.map(([x, n]) => (n > 1 ? `${n}x${x}` : x)).join(',');
  };
  // null past RUN_MAX: more than any field holds, and a link's number shouldn't build a list that size
  const RUN_MAX = 1000;
  const runsIn = (v) => {
    const runs = v.split(',').map((x) => { const m = x.match(/^(\d+)x(.*)$/); return m ? [m[2], +m[1]] : [x, 1]; });
    if (runs.reduce((a, r) => a + r[1], 0) > RUN_MAX) return null;
    return runs.flatMap(([x, n]) => Array(n).fill(x));
  };

  /* the Cycle: steps;inner;pins, a free step and an unset pin being empty */
  const cycleOut = (o) => {
    const t = (x) => x.replace('\\', '_');
    const pins = o.pins.some((p) => p != null) ? `;${runsOut(o.pins.map((p) => p ?? ''))}` : '';
    return `${runsOut(o.steps.map((x) => (x == null ? '' : t(x))))};${runsOut(o.inner.map(t))}${pins}`;
  };
  const cycleIn = (v) => {
    const [a, b, c] = v.split(';');   // a may be empty: one free step
    if (a == null || !b) return null;
    const as = runsIn(a), bs = runsIn(b), cs = c ? runsIn(c) : null;
    if (!as || !bs || (c && !cs)) return null;
    const steps = as.map((x) => (x === '' ? null : stepIn(x))), inner = bs.map(stepIn);
    if (inner.some((x) => !x) || as.some((x, i) => x !== '' && !steps[i])) return null;
    const pins = cs ? cs.map((x) => (x === '' ? null : +x)) : Array(inner.length - 1).fill(null);
    return { n: steps.length, steps, inner, pins };
  };

  /* the Spiral: runs as its chips read, count, direction (~ down), interval: 12x3/2, 5x~81/80 */
  const pathOut = (path) => path.map((p) => `${p.n > 1 ? `${p.n}x` : ''}${p.down ? '~' : ''}${p.t.replace('\\', '_')}`).join(',');
  const pathIn = (v) => {
    const path = v.split(',').map((x) => {
      const m = x.match(/^(?:(\d+)x)?(~?)(.+)$/), t = m && stepIn(m[3]);
      return t && (!m[1] || +m[1] >= 1) ? { t, down: !!m[2], n: m[1] ? +m[1] : 1 } : null;
    });
    return path.every(Boolean) && path.every((p) => p.n <= S.parts.spiral.MAXN) && path.reduce((a, p) => a + p.n, 0) <= S.parts.spiral.MAXP ? path : null;
  };

  /* the spectrum: 12 bits a partial; trailing silence is left out (never below 8 partials: no shape's name reads as a spectrum) */
  const ampsOut = (a) => {
    let s = a.map((x) => { const v = Math.round(S.clamp(x, 0, 1) * LEVELS); return B64[v >> 6] + B64[v & 63]; }).join('');
    while (s.length > 16 && s.endsWith('AA')) s = s.slice(0, -2);
    return s;
  };
  const ampsIn = (t) => {
    if (t.length % 2 || t.length > 128 || !t || [...t].some((ch) => !B64.includes(ch))) return null;
    return Array.from({ length: 64 }, (_, i) => (2 * i < t.length ? (B64.indexOf(t[2 * i]) * 64 + B64.indexOf(t[2 * i + 1])) / LEVELS : 0));
  };
  const toneOut = () => {
    const H = S.views.harmonics, shape = !S.state.toneCustom && S.shapeOf();
    const name = shape ? SHAPE_NAME[shape] || shape : ampsOut(S.state.customAmps);
    if (shape === DEF.tone && H.N() === H.defaultN()) return null;
    return H.N() === H.defaultN() ? name : `${name},${H.N()}`;
  };

  /* state -> fields */
  const enc = (v) => encodeURIComponent(v).replace(/%(2F|2C|3A|2B|3B)/g, (m) => decodeURIComponent(m));   // * ~ _ stay as they are
  function fields() {
    const J = S.views.lattice, C = S.parts.cycle, P = S.parts.spiral, T = S.views.spiral, set = S.settings, f = [];
    const put = (k, v) => { if (v != null) f.push(`${k}=${enc(v)}`); };
    const a = [set.anchorMidi, set.anchorHz, set.base];
    if (a.some((x, i) => x !== DEF.a[i])) put('a', a.join(','));
    const s = S.scale.map(noteOut).join(',');
    const j = J.presetName();
    // linked, a scale that is just a preset goes by its label, as `j` does; `j` itself is left out
    if (s !== DEF.s.join(',')) put('s', S.ji.linked && j ? j : s);
    if (S.silent.size) put('m', [...S.silent].map(noteOut).join(','));
    put('h', toneOut());
    if (!S.state.toneCustom && S.state.customSlot) put('hc', ampsOut(S.state.customSlot));
    if (!S.ji.linked) {
      put('l', '0');
      const jt = j || S.ji.notes.join(',');
      if (jt !== DEF.j) put('j', jt);
    }
    if ((j || J.noPreset()) && J.slot()) put('jc', J.slot().join(','));
    const k = C.match();
    if (k === 'custom') put('c', cycleOut(C.state()));
    else if (C.presets.find((q) => q[0] === k)[1] !== DEF.c) put('c', C.presets.find((q) => q[0] === k)[1]);
    if (k !== 'custom' && C.slot()) put('cc', cycleOut(C.slot()));
    const pn = T.pathName(), pt = pathOut(P.path());
    if (!pn) put('p', pt);
    else if (pt !== pathOut(DEF_PATH)) put('p', pn);
    if (pn && T.pathSlot()) put('pc', pathOut(T.pathSlot()));
    const ax = S.parts.lattice.axes();
    if (ax.join() !== S.parts.lattice.DEF_AX.join()) put('x', ax.map(noteOut).join(','));
    const lv = S.parts.lattice.view();
    if (lv.label !== 'name') put('ln', lv.label);
    if (lv.view === 'chords') put('lc', '1');
    if (lv.moved) put('lv', `${lv.plane};${lv.ob};${lv.oc}`);
    const D = S.parts.diamond, dop = D.opts();
    if (dop.ids.join() !== D.DEF_IDS.join()) put('d', dop.ids.join(','));
    put('do', dop.order !== 'prime' ? dop.order : dop.then !== 'size' ? `prime,${dop.then}` : null);
    return f;
  }
  const DEF_PATH = [{ t: '3/2', down: false, n: 12 }];

  /* fields -> state: what is missing or unreadable is the default */
  function apply(f) {
    const J = S.views.lattice, C = S.parts.cycle, P = S.parts.spiral, T = S.views.spiral, H = S.views.harmonics;
    S.linkQuiet = true;
    try {
      S.ji.setLinked(false);   // while the fields are read, the scale and these notes stay apart
      const a = (f.a || '').split(',').map(Number);
      const midi = (m) => Number.isInteger(m) && m >= 21 && m <= 108;
      const good = a.length === 3 && midi(a[0]) && a[1] >= 10 && a[1] <= 5000 && Number.isInteger(a[2]) && a[2] >= S.BASE_MIN && a[2] <= S.BASE_MAX;
      [S.settings.anchorMidi, S.settings.anchorHz, S.settings.base] = good ? a : DEF.a;
      S.saveSettings();
      S.emit('settings');

      // an empty value is an empty list, not a missing one
      const scale = f.s === '' ? [] : f.s && (J.presetByName(f.s) || notesIn(f.s));
      S.setScale(scale || DEF.s, (f.m && notesIn(f.m)) || []);

      const [tone, n] = (f.h || '').split(',');
      const shape = tone ? shapeKey(tone) : DEF.tone, amps = tone && !S.SHAPES[shape] ? ampsIn(tone) : null;
      H.setN([8, 16, 32, 64].includes(+n) ? +n : H.defaultN());
      if (amps) { amps.forEach((x, i) => { S.state.customAmps[i] = x; }); S.saveCustomAmps(); S.keepCustom(); S.emit('spectrum', 'header'); }
      else S.setShape(S.SHAPES[shape] ? shape : DEF.tone, 'header');
      const slot = f.hc && ampsIn(f.hc);
      if (slot) { S.state.customSlot = slot; S.saveCustomSlot(); }

      S.ji.set(f.j === '' ? [] : (f.j && (J.presetByName(f.j) || notesIn(f.j))) || notesIn(DEF.j));
      const jc = f.jc && notesIn(f.jc);
      if (jc) J.setSlot(jc);
      // a missing field is the default, linked; an address with its own `j` keeps the two apart
      if (f.l === '1' || (f.l !== '0' && f.j == null)) { S.ji.setLinked(true); S.ji.set(S.scale); }
      S.emit('preset');

      const named = f.c && C.presets.find((q) => q[1] === f.c);
      const cy = !named && f.c ? cycleIn(f.c) : null;
      if (!(cy && C.setState(cy))) C.use(named ? named[0] : 'tet');
      const cc = f.cc && cycleIn(f.cc);
      if (cc) C.setSlot(cc);

      const pnamed = f.p && T.pathByName(f.p);
      const path = pnamed || (f.p === '' ? [] : (f.p && pathIn(f.p)) || DEF_PATH.map((x) => ({ ...x })));
      P.setPath(path);
      const pc = f.pc && pathIn(f.pc);
      T.keepPath(pc);

      S.parts.lattice.setAxes((f.x && notesIn(f.x)) || S.parts.lattice.DEF_AX);
      const [lp, lb, lc] = (f.lv || '').split(';');
      S.parts.lattice.setView({ label: f.ln || 'name', view: f.lc === '1' ? 'chords' : 'notes', moved: f.lv != null, plane: lp, ob: +lb, oc: +lc });

      const [o, t] = (f.do || 'prime').split(',');
      S.parts.diamond.setOpts({ ids: f.d ? f.d.split(',').map(Number) : S.parts.diamond.DEF_IDS, order: o, then: t || (o !== 'prime' ? o : 'size') });

      if (S.note.rim && !S.inScale(S.note.str)) S.note.rim = false;
    } finally { S.linkQuiet = false; }
  }

  /* the address */
  function read() {
    const [tab, ...rest] = location.hash.slice(1).split('&');
    if (!rest.length) return { tab, fields: null };
    const f = {};
    rest.forEach((p) => {
      const i = p.indexOf('=');
      if (i < 1) return;
      try { f[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); } catch (e) {}
    });
    return { tab, fields: f };
  }
  const saved = () => { try { return KEYS.some((k) => localStorage.getItem('scales.' + k) != null); } catch (e) { return false; } };
  let tab = '', timer = null, off = false;
  function write(t) {
    if (t) tab = t;
    clearTimeout(timer); timer = null;
    if (off || !tab) return;
    const f = fields();
    // all default: a bare address would bring this browser's last state back, "&" keeps it default
    const hash = '#' + tab + (f.length ? '&' + f.join('&') : saved() ? '&' : '');
    try { if (location.hash !== hash || !own()) history.replaceState({ scales: 1 }, '', hash); } catch (e) {}
  }
  // this history entry's address was written here, not typed or pasted
  const own = () => !!(history.state && history.state.scales);
  // bars being painted wait a second; anything else is written nearly at once, since a reload reads the address
  const dirty = (ms = 200) => { if (off || !tab) return; clearTimeout(timer); timer = setTimeout(write, ms); };
  S.on('spectrum', () => dirty(1000));
  window.addEventListener('beforeunload', () => { if (timer) write(); });
  window.addEventListener('pagehide', () => { if (timer) write(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) write(); });

  return { read, apply, write, dirty, own, stop: () => { off = true; clearTimeout(timer); } };
})();
