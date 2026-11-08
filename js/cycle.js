'use strict';
// A cycle of n steps round an inner ring of intervals (octaves by default; any p/q, cents or k\N). The
// inner ring's sum is the span the steps fill. A step set to a size keeps it; the free steps share what is
// left equally: 12 free steps over 7 × 2/1 are 700¢ each, and with 11 of them set to a pure 3/2 the free
// one is the wolf. An inner boundary can be pinned to a dot: the steps up to it must then reach it
// exactly, and the free ones on each side of a pin share their own part. Every part keeps a free step
// with room to share, or lands on its pin exactly: any other change is refused, so the cycle always closes. A sub-view of the Temperament tab.
S.parts.cycle = (() => {
  const NMAX = 120, MMAX = 60;
  // presets: [name, n steps, inner intervals, step i -> its value (null: free), pins {inner boundary: dot}].
  // The fifths run up from the 1/1: C–G is step 1, F♯–D♭ (Pythagorean's wolf) step 7, G♯–E♭ (the meantones') step 9, F–C step 12
  const oct = (k) => Array(k).fill('2/1');
  // a meantone fifth: k of them make ratio q (⅓ comma: 3 fifths are 10/3, a 5/3 an octave up; ¼: 4 are
  // 5/1; ⅕: 5 are 15/2; ⅙: 6 are 45/4; 2/7: 7 are 50/3, a 25/24 four octaves up); every step but the wolf's.
  // An a/k comma fifth is 3/2 · (80/81)^(a/k), so q = (3/2)^k · (80/81)^a
  const mean =(q, k) => { const f = String(S.roundC(S.parseStep(q).c / k)); return (i) => (i === 8 ? null : f); };
  const short = (q) => (i) => (i === 9 ? q : null);
  // one flat list but for the Commas group (the user: categories read sloppy, then asked for that one): 12 fifths over 7 octaves (well
  // temperaments by date), the meantones, then other cycles
  const PRESETS = {
      tet: ['12-TET', 12, oct(7), () => null],
      pyth: ['Pythagorean', 12, oct(7), (i) => (i === 6 ? null : '3/2')],
      werck: ['Werckmeister III', 12, oct(7), (i) => ([0, 1, 2, 5].includes(i) ? null : '3/2')],
      vallotti: ['Vallotti', 12, oct(7), (i) => (i < 5 || i === 11 ? null : '3/2')],
      // C–E a pure 5/4: four fifths pinned to 2/1 2/1 5/4; the rest pure, one free (a schisma narrow)
      kirn: ['Kirnberger III', 12, [...oct(2), '5/4', ...oct(4), '8/5'], (i) => (i < 4 || i === 6 ? null : '3/2'), { 2: 4 }],
      young: ['Young', 12, oct(7), (i) => (i < 6 ? null : '3/2')],
      // Kellner's reading of Bach (1977): C–G–D–A–E and B–F♯ share the comma, the rest pure
      kellner: ['Kellner', 12, oct(7), (i) => ([0, 1, 2, 3, 5].includes(i) ? null : '3/2')],
      // the meantones as keyboards had them: 11 equal fifths, each a root of the ratio its pure interval makes
      // (kept as cents, S.CENTS_DIGITS, so that interval still reads as the ratio), the wolf G♯–E♭ free; by
      // how much the fifth is narrowed
      mtw3: ['Meantone 1/3 comma', 12, oct(7), mean('10/3', 3)],
      mtw27: ['Meantone 2/7 comma', 12, oct(7), mean('50/3', 7)],
      mtw4: ['Meantone 1/4 comma', 12, oct(7), mean('5/1', 4)],
      mtw5: ['Meantone 1/5 comma', 12, oct(7), mean('15/2', 5)],
      mtw6: ['Meantone 1/6 comma', 12, oct(7), mean('45/4', 6)],
      // where 12 fifths really land: pure ones 7 octaves and a Pythagorean comma up (all
      // free, each comes out 3/2)
      fifths: ['12 fifths, pure', 12, [...oct(7), '531441/524288'], () => null],
      // the comma 12 meantone fifths fall short of 7 octaves, set between D♯ and E♭ (with the fifth before it,
      // the wolf), the 12 free fifths coming out as the meantone's; 1/5 and 2/7 fall short by no ratio
      cmt3: ['1/3 comma + greater diesis', 13, oct(7), short('648/625')],
      cmt4: ['1/4 comma + lesser diesis', 13, oct(7), short('128/125')],
      cmt6: ['1/6 comma + diaschisma', 13, oct(7), short('2048/2025')],
      // other intervals stacked: the free one takes what is left (3 thirds: 32/25; 4 minor thirds: 125/108)
      penta: ['5 fifths', 5, oct(3), (i) => (i === 4 ? null : '3/2')],
      thirds: ['3 major thirds', 3, ['2/1'], (i) => (i === 2 ? null : '5/4')],
      minor3: ['4 minor thirds', 4, ['2/1'], (i) => (i === 3 ? null : '6/5')],
      major: ['Major 9/8 (Ptolemy)', 7, ['2/1'], (i) => ['9/8', '10/9', '16/15', '9/8', '10/9', '9/8', null][i]],
      edo19: ['19 fifths', 19, oct(11), () => null],
      edo31: ['31 fifths (Huygens)', 31, oct(18), () => null],
      merc: ['53 fifths', 53, oct(31), () => null],
      bp: ['Bohlen–Pierce', 13, ['3/1'], () => null],
      // no octaves: Wendy Carlos's α, β, γ, one step fitted to 3/2, 5/4 and 6/5 at once (least squares;
      // 9, 11 or 20 steps come near the fifth), so the span is her near-fifth in cents, typed as published
      alpha: ['Carlos α', 9, ['701.68490595'], () => null],
      beta: ['Carlos β', 11, ['702.16225827'], () => null],
      gamma: ['Carlos γ', 20, ['701.97084561'], () => null],
  };
  // the Commas group of the menu: each comma as it comes out, the shorter stack set round the outside, the
  // longer one inside, the one free step taking the difference; then how they add up (the user's form): one
  // comma inside, another set outside, the free step coming out as the third
  const COMMA_PRESETS = {
      cPyth: ['Pythagorean comma', 8, Array(12).fill('3/2'), (i) => (i < 7 ? '2/1' : null)],
      cSynt: ['Syntonic comma', 4, Array(4).fill('3/2'), (i) => ['2/1', '2/1', '5/4', null][i]],
      cSchis: ['Schisma', 6, [...Array(8).fill('3/2'), '5/4'], (i) => (i < 5 ? '2/1' : null)],
      cDiasch: ['Diaschisma', 7, oct(3), (i) => (i < 4 ? '3/2' : i < 6 ? '5/4' : null)],
      cLess: ['Lesser diesis', 4, ['2/1'], (i) => (i < 3 ? '5/4' : null)],
      cGreat: ['Greater diesis', 2, Array(4).fill('6/5'), (i) => (i < 1 ? '2/1' : null)],
      cSept: ['Septimal comma', 2, ['4/3', '4/3'], (i) => (i < 1 ? '7/4' : null)],
      cKleis: ['Kleisma', 7, ['2/1', '3/2'], (i) => (i < 6 ? '6/5' : null)],
      rPyth: ['Syntonic + schisma', 2, ['531441/524288'], (i) => (i < 1 ? '81/80' : null)],
      rSynt: ['Schisma + diaschisma', 2, ['81/80'], (i) => (i < 1 ? '32805/32768' : null)],
      rLess: ['Syntonic + diaschisma', 2, ['128/125'], (i) => (i < 1 ? '81/80' : null)],
      rGreat: ['Syntonic + lesser diesis', 2, ['648/625'], (i) => (i < 1 ? '81/80' : null)],
  };
  Object.assign(PRESETS, COMMA_PRESETS);

  const parseStep = S.parseStep;
  const OCT = parseStep('2/1');

  // steps: one per step, its parsed value or null (free); inner: the inner intervals (parsed); pins[j]:
  // the dot inner boundary j + 1 is pinned to, or null; sel: the selected step (arc), note (dot), inner
  // interval (inner), or a note picked on the rim or in the list (rim)
  const st = { n: 12, steps: Array(12).fill(null), inner: Array(7).fill(OCT), pins: Array(6).fill(null), sel: { dot: 0 }, arp: null };
  let el, svgEl, clockEl, readEl, headEl, editIn, nIn, mIn;
  let open = false;   // the step field shows: only its label opens it (an arc only plays and selects)

  // the sizes. B: where each inner boundary stands; the pins split the steps into parts, each part's free
  // steps share what its set ones leave of the way to its pin (from where the part really starts)
  function calc(o = st) {
    const B = [0];
    o.inner.forEach((x) => B.push(B[B.length - 1] + x.c));
    const T = B[B.length - 1], n = o.n;
    const anchors = [[0, 0, 0]];   // [step, where it stands, its inner boundary]
    o.pins.forEach((p, j) => { if (p != null) anchors.push([p, B[j + 1], j + 1]); });
    anchors.push([n, T, B.length - 1]);
    const cs = Array(n), cum = [0], parts = [];
    for (let a = 0; a + 1 < anchors.length; a++) {
      const [pa] = anchors[a], [pb, Bb, bj] = anchors[a + 1];
      let fixed = 0, free = 0;
      for (let i = pa; i < pb; i++) o.steps[i] ? (fixed += o.steps[i].c) : free++;
      const fc = free ? (Bb - cum[pa] - fixed) / free : null;
      for (let i = pa; i < pb; i++) { cs[i] = o.steps[i] ? o.steps[i].c : fc; cum[i + 1] = cum[i] + cs[i]; }
      parts.push({ pa, pb, bj, free, fc, rest: Bb - cum[pa] - fixed });
    }
    return { o, T, B, cs, cum, parts };
  }
  // every part has a free step with room (its set steps stay short of the way to its pin), or its set steps
  // land on its pin exactly (3L 9s all set as k\15). A set step is above 0 too: the ring has no place for a
  // step down (the Spiral has)
  const valid = (o) => o.steps.every((s) => !s || s.c > 1e-6) && calc(o).parts.every((p) => (p.free ? p.fc > 1e-6 : Math.abs(p.rest) < S.EXACT));
  // a change is tried on a copy and kept only if it stays valid
  // while Outer or Inner is dragged, each count is tried on the cycle as the drag found it (dragFrom), so dragging
  // down and back up again gives back the steps and pins it passed
  let dragFrom = null;
  function attempt(f) {
    const b = dragFrom || st, o = { n: b.n, steps: [...b.steps], inner: [...b.inner], pins: [...b.pins] };
    f(o);
    if (!valid(o)) return false;
    Object.assign(st, o);
    return true;
  }
  // kept across reloads (scales.cycle): the steps and inner intervals as typed, the pins; a stored cycle that
  // no longer reads or closes is left out (12-TET)
  const texts = () => ({ n: st.n, steps: st.steps.map((x) => x && x.t), inner: st.inner.map((x) => x.t), pins: st.pins });
  // Custom keeps the last cycle that matched no preset (scales.cycleSlot), so choosing a preset doesn't lose it
  let slot = null;
  const keepSlot = (o) => { slot = o; S.keep('scales.cycleSlot', JSON.stringify(slot)); };
  const save = () => {
    S.keep('scales.cycle', JSON.stringify(texts()));
    if (presetOf() === 'custom') keepSlot(texts());
  };
  // as typed to state, if it reads and closes
  const fromTexts = (o) => {
    if (!o || !Array.isArray(o.steps) || !Array.isArray(o.inner) || !Array.isArray(o.pins) || o.steps.length !== o.n || o.pins.length !== o.inner.length - 1) return null;
    const c = { n: o.n, steps: o.steps.map((t) => (t == null ? null : parseStep(t))), inner: o.inner.map(parseStep), pins: o.pins.map((p) => (Number.isInteger(p) ? p : null)) };
    return c.n >= 1 && c.n <= NMAX && c.inner.length <= MMAX && c.inner.every((x) => x && x.c > 0) && c.steps.every((x, i) => x || o.steps[i] == null) && valid(c) ? c : null;
  };
  try {
    const c = fromTexts(JSON.parse(localStorage.getItem('scales.cycle') || 'null'));
    if (c) Object.assign(st, c);
  } catch (e) {}
  // a refused press: the element flashes red
  const refuse = (elm) => { if (!elm) return; elm.classList.add('no'); setTimeout(() => elm.classList.remove('no'), 600); };

  // a free step's size as the ratio it is: exact when it is its part's only free step and everything around it is a
  // ratio (the way to its pin, the set steps, where the part starts): Pythagorean's wolf is 262144/177147, Major
  // steps' last 16/15; else in good faith (S.simpleRatio). Its prime exponents, or null
  const freeMemo = new WeakMap();
  const exactOf = (i, v = calc()) => {
    if (!freeMemo.has(v)) {
      const o = v.o, rs = Array(o.n).fill(null);
      const mul = (a, r) => a && r && S.qMul(a, r);
      let cum = {};   // where the part starts, while every step so far is a ratio
      for (const p of v.parts) {
        let to = {}, set = {};
        for (let k = 0; k < p.bj; k++) to = mul(to, o.inner[k].r);
        for (let k = p.pa; k < p.pb; k++) if (o.steps[k]) set = mul(set, o.steps[k].r);
        const one = p.free === 1 && cum && to && set ? S.qMul(S.qMul(to, cum, -1), set, -1) : null;
        for (let k = p.pa; k < p.pb; k++) {
          if (o.steps[k]) continue;
          rs[k] = one || S.simpleRatio(p.fc);
        }
        for (let k = p.pa; k < p.pb && cum; k++) cum = mul(cum, o.steps[k] ? o.steps[k].r : rs[k]);
      }
      freeMemo.set(v, rs);
    }
    return freeMemo.get(v)[i];
  };
  // step i's size as a field takes it: as set, else the ratio it comes out as, else its cents
  const sizeText = (i, v = calc()) => {
    const s = st.steps[i], r = !s && exactOf(i, v);
    return s ? s.t : r ? S.qText(r) : parseStep(String(S.roundC(v.cs[i]))).t;   // 12-TET's free 700¢ is 7\12, as set
  };
  // a step's ratio: as set, or a free one's exact ratio
  const ratioOf = (i, v) => (st.steps[i] ? st.steps[i].r : exactOf(i, v));

  // notes: a ratio when every step up to it is one, else what its cents are (S.noteOfCents: a simple
  // ratio, k\12, or cents)
  const noteOfCents = S.noteOfCents;
  const stepNote = (i, v = calc()) => {
    const s = st.steps[i];
    if (s && s.r) return S.qNote(s.r);
    if (s && s.edo) return S.edoKey(s.edo[0], s.edo[1]);
    const r = !s && exactOf(i, v);
    return r ? S.qNote(r) : noteOfCents(v.cs[i]);
  };
  const innerNote = (j) => { const s = st.inner[j]; return s.r ? S.qNote(s.r) : s.edo ? S.edoKey(s.edo[0], s.edo[1]) : noteOfCents(s.c); };
  const dotNote = (i, v = calc()) => {
    let e = {};
    for (let j = 0; j < i; j++) {
      const r = ratioOf(j, v);
      if (!r) return noteOfCents(v.cum[i]);
      e = S.qMul(e, r);
    }
    return S.qNote(e);   // reduced and folded, as the scale keeps it (9/8 · 10/9 is 5/4, not 90/72)
  };
  // where inner interval j starts (B[j]): the inner intervals before it multiplied, when all are ratios
  const boundNote = (j, v = calc()) => {
    let e = {};
    for (let k = 0; k < j; k++) {
      const r = st.inner[k].r;
      if (!r) return noteOfCents(v.B[j]);
      e = S.qMul(e, r);
    }
    return S.qNote(e);
  };
  const dotFreq = (i, v = calc()) => S.baseFreq() * 2 ** (S.fold(v.cum[i]) / 1200);

  // side: the Temperament tab's shared panel lends its readout and circle
  function mount(root, side) {
    el = root;
    el.innerHTML = `
      <div class="toolbar">
        <label class="field">Outer<input type="number" class="ratio-in num-in" data-in="n" min="1" max="${NMAX}" step="1" inputmode="numeric" aria-label="Outer steps"></label>
        <label class="field">Inner<input type="number" class="ratio-in num-in" data-in="m" min="1" max="${MMAX}" step="1" inputmode="numeric" aria-label="Inner intervals"></label>
      </div>
      <div class="panel">
        <div class="toolbar chart-head">
          <span class="mono" data-head></span>
          <span class="head-btns"><button class="btn quiet" data-act="toscale" title="Make these notes the scale">Use as scale</button><button class="btn quiet" data-act="chain"><span class="ico seq"></span>Chain</button><button class="btn quiet" data-act="cscale"><span class="ico seq"></span>Scale</button></span>
        </div>
        <div class="cycle" data-cycle><div data-svg></div>
          <input type="search" enterkeyhint="done" class="ratio-in step-in" data-in="step" spellcheck="false" aria-label="Step size" hidden>
        </div>
      </div>`;
    clockEl = side.clock;
    readEl = side.read;
    svgEl = el.querySelector('[data-svg]');
    headEl = el.querySelector('[data-head]');
    editIn = el.querySelector('[data-in="step"]');
    nIn = el.querySelector('[data-in="n"]');
    mIn = el.querySelector('[data-in="m"]');

    // how many steps, how many inner intervals; new ones are free (steps) or octaves (inner). Applied on
    // change (Enter, leaving the field, the arrows), not per keystroke: typing 12 went through 1, which
    // dropped every set step
    // dragged too (S.numDrag), as the Spiral's counts; a refused count turns the field red while dragging
    const num = (inp, max, set, get) => {
      S.numIn(inp, max, set, syncFields);
      S.numDrag(inp, { get, max, set, onStart: () => { dragFrom = { n: st.n, steps: [...st.steps], inner: [...st.inner], pins: [...st.pins] }; }, onEnd: () => { dragFrom = null; } });
    };
    num(nIn, NMAX, (n) => {
      if (n === st.n) return;
      // fewer steps: the last part's steps go free from its end until it has room again
      const ok = attempt((o) => {
        o.steps = Array.from({ length: n }, (_, i) => o.steps[i] || null);
        o.n = n;
        o.pins = o.pins.map((p) => (p != null && p < n ? p : null));
        for (let i = n - 1; i >= 0 && !valid(o); i--) o.steps[i] = null;
      });
      if (!ok) { nIn.classList.add('bad'); return false; }
      if (st.sel.arc >= n || st.sel.dot > n) st.sel = { dot: 0 };
      render(true);
    }, () => st.n);
    // how many inner intervals; new ones are octaves
    num(mIn, MMAX, (m) => {
      if (m === st.inner.length) return;
      const ok = attempt((o) => {
        o.inner = Array.from({ length: m }, (_, j) => o.inner[j] || OCT);
        o.pins = Array.from({ length: m - 1 }, (_, j) => o.pins[j] ?? null);
      });
      if (!ok) { mIn.classList.add('bad'); return false; }
      if (st.sel.inner >= m) st.sel = { dot: 0 };
      render(true);
    }, () => st.inner.length);

    // the selected step's size: Enter (or leaving the field) sets it; empty sets it free again. An inner
    // interval is always set: empty makes it an octave again
    const apply = () => {
      const txt = editIn.value.trim();
      if (st.sel.inner != null) {
        const s = txt ? parseStep(txt) : OCT, j = st.sel.inner;
        const ok = s && s.c > 0 && attempt((o) => { o.inner[j] = s; });
        editIn.classList.toggle('bad', !ok);
        if (ok) render(true);
        return;
      }
      if (st.sel.arc == null) return;
      const s = txt ? parseStep(txt) : null;
      editIn.classList.toggle('bad', !!txt && !s);
      if ((s || !txt) && !setStep(st.sel.arc, s)) editIn.classList.add('bad');
    };
    editIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { apply(); if (!editIn.classList.contains('bad')) editIn.blur(); }
      if (e.key === 'Escape') {
        const s = st.sel.inner != null ? st.inner[st.sel.inner] : st.steps[st.sel.arc];
        editIn.value = s ? s.t : ''; editIn.classList.remove('bad'); editIn.blur();
      }
    });
    editIn.addEventListener('change', apply);
    editIn.addEventListener('input', () => editIn.classList.remove('bad'));
    // leaving the field shuts it; the selection stays, as in every view (the readout and the rings keep it)
    // a refused value keeps the field open (red) until it is fixed or left with Esc
    editIn.addEventListener('blur', () => {
      if (editIn.classList.contains('bad')) return;
      open = false;
      renderCycle(); renderEdit();
    });
    // a step's lock: open, it is free and shares what the others leave; shutting it keeps its present size
    svgEl.addEventListener('click', (e) => {
      const pin = e.target.closest('.ipin');
      if (pin) { if (!togglePin(+pin.dataset.pinj)) refuse(pin); return; }
      // a label opens its field at once, without sounding
      const lab = e.target.closest('.a-lab, .i-lab');
      if (lab) { edit(lab.dataset.j != null ? { inner: +lab.dataset.j } : { arc: +lab.dataset.i }); return; }
      const l = e.target.closest('.alock');
      if (!l) return;
      const i = +l.dataset.lock, s = st.steps[i];
      // shut: the step keeps its present size, as the ratio it is when it is one (stored, so it stays exact)
      if (!setStep(i, s ? null : parseStep(sizeText(i)))) refuse(l);
    });
    // while the field is open, a scale list row or step puts its interval into it
    const put = (txt) => { editIn.value = txt; editIn.classList.remove('bad'); apply(); };
    S.stepFields.set(editIn, put);
    // a selected step or inner interval opens its field, focused (the user): an arc's press keeps the focus
    // there, as a label's does. On touch the field opens unfocused, so the keyboard doesn't jump up on every
    // tap; tapping the field types
    const edit = (sel, e) => {
      if (document.activeElement === editIn && editIn.value.trim() !== (selStep()?.t ?? '')) apply();   // typed for the old one
      editIn.classList.remove('bad');
      open = true;
      select(sel);
      editIn.value = selStep()?.t ?? '';
      if (!e || e.pointerType !== 'touch') { editIn.focus(); editIn.select(); }
    };
    const selStep = () => (st.sel.inner != null ? st.inner[st.sel.inner] : st.steps[st.sel.arc]);
    // (decided at pointerdown: the press redraws the picture before its mousedown arrives)
    let downArc = false;
    svgEl.addEventListener('pointerdown', (e) => { downArc = !!e.target.closest('.carc, .iarc'); }, true);
    clockEl.addEventListener('pointerdown', (e) => { downArc = !!e.target.closest('[data-iv]'); }, true);   // its interval's dot too
    window.addEventListener('mousedown', (e) => { if (downArc) e.preventDefault(); downArc = false; }, true);
    // the notes the cycle arrives at become the scale
    el.querySelector('[data-act="toscale"]').addEventListener('click', () => S.useAsScale(cycleNotes()));
    // "Use as scale", or "Use" where the buttons' row would otherwise not fit its line (the header's rule: short only
    // where needed); a button's words never break
    const toScale = el.querySelector('[data-act="toscale"]'), btns = toScale.parentElement, headRow = btns.parentElement;
    const fitUse = () => {
      toScale.textContent = 'Use as scale';
      if (btns.offsetWidth > headRow.clientWidth) toScale.textContent = 'Use';
    };
    new ResizeObserver(fitUse).observe(headRow);

    S.seqBtn(el.querySelector('[data-act="chain"]'), playChain);
    S.seqBtn(el.querySelector('[data-act="cscale"]'), playScale);
    // an arc plays its step as an interval (from where it starts, so a wolf sounds as one); a dot its note.
    // Either becomes the selection; glide across them
    S.holdOn(svgEl, '.carc, .cdot, .iarc', (t, e) => {
      if (t.dataset.j != null) { const j = +t.dataset.j; edit({ inner: j }, e); return soundInner(j); }
      const i = +t.dataset.i;
      if (!t.classList.contains('cdot')) { edit({ arc: i }, e); return soundArc(i); }
      open = false;
      select({ dot: i });
      return soundDot(i);
    }, { takeTouch: true });
    S.clockHold(clockEl, '[data-i], [data-iv]', (d) => {
      if (d.dataset.iv) return soundIv(d);   // the selected interval's dot: its note, the selection stays
      const i = +d.dataset.i; select({ dot: i }); return soundDot(i);
    }, (str) => pickRim(str));
    const shown = S.whenShown(root);
    // a note picked on the rim, in the list, by a key or typed in stays a rim note, as in Just intonation, even where a dot
    // has it (the arrows then walk the scale); one selected in another tab selects its dot, if one has it
    S.on('pick', shown(pickRim));
    S.on('note', shown((str, src) => { if (src !== 'cycle') showNote(str); }));
    S.note.rim ? pickRim(S.note.str) : showNote(S.note.str);

    render();
    S.on('settings', render);
    S.on('scale', () => render());   // a free step or note may now read as a scale ratio
    new ResizeObserver(() => { renderCycle(); renderEdit(); }).observe(svgEl);   // labels keep their px clearance
  }

  // a preset as the cycle's state: steps, inner intervals, pins
  const presetState = (k) => {
    const [, n, inner, f, pins = {}] = PRESETS[k];
    return {
      n,
      inner: inner.map(parseStep),
      pins: Array.from({ length: inner.length - 1 }, (_, j) => pins[j] ?? null),
      steps: Array.from({ length: n }, (_, i) => { const v = f(i); return v == null ? null : parseStep(v); }),
    };
  };
  // the preset menu is the Temperament tab's (temper.js); a preset chosen before this view is drawn waits
  function usePreset(k) {
    if (k === 'custom') { if (slot) setState(slot); return; }   // none kept: it stays as it is
    Object.assign(st, presetState(k));
    open = false;
    if (st.sel.arc >= st.n || st.sel.dot > st.n || st.sel.inner >= st.inner.length) st.sel = { dot: 0 };
    save();
    if (el) render(true);
  }
  // the preset's steps as the Spiral's runs (each step as a field takes it; equal ones in a row as one run):
  // a free step as k\N when every inner interval is an octave and no step is set (12-TET: 7\12), else as
  // the ratio it comes out as, else its cents
  const pathMemo = new Map();
  function pathOf(k) {
    if (!pathMemo.has(k)) {
      const o = presetState(k), v = calc(o), runs = [];
      const edo = o.steps.every((s) => !s) && o.inner.every((x) => x.t === '2/1');
      o.steps.forEach((s, i) => {
        const r = !s && exactOf(i, v);
        const t = parseStep(s ? s.t : edo ? `${o.inner.length}\\${o.n}` : r ? S.qText(r) : String(S.roundC(v.cs[i]))).t;
        const l = runs[runs.length - 1];
        if (l && l.t === t) l.n++; else runs.push({ t, down: false, n: 1 });
      });
      pathMemo.set(k, runs);
    }
    return pathMemo.get(k).map((p) => ({ ...p }));
  }
  // the preset the steps, inner intervals and pins match, else Custom
  const same = (v, s) => (v == null ? !s : !!s && Math.abs(parseStep(v).c - s.c) < 1e-9);
  const presetOf = () => Object.keys(PRESETS).find((k) => {
    const [, n, inner, f, pins = {}] = PRESETS[k];
    return n === st.n && inner.length === st.inner.length && inner.every((v, j) => same(v, st.inner[j]))
      && st.pins.every((p, j) => p === (pins[j] ?? null)) && st.steps.every((s, i) => same(f(i), s));
  }) || 'custom';
  try { const o = JSON.parse(localStorage.getItem('scales.cycleSlot') || 'null'); if (fromTexts(o)) slot = o; } catch (e) {}
  if (!slot && presetOf() === 'custom') slot = texts();
  // a cycle as typed (the link, Custom); false if it doesn't read or close
  function setState(o) {
    const c = fromTexts(o);
    if (!c) return false;
    Object.assign(st, c);
    open = false;
    if (st.sel.arc >= st.n || st.sel.dot > st.n || st.sel.inner >= st.inner.length) st.sel = { dot: 0 };
    save();
    if (el) render(true);
    return true;
  }

  // pin inner boundary j + 1 to the nearest dot that keeps the pins in order; pressed again, unpin it
  // (nearest first, among the dots that leave both sides room); false when none does
  function togglePin(j) {
    if (st.pins[j] != null) { if (!attempt((o) => { o.pins[j] = null; })) return false; render(true); return true; }
    const at = pinTarget(j);
    if (at == null) return false;
    st.pins[j] = at;
    st.sel = { dot: at };
    render(true);
    return true;
  }
  // the dot inner boundary j + 1 would be pinned to: the nearest that keeps the pins in order and leaves
  // both sides room, or null (drawn as its dotted line, so a press does what the line shows)
  function pinTarget(j, v = calc()) {
    let lo = 1, hi = st.n - 1;
    for (let q = j - 1; q >= 0; q--) if (st.pins[q] != null) { lo = st.pins[q] + 1; break; }
    for (let q = j + 1; q < st.pins.length; q++) if (st.pins[q] != null) { hi = st.pins[q] - 1; break; }
    const near = [];
    for (let i = lo; i <= hi; i++) near.push(i);
    near.sort((a, b) => Math.abs(v.cum[a] - v.B[j + 1]) - Math.abs(v.cum[b] - v.B[j + 1]));
    const at = near.find((i) => { const o = { ...st, pins: st.pins.slice() }; o.pins[j] = i; return valid(o); });
    return at == null ? null : at;
  }

  // false (and nothing changes) when it would leave a part neither closing nor with a free step with room
  function setStep(i, s) {
    if (!attempt((o) => { o.steps[i] = s; })) return false;
    render(true);
    return true;
  }
  function syncFields() { nIn.value = st.n; mIn.value = st.inner.length; }

  // a selection made here becomes the selected note in the other tabs
  function select(sel) {
    st.sel = sel;
    render(true);
  }
  // the notes the cycle arrives at, as the scale would keep them
  const cycleNotes = (v = calc()) => [...new Set(Array.from({ length: st.n }, (_, i) => dotNote(i, v)))].filter((x) => x !== '2/1');
  // Use as scale is off while the scale is already these notes
  function syncToScale(v) {
    const ns = cycleNotes(v), b = el.querySelector('[data-act="toscale"]');
    b.disabled = ns.length === S.scale.length && ns.every((x) => S.inScale(x));
  }
  const selNote = (v = calc()) => (st.sel.rim ?? (st.sel.inner != null ? innerNote(st.sel.inner) : st.sel.arc != null ? stepNote(st.sel.arc, v) : dotNote(st.sel.dot, v)));
  function pickRim(str) { st.sel = { rim: str || '' }; render(); }
  // a note selected elsewhere: the first dot with that note, else as a rim note
  function showNote(str) {
    const v = calc();
    for (let i = 0; i < st.n; i++) if (dotNote(i, v) === str) { st.sel = { dot: i }; render(); return; }
    pickRim(str);
  }

  function render(own = false) {
    save();
    syncFields();
    if (S.parts.cycle.onEdit) S.parts.cycle.onEdit();
    renderCycle(); renderClock(); renderEdit();
    const v = calc();
    if (own && st.sel.rim == null) S.setNote(selNote(v), 'cycle');
    readEl.innerHTML = S.readout(selNote(v));
    // how many steps are free (their sizes are on their arcs)
    headEl.innerHTML = `<b>${v.parts.reduce((a, p) => a + p.free, 0)}</b> free`;
    syncToScale(v);
  }

  // where a step's label (or its field, a box w × h px) stands: out along the arc's middle, its box's
  // nearest corner 4 px clear of the band, so the field never covers the arc
  const RO = 168, RI = 116;   // the steps' ring, the inner ring
  const labelR = (a, w, h, inner) => {
    const k = 480 / (svgEl.clientWidth || 480), off = 4 * k + (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) * k / 2;   // svg units per px
    return inner ? RI - 5 - off : RO + 8 + off;
  };
  // a ratio is labelled as such only while it reads plainly (9 digits at most), else in cents: the user found
  // 3¹² / 2¹⁹ only restates the rings; set or free, outer or inner alike (the field keeps what was typed)
  const plainR = (e) => !!e && !!S.qND(e, 4);   // as S.fmtRatio writes n/d; powers would only restate the rings
  const plainTxt = (e) => S.fmtRatio(null, 4, e);
  const labelBox = (txt) => [txt.length * 8.2 + 18, 28];   // as the field would be with that text
  // one ring's labels: those with room, and the selected one even without (a comma, one of 31 octaves),
  // whose neighbours then step aside; none while its field stands there. A label too long for its arc (a
  // comma) shows too, its neighbours stepping aside as well, where it meets no other such label (so a
  // crowded ring shows none of them)
  function placeLabels(list, k) {
    // a label that would run past the card's side (a long one at 3 or 9 o'clock on a phone) is left out
    // (the user: turning it along the ring, or keeping it inside, which covered the lock, both looked off),
    // selected too; only its field, while editing, stands inside the card over the arc
    const card = svgEl.closest('.panel'), sb = svgEl.getBoundingClientRect(), cb = card ? card.getBoundingClientRect() : sb;
    const lo = (cb.left - sb.left) * k, hi = 480 + (cb.right - sb.right) * k;   // the card's edges, in units
    list.forEach((l) => {
      const h = ((l.txt.length * 8.2) / 2 + 4) * k;   // the text, not the field's padding
      if (!sb.width || (l.at[0] - h >= lo && l.at[0] + h <= hi)) return;
      l.out = true;
    });
    const box = (l) => [l.at[0], l.at[1], labelBox(l.txt)[0] * k, 28 * k];
    const meets = (a, b) => Math.abs(a[0] - b[0]) < (a[2] + b[2]) / 2 && Math.abs(a[1] - b[1]) < (a[3] + b[3]) / 2;
    const alone = (l) => !l.fits && list.every((m) => m === l || m.fits || !meets(box(l), box(m)));
    const sel = list.find((l) => l.sel && !l.out), first = list.filter((l) => l === sel || (!l.out && alone(l) && !(sel && meets(box(l), box(sel)))));
    return list.filter((l) => !(l.sel && open) && !l.out && (first.includes(l) || (l.fits && !first.some((f) => meets(box(l), box(f))))))
      .map((l) => `${l.tag} x="${l.at[0].toFixed(1)}" y="${l.at[1].toFixed(1)}" dy="${S.DY_SANS}">${l.txt}</text>`).join('');
  }

  // the selected step's size is edited where its label stands
  function renderEdit() {
    const i = st.sel.arc, j = st.sel.inner, inner = j != null;
    editIn.hidden = !open || (i == null && !inner);
    if (editIn.hidden) return;
    const v = calc(), W = 480, C = W / 2;
    const s = inner ? st.inner[j] : st.steps[i], mid = inner ? (v.B[j] + v.B[j + 1]) / 2 : (v.cum[i] + v.cum[i + 1]) / 2, a = (mid / v.T) * 2 * Math.PI;
    if (document.activeElement !== editIn) editIn.value = s ? s.t : '';
    const ex = !inner && !s && exactOf(i, v);
    editIn.placeholder = inner ? '2/1' : ex ? S.qText(ex) : S.fmtC(v.cs[i]);
    editIn.classList.toggle('free', !s);
    const w = svgEl.clientWidth || W, bw = editIn.offsetWidth || 60, bh = editIn.offsetHeight || 28;
    const r = labelR(a, bw, bh, inner), half = bw / 2;   // kept inside the picture
    editIn.style.left = `${Math.min(w - half, Math.max(half, ((C + r * Math.sin(a)) / W) * w))}px`;
    editIn.style.top = `${((C - r * Math.cos(a)) / W) * w}px`;
    editIn.title = `${inner ? 'Inner ' + (j + 1) : 'Step ' + (i + 1)}: p/q, ¢ or k\\N`;
  }

  // the picture: the steps as arcs round the outside (angle in proportion to their size, the whole turn
  // the inner ring's sum), a dot where each arrives; the inner intervals as thinner arcs inside, with a pin
  // at each boundary between them
  function renderCycle() {
    const W = 480, C = W / 2, R = RO, v = calc(), T = v.T;
    const ang = (c) => (c / T) * 2 * Math.PI;
    const P = (c, r) => { const a = ang(c); return [C + r * Math.sin(a), C - r * Math.cos(a)]; };
    const arc = (c0, c1, r) => {
      if (c1 < c0) [c0, c1] = [c1, c0];
      if (c1 - c0 >= T - 1e-9) {   // the whole turn: two halves
        const [x0, y0] = P(c0, r), [xm, ym] = P(c0 + T / 2, r);
        return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${xm.toFixed(2)} ${ym.toFixed(2)}A${r} ${r} 0 0 1 ${x0.toFixed(2)} ${y0.toFixed(2)}`;
      }
      const [x0, y0] = P(c0, r), [x1, y1] = P(c1, r);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${ang(c1) - ang(c0) > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const n = st.n, gapC = (5 / R) * (T / (2 * Math.PI));   // 5 px apart at the dots
    const dotR = n > 40 ? 3.5 : n > 24 ? 5 : 7;
    let arcs = '', labels = '', dots = '', inner = '', locks = '';
    // the inner intervals: arcs in their prime's colour, at their true size but at least 2 px long (the
    // smallest that shows: a comma), labelled inside where they have room; between them a pin. An arc too
    // short for its gaps keeps its whole length and is drawn last, with a hit as wide as a dot's (r 12)
    const k = 480 / (svgEl.clientWidth || 480), toC = (u, r) => (u / r) * (T / (2 * Math.PI));
    const giC = toC(4, RI), hitC = toC(12, RI), minC = toC(2 * k, RI), iLabs = [];
    let tiny = '';
    st.inner.forEach((x, j) => {
      const c0 = v.B[j], c1 = v.B[j + 1], short = c1 - c0 < 4 * giC, g = short ? 0 : giC;
      const cls = x.r ? S.ratio(S.qNote(x.r)).cls : 'pt', sel = st.sel.inner === j ? ' sel' : '';
      const mid = (c0 + c1) / 2, half = Math.max((c1 - c0) / 2, minC / 2);
      const band = short ? arc(mid - half, mid + half, RI) : arc(c0 + g, c1 - g, RI);
      const hit = short ? arc(mid - Math.max(half, hitC), mid + Math.max(half, hitC), RI) : arc(c0, c1, RI);
      const gx = `<g class="iarc ${cls}${x.r ? ' exact' : ''}${sel}" data-j="${j}"><title>${S.stepTip(x)}</title><path class="a-band" d="${band}"/><path class="a-in" d="${band}"/><path class="a-hit" d="${hit}"/></g>`;
      if (short) tiny += gx; else inner += gx;
      const txt = plainR(x.r) ? plainTxt(x.r) : x.edo ? x.t : S.fmtC(x.c), lr = labelR(ang(mid), ...labelBox(txt), true);
      iLabs.push({ txt, at: P(mid, lr), fits: lr * ang(c1 - c0) >= txt.length * 8.2 + 6, sel: !!sel,
        tag: `<text class="i-lab${x.r ? ' rat ' + cls : ''}" data-j="${j}"` });
    });
    inner += tiny;
    labels += placeLabels(iLabs, k);
    // each boundary between inner intervals: a dotted line to the dot it would be pinned to, pressed to pin
    // it (dashed, accent) or let go; from just outside the band, so no arc is ever covered
    let pins = '';
    st.pins.forEach((p, j) => {
      const at = p ?? pinTarget(j, v);
      if (at == null) return;
      const [x, y] = P(v.B[j + 1], RI + 4), [dx, dy] = P(v.cum[at], R), xy = `x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${dx.toFixed(2)}" y2="${dy.toFixed(2)}"`;
      pins += `<g class="ipin${p != null ? ' on' : ''}" data-pinj="${j}"><title>${p != null ? 'Pinned to note ' + p : 'Pin to note ' + at}</title><line class="pin-hit" ${xy}/><line class="pin-line" ${xy}/></g>`;
    });
    const oLabs = [];
    for (let i = 0; i < n; i++) {
      const s = st.steps[i], c0 = v.cum[i], c1 = v.cum[i + 1], ext = Math.abs(c1 - c0);
      const lo = Math.min(c0, c1), hi = Math.max(c0, c1);   // the arcs run on behind the dots (the user's test; a 5 px gap before)
      // a free step that comes out a ratio is tinted in its prime's colour, as an unchosen lattice node
      const fr = !s && exactOf(i, v), rr = (s && s.r) || fr;
      const cls = rr ? S.ratio(S.qNote(rr)).cls + (fr ? ' tint' : '') : 'pt';
      const sel = st.sel.arc === i ? ' sel' : '';
      const d = ext > 1e-9 ? arc(lo, hi, R) : '';
      arcs += `<g class="carc ${cls}${s ? ' set' : ' free'}${s && s.r ? ' exact' : ''}${sel}" data-i="${i}">
        <title>Step ${i + 1}: ${s ? s.t + ' · ' : ''}${S.exactC(v.cs[i])}${s ? '' : ' (free)'}</title>
        ${d ? `<path class="a-band" d="${d}"/><path class="a-in" d="${d}"/>` : ''}
        <path class="a-hit" d="${arc(c0, c1 === c0 ? c0 + gapC : c1, R)}"/></g>`;
      // the step's size outside its arc, where it has room: as set (3/2, 7\12), else in cents (one
      // decimal); pressed, as its arc. The selected step's field stands in its place, looking the same
      const ex = !s && exactOf(i, v);
      const txt = s && plainR(s.r) ? plainTxt(s.r) : s && s.edo ? s.t : plainR(ex) ? plainTxt(ex) : S.fmtC(v.cs[i]);
      const lr = labelR(ang((c0 + c1) / 2), ...labelBox(txt));
      oLabs.push({ txt, at: P((c0 + c1) / 2, lr), fits: lr * ang(ext) >= txt.length * 8.2 + 6, sel: st.sel.arc === i,
        tag: `<text class="a-lab${s ? (s.r ? ' rat ' + cls : '') : ' free'}" data-i="${i}"` });
      // the lock on the band: shut, the step keeps its size; open, it is free
      if (R * ang(ext) >= 30) {
        const [x, y] = P((c0 + c1) / 2, R);
        locks += `<g class="alock ${cls}${s ? ' set' : ''}${s && s.r ? ' exact' : ''}" data-lock="${i}" transform="translate(${x.toFixed(2)},${y.toFixed(2)})"><title>${s ? 'Set' : 'Free'}</title><circle r="12"/>
          <path class="shackle" d="${s ? 'M-3.2 -0.5V-3.5a3.2 3.2 0 0 1 6.4 0V-0.5' : 'M-3.2 -4V-6a3.2 3.2 0 0 1 6.4 0V-0.5'}"/><rect x="-5" y="-0.5" width="10" height="7" rx="1.5"/></g>`;
      }
    }
    for (let i = 0; i < n; i++) {
      const str = dotNote(i, v), [x, y] = P(v.cum[i], R);
      const sel = st.sel.dot === i ? ' sel' : '';
      dots += `<circle class="cdot ${S.ratio(str).cls}${sel}" data-i="${i}" data-r="${str}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotR}"><title>${S.noteTitle(S.ratio(str), S.fold(v.cum[i]))}</title></circle>`;
    }
    labels += placeLabels(oLabs, k);
    svgEl.innerHTML = `<svg class="cycle-svg" viewBox="0 0 ${W} ${W}" role="img" aria-label="Cycle of steps">${inner}${pins}${arcs}${labels}${dots}${locks}</svg>`;
  }

  // the side circle: the notes the cycle arrives at, folded into one octave, faint; the scale on its rim;
  // a selected step or inner interval as a dot of its own, at its size above the 1/1
  function renderClock() {
    if (S.sideWait(renderClock)) return;
    const v = calc(), points = [];
    for (let i = 0; i < st.n; i++) {
      const str = dotNote(i, v);
      points.push({ cents: S.fold(v.cum[i]), rf: 0.8, r: st.n > 40 ? 4 : st.n > 24 ? 5 : 7, cls: S.ratio(str).cls + (st.sel.dot === i ? ' sel' : ''), attrs: `data-i="${i}" data-r="${str}"`, spoke: true });
    }
    const iv = ivOf();
    if (iv) points.push({ cents: S.fold(S.ratio(iv.str).cents), rf: 0.8, r: 7, cls: S.ratio(iv.str).cls + ' sel', attrs: `data-iv="${iv.id}" data-r="${iv.str}"`, spoke: true });
    S.clock(clockEl, { size: 320, points, rimSel: st.sel.rim });
  }

  // the selected step or inner interval, as a note above the 1/1 (id: its dot's data-iv)
  const ivOf = () => (st.sel.inner != null ? { id: 'j' + st.sel.inner, str: innerNote(st.sel.inner) }
    : st.sel.arc != null ? { id: 'a' + st.sel.arc, str: stepNote(st.sel.arc) } : null);
  const hotIv = (id, on) => clockEl.querySelector(`.clock-dot[data-iv="${id}"]`)?.classList.toggle('hot', on);
  // its dot plays that note
  function soundIv(d) {
    const voice = S.audio.tone(S.baseFreq() * 2 ** (S.fold(S.ratio(d.dataset.r).cents) / 1200));
    const id = d.dataset.iv;
    hotIv(id, true);
    return () => { voice.stop(); hotIv(id, false); };
  }

  /* ---- sound ---- */
  // a sounding note lights every dot of the same note, round the cycle, on the side circle and in the list
  // (S.markScale counts, so two sounding dots of one note don't switch each other off)
  function hotDot(i, on) {
    const str = svgEl.querySelector(`.cdot[data-i="${S.mod(i, st.n)}"]`)?.dataset.r;
    if (str) S.markScale([str], on);
  }
  function soundDot(i) {
    const voice = S.audio.tone(dotFreq(i));
    hotDot(i, true);
    return () => { voice.stop(); hotDot(i, false); };
  }
  // a selected step's (or inner interval's) own dot on the side circle lights only when heard: when its
  // note is one of the two ends (2/1 is 1/1 there)
  const pc = (str) => (str === '2/1' ? '1/1' : str);
  const hotIvIf = (id, ends, on) => {
    const d = clockEl.querySelector(`.clock-dot[data-iv="${id}"]`);
    if (d && ends.map(pc).includes(pc(d.dataset.r))) d.classList.toggle('hot', on);
  };
  // a step: its two ends together, the lower one folded into the octave above the 1/1
  function soundArc(i) {
    const v = calc(), f0 = dotFreq(i, v);
    const ch = S.audio.chord([f0, f0 * 2 ** (v.cs[i] / 1200)]);
    const a = svgEl.querySelector(`.carc[data-i="${i}"]`), j = (i + 1) % st.n;
    const ends = [dotNote(i, v), dotNote(j, v)];
    a?.classList.add('hot'); hotDot(i, true); hotDot(j, true); hotIvIf('a' + i, ends, true);
    return () => { ch.stop(); svgEl.querySelector(`.carc[data-i="${i}"]`)?.classList.remove('hot'); hotDot(i, false); hotDot(j, false); hotIvIf('a' + i, ends, false); };
  }
  // an inner interval: its two ends together, the lower one folded into the octave above the 1/1
  function soundInner(j) {
    const v = calc(), f0 = S.baseFreq() * 2 ** (S.fold(v.B[j]) / 1200);
    const ch = S.audio.chord([f0, f0 * 2 ** (st.inner[j].c / 1200)]);
    const a = svgEl.querySelector(`.iarc[data-j="${j}"]`), ends = [boundNote(j, v), boundNote(j + 1, v)];
    a?.classList.add('hot'); S.markScale(ends, true); hotIvIf('j' + j, ends, true);
    return () => { ch.stop(); svgEl.querySelector(`.iarc[data-j="${j}"]`)?.classList.remove('hot'); S.markScale(ends, false); hotIvIf('j' + j, ends, false); };
  }
  // the button of the run that sounds looks held (S.seqBtn), the other not; none once it ends or stops
  const seqLit = (act) => document.querySelectorAll('[data-act="chain"], [data-act="cscale"]').forEach((b) => b.classList.toggle('held', b.dataset.act === act));
  // the chain note by note, round to its end
  function playChain() {
    if (st.arp) { st.arp(); return; }
    const v = calc(), is = Array.from({ length: st.n + 1 }, (_, i) => i);
    // the last note is dot 0 again only when the span is whole octaves (meantone's ends a diesis off it)
    const closes = Math.abs(v.T / 1200 - Math.round(v.T / 1200)) < 1e-9;
    const idx = (i) => (i < st.n ? i : closes ? 0 : -1);
    let last = -1;
    st.arp = S.audio.sequence(S.climb(is.map((i) => v.cum[i])), {
      ...S.seqPace(is.length),
      onStep: (k) => {
        if (last >= 0) hotDot(last, false);
        if (k < 0 || k >= is.length) { last = -1; if (k < 0) { st.arp = null; seqLit(null); } return; }
        last = idx(k); if (last >= 0) hotDot(last, true);
      },
    });
    seqLit('chain');
  }

  // the notes the cycle makes, in pitch order, up to the octave
  function playScale() {
    if (st.arp) { st.arp(); return; }
    const v = calc(), ord = S.pitchOrder(v.cum.slice(0, st.n));
    let lastI = -1;
    st.arp = S.audio.sequence(ord.map(([f]) => S.baseFreq() * 2 ** (f / 1200)), {
      ...S.seqPace(ord.length),
      onStep: (k) => {
        if (lastI >= 0) hotDot(lastI, false);
        if (k < 0 || k >= ord.length) { lastI = -1; if (k < 0) { st.arp = null; seqLit(null); } return; }
        lastI = ord[k][1]; hotDot(lastI, true);
      },
    });
    seqLit('cscale');
  }

  return {
    title: 'Cycle',
    mount,
    // Enter plays the selection as a press would: a step or inner interval as its interval, a dot its note
    playSel() {
      const sl = st.sel;
      if (sl.arc != null) return soundArc(sl.arc);
      if (sl.inner != null) return soundInner(sl.inner);
      if (sl.dot != null) return soundDot(sl.dot);
      const str = sl.rim;
      return str ? S.playNote(str) : null;
    },
    presets: Object.entries(PRESETS).map(([k, [name]]) => [k, name, COMMA_PRESETS[k] ? 'Commas' : null]),
    use: usePreset,
    state: texts,
    setState,
    slot: () => slot,
    setSlot: (o) => { if (fromTexts(o)) keepSlot(o); },
    match: () => presetOf(),
    pathOf,
    onHide: () => { if (st.arp) st.arp(); },
    // ← → walk along the notes
    onKeyDown(code) {
      const d = S.ARROWS[code];
      if (!d) return false;
      if (st.sel.rim != null) return S.rimStep(st.sel.rim, d);
      const i = st.sel.dot != null ? st.sel.dot : st.sel.arc != null ? st.sel.arc : 0, j = S.mod(i + d, st.n);
      select({ dot: j });
      S.click(() => soundDot(j));
      return true;
    },
  };
})();
