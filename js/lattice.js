'use strict';
// Lattice (Tonnetz) of two chosen primes: one up, one to the right; every other prime's power is
// fixed per plane, and the planes that hold the chosen notes (S.ji) are listed as chips. Tap or paint notes,
// hold triads and intervals, build scales.
S.parts.lattice = (() => {
  // powers of the two axis primes shown around the view's centre: 9 rows (7 once the circle moves
  // below the lattice, ≤ 960 px, so it comes sooner), and 9, 7, 5 or 3 columns, as many as fit at full
  // size (the map is drawn 1 unit = 1 px, never shrunk, except on the narrowest phones)
  const STACKED = window.matchMedia('(max-width: 960px)');
  let rows = 4, cols = 3;
  const B1 = () => rows, B0 = () => -rows;
  const C1 = () => cols, C0 = () => -cols;
  // column and row steps, margin, node radius (SVG units); columns get more
  // room than rows so the triangles between nodes are easy to press
  const DX = 80, DY = 66, PAD = 34, NR = 25;
  // Chords view: the notes shrink to their names, so the triangles' chord names have the room
  const NRC = 14;
  const nr = () => (st.view === 'chords' ? NRC : NR);
  // and the room for the exponent labels, on both sides of the rows and the columns (wide enough
  // for −99 at the sides, so the map doesn't change size as it moves)
  const LX = 34, LY = 26, PX = PAD + LX, PY = PAD + LY;
  // the primes a lattice point is made of, each as its interval in the octave
  const P = [3, 5, 7, 11, 13];
  const AX = { 3: '3/2', 5: '5/4', 7: '7/4', 11: '11/8', 13: '13/8' };
  const NAMES = {
    '3/2': 'fifth', '4/3': 'fourth', '5/4': 'major third', '6/5': 'minor third', '8/5': 'minor sixth', '5/3': 'major sixth',
    '15/8': 'major seventh', '7/4': 'harmonic seventh', '7/6': 'septimal minor third', '7/5': 'septimal tritone',
    '10/7': 'septimal tritone', '12/7': 'septimal major sixth', '8/7': 'septimal whole tone',
  };
  // ax: the primes up and to the right; plane: the powers of the other primes ({7: 1});
  // ob, oc: how far the view has been moved along the two axes
  // view: 'notes', or 'chords' (each triangle named as the chord it is, as in Schoenberg's chart of the
  // regions: the notes small, the chords' names in the triangles)
  const st = { edit: false, label: 'name', ax: [3, 5], view: 'notes', plane: {}, sounding: new Map(), paintAdd: true, ob: 0, oc: 0, rimStr: null };   // rimStr: a picked note that is no lattice point
  // a point is a monzo {3: e, 5: e, …}; its key lists every prime's power
  const key = (m) => P.map((p) => m[p] || 0).join(',');
  const parse = (k) => { const v = k.split(',').map(Number), m = {}; P.forEach((p, i) => { if (v[i]) m[p] = v[i]; }); return m; };
  const pt = (b, c) => ({ ...st.plane, [st.ax[0]]: b, [st.ax[1]]: c });
  const offAx = () => P.filter((p) => !st.ax.includes(p));
  // the plane a point lies on: the powers of the primes that are not axes
  const planeOf = (m) => { const o = {}; for (const p of offAx()) if (m[p]) o[p] = m[p]; return o; };
  const planeKey = (o) => offAx().map((p) => o[p] || 0).join(',');
  // a ratio as a lattice point; null for notes with primes above 13 and tempered ones
  const pointOf = (str) => {
    const r = S.ratio(str);
    if (!r || r.temp) return null;
    const e = r.e;
    if (Object.keys(e).some((p) => e[p] && p > 13)) return null;
    const m = {}; for (const p of P) if (e[p]) m[p] = e[p];
    return m;
  };
  const scalePts = () => S.ji.notes.map(pointOf).filter(Boolean);
  let el, svgWrap, clockEl, readEl, planesEl;

  // geometry and pitch of a lattice point
  // a square grid, as Euler drew it: the first prime runs up, the second to the right, their
  // quotient on the diagonals; the map moves to show more
  const xy = (b, c) => [PX + (c - st.oc - C0()) * DX, PY + (B1() - (b - st.ob)) * DY];
  const centsOf = (m) => S.fold(P.reduce((s, p) => s + (m[p] || 0) * S.cents(p), 0));
  const ratioOf = (m) => S.monzoRatio(m);
  const ratioStr = (m) => S.ratioKey(ratioOf(m));
  // name and deviation from the 12-TET note of the same spelling (nearest note for 11 and 13)
  const spellOf = (m) => S.spell(ratioStr(m));
  const clsOf = (m) => { const p = [...P].reverse().find((q) => m[q]); return 'p' + (p || 2); };
  const freqOf = (m, oct = 0) => S.baseFreq() * 2 ** ((centsOf(m) + 1200 * oct) / 1200);
  // the ring shows what the label shows. ¢ above 1/1: the cents as an arc from the top on a faint
  // track, ending in a dot (a full turn = 1200, as on the clock). 12-TET ±¢: in tune (below). Ratio: an intensity, the
  // ring thicker and deeper in colour the more complex the note is (Tenney height log₂(n·d), full at
  // 32); it grows outwards, so the label keeps its room
  const RC = 2 * Math.PI * NR;
  const TENNEY_FULL = 32;
  const ring = (m, [n, d], cents) => {
    if (st.label === 'cents') {
      const a = cents / 1200;
      const arc = a > 0.002 ? `<circle class="seg" r="${NR}" transform="rotate(-90)" stroke-dasharray="${RC * a} ${RC}"/>` : '';
      // and a dot where the arc ends, as the note's dot on the clock
      const t = 2 * Math.PI * a;
      return `<circle class="track" r="${NR}"/>${arc}<circle class="cdot" cx="${(NR * Math.sin(t)).toFixed(2)}" cy="${(-NR * Math.cos(t)).toFixed(2)}" r="4"/>`;
    }
    if (st.label === 'name') {
      // 12-TET ±¢: an arc from the top, clockwise when sharp, counter-clockwise when flat, through
      // 90° · √(|dev| / 50¢), so small deviations (3/2 +2¢, 5/4 −14¢) are already apart (0¢ leaves a
      // dot at the top)
      const dev = spellOf(m).dev, s = Math.sqrt(Math.min(Math.abs(dev) / 50, 1));
      const w = 3.5, r = NR + 1.5 + w / 2,   // just outside the node's 3-wide edge (blue when selected)
        len = Math.max(0.01, 2 * Math.PI * r * s / 4);
      return `<circle class="track" r="${NR}"/><circle class="seg dev" r="${r.toFixed(2)}" transform="rotate(-90)${dev < 0 ? ' scale(1,-1)' : ''}" stroke-dasharray="${len.toFixed(2)} ${(2 * Math.PI * r).toFixed(2)}" style="stroke-width:${w}"/>`;
    }
    const t = Math.min(1, S.ratioCents(BigInt(n) * BigInt(d), 1n) / 1200 / TENNEY_FULL);
    const w = 1 + 5 * t;
    return `<circle class="seg int" r="${(NR + w / 2 - 1).toFixed(2)}" style="stroke-width:${w.toFixed(2)};--t:${Math.round(35 + 65 * t)}%"/>`;
  };
  // as S.fmtDev, whole cents: ±0 only when exact, −0 / +0 when it rounds to zero
  const fmtD = (x) => { const r = Math.round(x); return Math.abs(x) < S.EXACT ? '±0' : (x > 0 ? '+' : '−') + Math.abs(r); };
  const intTitle = (str) => str + (NAMES[str] ? ' ' + NAMES[str] : '');
  // the two triangles of a square, as steps [up, right] from its lower-left corner (the diagonal \ is
  // the axes' quotient, 6/5): a note and both axis steps above it, its overtone chord (4:5:6, 4:6:7 …),
  // and the same shape upside down, an undertone chord (10:12:15, 12:14:21 …)
  const TRIS = [[[0, 0], [1, 0], [0, 1]], [[1, 0], [0, 1], [1, 1]]];
  // a triangle's chord as whole numbers, from the axis steps' ratios (unfolded, so 3/2 · 5/4 = 15/8)
  const chordOf = (tri) => {
    const [r0, r1] = st.ax.map((p) => S.ratio(AX[p])).map((r) => ({ n: Number(r.n), d: Number(r.d) }));
    const fr = tri.map(([db, dc]) => ({ n: r0.n ** db * r1.n ** dc, d: r0.d ** db * r1.d ** dc }));
    const L = fr.reduce((a, f) => (a * f.d) / S.gcd(a, f.d), 1);
    const v = fr.map((f) => (f.n * L) / f.d), g = v.reduce(S.gcd);
    return v.map((x) => x / g).sort((a, b) => a - b).join(':');
  };
  const VIEW_ICON = {
    notes: '<svg class="diag-ico" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3.5" cy="10.5" r="2"/><circle cx="10.5" cy="10.5" r="2"/><circle cx="3.5" cy="3.5" r="2"/></svg>',
    chords: '<svg class="diag-ico" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 11.5V2.5L11.5 11.5Z"/></svg>',
  };

  // the axis menus, in the toolbar: a pill per direction (→ first), its arrow inside, tinted in the prime's
  // colour; they name the prime (→ ×5): ratios are for tones, the step's interval is on the edges
  const axSel = (i) => `<label class="axis-pick ${i ? 'right' : 'up'}"><svg class="arr" viewBox="0 0 12 12"><path d="M1 6H10.5M6.5 2L10.5 6L6.5 10"/></svg><select data-ax="${i}" aria-label="${i ? 'Right' : 'Up'}">${P.map((p) => `<option value="${p}">×${p}</option>`).join('')}</select></label>`;

  // side: the Just intonation tab's shared panel lends its readout and circle
  function mount(root, side) {
    el = root;
    el.innerHTML = `
      <div class="toolbar">
        ${S.EDIT_BTN}
        <div class="seg" data-seg="label" aria-label="Labels">
          <button data-v="name" title="note name and deviation from the 12-TET note of that name">12-TET ±¢</button>
          <button data-v="ratio">Ratio</button>
          <button data-v="cents" title="cents above 1/1">¢ above 1/1</button>
        </div>
        <div class="seg diag-pick" data-seg="view" aria-label="Show">
          <button data-v="notes" title="Notes" aria-label="Notes">${VIEW_ICON.notes}</button>
          <button data-v="chords" title="Chords" aria-label="Chords">${VIEW_ICON.chords}</button>
        </div>
        <div class="axis-picks">${axSel(1)}${axSel(0)}</div>
        <div class="seg planes" data-planes aria-label="Plane" hidden></div>
      </div>
      ${S.jiFig(`<div class="panel lattice-panel">
          ${S.jiHead('<button class="btn quiet recenter" data-pan="home" hidden>Recenter</button>')}
          <div class="lattice-frame">
            <div class="lattice" data-lattice></div>
            <button class="pan up" data-pan="up" aria-label="Move up">▲</button>
            <button class="pan down" data-pan="down" aria-label="Move down">▼</button>
            <button class="pan left" data-pan="left" aria-label="Move left">◀</button>
            <button class="pan right" data-pan="right" aria-label="Move right">▶</button>
          </div>
      </div>`)}`;
    S.jiWire(el);
    svgWrap = el.querySelector('[data-lattice]');
    clockEl = side.clock;
    readEl = side.read;
    planesEl = el.querySelector('[data-planes]');

    // on: tapping or dragging over notes adds them to the chosen notes (or removes them); off: they only play
    S.editSwitch(el, (on) => { st.edit = on; });
    S.seg(el, 'label', st.label, (v) => { st.label = v; renderLattice(); });
    S.seg(el, 'view', st.view, (v) => { st.view = v; renderLattice(); });
    // the axes: picking the other axis's prime swaps them; the view goes where the scale is
    el.querySelectorAll('[data-ax]').forEach((s) => {
      s.value = st.ax[+s.dataset.ax];
      s.addEventListener('change', () => {
        const i = +s.dataset.ax, p = +s.value;
        if (st.ax[1 - i] === p) st.ax[1 - i] = st.ax[i];
        st.ax[i] = p;
        s.blur();
        setAxes();
      });
    });
    planesEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      st.plane = parse(b.dataset.k);
      st.ob = 0; st.oc = 0;
      fitView(scalePts().filter((m) => planeKey(planeOf(m)) === planeKey(st.plane)));
      renderLattice();
    });
    // a preset chosen in the menu: the view and the plane move onto its notes
    S.on('preset', () => { followScale(); renderLattice(); });
    el.querySelector('.lattice-panel').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pan]');
      if (b) pan(b.dataset.pan);
    });

    // One hold for everything on the lattice, so a drag plays whatever it passes over:
    // nodes (notes), triangles (triads), edges (intervals). With Edit on, a drag that
    // started on a note also adds to (or removes from) the chosen notes.
    S.holdOn(svgWrap, '.node, .tri, .ehit', (t, e, glided) => {
      if (t.classList.contains('tri')) {
        const m = parse(t.dataset.k), [a0, a1] = st.ax, b = m[a0] || 0, c = m[a1] || 0;
        const at = (db, dc) => ({ ...m, [a0]: b + db, [a1]: c + dc });
        const pts = TRIS[+t.dataset.t].map(([db, dc]) => at(db, dc));
        if (!glided) st.paintFrom = false;
        return play(pts);
      }
      if (t.classList.contains('ehit')) {
        if (!glided) st.paintFrom = false;
        return play([parse(t.dataset.a), parse(t.dataset.b)]);
      }
      const k = t.dataset.k, str = t.dataset.r;
      S.setNote(str, 'lattice');
      setLast(k);
      // Edit: a drag that starts on a note adds (or removes) every note it passes
      if (!glided) { st.paintFrom = true; st.paintAdd = !S.ji.has(str); }
      if (st.edit && st.paintFrom) st.paintAdd ? S.ji.add(str) : S.ji.remove(str);
      return play([parse(k)]);
    }, { takeTouch: true });
    // the circle's dots select their note, the rim's too (as a lattice point, if it is one)
    // a rim note (or its scale list row) is picked as itself: only its rim dot turns blue
    // a note that is no lattice point (tempered, primes above 13) shows only in the readout and on the rim
    const pickRim = (str) => {
      const m = str && pointOf(str);
      if (m) { setLast(key(m), true); return; }
      st.lastRim = true; st.rimStr = str || 'none';
      svgWrap.querySelectorAll('.node.sel').forEach((n) => n.classList.remove('sel'));
      readEl.innerHTML = S.readout(str);
      renderSide();
    };
    S.clockHold(clockEl, '[data-k]', (d) => { S.setNote(d.dataset.r, 'lattice'); setLast(d.dataset.k); return play([parse(d.dataset.k)]); }, pickRim);
    const shown = S.whenShown(root);
    S.on('pick', shown(pickRim));
    // a note selected in another tab: its node, if it lies on the plane shown; else as a rim note
    const showNote = (str) => {
      const m = pointOf(str);
      if (m && planeKey(planeOf(m)) === planeKey(st.plane)) setLast(key(m));
      else pickRim(str);
    };
    S.on('note', shown((str, src) => { if (src !== 'lattice') showNote(str); }));

    followScale();
    renderLattice();
    S.note.rim ? pickRim(S.note.str) : showNote(S.note.str);
    S.on('settings', () => { renderLattice(); if (st.rimStr) pickRim(st.rimStr === 'none' ? null : st.rimStr); else if (st.last) setLast(st.last); });
    S.on('scale', () => renderSide());   // the rim
    // the chosen notes changed: mark them, no full redraw
    S.on('jiset', () => {
      svgWrap.querySelectorAll('.node').forEach((n) => n.classList.toggle('in', S.ji.has(n.dataset.r)));
      svgWrap.querySelectorAll('.tri-l').forEach((t) => t.classList.toggle('in', t.dataset.rs.split(' ').every(S.ji.has)));
      renderSide(); renderPlanes();
    });
    // as many columns as fit at full size; redraw when that number changes
    new ResizeObserver(() => { if (fitCols()) renderLattice(); }).observe(svgWrap);
    // and the rows when the circle moves below the lattice or back (the lattice's width may not change)
    STACKED.addEventListener('change', () => { if (fitCols()) renderLattice(); });
  }

  function setAxes() {
    el.querySelectorAll('[data-ax]').forEach((s) => { s.value = st.ax[+s.dataset.ax]; });
    st.plane = {}; st.ob = 0; st.oc = 0;
    followScale();
    renderLattice();
  }

  // sound a set of lattice points, each at the same pitch as alone (so triads come in whatever
  // inversion the octave gives them; the user chose that over root position)
  function play(pts) {
    const fs = pts.map((p) => freqOf(p));
    const ch = S.audio.chord(fs);
    const ks = pts.map(key), rs = pts.map(ratioStr);
    sounding(ks, 1); flash(ks, true); S.scaleHot(rs, true);   // redraw the circle first, then light it
    return () => { ch.stop(); flash(ks, false); S.scaleHot(rs, false); sounding(ks, -1); };
  }
  // what sounds shows inside the circle while it sounds
  function sounding(ks, d) {
    for (const k of ks) {
      const n = (st.sounding.get(k) || 0) + d;
      n > 0 ? st.sounding.set(k, n) : st.sounding.delete(k);
    }
    renderSide();
  }

  // label inside a node, sized to fit the circle (radius NR)
  function nodeText(m, [n, dd], cents) {
    const t = (cls, y, s) => `<text class="${cls}" y="${y}">${S.esc(s)}</text>`;
    if (st.label === 'name') { const sp = spellOf(m); return t('n-main', -2, sp.name) + t('n-sub', 13, fmtD(sp.dev) + '¢'); }
    if (st.label === 'cents') return t('n-main', 5, cents.toFixed(0));
    let ns = String(n), ds = String(dd);
    if (ns.length + ds.length <= 5) return t('n-r', 5, `${ns}/${ds}`);
    // stacked fraction, in S.fmtRatio's form as everywhere (n/d up to 9 digits, else prime powers: 13⁴ over 2¹⁴)
    [ns, ds = '1'] = S.fmtRatio([n, dd]).split(/\s*\/\s*/);
    const len = Math.max(ns.length, ds.length);
    const half = len <= 4 ? 15 : 20;
    return t('n-r', -4, ns) + `<line class="n-bar" x1="${-half}" x2="${half}" y1="0.5" y2="0.5"/>` + t('n-r', 15, ds);
  }

  function fitCols() {
    const w = svgWrap.clientWidth;
    if (!w) return false;
    const n = S.clamp(Math.floor((w - 2 * PX) / DX / 2), 1, 4), r = STACKED.matches ? 3 : 4;
    if (n === cols && r === rows) return false;
    cols = n; rows = r;
    return true;
  }

  // move the view one step: up/down along the first axis, left/right along the second
  function pan(dir) {
    if (dir === 'home') { st.ob = 0; st.oc = 0; }
    else {
      const [db, dc] = { up: [1, 0], down: [-1, 0], left: [0, -1], right: [0, 1] }[dir];
      st.ob += db; st.oc += dc;
    }
    el.querySelector('[data-pan="home"]').hidden = !st.ob && !st.oc;
    renderLattice();
  }
  // arrows move the selection one step along an axis (the map follows), or along the rim if picked there
  function step(code) {
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[code];
    if (!dir) return false;
    if (st.lastRim) return S.rimStep(st.rimStr || ratioStr(parse(st.last)), S.ARROWS[code]);
    const [a0, a1] = st.ax, [db, dc] = { up: [1, 0], down: [-1, 0], left: [0, -1], right: [0, 1] }[dir];
    // from the selected node, if it is on the plane shown; else from the middle of the view
    const cur = st.last && parse(st.last), on = cur && planeKey(planeOf(cur)) === planeKey(st.plane);
    const b = (on ? cur[a0] || 0 : st.ob) + db, c = (on ? cur[a1] || 0 : st.oc) + dc;
    if (b - st.ob > B1() || b - st.ob < B0() || c - st.oc > C1() || c - st.oc < C0()) pan(dir);
    const m = pt(b, c);
    S.setNote(ratioStr(m), 'lattice');
    setLast(key(m));
    S.click(() => play([m]));
    return true;
  }
  // a preset that doesn't fit the view moves the view onto it
  function fitView(notes) {
    if (notes.length) {
      const bs = notes.map((m) => m[st.ax[0]] || 0), cs = notes.map((m) => m[st.ax[1]] || 0);
      const fits = (lo, hi, o, a, z) => lo >= o + a && hi <= o + z;
      if (!fits(Math.min(...bs), Math.max(...bs), st.ob, B0(), B1())) st.ob = Math.round((Math.min(...bs) + Math.max(...bs)) / 2);
      if (!fits(Math.min(...cs), Math.max(...cs), st.oc, C0(), C1())) st.oc = Math.round((Math.min(...cs) + Math.max(...cs)) / 2);
    }
    el.querySelector('[data-pan="home"]').hidden = !st.ob && !st.oc;
  }
  // the view and the plane move onto the chosen notes (after a preset, a change of axes, and when
  // first drawn): the plane stays if it holds any, else the one holding the most
  function followScale() {
    const notes = scalePts();
    if (!notes.length) return;
    const cur = planeKey(st.plane);
    if (!notes.some((m) => planeKey(planeOf(m)) === cur)) st.plane = planeOf(planeList()[0][1]);
    fitView(notes.filter((m) => planeKey(planeOf(m)) === planeKey(st.plane)));
  }
  // the planes holding chosen notes, the fullest first: [count, a point on it]
  function planeList() {
    const by = new Map();
    for (const m of scalePts()) {
      const k = planeKey(planeOf(m)), o = by.get(k);
      o ? o[0]++ : by.set(k, [1, planeOf(m)]);
    }
    const size = (o) => Object.values(o).reduce((s, e) => s + Math.abs(e), 0);
    return [...by.values()].sort((a, b) => b[0] - a[0] || size(a[1]) - size(b[1]));
  }
  // rim: chosen on the circle's rim or in the scale list: only its rim dot turns blue, and it stays off
  // the inside of the circle unless it is on screen
  function setLast(k, rim = false) {
    st.last = k; st.lastRim = rim; st.rimStr = null;
    // the last pressed note has a blue edge, as the pressed Diamond cell
    svgWrap.querySelectorAll('.node').forEach((n) => n.classList.toggle('sel', !rim && n.dataset.k === k));
    readEl.innerHTML = S.readout(ratioStr(parse(k)));
    renderSide();
  }

  // chips for the planes that hold chosen notes (and the one shown), each with its count; hidden
  // while everything is on the plane through 1/1. Labels name only the primes that differ.
  function renderPlanes() {
    const list = planeList();
    const cur = planeKey(st.plane);
    if (!list.some(([, o]) => planeKey(o) === cur)) list.push([0, st.plane]);
    if (!list.some(([, o]) => !planeKey(o).split(',').some(Number))) list.push([0, {}]);
    const show = list.length > 1;
    planesEl.hidden = !show;
    if (!show) return;
    const ps = offAx().filter((p) => list.some(([, o]) => o[p]));
    const size = (o) => ps.reduce((s, p) => s + Math.abs(o[p] || 0), 0);
    const val = (o) => ps.reduce((s, p) => s * 100 + (o[p] || 0), 0);
    list.sort((a, b) => val(a[1]) - val(b[1]) || size(a[1]) - size(b[1]));
    planesEl.innerHTML = list.map(([n, o]) => {
      const on = planeKey(o) === cur;
      const top = [...ps].reverse().find((p) => o[p]) || ps[ps.length - 1];
      const label = ps.map((p) => p + S.sup(o[p] || 0)).join('·');
      return `<button class="${on ? 'on' : ''}" data-k="${key(o)}">${S.labelHTML(label)}${n && !on ? `<span class="badge p${top}">${n}</span>` : ''}</button>`;
    }).join('');
  }

  function renderLattice() {
    fitCols();
    const [a0, a1] = st.ax;
    const W = PX * 2 + (C1() - C0()) * DX, H = PY * 2 + (B1() - B0()) * DY;
    const tris2 = TRIS, chs = tris2.map(chordOf), chords = st.view === 'chords', R = nr();
    // each triangle is titled by the note of its chord's lowest number
    const step = (db, dc) => db * S.ratio(AX[a0]).cents + dc * S.ratio(AX[a1]).cents;
    const los = tris2.map((tri) => tri.reduce((lo, v, j) => (step(...v) < step(...tri[lo]) ? j : lo), 0));
    const diag = S.ratioKey(S.monzoRatio({ [a0]: 1, [a1]: -1 }));
    let tris = '', edges = '', hits = '', nodes = '', exps = '', names = '';
    const b0 = B0() + st.ob, b1 = B1() + st.ob, c0 = C0() + st.oc, c1 = C1() + st.oc;
    // the power of each axis prime, in its colour: on both sides of every row, and above and below
    // every column, halfway between the move arrow and the nodes. On the right, a positive number
    // keeps a hidden minus, so the digits line up
    const fmtE = (e, pad) => (e < 0 ? '−' + -e : (pad ? '<tspan visibility="hidden">−</tspan>' : '') + e);
    const ex = (p, x, y, anchor, e, pad) => `<text class="lat-exp p${p}" text-anchor="${anchor}" x="${x}" y="${y}" dy="${S.DY_SANS}">${fmtE(e, pad)}</text>`;
    for (let b = b0; b <= b1; b++) {
      const y = xy(b, c0)[1];
      exps += ex(a0, PX - NR - 12, y, 'end', b) + ex(a0, W - PX + NR + 12, y, 'start', b, true);
    }
    const my = (PY - NR) / 2;
    for (let c = c0; c <= c1; c++) {
      const x = xy(b0, c)[0];
      exps += ex(a1, x, my, 'middle', c) + ex(a1, x, H - my, 'middle', c);
    }
    for (let c = c0; c <= c1; c++) {
      for (let b = b0; b <= b1; b++) {
        const [x, y] = xy(b, c);
        const m = pt(b, c), k = key(m);
        if (b < b1 && c < c1) {
          tris2.forEach((tri, i) => {
            const pts = tri.map(([db, dc]) => xy(b + db, c + dc).join(',')).join(' ');
            const [lb, lc] = tri[los[i]];
            const root = spellOf(pt(b + lb, c + lc)).name;
            tris += `<polygon class="tri" data-k="${k}" data-t="${i}" points="${pts}"><title>${root} ${chs[i]}</title></polygon>`;
            // Chords: the name at the triangle's incentre, upper case for the overtone chord (C), lower
            // case for the undertone one (e), as Riemann and Schoenberg write major and minor; full ink
            // when all three notes are chosen
            if (chords) {
              const v = tri.map(([db, dc]) => xy(b + db, c + dc)), len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
              const w = [len(v[1], v[2]), len(v[0], v[2]), len(v[0], v[1])], sw = w[0] + w[1] + w[2];
              const ix = (w[0] * v[0][0] + w[1] * v[1][0] + w[2] * v[2][0]) / sw, iy = (w[0] * v[0][1] + w[1] * v[1][1] + w[2] * v[2][1]) / sw;
              const rs = tri.map(([db, dc]) => ratioStr(pt(b + db, c + dc)));
              names += `<text class="tri-l${rs.every(S.ji.has) ? ' in' : ''}" data-rs="${rs.join(' ')}" x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" dy="${S.DY_SANS}">${S.esc(i ? root.toLowerCase() : root)}</text>`;
            }
          });
        }
        const link = (b2, c2, cls, label) => {
          const [x1, y1] = xy(b2, c2);
          edges += `<line class="edge ${cls}" x1="${x}" y1="${y}" x2="${x1}" y2="${y1}"/>`;
          // shorten the hit line so it doesn't cover the nodes
          const t = (R + 2) / Math.hypot(x1 - x, y1 - y);
          hits += `<line class="ehit" data-a="${k}" data-b="${key(pt(b2, c2))}" x1="${x + (x1 - x) * t}" y1="${y + (y1 - y) * t}" x2="${x1 - (x1 - x) * t}" y2="${y1 - (y1 - y) * t}"><title>${label}</title></line>`;
        };
        if (b < b1) link(b + 1, c, 'ax p' + a0, intTitle(AX[a0]));
        if (c < c1) link(b, c + 1, 'ax p' + a1, intTitle(AX[a1]));
        if (b < b1 && c > c0) link(b + 1, c - 1, 'diag', intTitle(diag));

        const r = ratioOf(m), str = S.ratioKey(r);
        const cents = centsOf(m), sp = spellOf(m);
        nodes += `<g class="node ${clsOf(m)}${S.ji.has(str) ? ' in' : ''}${k === st.last && !st.lastRim ? ' sel' : ''}${!k.split(',').some(Number) ? ' home' : ''}" data-k="${k}" data-r="${str}" transform="translate(${x},${y})">
          <title>${sp.name} · ${S.fmtRatio(r, 6)} · ${S.exactC(cents)} · ${S.fmtDev(sp.dev)} vs 12-TET ${sp.name}</title>
          <circle class="base" r="${R}"/><circle class="selring" r="${R}"/>${chords ? '' : ring(m, r, cents)}<circle class="halo" r="${R}"/>
          ${chords ? `<text class="n-main" dy="${S.DY_SANS}">${S.esc(sp.name)}</text>` : nodeText(m, r, cents)}
        </g>`;
      }
    }
    svgWrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="lattice-svg" style="max-width:${W}px">
      ${exps}${tris}${edges}${hits}<g class="tri-names">${names}</g><g class="nodes">${nodes}</g></svg>`;
    el.querySelector('.axis-pick.up').className = 'axis-pick up p' + a0;
    el.querySelector('.axis-pick.right').className = 'axis-pick right p' + a1;
    // off the plane through 1/1: the frame takes the colour of the plane's largest prime
    const panel = svgWrap.closest('.panel'), top = [...P].reverse().find((p) => st.plane[p]);
    panel.classList.toggle('offplane', !!top);
    panel.style.setProperty('--pc', top ? `var(--p${top})` : '');
    renderPlanes();
    renderSide();   // the circle shows what is on screen
  }

  // the circle: the scale on its rim; inside, the chosen notes lit, wherever they lie, and every other
  // note on screen faint, lit while it sounds; the last pressed one with a blue edge
  function renderSide() {
    if (S.sideWait(renderSide)) return;
    const shown = [];
    for (let b = B0() + st.ob; b <= B1() + st.ob; b++) for (let c = C0() + st.oc; c <= C1() + st.oc; c++) shown.push(key(pt(b, c)));
    const ks = [...new Set([...shown, ...scalePts().map(key), st.lastRim ? null : st.last, ...st.sounding.keys()].filter(Boolean))];
    const points = ks.map((k) => {
      const m = parse(k);
      return { cents: centsOf(m), rf: 0.8, r: 7, cls: clsOf(m) + (S.ji.has(ratioStr(m)) ? ' in' : '') + (k === st.last && !st.lastRim ? ' sel' : '') + (st.sounding.has(k) ? ' hot' : ''), attrs: `data-k="${k}" data-r="${ratioStr(m)}"`, spoke: true };
    });
    S.clock(clockEl, { points, rimSel: st.lastRim ? st.rimStr || ratioStr(parse(st.last)) : null });
  }

  function flash(ks, on) {
    for (const k of ks) svgWrap.querySelector(`.node[data-k="${k}"]`)?.classList.toggle('hot', on);
  }

  return {
    title: 'Lattice',
    mount,
    onKeyDown: (code) => step(code),
  };
})();
