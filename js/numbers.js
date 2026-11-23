'use strict';
// What Table, Hasse and Scatter share (sub-views of the Numbers tab, each in its own file with its own state): the
// harmonics and what they divide, as maps of the numbers made of chosen primes. Table and Scatter rank ratios by
// complexity m = n·d: a number m stands for its family, its prime powers each above or below the bar (15: 15, 5/3,
// 3/5, 1/15), so every ratio has one place and the plain numbers are the d = 1 edge.
// Every number plays its note folded into the octave above the 1/1, and selects it (with every number of that note).
// S.numbers.part(spec) makes one such sub-view; S.numbers.primeTools are the primes' chips Table and Scatter each have.
S.numbers = (() => {
  const PRIMES = [3, 5, 7, 11, 13, 17, 19];
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
  // what a range would draw, counted (stops once past the kind's budget)
  const tally = (k, r) => {
    let sum = 0;
    walk(k.ps(), k.top(r), (n, w) => { sum += k.size(n, w); return sum <= k.budget; });
    return sum;
  };

  // The primes' toggles (Table, Scatter, each its own set; 2 is always in): chips, as the Diamond's numbers, one per
  // prime in its colour, then a field for any other prime that follows the last chip on its line and wraps with them.
  // st.primes: those on; st.extra: typed primes past 19, kept as chips while off
  const DEF_PRIMES = [3, 5, 7];
  const primeTools = {
    DEF: { primes: DEF_PRIMES, extra: [] },
    // stored or from a link: what is unreadable is the default
    use(st, o) {
      const typed = (p) => isPrime(p) && p > 19 && p <= 997, list = (a) => (Array.isArray(a) ? a : []);
      st.extra = [...new Set([...list(o.extra), ...list(o.primes)].filter(typed))].sort((a, b) => a - b);
      const ps = list(o.primes).filter((p) => PRIMES.includes(p) || st.extra.includes(p));
      st.primes = new Set(ps.length ? ps : DEF_PRIMES);
    },
    out: (st) => ({ primes: [...st.primes].sort((a, b) => a - b), extra: st.extra }),
    odd: (st) => [...st.primes].sort((a, b) => a - b),
    html: (st) => `<div class="chips nprimes" data-tools aria-label="Primes">${[...PRIMES, ...st.extra].map((p) => `<button class="chip ${S.primeClass(p)}${st.primes.has(p) ? ' on' : ''}" data-p="${p}" aria-pressed="${st.primes.has(p)}">${p}</button>`).join('')}<input type="search" enterkeyhint="done" class="ratio-in prime-in" data-in="prime" placeholder="p ⏎" spellcheck="false" inputmode="numeric" aria-label="Another prime, Enter to add"></div>`,
    // changed(p, same): save, the controls again unless same, draw; p a prime just typed, which the kind may need to reach
    wire(root, st, changed, fig) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tools] [data-p]');
        if (!b) return;
        const p = +b.dataset.p;
        if (st.primes.has(p) && st.primes.size === 1) return;   // one prime at least
        st.primes.has(p) ? st.primes.delete(p) : st.primes.add(p);
        b.classList.toggle('on', st.primes.has(p)); b.setAttribute('aria-pressed', st.primes.has(p));
        changed(null, true);   // toggled in place, so a chip reached by keyboard keeps the focus
      });
      root.addEventListener('keydown', (e) => {
        const inp = e.target.closest('[data-in="prime"]');
        if (!inp || e.key !== 'Enter') return;
        const p = +inp.value.trim();
        if (!isPrime(p) || p < 3 || p > 997) { inp.classList.add('bad'); setTimeout(() => inp.classList.remove('bad'), 1200); return; }
        if (!PRIMES.includes(p) && !st.extra.includes(p)) st.extra = [...st.extra, p].sort((x, y) => x - y);
        st.primes.add(p);
        changed(p);
        root.querySelector('[data-in="prime"]').focus();
        // the prime itself lights for a moment, scrolled into view
        const d = fig().querySelector(`[data-n="${p}"]`);
        if (d) { d.classList.add('flash'); d.scrollIntoView({ block: 'nearest', inline: 'nearest' }); setTimeout(() => d.classList.remove('flash'), 1400); }
      });
    },
  };

  // One sub-view of numbers. spec: id (its S.parts id, its key scales.<id>), title, tools ({DEF, use, out, html, wire}:
  // its own state and the controls above the picture), kind(st): the picture ({want, min, budget, floor, last?, ps, top,
  // size, up, down, draw(fig, r), resize?(fig), reach?(p)}), step?(fig, from, code, st): arrows its own way (Hasse),
  // else the nearest number on screen that way
  const SLOW = 250;
  function part({ id, title, tools, kind, step }) {
    const st = { n: null, sounding: new Map() };   // the selected note is the app's (S.shownNote, S.sel.rim); n: the number pressed for it
    tools.use(st, tools.DEF);
    try { const o = JSON.parse(localStorage.getItem('scales.' + id) || 'null'); if (o) tools.use(st, o); } catch (e) {}
    const save = () => S.keep('scales.' + id, JSON.stringify(tools.out(st)));
    const k = kind(st);
    let el, clockEl, figEl;

    const renderTools = () => { const t = el.querySelector('[data-tools]'); if (t) t.outerHTML = tools.html(st); };
    function draw() {
      if (!figEl) return;
      // a budget of elements; More goes once the next range would pass it, and a draw that takes longer than SLOW
      // lowers it to what it just drew (each More roughly doubles the work)
      const t = performance.now();
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
      el = root; clockEl = side.clock;
      el.innerHTML = `${tools.html(st)}
        <div class="panel num-panel"><div class="num-fig" data-fig></div><div class="num-more"><button class="btn quiet" data-act="more">More</button></div></div>`;
      figEl = el.querySelector('[data-fig]');
      tools.wire(el, st, (p, same) => { if (p && k.reach) k.reach(p); save(); if (!same) renderTools(); draw(); }, () => figEl);
      el.querySelector('[data-act="more"]').addEventListener('click', () => { k.want = k.up(k.want); draw(); });
      S.holdOn(figEl, '[data-n], [data-hit]', (d) => {
        const n = d.dataset.n || d.dataset.hit;
        st.n = n; trail.length = 0;
        select(noteOf(n), true);
        return sound(n);
      }, { takeTouch: true, id: (x) => x.dataset.n || x.dataset.hit });
      S.clockHold(clockEl, '[data-r]', (d) => { select(d.dataset.r, true); return S.playScaleNotes([d.dataset.r]); }, true);
      S.follow(root, id, { pick: () => select(), settings: draw });
      S.on('scale', renderSide);
      new ResizeObserver(() => { if (k.resize && k.resize(figEl)) draw(); }).observe(figEl);
      draw();
    }

    // own: str chosen here (n: the number, if one was pressed); else the note selected elsewhere, or picked on the rim
    // or in the list, which S.sel already holds
    function select(str, own = false) {
      if (!(own && st.n != null && noteOf(st.n) === str)) st.n = null;
      if (own) S.select(str, id);
      mark();
      renderSide();
    }
    function mark() {
      if (!figEl) return;
      // the pressed number (else the first of its note) blue-edged; the other numbers of that note tinted
      figEl.querySelectorAll('.sel, .same').forEach((d) => d.classList.remove('sel', 'same'));
      const same = figEl.querySelectorAll(`[data-r="${S.shownNote()}"]`);
      const one = (st.n != null && figEl.querySelector(`[data-n="${st.n}"]`)) || same[0];
      same.forEach((d) => d.classList.add('same'));
      if (one) { one.classList.remove('same'); one.classList.add('sel'); }
    }
    function sound(n) {
      const str = noteOf(n), v = S.audio.tone(freqOf(n));
      // every number of that note lights (6, 12, 24 with 3), and its dots and rows: S.markScale, by data-r
      st.sounding.set(str, (st.sounding.get(str) || 0) + 1); renderSide(); S.markScale([str], true);
      return () => {
        v.stop(); S.markScale([str], false);
        const c = st.sounding.get(str) - 1; c ? st.sounding.set(str, c) : st.sounding.delete(str); renderSide();
      };
    }
    // the circle: the chosen notes lit, every other note shown faint (as the Lattice's), the selected one, and what sounds
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
      if (S.sideWait(drawSide)) return;
      shownNotes = shownNotes || (figEl ? [...new Set([...figEl.querySelectorAll('[data-r]')].map((d) => d.dataset.r))] : null);
      const strs = [...new Set([...(shownNotes || []), ...st.sounding.keys()].filter((s) => s && !S.ratio(s).temp))];
      const points = strs.map((s) => ({ cents: S.ratio(s).cents, cls: S.ratio(s).cls, faint: true, attrs: `data-r="${s}"` }));
      const note = S.shownNote(), rim = S.sel.rim;
      S.clock(clockEl, { points, sel: rim ? null : note, rimSel: rim ? note : null });   // the selection: S.clock rings its dot, or draws one
    }

    // arrows: the view's own way (Hasse, which keeps its trail here: a press starts it anew), else the nearest number on
    // screen that way; on a rim pick, around the rim
    const trail = [];
    function onKeyDown(code) {
      const d = S.ARROWS[code];
      if (!d || !figEl) return false;
      if (S.sel.rim) return S.rimStep(S.sel.note, d);
      const els = [...figEl.querySelectorAll('[data-n]')].filter((d) => d.offsetParent !== null);   // not the hidden ones (an SVG dot has no offsetParent at all)
      const from = (st.n != null && figEl.querySelector(`[data-n="${st.n}"]`)) || figEl.querySelector(`[data-r="${S.shownNote()}"]`);
      const to = !from ? els[0] : step ? step(figEl, from, code, st, trail) : S.spatialStep(from, els, code);
      if (!to) return true;
      const n = to.dataset.n;
      st.n = n;
      select(noteOf(n), true);
      to.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      S.click(() => sound(n));
      return true;
    }

    return {
      title,
      mount,
      onKeyDown,
      // for the link: its state as stored, and its default
      DEF: tools.DEF,
      state: () => tools.out(st),
      setState: (o) => { tools.use(st, o); save(); if (el) { renderTools(); draw(); } },
    };
  }

  return { PRIMES, isPrime, factors, expOf, partsOf, noteOf, family, cell, smooth, primeTools, part };
})();
