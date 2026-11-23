'use strict';
// Lattice (Tonnetz) of two intervals: one up, one to the right (any ratio, k\N or cents; the primes' first steps at
// hand). The notes they reach from a note make a plane, and the planes that hold the chosen notes (S.latticeNotes) are listed
// as chips. Tap or paint notes, hold triads and intervals, build scales.
S.parts.lattice = (() => {
  // steps along the two axes shown around the view's centre: 9 rows (7 once the circle moves
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
  // and around it the frame's band for the move arrows, drawn into too: an exponent too long for its room runs on
  // into the band, instead of being cut at the picture's edge (44 units, 36 at the sides on phones). It widens at 614 px,
  // not at the page's 600 px breakpoint: there the page's gutters grow too, and five columns would turn three until 614
  const NARROW = window.matchMedia('(max-width: 613px)');
  const FX = () => (NARROW.matches ? 36 : 44), FY = 44;
  // the axis picker's first row: each prime's first step in the octave (Euler's 3/2 up and 5/4 to the right at first)
  const CORE = ['3/2', '5/4', '7/4', '11/8', '13/8'];
  const NAMES = {
    '3/2': 'fifth', '4/3': 'fourth', '5/4': 'major third', '6/5': 'minor third', '8/5': 'minor sixth', '5/3': 'major sixth',
    '15/8': 'major seventh', '7/4': 'harmonic seventh', '7/6': 'septimal minor third', '7/5': 'septimal tritone',
    '10/7': 'septimal tritone', '12/7': 'septimal major sixth', '8/7': 'septimal whole tone',
  };
  // ax: the intervals up and to the right (note strings: a ratio, k\N or cents in the octave); plane: the key of the plane
  // shown (G.home: the one through 1/1); ob, oc: how far the view has been moved along the two axes
  // view: 'notes', or 'chords' (each triangle named as the chord it is, as in Schoenberg's chart of the
  // regions: the notes small, the chords' names in the triangles)
  // the selected note is the app's (S.shownNote, S.sel.rim; selRim below says how it shows here);
  // selAt: the node it was pressed at, [b, c] (a note lies on more than one where the axes repeat notes)
  const DEF_AX = ['3/2', '5/4'];
  // two different intervals that step somewhere (1/1 and 2/1 don't)
  const axesOk = (l) => Array.isArray(l) && l.length === 2 && l[0] !== l[1] && l.every((s) => typeof s === 'string' && s !== '1/1' && s !== '2/1' && S.ratio(s));
  const st = { edit: false, label: 'name', ax: [...DEF_AX], view: 'notes', plane: '1/1', sounding: new Map(), paintAdd: true, ob: 0, oc: 0, selAt: null };
  let el, svgWrap, clockEl, planesEl, markLabel, markView;
  // the axes are kept (and in the address, x): typed ones are work
  try { const a = JSON.parse(localStorage.getItem('scales.latAxes')); if (axesOk(a)) st.ax = a; } catch (e) {}
  // labels, Notes/Chords, and the view once moved by hand (plane, pan) are in the link (`ln`, `lc`, `lv`) and kept
  // (scales.latView); moved: the view was moved by hand (a plane chip, the arrows, keys) rather than following the
  // notes, which a missing `lv` means. Edit is left out: a mode, not something to look at
  const LABELS = ['name', 'ratio', 'cents'], VIEWS = ['notes', 'chords'];
  const viewOk = (v) => v && LABELS.includes(v.label) && VIEWS.includes(v.view) && typeof v.plane === 'string' && v.plane.length <= 200
    && Number.isInteger(v.ob) && Number.isInteger(v.oc) && Math.abs(v.ob) <= 9999 && Math.abs(v.oc) <= 9999;
  const viewNow = () => ({ label: st.label, view: st.view, plane: st.plane, ob: st.ob, oc: st.oc, moved: !!st.moved });
  const keepView = () => S.keep('scales.latView', JSON.stringify(viewNow()));
  try { const v = JSON.parse(localStorage.getItem('scales.latView')); if (viewOk(v)) Object.assign(st, viewNow(), v, { moved: !!v.moved }); } catch (e) {}

  /* ---------- the geometry of the two intervals ---------- */
  // G.kind: 'ratio' (both ratios: exact, by their prime exponents), 'edo' (both k\N: steps of their common EDO), 'cents'
  // (tempered steps, one of them cents) or 'mix' (a ratio and a tempered step); tempered steps as exact fractions of the
  // octave, nothing hangs on the view. G.note(key, b, c): the note b steps up and c to the right of the plane's
  // origin (its simplest note); G.locate(str, near): where a note lies, {key, b, c}, the copy nearest near = [b, c]
  // where it lies more than once (3/2 with 4/3, any two k\N); null only for a note no key holds (S.EXP_MAX)
  let G;
  const odd = (e) => { const o = {}; for (const p in e) if (p !== '2' && e[p]) o[p] = e[p]; return o; };
  // s·a + t·b = g ≥ 0 (BigInts)
  const egcd = (a, b) => {
    let r0 = a, r1 = b, s0 = 1n, s1 = 0n, t0 = 0n, t1 = 1n;
    while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; [t0, t1] = [t1, t0 - q * t1]; }
    return r0 < 0n ? [-r0, -s0, -t0] : [r0, s0, t0];
  };
  const fdiv = (a, b) => { const q = a / b; return a % b && (a < 0n) !== (b < 0n) ? q - 1n : q; };
  // a ratio's complexity folded into the octave, log₂(n·d) (from its odd exponents; the 2s are what folding sets)
  const height = (e) => { let s = 0, l = 0; for (const p in e) { const w = Math.log2(+p); s += Math.abs(e[p]) * w; l += e[p] * w; } return s + Math.abs(Math.floor(l + 1e-9)); };
  // two ratios: their odd exponents u, v (octaves don't count) brought to echelon form, one extended gcd per prime:
  // H1 = T1·(u, v) with its first nonzero entry at prime j1, H2 = T2·(u, v) zero there (and zero throughout when u and v
  // are one line, 3/2 and 4/3: rank 1, and T2 the steps that come back to the same note). Reducing a note by H1 at j1
  // and H2 at j2 leaves the one remainder its plane has; its steps are what was taken off, through T1 and T2.
  // Linear in the primes, whatever their size: the exponents (up to 999999) make numbers near 10¹², BigInt
  function ratioGeom(sa, sb) {
    const u = odd(S.ratio(sa).e), v = odd(S.ratio(sb).e);
    const ps = [...new Set([...Object.keys(u), ...Object.keys(v)])].sort((a, b) => a - b);
    const row = (e) => ps.map((p) => BigInt(e[p] || 0));
    const U = row(u), V = row(v);
    const j1 = ps.findIndex((_, j) => U[j] || V[j]);
    const [g, s, t] = egcd(U[j1], V[j1]), x = U[j1] / g, y = V[j1] / g;
    const H1 = U.map((_, j) => s * U[j] + t * V[j]), T1 = [s, t];
    let H2 = U.map((_, j) => -y * U[j] + x * V[j]), T2 = [-y, x];
    const j2 = ps.findIndex((_, j) => j > j1 && H2[j]);
    if (j2 >= 0 && H2[j2] < 0n) { H2 = H2.map((z) => -z); T2 = T2.map((z) => -z); }
    const rank = j2 >= 0 ? 2 : 1, ker = T2.map(Number);
    const reduce = (e) => {
      const r = row(e);
      const q1 = fdiv(r[j1], H1[j1]);
      for (let j = 0; j < ps.length; j++) r[j] -= q1 * H1[j];
      let q2 = 0n;
      if (rank === 2) { q2 = fdiv(r[j2], H2[j2]); for (let j = 0; j < ps.length; j++) r[j] -= q2 * H2[j]; }
      const rem = { ...e };
      ps.forEach((p, j) => { if (r[j]) rem[p] = Number(r[j]); else delete rem[p]; });
      return { rem, b: Number(q1 * T1[0] + q2 * T2[0]), c: Number(q1 * T1[1] + q2 * T2[1]) };
    };
    const at = (e, b, c) => S.qMul(S.qMul(e, u, b), v, c);
    // the steps near which the plane's simplest notes lie: least squares from the remainder, weighted by log₂ p
    const W = {}; for (const p of ps) W[p] = Math.log2(+p) ** 2;
    const dot = (a, b) => { let z = 0; for (const p of ps) z += W[p] * (a[p] || 0) * (b[p] || 0); return z; };
    const tries = (rem) => {
      const out = [];
      if (rank === 2) {
        const a = dot(u, u), m = dot(u, v), c = dot(v, v), ru = dot(rem, u), rv = dot(rem, v), det = a * c - m * m;
        const b0 = Math.round((-ru * c + rv * m) / det), c0 = Math.round((-rv * a + ru * m) / det);
        for (let db = -3; db <= 3; db++) for (let dc = -3; dc <= 3; dc++) out.push([b0 + db, c0 + dc]);
      } else {
        const h = {}; ps.forEach((p, j) => { if (H1[j]) h[p] = Number(H1[j]); });
        const q0 = Math.round(-dot(rem, h) / dot(h, h)), t1 = T1.map(Number);
        for (let dq = -3; dq <= 3; dq++) out.push([(q0 + dq) * t1[0], (q0 + dq) * t1[1]]);
      }
      return out;
    };
    // a plane's origin, its simplest note (fewest steps from the remainder on a tie): {e, b, c}, b and c from the remainder
    // Only a note that is one counts (S.EXP_MAX), and the note that showed the plane first always is: with an
    // axis of exponents near 361212 the others can all be past it. (The remainders are kept as found: a key's text
    // may hold exponents past what is read back.)
    const origins = new Map(), rems = new Map([['1/1', { rem: {}, seed: [0, 0] }]]);
    const origin = (key) => {
      let o = origins.get(key);
      if (!o) {
        const { rem, seed } = rems.get(key);
        for (const [b, c] of [seed, ...tries(rem)]) {
          const e = at(rem, b, c), h = height(e);
          if (o && !(h < o.h - 1e-9 || (h < o.h + 1e-9 && Math.abs(b) + Math.abs(c) < Math.abs(o.b) + Math.abs(o.c)))) continue;
          if (ratioPt(e)) o = { e, b, c, h };
        }
        origins.set(key, o);
      }
      return o;
    };
    return {
      kind: 'ratio', home: '1/1', diag: ratioPt(S.qMul(u, v, -1)),
      // a plane's key: its remainder's, and a tempered part the axes don't reach (the plane through 7\12: "1/1+edo12:7")
      note: (key, b, c) => {
        const i = key.indexOf('+'), rk = i < 0 ? key : key.slice(0, i), p = ratioPt(at(origin(rk).e, b, c));
        return p && (i < 0 ? p : S.mixKey(p, key.slice(i + 1)));
      },
      locate: (str, near) => {
        const parts = S.noteParts(str), r = parts && S.ratio(parts[0]);
        if (!r) return null;
        const { rem, b, c } = reduce(odd(r.e)), rk = S.qText(rem), key = parts[1] === '1/1' ? rk : `${rk}+${parts[1]}`;
        if (!rems.has(rk)) rems.set(rk, { rem, seed: [b, c] });
        const o = origin(rk);
        let B = b - o.b, C = c - o.c;
        if (rank === 1) {
          const k = Math.round(((near[0] - B) * ker[0] + (near[1] - C) * ker[1]) / (ker[0] ** 2 + ker[1] ** 2));
          B += k * ker[0]; C += k * ker[1];
        }
        return { key, b: B, c: C };
      },
    };
  }
  // Every note is a ratio part and a tempered part (S.noteParts), each exact: a ratio by its prime exponents, a tempered
  // part as a fraction of the octave (S.tempFrac: k\N is k/N, 42¢ 42/1200). The axes reach some of a note; the rest is
  // its plane's: a plane is the lattice moved by a note, its key that note (its origin), so every note lies on one
  // (7\12 among ratio axes on the plane through 7\12, 5/4 among tempered ones on the plane through 5/4)
  const gcdB = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
  const modB = (a, m) => ((a % m) + m) % m;
  const rdiv = (a, b) => (b < 0n ? rdiv(-a, -b) : fdiv(2n * a + b, 2n * b));   // a / b, rounded
  const lcmB = (a, b) => (a * b) / gcdB(a, b);
  // a tempered part's fraction plus steps, as a key: k\N of an EDO among EDO axes (as such a lattice spelled them), else
  // as any note's (S.tempKey)
  const tempOf = (f, add, P, edo) => {
    const L = lcmB(f[1], P), x = modB((f[0] * L) / f[1] + (add * L) / P, L);
    return edo ? S.edoKey(Number(x), Number(L)) : S.tempKey([x, L]);
  };
  // two tempered steps (k\N or cents, 42¢ with 84¢ as 2\12 with 4\12): steps of 1/P octave, the common denominator. The
  // steps they reach from the 1/1 are the multiples of g/P; a note's tempered part beyond them, and its ratio part, are its
  // plane's (2\12 with 4\12: the whole-tone scale through 1/1, and the one through 1\12). A note lies at one point plus
  // any step pair that comes back to it (a lattice of them, made short by Lagrange's reduction), so the copy nearest the
  // view is found exactly, however far
  function tempGeom(sa, sb) {
    const edo = S.ratio(sa).edo && S.ratio(sb).edo, [na, da] = S.tempFrac(sa), [nb, db] = S.tempFrac(sb), P = lcmB(da, db);
    const a = (na * P) / da, b2 = (nb * P) / db, g01 = gcdB(a, b2), g = gcdB(g01, P), M = P / g;
    // e1 takes g01 steps, e2 none; k1 = M·e1 and e2 come back to the same note
    const [, s, t] = egcd(a / g01, b2 / g01), e1 = [s, t];
    const inv = M > 1n ? modB(egcd(modB(g01 / g, M), M)[1], M) : 0n;
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
    let [k1, k2] = [[M * s, M * t], [b2 / g01, -a / g01]];
    for (;;) {
      if (dot(k1, k1) > dot(k2, k2)) [k1, k2] = [k2, k1];
      const m = rdiv(dot(k1, k2), dot(k1, k1));
      if (!m) break;
      k2 = [k2[0] - m * k1[0], k2[1] - m * k1[1]];
    }
    const det = k1[0] * k2[1] - k1[1] * k2[0];
    const note = (key, b, c) => {
      const [rk, tk] = S.noteParts(key) || ['1/1', '1/1'];
      return S.mixKey(rk, tempOf(S.tempFrac(tk), BigInt(b) * a + BigInt(c) * b2, P, edo));
    };
    return {
      kind: edo ? 'edo' : 'cents', home: '1/1', diag: note('1/1', 1, -1), note,
      locate: (str, near) => {
        const parts = S.noteParts(str), f = parts && S.tempFrac(parts[1]);
        if (!f) return null;
        // in steps of 1/L octave, L a multiple of P and of the note's denominator: the planes' step gL = g·L/P
        const L = lcmB(P, f[1]), xL = (f[0] * L) / f[1], gL = (g * L) / P, oL = xL % gL;
        const key = S.mixKey(parts[0], edo ? S.edoKey(Number(oL), Number(L)) : S.tempKey([oL, L]));
        const q = modB(((xL - oL) / gL) * inv, M), p = [q * e1[0], q * e1[1]];
        const n = near.map(BigInt), d = [n[0] - p[0], n[1] - p[1]];
        const al = rdiv(d[0] * k2[1] - d[1] * k2[0], det), be = rdiv(k1[0] * d[1] - k1[1] * d[0], det);
        let best = null;
        for (let i = -1n; i <= 1n; i++) for (let j = -1n; j <= 1n; j++) {
          const b = p[0] + (al + i) * k1[0] + (be + j) * k2[0], c = p[1] + (al + i) * k1[1] + (be + j) * k2[1];
          const x2 = (b - n[0]) ** 2n + (c - n[1]) ** 2n;
          if (!best || x2 < best[2]) best = [b, c, x2];
        }
        return key && { key, b: Number(best[0]), c: Number(best[1]) };
      },
    };
  }
  // a ratio with a tempered step (3/2 with 4\12, or with 42¢): a point's ratio part from the ratio steps, its tempered
  // part from the tempered ones, both exact (3/2 and a 42¢ step: 3/2 + 42.00¢). A note's ratio part is reached as far as
  // it is a power of the axis's ratio, its tempered part as far as it is a multiple of the step's g/P; the rest is its
  // plane's (5/4 among 3/2 and 4\12 on the plane through 5/4)
  function mixGeom(sa, sb) {
    const J = S.ratio(sa).temp ? 1 : 0, rax = S.ratio(J ? sb : sa), mon = odd(rax.e), p0 = Object.keys(mon)[0];
    const edo = !!S.ratio(J ? sa : sb).edo, [Q, P] = S.tempFrac(J ? sa : sb), g = gcdB(Q, P), per = P / g;
    const inv = per > 1n ? modB(egcd(modB(Q / g, per), per)[1], per) : 0n;
    const at = (r, t) => (J ? [t, r] : [r, t]);
    const note = (key, b, c) => {
      const [rk, tk] = S.noteParts(key) || ['1/1', '1/1'], [r, t] = J ? [c, b] : [b, c];
      const rp = ratioPt(S.qMul(S.qParse(rk), rax.e, r));
      return rp && S.mixKey(rp, tempOf(S.tempFrac(tk), BigInt(t) * Q, P, edo));
    };
    return {
      kind: 'mix', home: '1/1', diag: note('1/1', 1, -1), note,
      locate: (str, near) => {
        const parts = S.noteParts(str), f = parts && S.tempFrac(parts[1]), rr = parts && S.ratio(parts[0]);
        if (!f || !rr) return null;
        // the ratio: k axis steps, and what is left with its exponent of the axis's first prime in [0, |that|)
        const x = odd(rr.e), m = mon[p0], k = m > 0 ? Math.floor((x[p0] || 0) / m) : Math.ceil((x[p0] || 0) / m);
        const rem = S.ratioOfMonzo(S.qMul(rr.e, rax.e, -k));
        // the tempered part: in steps of 1/L octave, t tempered steps and what is left below the step g/P
        const L = lcmB(P, f[1]), xL = (f[0] * L) / f[1], gL = (g * L) / P, oL = xL % gL;
        const t0 = modB(((xL - oL) / gL) * inv, per), t = t0 + per * rdiv(BigInt(near[1 - J]) - t0, per);
        const key = S.mixKey(rem, edo ? S.edoKey(Number(oL), Number(L)) : S.tempKey([oL, L]));
        const [b, c] = at(k, Number(t));
        return key && { key, b, c };
      },
    };
  }
  // a ratio point's note, or null past the exponents a note may have (S.EXP_MAX, folded): its text couldn't be read
  // back (a link, the scale), so it is no note here either (two steps of 2⁹⁸³²⁰³·3³⁰¹⁰¹·… are past it)
  function ratioPt(e) {
    const f = S.qFold(e).e;
    for (const p in f) if (Math.abs(f[p]) > S.EXP_MAX) return null;
    return S.ratioOfMonzo(e);
  }
  const locMemo = new Map();
  const setGeom = () => {
    const [ra, rb] = st.ax.map(S.ratio);
    G = !ra.temp && !rb.temp ? ratioGeom(...st.ax) : ra.temp && rb.temp ? tempGeom(...st.ax) : mixGeom(...st.ax);
    locMemo.clear();
  };
  // where a note lies, near the view's centre (remembered: the chosen notes are looked for at every redraw)
  const where = (str, near = [st.ob, st.oc]) => {
    const k = str + '|' + near;
    if (!locMemo.has(k)) { if (locMemo.size > 4000) locMemo.clear(); locMemo.set(k, G.locate(str, near)); }
    return locMemo.get(k);
  };
  const pt = (b, c) => G.note(st.plane, b, c);
  const parse = (k) => k.split(',').map(Number);
  // the chosen notes where they lie: {str, key, b, c}
  const scalePts = () => S.latticeNotes.notes.map((str) => { const w = where(str); return w && { str, ...w }; }).filter(Boolean);
  // Ratio shows no note of a lattice in cents (they have no ratio and no k\N): 12-TET ±¢ stands in
  const label = () => (st.label === 'ratio' && G.kind === 'cents' ? 'name' : st.label);

  // geometry and pitch of a lattice point
  // a square grid, as Euler drew it: the first interval runs up, the second to the right, their
  // quotient on the diagonals; the map moves to show more
  // shift: where the frame is narrower than the columns (narrow phones), the map is drawn at its size all the same
  // and seen through it, centred: the side columns run on under the row exponents' bands (renderLattice)
  let shift = 0;
  const xy = (b, c) => [shift + FX() + PX + (c - st.oc - C0()) * DX, FY + PY + (B1() - (b - st.ob)) * DY];
  // the ring shows what the label shows. ¢ above 1/1: the cents as an arc from the top on a faint
  // track, ending in a dot (a full turn = 1200, as on the clock). 12-TET ±¢: in tune (below). Ratio: an intensity, the
  // ring thicker and deeper in colour the more complex the note is (Tenney height log₂(n·d), full at
  // 32); it grows outwards, so the label keeps its room. A note without a ratio there (k\N; one whose ratio has no
  // room in the node, which shows where it lies instead) keeps the plain edge
  const RC = 2 * Math.PI * NR;
  const TENNEY_FULL = 32;
  const TRACK = `<circle class="track" r="${NR}"/>`;
  // the selected note's blue edge: under the cents arc, which is drawn on it, over the ratio's band, which covered it
  const SELRING = `<circle class="selring" r="${NR}"/>`;
  const ring = (r, sp, lab, plain) => {
    if (lab === 'cents') {
      const a = r.cents / 1200;
      const arc = a > 0.002 ? `<circle class="seg" r="${NR}" transform="rotate(-90)" stroke-dasharray="${RC * a} ${RC}"/>` : '';
      // and a dot where the arc ends, as the note's dot on the clock
      const t = 2 * Math.PI * a;
      return `${TRACK}${SELRING}${arc}<circle class="cdot" cx="${(NR * Math.sin(t)).toFixed(2)}" cy="${(-NR * Math.cos(t)).toFixed(2)}" r="4"/>`;
    }
    if (lab === 'name') {
      // 12-TET ±¢: an arc from the top, clockwise when sharp, counter-clockwise when flat, through
      // 90° · √(|dev| / 50¢), so small deviations (3/2 +2¢, 5/4 −14¢) are already apart (0¢ leaves a
      // dot at the top)
      const dev = sp.dev, s = Math.sqrt(Math.min(Math.abs(dev) / 50, 1));
      const w = 3.5, rr = NR + 1.5 + w / 2,   // just outside the node's 3-wide edge (blue when selected)
        len = Math.max(0.01, 2 * Math.PI * rr * s / 4);
      return `${TRACK}<circle class="seg dev" r="${rr.toFixed(2)}" transform="rotate(-90)${dev < 0 ? ' scale(1,-1)' : ''}" stroke-dasharray="${len.toFixed(2)} ${(2 * Math.PI * rr).toFixed(2)}" style="stroke-width:${w}"/>${SELRING}`;
    }
    if (plain || r.temp) return TRACK + SELRING;
    const t = Math.min(1, height(odd(r.e)) / TENNEY_FULL);
    const w = 1 + 5 * t;
    return `<circle class="seg int" r="${(NR + w / 2 - 1).toFixed(2)}" style="stroke-width:${w.toFixed(2)};--t:${Math.round(35 + 65 * t)}%"/>${SELRING}`;
  };
  // as S.fmtDev, whole cents: ±0 only when exact, −0 / +0 when it rounds to zero
  const fmtD = (x) => { const r = Math.round(x); return Math.abs(x) < S.EXACT ? '±0' : (x > 0 ? '+' : '−') + Math.abs(r); };
  const intTitle = (str) => { const r = S.ratio(str); return r.label + (NAMES[str] ? ' ' + NAMES[str] : ''); };
  // the two triangles of a square, as steps [up, right] from its lower-left corner (the diagonal \ is
  // the axes' quotient, 6/5): a note and both axis steps above it, its overtone chord (4:5:6, 4:6:7 …),
  // and the same shape upside down, an undertone chord (10:12:15, 12:14:21 …)
  const TRIS = [[[0, 0], [1, 0], [0, 1]], [[1, 0], [0, 1], [1, 1]]];
  // a triangle's chord as whole numbers, from the axis steps' ratios (unfolded, so 3/2 · 5/4 = 15/8); null for
  // tempered axes, or numbers past six digits
  const chordNums = (tri) => {
    const [ue, ve] = st.ax.map((s) => S.ratio(s).e);
    const es = tri.map(([db, dc]) => S.qMul(S.qMul({}, ue, db), ve, dc)), lo = {};
    for (const p of new Set(es.flatMap(Object.keys))) lo[p] = Math.min(...es.map((e) => e[p] || 0));
    const v = es.map((e) => S.qND(S.qMul(e, lo, -1), 6));
    return v.every(Boolean) ? v.map((x) => x[0]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(':') : null;
  };
  // a triangle's chord name, from its notes' names: its root in at most four characters (F♯♯♯, a₁₀♭, G♭♭♭⁷), or none. Major and minor triads
  // as Riemann and Schoenberg write them (C, a), then diminished (c°) and augmented (C+); then a seventh chord
  // without one of its notes (C⁷ dominant, c⁷ minor, CΔ major, cø half-diminished), then sus (C⁴, C²). The root
  // is tried from the triangle's lowest note up, so C–F–G low on C is C⁴ and on F F²
  const SUBD = { '₀': 0, '₁': 1, '₂': 2, '₃': 3, '₄': 4, '₅': 5, '₆': 6, '₇': 7, '₈': 8, '₉': 9 };   // C₆♯: six sharps (S.fifthName)
  const pcOf = (name) => {
    let v = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0]], k = '';
    for (const ch of name.slice(1)) {
      if (ch in SUBD) { k += SUBD[ch]; continue; }
      v += (ch === '♯' ? 1 : ch === '♭' ? -1 : 0) * (k ? +k : 1);
      k = '';
    }
    return S.mod(v, 12);
  };
  const CHORDS = [
    [[[0, 4, 7], '', 0], [[0, 3, 7], '', 1], [[0, 3, 6], '°', 1], [[0, 4, 8], '+', 0]],
    [[[0, 4, 10], '7', 0], [[0, 7, 10], '7', 0], [[0, 3, 10], '7', 1], [[0, 4, 11], 'Δ', 0], [[0, 7, 11], 'Δ', 0], [[0, 6, 10], 'ø', 1]],
    [[[0, 5, 7], '4', 0], [[0, 2, 7], '2', 0]],
  ];
  const RAISED = new Set(['7', '4', '2']);   // C⁷, C⁴, C² (CΔ, cø on the line)
  const chordName = (names) => {
    const pcs = names.map(pcOf);
    if (new Set(pcs).size < 3) return null;
    for (const group of CHORDS) for (let i = 0; i < 3; i++) {
      const rel = pcs.map((p) => S.mod(p - pcs[i], 12)).sort((a, b) => a - b).join();
      for (const [iv, suf, low] of group) {
        if (rel !== iv.join()) continue;
        const root = low ? names[i][0].toLowerCase() + names[i].slice(1) : names[i];
        if ([...root].length <= 4) return [root, suf];
      }
    }
    return null;
  };
  const chordHTML = ([root, suf]) => S.esc(root) + (RAISED.has(suf) ? S.sup(suf) : S.esc(suf));
  const VIEW_ICON = {
    notes: '<svg class="diag-ico" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3.5" cy="10.5" r="2"/><circle cx="10.5" cy="10.5" r="2"/><circle cx="3.5" cy="3.5" r="2"/></svg>',
    chords: '<svg class="diag-ico" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 11.5V2.5L11.5 11.5Z"/></svg>',
  };
  const ARR = '<path d="M1 6H10.5M6.5 2L10.5 6L6.5 10"/>';

  // the axes, in the toolbar: a pill per direction (→ first), its arrow inside, in its interval's colour, and a
  // chevron: it opens the interval picker below it
  const axBtn = (i) => `<button class="axis-pick ${i ? 'right' : 'up'}" data-ax="${i}" aria-haspopup="true" aria-expanded="false" aria-label="${i ? 'Right' : 'Up'}"><svg class="arr" viewBox="0 0 12 12" aria-hidden="true">${ARR}</svg><span class="ax-l"></span></button>`;
  // the picker's popover: one picker, moved into it when it opens; it edits the axis popAx
  let pop = null, popAx = null, pickBox, picker, typed = false;
  const popBtn = () => el.querySelector(`[data-ax="${popAx}"]`);
  // below its pill, within the window above the pinned readout (phones; it lies behind that bar): above the pill
  // where there is more room there. Placed in the page, not the window, so it moves with it (an overscroll's
  // bounce too, which sends no scroll)
  const placePop = () => {
    if (!pop) return;
    const box = popBtn().getBoundingClientRect(), edge = 8, w = pop.offsetWidth;
    const bar = document.querySelector('.pinbar'), lo = (bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : innerHeight) - edge;
    const below = lo - box.bottom - 4, above = box.top - 4 - edge;
    pop.style.left = `${scrollX + S.clamp(box.left, edge, Math.max(edge, innerWidth - w - edge))}px`;
    pop.style.maxHeight = '';
    const h = pop.offsetHeight, up = h > below && above > below;
    pop.style.maxHeight = `${Math.max(0, up ? above : below)}px`;
    pop.style.top = `${scrollY + (up ? Math.max(edge, box.top - 4 - Math.min(h, above)) : box.bottom + 4)}px`;
  };
  const closePop = (refocus) => {
    if (!pop) return;
    const btn = popBtn();
    pop.remove(); pop = null; popAx = null;
    picker.collapse();
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  };
  const openPop = (i) => {
    const again = popAx === i;
    closePop(false);
    if (again) return;
    popAx = i;
    pop = document.createElement('div');
    pop.className = 'sel-pop axis-pop';
    pop.append(pickBox);
    document.body.append(pop);
    picker.render();
    placePop();
    popBtn().setAttribute('aria-expanded', 'true');
  };

  // side: the Lattice tab's panel (S.subTab) lends its circle
  function mount(root, side) {
    el = root;
    el.innerHTML = `
      <div class="toolbar">
        ${S.EDIT_BTN}
        <div class="seg" data-seg="label" aria-label="Labels">
          <button data-v="name" title="12-TET name ±¢">12-TET ±¢</button>
          <button data-v="ratio">Ratio</button>
          <button data-v="cents">¢ above 1/1</button>
        </div>
        <div class="seg diag-pick" data-seg="view" aria-label="Show">
          <button data-v="notes" title="Notes" aria-label="Notes">${VIEW_ICON.notes}</button>
          <button data-v="chords" title="Chords" aria-label="Chords">${VIEW_ICON.chords}</button>
        </div>
        <div class="axis-picks">${axBtn(1)}${axBtn(0)}</div>
        <div class="seg planes" data-planes aria-label="Plane" hidden></div>
      </div>
      ${S.latticeFig(`<div class="panel lattice-panel">
          ${S.latticeHead('<button class="btn quiet recenter" data-pan="home" hidden>Recenter</button>')}
          <div class="lattice-frame">
            <div class="lattice" data-lattice></div>
            <button class="pan up" data-pan="up" aria-label="Move up">▲</button>
            <button class="pan down" data-pan="down" aria-label="Move down">▼</button>
            <button class="pan left" data-pan="left" aria-label="Move left">◀</button>
            <button class="pan right" data-pan="right" aria-label="Move right">▶</button>
          </div>
      </div>`)}`;
    S.latticeWire(el);
    svgWrap = el.querySelector('[data-lattice]');
    clockEl = side.clock;
    planesEl = el.querySelector('[data-planes]');
    setGeom();

    // on: tapping or dragging over notes adds them to the chosen notes (or removes them); off: they only play
    S.editSwitch(el, (on) => { st.edit = on; });
    markLabel = S.seg(el, 'label', st.label, (v) => { st.label = v; renderLattice(); });
    markView = S.seg(el, 'view', st.view, (v) => { st.view = v; renderLattice(); });
    // the axes: a pill opens the picker (the everyday ratios, its library with 12-TET's steps, a field for p/q, ¢ and
    // k\N); picking the other axis's interval swaps them; the view goes where the scale is
    pickBox = document.createElement('div');
    picker = S.ratioPicker(pickBox, {
      core: CORE,
      et: true,
      exclude: ['1/1', '2/1'],
      isOn: (s) => popAx != null && s === st.ax[popAx],
      isAlso: (s) => popAx != null && s === st.ax[1 - popAx],
      // typed (Enter): the focus stays put, else the same Enter would press the pill and open it again
      onTyped: () => { typed = true; },
      onPick: (s) => { const i = popAx; closePop(!typed); typed = false; setAxis(i, s); },
    });
    el.querySelectorAll('[data-ax]').forEach((b) => b.addEventListener('click', () => openPop(+b.dataset.ax)));
    // shut by a press elsewhere or Esc; placed anew when the window changes size (a phone's keyboard opening for the field)
    window.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !popBtn().contains(e.target)) closePop(false); }, true);
    window.addEventListener('resize', placePop);
    S.on('panic', () => closePop(true));
    planesEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.more != null) { st.planesAll = !st.planesAll; renderPlanes(); return; }
      st.plane = b.dataset.plane;
      st.ob = 0; st.oc = 0; st.moved = true;
      fitView(scalePts().filter((p) => p.key === st.plane));
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
    S.holdOn(svgWrap, '.node[data-r], .tri, .ehit', (t, e, glided) => {
      if (t.classList.contains('tri')) {
        const [b, c] = parse(t.dataset.bc);
        if (!glided) st.paintFrom = false;
        return play(TRIS[+t.dataset.t].map(([db, dc]) => pt(b + db, c + dc)));
      }
      if (t.classList.contains('ehit')) {
        if (!glided) st.paintFrom = false;
        return play([t.dataset.a, t.dataset.b]);
      }
      const str = t.dataset.r;
      S.select(str, 'lattice');
      st.selAt = parse(t.dataset.bc);
      markSel();
      // Edit: a drag that starts on a note adds (or removes) every note it passes
      if (!glided) { st.paintFrom = true; st.paintAdd = !S.latticeNotes.has(str); }
      if (st.edit && st.paintFrom) st.paintAdd ? S.latticeNotes.add(str) : S.latticeNotes.remove(str);
      return play([str]);
    }, { takeTouch: true });
    // the circle's dots select their note, the rim's too (only its rim dot turns blue)
    // a note that lies on no plane of these axes (tempered among ratios) shows only in the readout and on the rim
    S.clockHold(clockEl, '[data-dot]', (d) => { const r = d.dataset.r; S.select(r, 'lattice'); showSel(); return play([r]); }, true);
    const shown = S.whenShown(root);
    S.on('pick', shown(showSel));
    S.on('select', shown((str, src) => { if (src !== 'lattice') showSel(); }));   // an interval: nothing

    // a view moved by hand (kept, or from a link) stays where it was while its plane still holds notes
    if (!st.moved || !planeList().some(([, k]) => k === st.plane)) followScale();
    else el.querySelector('[data-pan="home"]').hidden = !st.ob && !st.oc;
    renderLattice();
    showSel();
    S.on('settings', shown(() => { renderLattice(); markSel(); }));
    S.on('scale', () => renderSide());   // the rim
    // the chosen notes changed: mark them, no full redraw
    S.on('latticeset', () => {
      svgWrap.querySelectorAll('.node').forEach((n) => n.classList.toggle('in', S.latticeNotes.has(n.dataset.r)));
      svgWrap.querySelectorAll('.tri-l').forEach((t) => t.classList.toggle('in', t.dataset.rs.split(' ').every(S.latticeNotes.has)));
      renderSide(); renderPlanes();
    });
    // as many columns as fit at full size; redraw when that number changes
    new ResizeObserver(() => { if (fitCols()) renderLattice(); }).observe(svgWrap);
    // and the rows when the circle moves below the lattice or back (the lattice's width may not change)
    STACKED.addEventListener('change', () => { if (fitCols()) renderLattice(); });
    NARROW.addEventListener('change', () => { fitCols(); renderLattice(); });
  }

  // an axis's new interval (1/1 and 2/1 step nowhere); the other axis's swaps them
  function setAxis(i, str) {
    if (!S.ratio(str) || str === '1/1' || str === '2/1' || str === st.ax[i]) return;
    const ax = [...st.ax];
    if (ax[1 - i] === str) ax[1 - i] = ax[i];
    ax[i] = str;
    useAxes(ax);
  }
  // new axes (a pick, a link read): kept, and the view moves onto the chosen notes
  function useAxes(ax) {
    st.ax = ax;
    S.keep('scales.latAxes', JSON.stringify(ax));
    if (!el) return;   // drawn with them when first shown
    setGeom();
    st.plane = G.home; st.ob = 0; st.oc = 0; st.selAt = null; st.moved = false;
    followScale();
    renderLattice();
    markSel();
  }

  // sound a set of notes, each at the same pitch as alone (so triads come in whatever
  // inversion the octave gives them; the user chose that over root position)
  function play(strs) {
    const ch = S.audio.chord(strs.map((x) => S.ratioFreq(x)));
    sounding(strs, 1); S.markScale(strs, true);   // the circle first (a note off screen gets its dot), then light it: nodes and dots by data-r
    return () => { ch.stop(); S.markScale(strs, false); sounding(strs, -1); };
  }
  // what sounds shows inside the circle while it sounds
  function sounding(strs, d) {
    for (const k of strs) {
      const n = (st.sounding.get(k) || 0) + d;
      n > 0 ? st.sounding.set(k, n) : st.sounding.delete(k);
    }
    renderSide();
  }

  // label inside a node, sized to fit the circle (radius NR); null when its ratio has no room there
  const FIT = 2 * (NR - 3);
  const font = (size) => { const cs = getComputedStyle(document.documentElement); return `600 ${size || cs.getPropertyValue('--fs-m').trim()} ${cs.getPropertyValue('--sans').trim()}`; };
  // 0.66: any cents with its + and ¢ fits (six characters at most, S.centsDigits: +1158.0¢), so a node of cents gives way to
  // its steps only for a long ratio part (2187/2048)
  const FIT_MIN = 0.66;
  function fitted(lines) {
    const f = font(), k = Math.min(1, FIT / Math.max(...lines.map(([, , s]) => S.textWidth(s, f))));
    if (k < FIT_MIN) return null;
    const txt = lines.map(([cls, y, s]) => `<text class="${cls}" y="${y}">${S.esc(s)}</text>`).join('');
    return k < 1 ? `<g transform="scale(${k.toFixed(3)})">${txt}</g>` : txt;
  }
  function nodeText(r, sp, lab) {
    const t = (cls, y, s) => `<text class="${cls}" y="${y}">${S.esc(s)}</text>`;
    if (lab === 'name') return t('n-main', -2, sp.name) + t('n-sub', 13, fmtD(sp.dev) + '¢');
    if (lab === 'cents') return t('n-main', 5, r.cents.toFixed(0));
    // a ratio with cents: its two parts, stacked; k\N or cents. Smaller where the longer line wouldn't fit, as far as
    // FIT_MIN of its size (as placeText's lines shrink); past that, as a long ratio, the node's steps
    if (r.mix) return fitted([['n-r', -2, r.rpart.label], ['n-sub', 13, (r.down ? '−' : '+') + r.tshown.label]]);
    if (r.temp) return fitted([['n-r', 5, r.label]]);
    const nd = S.qND(r.e, 5);
    let ns = nd && String(nd[0]), ds = nd && String(nd[1]);
    if (nd && ns.length + ds.length <= 5) return t('n-r', 5, `${ns}/${ds}`);
    // stacked fraction, in S.fmtRatio's form as everywhere (n/d up to 4 digits, else prime powers: 13⁴ over 2¹⁴)
    [ns, ds = '1'] = S.fmtRatio(S.qND(r.e, S.Q_DIGITS), 4, r.e).split(/\s*\/\s*/);
    const f = font();
    if (Math.max(S.textWidth(ns, f), S.textWidth(ds, f)) > FIT) return null;
    const len = Math.max(ns.length, ds.length);
    const half = len <= 4 ? 15 : 20;
    return t('n-r', -4, ns) + `<line class="n-bar" x1="${-half}" x2="${half}" y1="0.5" y2="0.5"/>` + t('n-r', 15, ds);
  }
  // where a node lies, for a ratio with no room in it: its steps up and to the right, each after its axis's
  // arrow, in that axis's colour
  // arrow, in that axis's colour; both lines smaller where the longer one wouldn't fit (−233401), so nothing
  // leaves the node, filled or not
  function placeText(b, c, clsUp, clsRight) {
    const f = font(), fs = parseFloat(f.split(' ')[1]) || 14, g = fs / 11;   // the arrow and gaps were drawn for 11 px
    const txt = (n) => (n < 0 ? '−' + -n : String(n)), sb = txt(b), sc = txt(c), ax = 11 * g;
    const k = Math.min(1, FIT / (ax + Math.max(S.textWidth(sb, f), S.textWidth(sc, f))));
    const line = (y, cls, up, s) => {
      const x = -(k * (ax + S.textWidth(s, f))) / 2;
      return `<g class="${cls}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})"><path class="n-arr" transform="translate(0 ${(-4.5 * g).toFixed(2)}) scale(${(0.75 * g).toFixed(3)})${up ? ' rotate(-90 6 6)' : ''}" d="M1 6H10.5M6.5 2L10.5 6L6.5 10"/><text class="n-id" x="${ax.toFixed(1)}" dy="${S.DY_SANS}">${s}</text></g>`;
    };
    const m = Math.max(k, 0.7) * g;
    return line(-6 * m, clsUp, true, sb) + line(8 * m, clsRight, false, sc);
  }

  function fitCols() {
    const w = svgWrap.clientWidth;
    if (!w) return false;
    const n = S.clamp(Math.floor((w - 2 * (FX() + PX)) / DX / 2), 1, 4), r = STACKED.matches ? 3 : 4;
    if (n === cols && r === rows) return false;
    cols = n; rows = r;
    return true;
  }

  const DIRS = { up: [1, 0], down: [-1, 0], left: [0, -1], right: [0, 1] };
  // move the view one step: up/down along the first axis, left/right along the second
  function pan(dir) {
    if (dir === 'home') { st.ob = 0; st.oc = 0; }
    else { const [db, dc] = DIRS[dir]; st.ob += db; st.oc += dc; }
    st.moved = true;
    el.querySelector('[data-pan="home"]').hidden = !st.ob && !st.oc;
    renderLattice();
  }
  // arrows move the selection one step along an axis (the map follows), or along the rim if picked there
  function step(code) {
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[code];
    if (!dir) return false;
    const sel = S.shownNote();
    if (selRim()) return S.rimStep(sel, S.ARROWS[code]);
    const [db, dc] = DIRS[dir];
    // from the selected node (where it was pressed, else where it lies), if it is on the plane shown; else from the middle of the view
    let at = st.selAt && sel && pt(...st.selAt) === sel ? st.selAt : null;
    if (!at && sel) { const w = where(sel); if (w && w.key === st.plane) at = [w.b, w.c]; }
    const b = (at ? at[0] : st.ob) + db, c = (at ? at[1] : st.oc) + dc;
    const str = pt(b, c);
    if (!str) return true;   // past what a note may be: the selection stays
    if (b - st.ob > B1() || b - st.ob < B0() || c - st.oc > C1() || c - st.oc < C0()) pan(dir);
    S.select(str, 'lattice');
    st.selAt = [b, c];
    markSel();
    S.click(() => play([str]));
    return true;
  }
  // a preset that doesn't fit the view moves the view onto it
  function fitView(pts) {
    if (pts.length) {
      const bs = pts.map((p) => p.b), cs = pts.map((p) => p.c);
      const fits = (lo, hi, o, a, z) => lo >= o + a && hi <= o + z;
      if (!fits(Math.min(...bs), Math.max(...bs), st.ob, B0(), B1())) st.ob = Math.round((Math.min(...bs) + Math.max(...bs)) / 2);
      if (!fits(Math.min(...cs), Math.max(...cs), st.oc, C0(), C1())) st.oc = Math.round((Math.min(...cs) + Math.max(...cs)) / 2);
    }
    el.querySelector('[data-pan="home"]').hidden = !st.ob && !st.oc;
  }
  // the view and the plane move onto the chosen notes (after a preset, a change of axes, and when
  // first drawn): the plane stays if it holds any, else the one holding the most
  function followScale() {
    st.moved = false;
    const pts = scalePts();
    if (!pts.length) return;
    if (!pts.some((p) => p.key === st.plane)) st.plane = planeList()[0][1];
    fitView(scalePts().filter((p) => p.key === st.plane));
  }
  // the planes holding chosen notes, the fullest first (the one through 1/1 first among equals): [count, key]
  function planeList() {
    const by = new Map();
    for (const p of scalePts()) { const o = by.get(p.key); o ? o[0]++ : by.set(p.key, [1, p.key]); }
    const home = (k) => (k === G.home ? 0 : 1);
    return [...by.values()].sort((a, b) => b[0] - a[0] || home(a[1]) - home(b[1]));
  }
  // the selected note (S.sel) shows as a rim note, only its rim dot blue and off the inside of the circle unless it
  // is on screen, when it was picked on the rim or in the scale list, or lies on no node of the plane shown
  const selRim = () => {
    const sel = S.shownNote();
    if (!sel) return false;
    if (S.sel.rim) return true;
    const w = where(sel);
    return !(w && w.key === st.plane);
  };
  // the selected note marked: the last pressed note has a blue edge, as the pressed Diamond cell, wherever it lies
  // on the map (more than once where the axes repeat notes)
  function markSel() {
    const sel = !selRim() && S.shownNote();
    svgWrap.querySelectorAll('.node').forEach((n) => n.classList.toggle('sel', n.dataset.r === sel));
    renderSide();
  }
  // a note selected elsewhere (another tab, the rim, the list, a circle's dot): marked where it lies, not where pressed
  const showSel = () => { st.selAt = null; markSel(); };

  // chips for the planes that hold chosen notes (and the one shown), each named by its simplest note (cut short with
  // its whole label as the tooltip, as a ratio in powers has its n/d), with its count; hidden while everything is on
  // the plane through 1/1. Past PLANES of them, the fullest (and the one shown) until "+ n more" shows all (as a picker's own row)
  const PLANES = 6;
  function renderPlanes() {
    const list = planeList(), cur = st.plane;
    if (!list.some(([, k]) => k === cur)) list.push([0, cur]);
    if (!list.some(([, k]) => k === G.home)) list.push([0, G.home]);
    const show = list.length > 1;
    planesEl.hidden = !show;
    if (!show) return;
    const org = (k) => S.ratio(G.note(k, 0, 0)), more = list.length > PLANES;
    let shown = list;
    if (more && !st.planesAll) {   // planeList's order: the fullest first; the home plane and the one shown always
      const keep = new Set([G.home, cur]);
      for (const [, k] of list) { if (keep.size >= PLANES) break; keep.add(k); }
      shown = list.filter(([, k]) => keep.has(k));
    }
    shown.sort((a, b) => (a[1] === G.home ? -1 : b[1] === G.home ? 1 : org(a[1]).cents - org(b[1]).cents));
    planesEl.innerHTML = shown.map(([n, k]) => {
      const on = k === cur, r = org(k);
      return `<button class="${on ? 'on' : ''}" data-plane="${S.esc(k)}"${r.label.length > 12 ? ` title="${S.esc(r.label)}"` : ''}><span class="pl-l">${S.labelHTML(r.label)}</span>${n && !on ? `<span class="badge ${r.cls}">${n}</span>` : ''}</button>`;
    }).join('') + (more ? `<button class="pl-more" data-more>${st.planesAll ? '− less' : `+ ${list.length - shown.length} more`}</button>` : '');
  }
  // the axis pills: each interval's label in its colour; Ratio off where the notes have none
  function renderAxes() {
    el.querySelectorAll('[data-ax]').forEach((b) => {
      const i = +b.dataset.ax, r = S.ratio(st.ax[i]);
      b.className = `axis-pick ${i ? 'right' : 'up'} ${r.cls}`;
      b.querySelector('.ax-l').innerHTML = S.labelHTML(r.label);
      if (r.label.length > 10) b.title = r.label; else b.removeAttribute('title');   // cut short: its whole label, as a plane's
    });
    el.querySelector('[data-seg="label"] [data-v="ratio"]').disabled = G.kind === 'cents';
    markLabel(label());
  }

  function renderLattice() {
    keepView();
    fitCols();
    renderAxes();
    const [clsA, clsB] = st.ax.map((s) => S.ratio(s).cls), lab = label();
    const W0 = (FX() + PX) * 2 + (C1() - C0()) * DX, H = (FY + PY) * 2 + (B1() - B0()) * DY;
    const W = Math.min(W0, Math.floor(svgWrap.clientWidth) || W0);   // never drawn smaller: a narrower frame shows less of it
    shift = (W - W0) / 2;
    const exL = FX() + PX - NR - 12;   // the row exponents' inner edge, from the frame's side
    const chords = st.view === 'chords', R = nr();
    // each triangle's notes from the lowest up (the axis steps as they are, within the octave): its title names the lowest,
    // with the chord's numbers between ratios
    const [ca, cb] = st.ax.map((s) => S.ratio(s).cents), stepC = ([db, dc]) => db * ca + dc * cb;
    const orders = TRIS.map((tri) => [0, 1, 2].sort((x, y) => stepC(tri[x]) - stepC(tri[y])));
    const nums = TRIS.map((tri) => (G.kind === 'ratio' ? chordNums(tri) : null));
    let tris = '', edges = '', hits = '', nodes = '', exps = '', names = '', bands = '';
    const b0 = B0() + st.ob, b1 = B1() + st.ob, c0 = C0() + st.oc, c1 = C1() + st.oc;
    // the steps along each axis, in its colour: on both sides of every row, and above and below
    // every column, halfway between the move arrow and the nodes. On the right, a positive number
    // keeps a hidden minus, so the digits line up
    const fmtE = (e, pad) => (e < 0 ? '−' + -e : (pad ? '<tspan visibility="hidden">−</tspan>' : '') + e);
    const ex = (cls, x, y, anchor, e, pad) => `<text class="lat-exp ${cls}" text-anchor="${anchor}" x="${x}" y="${y}" dy="${S.DY_SANS}">${fmtE(e, pad)}</text>`;
    for (let b = b0; b <= b1; b++) {
      const y = xy(b, c0)[1];
      exps += ex(clsA, exL, y, 'end', b) + ex(clsA, W - exL, y, 'start', b, true);
    }
    const my = FY + (PY - NR) / 2;
    const selN = !selRim() && S.shownNote();   // the selected note's nodes, blue-edged
    for (let c = c0; c <= c1; c++) {
      const x = xy(b0, c)[0];
      exps += ex(clsB, x, my, 'middle', c) + ex(clsB, x, H - my, 'middle', c);
    }
    for (let c = c0; c <= c1; c++) {
      for (let b = b0; b <= b1; b++) {
        const [x, y] = xy(b, c);
        const k = `${b},${c}`, str = pt(b, c);
        if (b < b1 && c < c1) {
          TRIS.forEach((tri, i) => {
            if (tri.some(([db, dc]) => !pt(b + db, c + dc))) return;
            const pts = tri.map(([db, dc]) => xy(b + db, c + dc).join(',')).join(' ');
            const rs = orders[i].map((j) => pt(b + tri[j][0], c + tri[j][1])), ns = rs.map((s) => S.spell(s).name);
            tris += `<polygon class="tri" data-bc="${k}" data-t="${i}" points="${pts}"><title>${ns[0]}${nums[i] ? ' ' + nums[i] : ''}</title></polygon>`;
            // Chords: the name at the triangle's incentre; full ink when all three notes are chosen
            if (chords) {
              const v = tri.map(([db, dc]) => xy(b + db, c + dc)), len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
              const w = [len(v[1], v[2]), len(v[0], v[2]), len(v[0], v[1])], sw = w[0] + w[1] + w[2];
              const ix = (w[0] * v[0][0] + w[1] * v[1][0] + w[2] * v[2][0]) / sw, iy = (w[0] * v[0][1] + w[1] * v[1][1] + w[2] * v[2][1]) / sw;
              const name = chordName(ns);
              names += `<text class="tri-l${rs.every(S.latticeNotes.has) ? ' in' : ''}" data-rs="${rs.join(' ')}" x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" dy="${S.DY_SANS}">${name ? chordHTML(name) : ''}</text>`;
            }
          });
        }
        const link = (b2, c2, cls, title) => {
          if (!str || !pt(b2, c2)) return;
          const [x1, y1] = xy(b2, c2);
          edges += `<line class="edge ${cls}" x1="${x}" y1="${y}" x2="${x1}" y2="${y1}"/>`;
          // shorten the hit line so it doesn't cover the nodes
          const t = (R + 2) / Math.hypot(x1 - x, y1 - y);
          hits += `<line class="ehit" data-a="${str}" data-b="${pt(b2, c2)}" x1="${x + (x1 - x) * t}" y1="${y + (y1 - y) * t}" x2="${x1 - (x1 - x) * t}" y2="${y1 - (y1 - y) * t}"><title>${title}</title></line>`;
        };
        if (b < b1) link(b + 1, c, 'ax ' + clsA, intTitle(st.ax[0]));
        if (c < c1) link(b, c + 1, 'ax ' + clsB, intTitle(st.ax[1]));
        if (b < b1 && c > c0 && G.diag) link(b + 1, c - 1, 'diag', intTitle(G.diag));
        // a point past what a note may be: an empty dashed ring
        if (!str) { nodes += `<g class="node void" transform="translate(${x},${y})"><circle class="base" r="${R}"/><circle class="track" r="${R}"/></g>`; continue; }

        const r = S.ratio(str), sp = S.spell(str);
        const txt = chords ? `<text class="n-main" dy="${S.DY_SANS}">${S.esc(sp.name)}</text>` : nodeText(r, sp, lab);
        const label6 = r.temp ? r.label : S.fmtRatio(S.qND(r.e, S.Q_DIGITS), 6, r.e);
        nodes += `<g class="node ${r.cls}${S.latticeNotes.has(str) ? ' in' : ''}${str === selN ? ' sel' : ''}${str === '1/1' ? ' home' : ''}" data-bc="${k}" data-r="${str}" transform="translate(${x},${y})">
          <title>${sp.name} · ${label6} · ${S.exactC(r.cents)} · ${S.fmtDev(sp.dev)} vs 12-TET ${sp.name}</title>
          <circle class="base" r="${R}"/>${chords ? `<circle class="selring" r="${R}"/>` : ring(r, sp, lab, txt == null)}<circle class="halo" r="${R}"/>
          ${txt ?? placeText(b, c, clsA, clsB)}
        </g>`;
      }
    }
    // the map seen through a narrower frame: the row exponents keep their place on a band of the panel's colour over it
    // (its inner edge a line, as a window's, 10 units past the numbers so they don't run into a covered note's text)
    if (shift < 0 && exL + 10 > xy(b0, c0)[0] - NR) {   // only where it covers a note
      const bw = exL + 10, ya = xy(b1, c0)[1] - NR - 6, yb = xy(b0, c0)[1] + NR + 6;   // the line along the notes' rows, clear of the column exponents
      bands = `<rect class="lat-band" x="0" y="0" width="${bw}" height="${H}"/><rect class="lat-band" x="${W - bw}" y="0" width="${bw}" height="${H}"/>`
        + `<line class="lat-band-edge" x1="${bw}" x2="${bw}" y1="${ya}" y2="${yb}"/><line class="lat-band-edge" x1="${W - bw}" x2="${W - bw}" y1="${ya}" y2="${yb}"/>`;
    }
    svgWrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="lattice-svg" style="max-width:${W}px">
      ${tris}${edges}${hits}<g class="tri-names">${names}</g><g class="nodes">${nodes}</g>${bands}${exps}</svg>`;
    // off the plane through 1/1: the frame takes the colour of the plane's simplest note
    const panel = svgWrap.closest('.panel'), off = st.plane !== G.home, oc = off && S.ratio(G.note(st.plane, 0, 0)).cls;
    panel.classList.toggle('offplane', off);
    panel.style.setProperty('--pc', off ? (oc === 'pt' ? 'var(--ink)' : `var(--${oc})`) : '');
    renderPlanes();
    renderSide();   // the circle shows what is on screen
  }

  // the circle: the scale on its rim; inside, the chosen notes lit, wherever they lie, and every other
  // note on screen faint, lit while it sounds; the last pressed one with a blue edge
  function renderSide() {
    if (S.sideWait(renderSide)) return;
    const strs = new Set();
    for (let b = B0() + st.ob; b <= B1() + st.ob; b++) for (let c = C0() + st.oc; c <= C1() + st.oc; c++) { const s = pt(b, c); if (s) strs.add(s); }
    for (const p of scalePts()) strs.add(p.str);
    for (const k of st.sounding.keys()) strs.add(k);
    const points = [...strs].map((str) => {
      const r = S.ratio(str);
      return { cents: r.cents, cls: r.cls, faint: !S.latticeNotes.has(str), attrs: `data-dot data-r="${str}"` };
    });
    const sel = S.shownNote(), rim = selRim();
    S.clock(clockEl, { points, sel: !rim && sel || null, rimSel: rim ? sel : null });   // the selection: S.clock rings its dot, or draws one
  }

  return {
    title: 'Lattice',
    mount,
    DEF_AX,
    axes: () => [...st.ax],
    setAxes: (l) => { const a = axesOk(l) ? [...l] : [...DEF_AX]; if (a.join() !== st.ax.join()) { closePop(false); useAxes(a); } },
    onKeyDown: (code) => step(code),
    view: viewNow,
    home: () => (G ? G.home : null),
    // from a link (after its axes): labels and Notes/Chords, and the view if it was moved by hand
    setView: (v) => {
      const d = { label: 'name', view: 'notes', plane: st.plane, ob: st.ob, oc: st.oc, moved: false };
      Object.assign(st, d, v && LABELS.includes(v.label) ? { label: v.label } : {}, v && VIEWS.includes(v.view) ? { view: v.view } : {},
        v && v.moved && viewOk({ ...d, ...v }) ? { plane: v.plane, ob: v.ob, oc: v.oc, moved: true } : {});
      if (!el) return keepView();
      markLabel(st.label); markView(st.view);
      if (!st.moved || !planeList().some(([, k]) => k === st.plane)) followScale();
      el.querySelector('[data-pan="home"]').hidden = !st.ob && !st.oc;
      renderPlanes(); renderLattice();
    },
  };
})();
