'use strict';
// Numbers (a Just intonation sub-view): the harmonics and what they divide, as three maps of the numbers
// made of chosen primes. Table and Scatter rank ratios by complexity m = n·d: a number m stands for its
// family, its prime powers each above or below the bar (15: 15, 5/3, 3/5, 1/15), so every ratio has one
// place and the plain numbers are the d = 1 edge. Table: one band per octave of m, 12 columns by pitch;
// Hasse: three directions, each × or ÷ a prime, each ratio joined to the next along them, height by log₂(n·d);
// Scatter: the odd families, away from the middle by how lopsided a ratio is and the log of (prime factors
// of m counted with repeats × the largest prime), down m (as m^⅔).
// Every number plays its note folded into the octave above the 1/1, and selects it (with every number
// of that note). Table and Scatter share one set of primes (2 is always in); Hasse has its three axes.
S.parts.numbers = (() => {
  const PRIMES = [3, 5, 7, 11, 13, 17, 19];
  const VIEWS = { table: 'Table', hasse: 'Hasse', scatter: 'Scatter' };
  const st = { view: 'table', primes: new Set([3, 5, 7]), extra: [], hax: [3, 5, 7], sel: S.note.str, n: null, rim: S.note.rim, sounding: new Map() };
  try {
    const o = JSON.parse(localStorage.getItem('scales.numbers') || 'null');
    if (o) {
      if (VIEWS[o.view]) st.view = o.view;
      if (Array.isArray(o.extra)) st.extra = o.extra.filter((p) => isPrime(p) && p > 19);
      if (Array.isArray(o.primes)) { const ps = o.primes.filter((p) => PRIMES.includes(p) || st.extra.includes(p)); if (ps.length) st.primes = new Set(ps); }
      if (Array.isArray(o.hax) && o.hax.length === 3 && o.hax.every((p) => p === 0 || PRIMES.includes(Math.abs(p)))) {
        const on = o.hax.filter(Boolean).map(Math.abs);
        if (on.length && new Set(on).size === on.length) st.hax = o.hax;
      }
    }
  } catch (e) {}
  const save = () => {
    try { localStorage.setItem('scales.numbers', JSON.stringify({ view: st.view, primes: [...st.primes], extra: st.extra, hax: st.hax })); } catch (e) {}
  };
  function isPrime(n) { if (!Number.isInteger(n) || n < 2) return false; for (let p = 2; p * p <= n; p++) if (n % p === 0) return false; return true; }
  const factors = (n) => { const f = []; for (let p = 2; p * p <= n; p++) while (n % p === 0) { f.push(p); n /= p; } if (n > 1) f.push(n); return f; };
  const expOf = (n, p) => { let k = 0; if (p) while (n % p === 0) { n /= p; k++; } return k; };
  // k: a number, or a ratio "n/d" as its family writes it
  const partsOf = (k) => { const [n, d = 1] = String(k).split('/').map(Number); return [n, d]; };
  const noteOf = (k) => S.ratioKey(S.foldRatio(...partsOf(k)));
  const freqOf = (k) => S.ratioFreq(noteOf(k), 0);
  // the ratios of complexity m: each prime power of m above or below the bar, as keys, the overtone first
  const family = (m) => {
    const pw = new Map();
    for (const p of factors(m)) pw.set(p, (pw.get(p) || 1) * p);
    let out = [[1, 1]];
    for (const q of pw.values()) out = out.flatMap(([n, d]) => [[n * q, d], [n, d * q]]);
    return out.map(([n, d]) => (d === 1 ? String(n) : `${n}/${d}`));
  };
  // an even number (the Table's octaves of an odd one) muted until pointed at, selected or sounding
  const cell = (k) => {
    const [n, d] = partsOf(k);
    return `<button class="nnum ${S.primeClass(n * d)}${n % 2 ? '' : ' even'}" data-n="${k}" data-r="${noteOf(k)}" title="${k} · ${noteOf(k)}">${k}</button>`;
  };

  // the numbers made of primes ps (ascending) up to max, smallest factor first, each with its count of distinct
  // primes; visit returning false stops the walk. As long as what it finds, however far max is
  const walk = (ps, max, visit) => {
    let stop = false;
    const go = (n, i, w) => {
      if (stop) return;
      if (visit(n, w) === false) { stop = true; return; }
      for (let j = i; j < ps.length && !stop; j++) {
        const m = n * ps[j];
        if (m > max) break;
        go(m, j, j === i && n > 1 ? w : w + 1);
      }
    };
    go(1, 0, 0);
  };
  const smooth = (ps, max) => { const out = []; walk(ps, max, (n) => { out.push(n); }); return out.sort((a, b) => a - b); };
  const oddPrimes = () => [...st.primes].sort((a, b) => a - b);
  // what a range would draw, counted (stops once past the kind's budget)
  const tally = (k, r) => {
    let sum = 0;
    walk(k.ps(), k.top(r), (n, w) => { sum += k.size(n, w); return sum <= k.budget; });
    return sum;
  };

  /* ---- Table: an octave of m = n·d per band, 12 columns by pitch ---- */
  const table = {
    want: 7, min: 3,   // octaves asked for: m up to 2^K − 1
    budget: 4000, floor: 500,
    ps: () => [2, ...oddPrimes()],
    top: (K) => 2 ** K - 1,
    size: (n, w) => (n % 2 ? 2 ** w : 1),
    up: (K) => K + 1,
    down: (K) => K - 1,
    last: 20,   // the user's call
    // a typed prime gets the octaves it needs to show
    reach(p) { table.want = Math.max(table.want, Math.ceil(Math.log2(p + 1))); },
    draw(fig, K) {
      const list = smooth(table.ps(), table.top(K));
      let at = 0;
      const names = Array.from({ length: 12 }, (_, i) => S.midiName(S.settings.base + i).replace(/-?\d+$/, ''));
      let rows = '', longest = 1;
      for (let k = 0; k < K; k++) {
        const cols = Array.from({ length: 12 }, () => []);
        for (; at < list.length && list[at] < 2 ** (k + 1); at++) {
          const m = list[at];
          // an even m: only its plain octave; its ratios are the odd part's, in the same note
          for (const key of m % 2 ? family(m) : [String(m)]) {
            cols[S.mod(Math.round(S.ratio(noteOf(key)).cents / 100), 12)].push(key);
            if (m % 2) longest = Math.max(longest, key.length);
          }
        }
        rows += `<div class="nrow nband">${cols.map((c) => `<span class="ncell">${c.map(cell).join('')}</span>`).join('')}</div>`;
      }
      // wide enough for the longest ratio in every column (7.5 px a character, 6 px room); past that the panel scrolls sideways
      const colW = 7.5 * longest + 6;
      return `<div class="ntable" style="min-width:${Math.max(300, 12 * colW + 22)}px"><div class="nrow nhead">${names.map((x) => `<span>${x}</span>`).join('')}</div>${rows}</div>`;
    },
  };

  /* ---- Hasse: the odd m = n·d of three primes; the first straight down, the second down to the right,
     the third down to the left; a direction × a prime puts it above the bar, ÷ below (st.hax: −3 is ÷3), so the
     picture keeps one shape; height = log₂ m, so a step's drop is its prime's size. The
     flattest spacing that fits the width without two numbers touching is searched on every draw ---- */
  const haxAbs = () => st.hax.map(Math.abs);
  // the key of m in Hasse: below the bar what the ÷ directions make of it
  const hkey = (m) => {
    let d = 1;
    for (const p of st.hax) if (p < 0) d *= (-p) ** expOf(m, -p);
    return d === 1 ? String(m) : `${m / d}/${d}`;
  };
  const PH = 24, GAP = 4;   // a number's pill: 24 high, as wide as its digits
  const pillW = (m) => 12 + 8.5 * hkey(m).length;
  // the spacing with the smallest area whose numbers don't touch: it keeps one shape as More adds numbers
  // (the picture widens; the panel scrolls sideways), where fitting the width made it jump to twice the height
  function hasseLayout(ns) {
    const [, b, c] = haxAbs();
    const it = ns.map((n) => ({ n, eb: expOf(n, b), ec: expOf(n, c), ly: Math.log2(n), w: pillW(n) })).sort((p, q) => p.ly - q.ly);
    const L = Math.log2(Math.max(...ns));
    let best = null;
    const rng = (p) => p ? Array.from({ length: 60 }, (_, i) => 4 + 4 * i) : [0];   // an axis set to – has no spacing to search
    for (let hy = 32; hy <= 140; hy += 2) {   // below 32 the steps lie almost flat and stop reading as a climb
      for (const db of rng(b)) for (const dc of rng(c)) {
        let lo = Infinity, hi = -Infinity;
        for (const p of it) { p.x = p.eb * db - p.ec * dc; lo = Math.min(lo, p.x - p.w / 2); hi = Math.max(hi, p.x + p.w / 2); }
        const area = (hi - lo) * (hy * L + PH);
        if (best && area >= best.area) continue;
        let ok = true;
        for (let i = 0; ok && i < it.length; i++) {
          for (let j = i + 1; j < it.length && (it[j].ly - it[i].ly) * hy < PH + GAP; j++) {
            if (Math.abs(it[i].x - it[j].x) < (it[i].w + it[j].w) / 2 + GAP) { ok = false; break; }
          }
        }
        if (ok) best = { hy, db, dc, area };
      }
    }
    return best || { hy: 60, db: 40, dc: 40 };
  }

  const hasse = {
    want: 1000, min: 16,
    budget: 300, floor: 60,
    ps: () => haxAbs().filter(Boolean).sort((p, q) => p - q),
    top: (H) => H,
    size: () => 1,
    up: (H) => H * 4,
    down: (H) => Math.floor(H / 4),
    draw(fig, H) {
      const [a, b, c] = haxAbs(), ns = smooth(hasse.ps(), H);
      const { hy, db, dc } = hasseLayout(ns);
      const pos = (n) => [expOf(n, b) * db - expOf(n, c) * dc, Math.log2(n) * hy];
      let x0 = Infinity, x1 = -Infinity, y1 = 0;
      for (const n of ns) { const [x, y] = pos(n), w = pillW(n) / 2; x0 = Math.min(x0, x - w); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y); }
      const set = new Set(ns);
      let edges = '', nodes = '';
      for (const n of ns) {
        const [x, y] = pos(n), w = pillW(n);
        for (const p of [a, b, c]) if (p && set.has(n * p)) { const [x2, y2] = pos(n * p); edges += `<line class="hedge ${S.primeClass(p)}" x1="${x}" y1="${y}" x2="${x2}" y2="${y2}"/>`; }
        const key = hkey(n);
        nodes += `<g class="hnode ${S.primeClass(n)}" data-n="${key}" data-r="${noteOf(key)}" transform="translate(${x},${y})"><title>${key} · ${noteOf(key)}</title><rect x="${-w / 2}" y="${-PH / 2}" width="${w}" height="${PH}" rx="${PH / 2}"/><text dy="${S.DY_SANS}">${key}</text></g>`;
      }
      const m = 4, vw = x1 - x0 + 2 * m, vh = y1 + PH + 2 * m;
      return `<svg class="hasse-svg" viewBox="${x0 - m} ${-PH / 2 - m} ${vw} ${vh}" width="${vw}" height="${vh}">${edges}${nodes}</svg>`;
    },
  };

  /* ---- Scatter: the odd families. A ratio n/d of m = n·d lies t · D(x) from the middle, t = ln(n/d) / ln(m)
     (1 for an overtone, −1 for an undertone, between for the rest), x = ln(Ω(m) · P(m)) (prime factors with
     repeats, times the largest), D with 0…2 squeezed next to the middle (only 3, 5, 9 and 7 lie there) and
     the 1 (Ω = 0) in the middle; y down = m^⅔ ---- */
  let SW = 0;
  const xOf = (n) => { const f = factors(n); return f.length ? Math.log(f.length * f[f.length - 1]) : -Infinity; };
  const scatter = {
    want: 128, min: 8,   // as the Table: m below 2^7, More doubles it
    budget: 4000, floor: 500,
    last: 2 ** 20,   // as far as the Table reaches (9 px per unit of m^⅔: some 90 000 px down)
    ps: oddPrimes,
    top: (M) => M,
    size: (n, w) => 2 ** w,
    up: (M) => M * 2,
    down: (M) => Math.floor(M / 2),
    resize(fig) { const w = fig.clientWidth; if (w && Math.abs(w - SW) > 8) { SW = w; return true; } return false; },
    draw(fig, SMAX) {
      SW = fig.clientWidth || 600;
      const W = SW, ns = smooth(oddPrimes(), SMAX);
      const xmax = Math.max(2.5, ...ns.slice(1).map(xOf)) + 0.1, ML = 44, MR = 14, MT = 16, R = 5, HIT = 11, ONE = 18;
      const mid = (ML + W - MR) / 2, pw = (W - MR - ML) / 2 - R - ONE, F = 0.12, xs = Math.log(3) - 0.1;
      const D = (x) => (x === -Infinity ? 0 : ONE + (x < 2 ? ((x - xs) / (2 - xs)) * F * pw : F * pw + ((x - 2) / (xmax - 2)) * (1 - F) * pw));
      // 9 px per unit of m^⅔ (128 lands 219 px down, 1000 888; odd numbers only, so they stand sparse). A dot closer than 11 px
      // to one placed before it moves aside, in turn right and left
      const yv = (n) => n ** (2 / 3), s = 9, Y = (n) => MT + (yv(n) - 1) * s;
      const dots = [];
      for (const m of ns) {
        const y = Y(m), lm = Math.log(m);
        for (const key of family(m)) {
          const [n, d] = partsOf(key), x0 = mid + (m > 1 ? Math.log(n / d) / lm : 0) * D(xOf(m));
          const near = [];   // m only grows, so the dots within reach are the last ones placed
          for (let i = dots.length - 1; i >= 0 && y - dots[i].y < 11; i--) near.push(dots[i]);
          const x = [0, 11, -11, 22, -22, 33, -33].map((o) => x0 + o).find((a) => near.every((o) => Math.hypot(a - o.x, y - o.y) >= 11)) ?? x0;
          dots.push({ key, m, x, y });
        }
      }
      const hi = SMAX, h = Y(hi) + MT;   // to the range's end (128, 256 …), so its label shows
      // y labels at the powers of 2, the Table's bands, from the end up while they stay 18 px apart
      const tick = [];
      for (let v = hi; v > 1 && (!tick.length || Y(tick[tick.length - 1]) - Y(v) >= 18); v /= 2) tick.push(v);
      let g = '';
      for (const v of tick) g += `<line class="sgrid" x1="${ML - 4}" x2="${W - MR / 2}" y1="${Y(v)}" y2="${Y(v)}"/><text class="stick l" x="2" y="${Y(v)}" dy="${S.DY_SANS}">${v}</text>`;
      // a wider ring under each dot takes presses near it (a 5 px dot was hard to hit with a finger); later dots' on top
      for (const o of dots) g += `<circle class="sdot-hit" data-hit="${o.key}" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${HIT}"/>`;
      for (const o of dots) g += `<circle class="sdot ${S.primeClass(o.m)}" data-n="${o.key}" data-r="${noteOf(o.key)}" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${R}"><title>${o.key} · ${noteOf(o.key)}</title></circle>`;
      return `<svg class="scatter-svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">${g}</svg>`;
    },
  };

  const KINDS = { table, hasse, scatter }, SLOW = 250;
  let el, clockEl, readEl, figEl;

  // the primes' toggles (Table, Scatter): chips, as the Diamond's numbers, one per prime in its colour, then a field for any
  // other prime that follows the last chip on its line and wraps with them
  const primeBar = () => `${[...PRIMES, ...st.extra].map((p) => `<button class="chip ${S.primeClass(p)}${st.primes.has(p) ? ' on' : ''}" data-p="${p}" aria-pressed="${st.primes.has(p)}">${p}</button>`).join('')}<input type="search" enterkeyhint="done" class="ratio-in prime-in" data-in="prime" placeholder="p ⏎" spellcheck="false" inputmode="numeric" aria-label="Another prime, Enter to add">`;
  // Hasse's three axes: one pill per direction, as the Lattice's; picking another axis's prime swaps them
  const DIRS = [['down', 90], ['dright', 50], ['dleft', 130]];
  // – takes a direction out (at most two)
  const axSel = (i) => `<label class="axis-pick ${st.hax[i] ? 'p' + Math.abs(st.hax[i]) : 'off'}"><svg class="arr" viewBox="0 0 12 12" style="transform: rotate(${DIRS[i][1]}deg)"><path d="M1 6H10.5M6.5 2L10.5 6L6.5 10"/></svg><select data-hax="${i}" aria-label="Axis ${i + 1}">${[...PRIMES, ...PRIMES.map((p) => -p)].map((p) => `<option value="${p}"${p === st.hax[i] ? ' selected' : ''}>${p > 0 ? '×' : '÷'}${Math.abs(p)}</option>`).join('')}<option value="0"${st.hax[i] ? '' : ' selected'}>–</option></select></label>`;

  function renderTools() {
    el.querySelector('[data-ntools]').innerHTML = st.view === 'hasse' ? `<div class="axis-picks">${axSel(0)}${axSel(1)}${axSel(2)}</div>` : '';
    const chips = el.querySelector('[data-nprimes]');
    chips.hidden = st.view === 'hasse';
    chips.innerHTML = st.view === 'hasse' ? '' : primeBar();
  }
  function draw() {
    if (!figEl) return;
    // Each kind has a budget of elements; More goes once the next range would pass it, and a draw that takes
    // longer than SLOW lowers it to what it just drew (each More roughly doubles the work)
    const t = performance.now(), k = KINDS[st.view];
    // the range asked for, as far as the budget reaches: more primes draw less far, fewer draw far again
    let r = k.want;
    while (r > k.min && tally(k, r) > k.budget) r = k.down(r);
    figEl.innerHTML = k.draw(figEl, r);
    shownNotes = null;
    mark(); renderSide();
    figEl.offsetHeight;
    // this device's budget: what just took too long is as far as it goes
    if (performance.now() - t > SLOW) k.budget = Math.max(k.floor, Math.min(k.budget, tally(k, r)));
    const next = k.up(k.want);
    el.querySelector('.num-more').hidden = r !== k.want || (k.last && next > k.last) || tally(k, next) > k.budget;
  }

  function mount(root, side) {
    el = root; clockEl = side.clock; readEl = side.read;
    st.sel = S.note.str; st.rim = S.note.rim;   // the note selected by now (a view mounted later starts on it), not the one at load
    el.innerHTML = `<div class="toolbar"><div class="seg" data-seg="nview">${Object.entries(VIEWS).map(([k, t]) => `<button data-v="${k}">${t}</button>`).join('')}</div><span class="ntools" data-ntools></span></div>
      <div class="chips nprimes" data-nprimes aria-label="Primes"></div>
      ${S.jiFig('<div class="panel num-panel"><div class="num-fig" data-fig></div><div class="num-more"><button class="btn quiet" data-act="more">More</button></div></div>')}`;
    S.markLink();
    figEl = el.querySelector('[data-fig]');
    S.seg(el, 'nview', st.view, (v) => { st.view = v; save(); renderTools(); draw(); });
    renderTools();
    el.querySelector('[data-nprimes]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const p = +b.dataset.p;
      if (st.primes.has(p) && st.primes.size === 1) return;   // one prime at least
      st.primes.has(p) ? st.primes.delete(p) : st.primes.add(p);
      b.classList.toggle('on', st.primes.has(p)); b.setAttribute('aria-pressed', st.primes.has(p));
      save(); draw();
    });
    el.querySelector('[data-ntools]').addEventListener('change', (e) => {
      const s = e.target.closest('[data-hax]');
      if (!s) return;
      const i = +s.dataset.hax, p = +s.value, j = p ? st.hax.findIndex((q) => Math.abs(q) === Math.abs(p)) : -1;
      if (!p && st.hax.filter(Boolean).length === 1) { s.value = st.hax[i]; return; }   // one direction at least
      if (j >= 0 && j !== i) st.hax[j] = st.hax[i];
      st.hax[i] = p;
      save(); renderTools(); draw();
    });
    el.querySelector('[data-nprimes]').addEventListener('keydown', (e) => {
      const inp = e.target.closest('[data-in="prime"]');
      if (!inp || e.key !== 'Enter') return;
      const p = +inp.value.trim();
      if (!isPrime(p) || p < 3 || p > 997) { inp.classList.add('bad'); setTimeout(() => inp.classList.remove('bad'), 1200); return; }
      if (!PRIMES.includes(p) && !st.extra.includes(p)) st.extra = [...st.extra, p].sort((x, y) => x - y);
      st.primes.add(p);
      inp.value = '';
      if (st.view === 'table') table.reach(p);
      save(); renderTools(); draw();
      el.querySelector('[data-in="prime"]').focus();
      // the prime itself lights for a moment, scrolled into view
      const d = figEl.querySelector(`[data-n="${p}"]`);
      if (d) { d.classList.add('flash'); d.scrollIntoView({ block: 'nearest', inline: 'nearest' }); setTimeout(() => d.classList.remove('flash'), 1400); }
    });
    el.querySelector('[data-act="more"]').addEventListener('click', () => { const k = KINDS[st.view]; k.want = k.up(k.want); draw(); });
    S.holdOn(figEl, '[data-n], [data-hit]', (d) => {
      const n = d.dataset.n || d.dataset.hit;
      st.n = n; trail.length = 0;
      select(noteOf(n), true);
      return sound(n);
    }, { takeTouch: true, id: (x) => x.dataset.n || x.dataset.hit });
    S.clockHold(clockEl, '[data-r]', (d) => { select(d.dataset.r, true); return S.playScaleNotes([d.dataset.r]); }, (str) => select(str, false, true));
    const shown = S.whenShown(root);
    S.on('pick', shown((str) => select(str, false, true)));
    S.on('note', shown((str, src) => { if (src !== 'numbers') select(str); }));
    S.on('settings', draw);
    S.on('scale', renderSide);
    S.on('jiset', renderSide);
    new ResizeObserver(() => { const k = KINDS[st.view]; if (k.resize && k.resize(figEl)) draw(); }).observe(figEl);
    draw();
  }

  // own: chosen here (n: the number, if one was pressed); rim: picked on the rim or in the list
  function select(str, own = false, rim = false) {
    if (!(own && st.n != null && noteOf(st.n) === str)) st.n = null;
    st.sel = str; st.rim = rim;
    if (own) S.setNote(str, 'numbers');
    mark();
    renderSide();
  }
  function mark() {
    if (!figEl) return;
    // the pressed number (else the first of its note) blue-edged; the Table's other numbers of that note tinted
    figEl.querySelectorAll('.sel, .same').forEach((d) => d.classList.remove('sel', 'same'));
    const same = figEl.querySelectorAll(`[data-r="${st.sel}"]`);
    const one = (st.n != null && figEl.querySelector(`[data-n="${st.n}"]`)) || same[0];
    same.forEach((d) => d.classList.add('same'));
    if (one) { one.classList.remove('same'); one.classList.add('sel'); }
  }
  function sound(n) {
    const str = noteOf(n), v = S.audio.tone(freqOf(n));
    const ds = figEl.querySelectorAll(`[data-r="${str}"]`);   // every number of that note (6, 12, 24 with 3)
    ds.forEach((d) => d.classList.add('hot'));
    st.sounding.set(str, (st.sounding.get(str) || 0) + 1); renderSide(); S.scaleHot([str], true);
    return () => {
      v.stop(); ds.forEach((d) => d.classList.remove('hot')); S.scaleHot([str], false);
      const c = st.sounding.get(str) - 1; c ? st.sounding.set(str, c) : st.sounding.delete(str); renderSide();
    };
  }
  // the circle: the chosen notes lit, every other note shown faint (as the Lattice's), the selected one with its spoke, and what sounds
  let shownNotes = null;   // the picture's notes, read once per drawing
  // a press selects and sounds: one drawing for both
  let sideQueued = false;
  function renderSide() {
    if (sideQueued) return;
    sideQueued = true;
    queueMicrotask(() => { sideQueued = false; drawSide(); });
  }
  function drawSide() {
    if (!clockEl) return;
    readEl.innerHTML = S.readout(st.sel);
    if (S.sideWait(drawSide)) return;
    shownNotes = shownNotes || (figEl ? [...new Set([...figEl.querySelectorAll('[data-r]')].map((d) => d.dataset.r))] : null);
    const strs = [...new Set([...(shownNotes || []), ...S.ji.notes, st.rim ? null : st.sel, ...st.sounding.keys()].filter((s) => s && !S.ratio(s).temp))];
    const points = strs.map((s) => ({ cents: S.ratio(s).cents, rf: 0.8, r: 7, cls: S.ratio(s).cls + (S.ji.has(s) ? ' in' : '') + (s === st.sel && !st.rim ? ' sel' : '') + (st.sounding.has(s) ? ' hot' : ''), attrs: `data-r="${s}"`, spoke: true }));
    S.clock(clockEl, { points, rimSel: st.rim || !strs.includes(st.sel) ? st.sel : null });
  }

  // Hasse: along the axes, on m. ↓ → ← multiply it by the prime drawn that way (down, down right, down left);
  // ↑ climbs back the way the arrows came down, else divides by the first axis that divides
  const trail = [];
  function hasseStep(n, code) {
    const [a, b, c] = haxAbs(), at = (m) => figEl.querySelector(`[data-n="${hkey(m)}"]`);
    if (code !== 'ArrowUp') {
      const p = { ArrowDown: a, ArrowRight: b, ArrowLeft: c }[code], to = p && at(n * p);
      if (to) trail.push(n);
      return to;
    }
    const back = trail.pop();
    if (back && n % back === 0 && haxAbs().includes(n / back) && at(back)) return at(back);
    trail.length = 0;
    const p = haxAbs().find((q) => q && n % q === 0);
    return p ? at(n / p) : null;
  }
  // arrows: the nearest number on screen that way (Table, Scatter), along the axes (Hasse); on a rim
  // pick, around the rim
  function onKeyDown(code) {
    const d = S.ARROWS[code];
    if (!d || !figEl) return false;
    if (st.rim) return S.rimStep(st.sel, d);
    const els = [...figEl.querySelectorAll('[data-n]')].filter((d) => d.offsetParent !== null);   // not the hidden ones (an SVG dot has no offsetParent at all)
    const from = (st.n != null && figEl.querySelector(`[data-n="${st.n}"]`)) || figEl.querySelector(`[data-r="${st.sel}"]`);
    const to = !from ? els[0] : st.view === 'hasse' ? hasseStep(partsOf(from.dataset.n).reduce((x, y) => x * y), code) : S.spatialStep(from, els, code);
    if (!to) return true;
    const n = to.dataset.n;
    st.n = n;
    select(noteOf(n), true);
    to.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    S.click(() => sound(n));
    return true;
  }

  return { title: 'Numbers', mount, onKeyDown };
})();
