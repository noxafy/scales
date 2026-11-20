'use strict';
// Spiral: put intervals together and see where they go. The path is a row of runs (count × interval, up or
// down; an interval is a ratio, cents or k\N); the chosen run's count and direction are edited in its chip, its interval with the picker below the row; the path is drawn on the pitch spiral: the angle is the place in the octave (as on every circle),
// the radius grows one turn per octave, so the end shows both where in the octave the stack lands and how
// many octaves it climbed, and how near it comes back to the 1/1. Nothing is decided ahead (no step count,
// no octaves). The Spiral tab's one view (temper.js).
S.parts.spiral = (() => {
  const MAXN = 999, MAXP = 9999;   // steps in a run, in the whole path (the user: 9999 steps may take 200 ms to draw)
  // the path: runs {t: as typed, down, n}; t: the chosen run (null: "+" waits, the next interval picked adds a run); sel: the selected note (index into the notes,
  // 0 = the 1/1), a step (seg: index into the steps) or a note picked on the rim or in the list (rim)
  const st = { path: [], t: 0, sel: { i: null } };
  const steps = () => st.path.reduce((a, p) => a + p.n, 0);
  // an interval's text parsed once: a path of 9999 runs has a handful of texts, and a press parsed each run's twice. The
  // memos hold every text a path can have (at 1000 a path of 9999 different ones cleared them on every press, 110 ms)
  const MEMO = 2 * MAXP;
  const stepMemo = new Map();
  const step = (t) => {
    let x = stepMemo.get(t);
    if (x === undefined) { if (stepMemo.size > MEMO) stepMemo.clear(); x = S.parseStep(t); stepMemo.set(t, x); }
    return x;
  };
  let stored = false, edit;
  try {
    const o = JSON.parse(localStorage.getItem('scales.spiral') || 'null');
    if (o && Array.isArray(o.path)) {
      for (const p of o.path) {
        if (!p || !S.parseStep(p.t)) continue;
        const n = Math.min(Math.max(1, Math.round(+p.n || 1)), MAXN, MAXP - steps()), l = st.path[st.path.length - 1];
        if (n < 1) break;
        if (l && l.t === p.t && l.down === !!p.down && p.n == null) l.n++;   // single steps, as stored before: one run each
        else st.path.push({ t: p.t, down: !!p.down, n });
      }
      stored = o.path.length === 0;   // all runs taken out: it stays so
    }
  } catch (e) {}
  if (!st.path.length && !stored) st.path = [{ t: '3/2', down: false, n: 12 }];
  st.t = null;   // "+" waits until an interval is chosen, as in Beats
  const save = () => S.keep('scales.spiral', JSON.stringify({ path: st.path }));
  // the run each step belongs to
  const runOf = (i) => { for (let r = 0; r < st.path.length; r++) { if (i < st.path[r].n) return r; i -= st.path[r].n; } return st.path.length - 1; };
  const endOf = (r) => st.path.slice(0, r + 1).reduce((a, p) => a + p.n, 0);   // the note a run ends on
  // the steps of the chosen run, [from, to): an arc is in it by a range check (runOf per arc walked the runs each
  // time, 50 million steps for 9999 runs)
  const curSteps = () => (st.path[st.t] ? [endOf(st.t) - st.path[st.t].n, endOf(st.t)] : [0, 0]);

  // intervals typed into the field, kept as chips (browser-only, as the pickers' typed ratios)
  let typed = [];
  try { const t = JSON.parse(localStorage.getItem('scales.spiralTyped') || '[]'); if (Array.isArray(t)) typed = t.filter((x) => S.parseStep(x)); } catch (e) {}
  const keepTyped = (t) => {
    typed = [...typed.filter((x) => x !== t), t].slice(-12);
    try { localStorage.setItem('scales.spiralTyped', JSON.stringify(typed)); } catch (e) {}
  };

  let el, svgEl, clockEl, readEl, headEl, runsEl, typeIn, picker;

  const clsOfP = (p) => (p <= 2 ? 'p2' : p <= 13 ? 'p' + p : 'p17');
  // a note of the path. c: cents above the 1/1 (not folded), fc folded; str: its key, made when first asked for
  // (S.ratioOfMonzo, from its prime exponents e); short: its key is n/d (S.Q_DIGITS), else powers
  function note(c, e, s, down) {
    const x = { c, fc: S.fold(c), s, down };
    if (!e) {   // a step that isn't a ratio is in the stack: 12-TET's k\12 when it lands on one, else cents
      x.str = S.noteOfCents(c); x.cls = S.ratio(x.str).cls; x.short = true;
      return x;
    }
    let top = 2, dn = 0, dd = 0;
    for (const p in e) {
      if (+p > top) top = +p;
      if (p !== '2') { const l = e[p] * Math.log10(+p); if (l > 0) dn += l; else dd -= l; }
    }
    x.cls = clsOfP(top);
    // the 2s that fold it, from its cents (only to tell n/d from powers: the key's own come from S.qFold)
    const two = (e[2] || 0) - Math.floor(c / 1200);
    if (two > 0) dn += two * Math.LOG10E * Math.LN2; else dd -= two * Math.LOG10E * Math.LN2;
    x.short = dn < S.Q_DIGITS - 0.01 && dd < S.Q_DIGITS - 0.01;
    let str = null;
    Object.defineProperty(x, 'str', { get: () => str || (str = S.ratioOfMonzo(e)), enumerable: true });
    return x;
  }
  // the notes the path reaches, made again only when the path changes. Each note's cents come afresh (never summed
  // along): its ratio steps' from its prime exponents (S.qCents), the others' from how many of each lie below it; so a
  // step costs the same however far the path has climbed, and however many texts it has (counting every text per step
  // took 4 s for 9999 superparticulars)
  let memo = null;
  function notes() {
    const sig = JSON.stringify(st.path);
    if (memo && memo.sig === sig) return memo.ns;
    const parsed = new Map(st.path.map((p) => [p.t, step(p.t)]));
    const out = [note(0, {}, null, false)], count = new Map();   // count: the steps below of each text that isn't a ratio
    let e = {}, eC = 0;
    for (const p of st.path) {
      const s = parsed.get(p.t), sign = p.down ? -1 : 1;
      for (let j = 0; j < p.n; j++) {
        if (s.r) { e = S.qMul(e, s.r, sign); eC = S.qCents(e); }   // a fresh object: each note keeps its own
        else count.set(p.t, (count.get(p.t) || 0) + sign);
        let c = eC, ratio = true;
        for (const [t, k] of count) { if (!k) continue; c += k * parsed.get(t).c; ratio = false; }
        out.push(note(c, ratio ? e : null, s, p.down));
      }
    }
    return (memo = { sig, ns: out }).ns;
  }
  // the notes the path reaches, each once, as the scale keeps them (a note too long to key is left out)
  let pnMemo = null;   // made again only with the notes (keys of a long path take a while)
  const pathNotes = () => {
    const ns = notes();
    if (!pnMemo || pnMemo.ns !== ns) pnMemo = { ns, list: [...new Set(ns.map((x) => S.noteKey(x.str)).filter((k) => k && k !== '2/1'))] };
    return pnMemo.list;
  };
  // Use as scale is off while the scale is already these notes
  let syncUse = null;   // S.useWire's: the arrows off while the scale is already these notes
  function syncToScale() { if (syncUse) syncUse(); }
  // one pitch (S.EXACT decides, as everywhere), the keys compared only when the pitches agree
  const samePitch = (a, b) => Math.abs(a.fc - b.fc) < S.EXACT || Math.abs(Math.abs(a.fc - b.fc) - 1200) < S.EXACT;
  const isNote = (x, str) => { const r = S.ratio(str); return !!r && samePitch(x, { fc: S.fold(r.cents) }) && x.str === str; };
  // a dot's data-r: its key when short, and a long one only when the scale holds it (so it lights with the scale)
  const longScale = () => S.scale.filter((k) => k.includes('*'));
  const rAttr = (x, longs) => (x.short || longs.some((k) => isNote(x, k)) ? ` data-r="${x.str}"` : '');
  const freqOf = (c) => S.centsFreq(S.fold(c));   // every note sounds in the octave above the 1/1

  function mount(root, side) {
    el = root; clockEl = side.clock; readEl = side.read;
    el.innerHTML = `
      <div class="toolbar sp-runs" data-runs></div>
      <div class="sp-pick" data-picker></div>
      ${S.useFig(`<div class="panel">
        <div class="toolbar chart-head">
          <span class="mono" data-head></span>
          <span class="head-btns"><button class="btn quiet" data-act="path"><span class="ico seq"></span>Path</button><button class="btn quiet" data-act="sscale"><span class="ico seq"></span>Scale</button></span>
        </div>
        <div data-svg></div>
      </div>`)}`;
    svgEl = el.querySelector('[data-svg]');
    headEl = el.querySelector('[data-head]');
    runsEl = el.querySelector('[data-runs]');
    // the controls edit a run (the chosen one by default), which becomes the chosen one; its end note is selected
    edit = (f, r = st.t) => { const p = st.path[r]; if (!p) return; st.t = r; f(p); st.sel = { i: endOf(r) }; save(); render(true); };
    // an interval: the chosen run's, or, while "+" waits, a new run of 1 up
    const pickIv = (t) => {
      if (st.path[st.t]) { edit((p) => { p.t = t; }); return; }
      if (steps() >= MAXP) return;
      st.path.push({ t, down: false, n: 1 });
      st.t = st.path.length - 1; st.sel = { i: steps() }; save(); render(true);
    };
    // the intervals: the shared picker (its library under "+ more", 12-TET's k\12 there too); its field
    // also takes cents and k\N, and an interval no chip shows stays in it, lit
    const put = (txt) => {
      const s = S.parseStep(txt);
      typeIn.value = txt; typeIn.classList.toggle('bad', !s);
      if (s) pickIv(s.t);
    };
    picker = S.ratioPicker(el.querySelector('[data-picker]'), {
      exclude: ['1/1'],
      et: true,
      groups: [...S.RATIO_GROUPS, { id: 'commas', label: 'Commas', list: S.COMMAS.slice(0, 8) }],   // the Cycle's eight: a stack's shortfall, as a step
      isOn: (str) => str === runKey(st.path[st.t]),
      steps: stepChips,
      onTyped: (t) => { if (!onTop(t)) keepTyped(t); },
      onPick: (str) => { const r = S.ratio(str); pickIv(!r ? str : r.edo ? `${r.edo[0]}\\${r.edo[1]}` : r.temp ? String(r.cents) : str); },   // a cents note (a scale chip) steps by its cents; a step chip (13\19, 653.2) is its step text
      parse: (t) => S.parseStep(t)?.t ?? null,
      onField: (inp, kept) => {
        if (typeIn && typeIn !== inp) S.stepFields.delete(typeIn);
        typeIn = inp;
        // a scale list row or step pressed while the field has the focus: its interval, at once
        S.stepFields.set(inp, put);
        // every run's interval has a chip, so the field only holds what is being typed
        if (!kept) inp.value = '';
      },
    });
    // the runs: press one to choose it, its arrow turns it, × removes it, + waits for the next run's interval
    runsEl.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]'), r = e.target.closest('[data-run]');
      if (x) { removeRun(+x.dataset.x); return; }
      const dir = e.target.closest('[data-dir]');
      if (dir) { edit((p) => { p.down = !p.down; }, +dir.dataset.dir); return; }
      if (e.target.closest('[data-act="more"]')) {
        st.t = null; render(false, true);
        return;
      }
      if (r) { st.t = +r.dataset.run; st.sel = { i: endOf(st.t) }; render(true, true); }
    });
    // the notes the path reaches become the scale, as the Cycle's do (the arrow)
    syncUse = S.useWire(el, pathNotes);
    S.seqBtn(el.querySelector('[data-act="path"]'), playPath);
    S.seqBtn(el.querySelector('[data-act="sscale"]'), playScale);

    // a dot plays its note; a segment its two ends together; glide across them
    // a mass (a crowded run drawn as one shape) plays the step under the pointer, so gliding over it walks its steps
    const which = (t, e) => (t.classList.contains('sp-mass') ? stepAt(t, e) : +t.dataset.i);
    S.holdOn(svgEl, '.sp-dot, .sp-seg, .sp-mass', (t, e) => {
      const i = which(t, e);
      if (i == null) return null;
      if (!t.classList.contains('sp-dot')) { st.t = runOf(i); st.sel = { seg: i }; render(true, true); return soundSeg(i); }
      select(i);
      return soundDot(i);
    }, { takeTouch: true, id: (t, e) => (t.classList.contains('sp-dot') ? `dot ${t.dataset.i}` : `seg ${which(t, e)}`) });
    // a tap on the picture's background lets go of the selection, here and in every tab, and of the chosen run, so
    // none is faint (the user, 2026-11-20); "+" then waits, as with no run chosen
    S.bgTap(svgEl.closest('.panel'), '[data-head], .sp-dot, .sp-seg, .sp-mass', () => {
      st.t = null;
      S.emit('pick', null);
    });
    S.clockHold(clockEl, '[data-i]', (d) => {
      const i = +d.dataset.i, ns = notes();
      if (!(st.sel.i != null && ns[st.sel.i] && samePitch(ns[st.sel.i], ns[i]))) select(i);   // its note already selected (dot 13's 1/1): it stays there
      return soundDot(i);
    }, pickRim);
    const shown = S.whenShown(root);
    // a note picked on the rim, in the list, by a key or typed in stays a rim note, as in the Lattice, even where the
    // path reaches it (the arrows then walk the scale); one selected in another tab selects its dot, if the path has it
    S.on('pick', shown(pickRim));
    S.on('note', shown((str, src) => { if (src !== 'spiral') showNote(str); }));
    S.on('settings', () => render());
    S.on('scale', () => render());   // a note may now read as a scale ratio
    new ResizeObserver(() => renderSpiral()).observe(svgEl);
    // the note selected by now, as every view mounted later starts (a note the path doesn't reach: as a rim note)
    st.sel = { i: steps() };
    render();
    S.note.rim ? pickRim(S.note.str) : showNote(S.note.str);
  }

  function removeRun(r) {
    st.path.splice(r, 1);
    // the chosen one gone: the run before it is chosen, else "+" waits (as Beats' tones)
    if (st.t === r) st.t = r > 0 ? r - 1 : null;
    else if (st.t > r) st.t--;
    st.sel = { i: st.t != null ? endOf(st.t) : steps() }; save(); render(true);
  }
  function select(i) { st.sel = { i }; render(true, true); }
  function pickRim(str) { st.sel = { rim: str || '' }; render(false, true); }
  function showNote(str) {
    if (!str) { pickRim(str); return; }   // nothing selected: a dash, as every view
    const ns = notes();
    for (let i = ns.length - 1; i >= 0; i--) if (isNote(ns[i], str)) { st.sel = { i }; render(false, true); return; }
    st.sel = { rim: str }; render(false, true);
  }
  const selNote = (ns) => (st.sel.rim ?? (st.sel.seg != null ? segNote(ns, st.sel.seg) : (ns[Math.min(st.sel.i ?? ns.length - 1, ns.length - 1)] || ns[0]).str));
  // step i as a note above the 1/1 (a step down: below it, folded)
  function segNote(ns, i) {
    const { s, down } = ns[i + 1];
    if (s.r) return S.qNote(down ? S.qMul({}, s.r, -1) : s.r);
    if (s.edo) return S.edoKey(down ? -s.edo[0] : s.edo[0], s.edo[1]);
    return S.noteOfCents(down ? -s.c : s.c);
  }

  // sameNotes: only the selection moved, so the picture keeps its shapes (a redraw during a press takes the touch's target away)
  function render(own = false, sameNotes = false) {
    syncToScale();
    const ns = notes();
    if (st.sel.i != null && st.sel.i > ns.length - 1) st.sel.i = ns.length - 1;
    if (st.sel.seg != null && st.sel.seg > ns.length - 2) st.sel = { i: ns.length - 1 };
    if (sameNotes) { markSpiral(); markRuns(); } else { renderSpiral(ns); renderRuns(); }
    renderClock(ns);
    if (own && st.sel.rim == null) S.setNote(selNote(ns), 'spiral');
    readEl.innerHTML = S.readout(selNote(ns));
    // where it went: the whole climb in cents
    const end = ns[ns.length - 1].c;
    headEl.innerHTML = `${ns.length - 1} steps · <span class="has-tip" title="${S.exactC(end)}">${S.fmtC(end)}¢</span>`;
    if (S.parts.spiral.onEdit) S.parts.spiral.onEdit();
  }

  // the note a run's interval is as a chip (folded ratio or k\N key), to light its chip
  const keyMemo = new Map();
  const runKey = (p) => {
    if (!p) return null;
    if (!keyMemo.has(p.t)) { const s = step(p.t); if (keyMemo.size > MEMO) keyMemo.clear(); keyMemo.set(p.t, !s ? null : s.r ? S.qText(s.r) : s.edo ? S.edoKey(s.edo[0], s.edo[1]) : s.c > 0 && s.c < 1200 ? S.centsKey(s.c) : null); }
    return keyMemo.get(p.t);
  };
  // the interval a run takes, as its chip reads it
  const textMemo = new Map();
  const runText = (t) => { const s = step(t); return s.r || s.edo ? ivText(t) : `${S.chipC(s.c)}¢`; };   // a run's chip: whole cents from 1000¢ on
  const ivText = (t) => { if (!textMemo.has(t)) { const s = step(t); if (textMemo.size > MEMO) textMemo.clear(); textMemo.set(t, s.r ? S.fmtRatio(null, S.WIDE_DIGITS, s.r) : s.edo ? s.t : `${S.fmtC(s.c)}¢`); } return textMemo.get(t); };   // n/d up to 6 digits a side, as every chip
  const clsMemo = new Map();
  const ivCls = (t) => {
    if (!clsMemo.has(t)) { const s = step(t); clsMemo.set(t, s.r ? S.ratio(S.qNote(s.r)).cls : 'pt'); }
    return clsMemo.get(t);
  };
  // shown by one of the picker's chips that are always there (the everyday ones, the scale's, typed ratios)
  const onTop = (t) => { const k = runKey({ t }); return !!k && k !== '1/1' && (S.CORE_RATIOS.includes(k) || S.scale.includes(k) || S.typed.includes(k)); };
  // the picker's chips of the path's own intervals and the typed ones that no chip there shows (9/4, 700¢, a comma),
  // each once, so a chosen run's interval is always a chip and the field stays free for typing
  function stepChips() {
    const cur = st.path[st.t] && step(st.path[st.t].t).t, seen = new Set(), out = [];
    for (const t of new Set([...st.path.map((p) => p.t), ...typed])) {
      const s = step(t);
      if (!s || seen.has(s.t) || onTop(s.t)) continue;
      seen.add(s.t);
      out.push({ key: s.t, c: s.c, cls: ivCls(s.t), on: s.t === cur, html: () => S.breakHTML(S.labelHTML(ivText(s.t))), title: () => S.stepTip(s, ivText(s.t)) });
    }
    return out;
  }
  // a run's count: a field in its chip, typed or dragged (S.numDrag); a press that doesn't move chooses the run and types
  function countIn(r) {
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'number', className: 'run-n', min: 1, max: MAXN, step: 1, inputMode: 'numeric', value: st.path[r].n });
    inp.dataset.n = r;
    inp.setAttribute('aria-label', 'Times');
    const most = () => Math.min(MAXN, MAXP - steps() + (st.path[r]?.n || 0));
    S.numIn(inp, most, (v) => edit((q) => { q.n = v; }, r), () => { const p = st.path[r]; if (p) inp.value = p.n; });
    S.numDrag(inp, {
      get: () => st.path[r]?.n ?? 1,
      max: most,
      set: (n) => edit((q) => { q.n = n; }, r),
      onStart: () => { st.dragN = true; if (st.t !== r) edit(() => {}, r); },
      onEnd: () => { st.dragN = false; renderRuns(); },
      // a press chooses the run, then types into its count (the row is drawn anew, so it is that run's new field)
      onTap: () => { if (st.t !== r) { st.t = r; st.sel = { i: endOf(r) }; render(true, true); } return runsEl.querySelector(`.run-n[data-n="${r}"]`); },
    });
    return inp;
  }
  // the same path, another run chosen (or none): the marks move, the row and the picker stay as drawn
  function markRuns() {
    runsEl.querySelectorAll('.sp-run').forEach((c, r) => c.classList.toggle('on', r === st.t));
    runsEl.querySelector('.add-tone')?.classList.toggle('on', !st.path[st.t]);
    picker.mark();
  }
  // the row of runs; every chip holds its count (a field) and direction (its arrow), so none changes length when chosen
  function renderRuns() {
    picker.render();
    const typing = runsEl.querySelector('.run-n:focus');
    if (typing || st.dragN) {   // typing or dragging a count: the row stays as it is, the counts follow
      runsEl.querySelectorAll('.run-n').forEach((f) => { const p = st.path[+f.dataset.n]; if (p && f !== typing) f.value = p.n; });
      runsEl.querySelectorAll('.sp-run').forEach((c, r) => c.classList.toggle('on', r === st.t));
      return;
    }
    const p = st.path[st.t];
    const arr = (p) => `<svg class="arr${p.down ? ' down' : ''}" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6H10.5M6.5 2L10.5 6L6.5 10"/></svg>`;
    S.keepFocus(runsEl, () => { runsEl.innerHTML = st.path.map((p, r) => `<span class="chip tok sp-run ${ivCls(p.t)}${r === st.t ? ' on' : ''}"><span class="run-n-slot"></span><span class="run-x">×</span><button class="run-dir" data-dir="${r}" aria-label="${p.down ? 'Down' : 'Up'}">${arr(p)}</button><button data-run="${r}">${S.breakHTML(S.labelHTML(runText(p.t)))}</button><button class="tok-x" data-x="${r}" aria-label="remove"><svg viewBox="0 0 8 8"><path d="M1 1L7 7M7 1L1 7"/></svg></button></span>`).join('')
      + (steps() < MAXP ? `<button class="chip more add-tone${p ? '' : ' on'}" data-act="more" aria-label="Add a run"><svg viewBox="0 0 10 10"><path d="M5 1V9M1 5H9"/></svg></button>` : '');
    runsEl.querySelectorAll('.run-n-slot').forEach((slot, r) => slot.replaceWith(countIn(r))); });
  }

  // the picture: the pitch spiral from the lowest octave the path touches to the highest; spokes at the 12
  // 12-TET steps, named outside; the path along the spiral, each step in its interval's colour.
  // Turns lie dr apart. While the screen can show a gap between bands (BAND wide), every step is drawn as it is. When it
  // can't (under one device pixel), a run that covers a whole turn or more is one filled shape (a mass): at every angle
  // from its first turn to its last, so a ratio's and a tempered step's alike (the limit of a hollow band is a full one).
  // Its steps are found by where a press lands (stepAt), and only the selected or sounding one is drawn, on top (overlay).
  // Runs shorter than a turn are drawn step by step, as are steps whose colour changes every run.
  const W = 480, C = W / 2, R0 = 34, RM = 196, BAND = 4;
  let geo = null;   // the last drawing's lo, dr and whether it is crowded, for presses and overlays
  let curMarked = [0, 0];   // the chosen run's steps as the picture marks them
  const angleOf = (c) => (c / 1200) * 2 * Math.PI;
  const at = (c, r) => { const a = angleOf(c); return [C + r * Math.sin(a), C - r * Math.cos(a)]; };
  const f1 = (v) => Math.round(v * 10) / 10;
  // points along the spiral from c0 to c1, off units outside it, close enough that no chord strays more than tol from
  // the curve (its sagitta r·θ²/8, at most 30¢ apart)
  const stepOf = (r, t) => Math.min(30, (1200 / (2 * Math.PI)) * Math.sqrt((8 * t) / Math.max(r, 1)));
  function curve(g, c0, c1, off, move) {
    const D = Math.abs(c1 - c0), s = c1 >= c0 ? 1 : -1, rad = (c) => R0 + ((c - g.lo) / 1200) * g.dr + off;
    let d = '', u = 0;
    const put = (c, cmd) => { const [x, y] = at(c, rad(c)); d += `${cmd}${f1(x)} ${f1(y)}`; };
    put(c0, move ? 'M' : 'L');
    while (u < D) { u = Math.min(D, u + stepOf(rad(c0 + s * u), g.tol)); put(u === D ? c1 : c0 + s * u, 'L'); }
    return d;
  }
  // from c0 to c1 along the spiral: a band, or, crowded and a turn or more, the shape it fills: within BAND/2 of its
  // first turn and its last, each closed by a radial edge where the path starts or ends (evenodd: at every angle its
  // last turn lies outside its first, so the two loops never cross)
  const isMass = (g, c0, c1) => g.crowded && Math.abs(c1 - c0) >= 1200;
  function shapeOf(g, c0, c1) {
    if (!isMass(g, c0, c1)) return curve(g, c0, c1, 0, true);
    const a = Math.min(c0, c1), b = Math.max(c0, c1);
    return `${curve(g, b - 1200, b, BAND / 2, true)}Z${curve(g, a, a + 1200, -BAND / 2, true)}Z`;
  }
  // a step's group: its band (or filled shape), a tempered band's hollow centre, its press area
  function segHTML(g, ns, i, extra = '', cur = curSteps()) {   // cur: the chosen run's steps, found once per drawing (per step: 9999² for 9999 runs)
    const s = ns[i + 1].s, c0 = ns[i].c, c1 = ns[i + 1].c, d = shapeOf(g, c0, c1), fill = isMass(g, c0, c1);
    const [cur0, cur1] = cur;
    return `<g class="sp-seg ${ivCls(s.t)}${s.r ? '' : ' temp'}${i >= cur0 && i < cur1 ? ' cur' : ''}${st.sel.seg === i ? ' sel' : ''}${extra}" data-i="${i}"><title>${ns[i + 1].down ? '↓' : '↑'} ${s.r && s.t.includes('*') ? S.fmtMonzo(s.r) : s.t}</title>`
      + (fill ? `<path class="sp-fill" d="${d}"/>` : `<path class="sp-band" d="${d}"/>${s.r ? '' : `<path class="sp-in" d="${d}"/>`}<path class="sp-hit" d="${d}"/>`) + '</g>';
  }
  // the runs drawn as masses: [run, first step, steps]
  function massRuns(g, ns) {
    const out = [];
    let i0 = 0;
    st.path.forEach((p, r) => { if (isMass(g, ns[i0].c, ns[i0 + p.n].c)) out.push([r, i0, p.n]); i0 += p.n; });
    return out;
  }
  function renderSpiral(ns = notes()) {
    const cs = ns.map((x) => x.c), cmin = Math.min(...cs), cmax = Math.max(...cs);
    const lo = 1200 * Math.floor(cmin / 1200 + 1e-9), hi = Math.max(lo + 1200, 1200 * Math.ceil(cmax / 1200 - 1e-9));
    const dr = (RM - R0) / ((hi - lo) / 1200);
    // crowded: the bands touch, so no gap between turns can be drawn. A gap under a device pixel still shows, fainter
    // (smoothing covers a pixel in part): masses from one pixel on swallowed lines the eye still saw (62 × 3/2, the
    // user's test, 2026-11-20)
    const g = geo = { lo, dr, crowded: dr <= BAND + 1e-9, tol: 0.1 };
    const P = (c) => at(c, R0 + ((c - lo) / 1200) * dr);
    const masses = massRuns(g, ns), inMass = g.inMass = new Set();
    masses.forEach(([, i0, n]) => { for (let i = i0; i < i0 + n; i++) inMass.add(i); });
    // a drawing that would need more than PTS points loosens tol to fit, up to half a unit: what is drawn, a mass two turns
    const PTS = 15000;
    let span = (cmin - lo) + (hi - cmax) + masses.length * 2400;
    for (let i = 0; i + 1 < ns.length; i++) if (!inMass.has(i)) span += Math.abs(cs[i + 1] - cs[i]);
    g.tol = S.clamp(0.1 * (span / stepOf((R0 + RM) / 2, 0.1) / PTS) ** 2, 0.1, 0.5);
    let s = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI, sx = Math.sin(a), cy = -Math.cos(a);
      s += `<line class="sp-spoke${i ? '' : ' one'}" x1="${C + R0 * 0.6 * sx}" y1="${C + R0 * 0.6 * cy}" x2="${C + RM * sx}" y2="${C + RM * cy}"/>`;
      s += `<text class="sp-name" x="${C + (RM + 20) * sx}" y="${C + (RM + 20) * cy}" dy="${S.DY_SANS}">${S.midiName(S.settings.base + i).replace(/-?\d+$/, '')}</text>`;
    }
    // the guide only where the path isn't: its bands cover it everywhere between the lowest and highest note
    s += `<path class="sp-guide" d="${cmin > lo ? curve(g, lo, cmin, 0, true) : ''}${cmax < hi ? curve(g, cmax, hi, 0, true) : ''}"/>`;
    const n = ns.length - 1;
    g.dotR = n > 60 ? 3.5 : n > 24 ? 5 : 7;
    let segs = '', dots = '';
    let mi = 0;
    const cur = curMarked = curSteps();
    for (let i = 0; i < n; i++) {
      if (masses[mi] && masses[mi][1] === i) {   // a run drawn as one shape, in its interval's colour
        const [r, i0, k] = masses[mi++], t = st.path[r].t;
        segs += `<g class="sp-mass ${ivCls(t)}${r === st.t ? ' cur' : ''}" data-mass="${r}"><path class="sp-fill" d="${shapeOf(g, cs[i0], cs[i0 + k])}"/></g>`;
        i = i0 + k - 1;
        continue;
      }
      segs += segHTML(g, ns, i, '', cur);
    }
    const longs = longScale();
    ns.forEach((x, i) => { if (!hidDot(i, n)) dots += dotHTML(ns, i, longs); });
    // press areas and the sounding glow reach no further than the next turn
    const vars = `--sp-hit:${f1(S.clamp(dr, BAND, 20))}px;--glow-max:${f1(Math.max(BAND, 2 * dr - BAND))}px`;
    svgEl.innerHTML = `<svg class="spiral-svg${st.path.length > 1 && st.path[st.t] ? ' runs' : ''}" style="${vars}" viewBox="0 0 ${W} ${W}" role="img" aria-label="Spiral of the path">${s}${segs}<g class="sp-dots">${dots}</g></svg>`;
    markOverlays();
  }
  // a note's dot. A note inside a mass (every step beside it in one) has none, as its steps (a thousand dots there,
  // overlapping, showed only their dark edges: the user, 2026-11-20); it is drawn on top while it is selected, sounds,
  // or borders the selected or sounding step (markOverlays)
  const hidDot = (i, n = notes().length - 1) => !!geo && (i === 0 || geo.inMass.has(i - 1)) && (i === n || geo.inMass.has(i));
  function dotHTML(ns, i, longs = longScale(), extra = '') {
    const x = ns[i], n = ns.length - 1, [cx, cy] = at(x.c, R0 + ((x.c - geo.lo) / 1200) * geo.dr);
    return `<circle class="sp-dot ${x.cls}${st.sel.i === i ? ' sel' : ''}${extra}" data-i="${i}"${rAttr(x, longs)} cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${geo.dotR}"></circle>`;   // one size, the ends too (they were 1 larger, from the first version: the user, 2026-11-20)
  }
  // a hidden note's dot, drawn on top (made when first asked for)
  function dotOver(i) {
    const box = svgEl.querySelector('.sp-dots'), ns = notes();
    if (!box || !ns[i]) return null;
    return box.querySelector(`.sp-dot[data-i="${i}"]`) || (box.insertAdjacentHTML('beforeend', dotHTML(ns, i, undefined, ' over')), box.lastElementChild);
  }
  // the step of a mass under a press: the angle gives the place in the octave, the radius the nearest turn, the run's
  // equal steps which step holds that pitch
  function stepAt(mass, e) {
    const svg = mass.ownerSVGElement, m = svg?.getScreenCTM(), ns = notes(), r = +mass.dataset.mass, p = st.path[r];
    if (!m || !p || !geo) return null;
    const i0 = endOf(r) - p.n, ca = ns[i0].c, cb = ns[i0 + p.n].c;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()), dx = pt.x - C, dy = pt.y - C;
    const phi = S.mod((Math.atan2(dx, -dy) / (2 * Math.PI)) * 1200, 1200);
    const h = geo.lo + ((Math.hypot(dx, dy) - R0) / geo.dr) * 1200;   // the height the radius says
    let c = phi + 1200 * Math.round((h - phi) / 1200);
    const a = Math.min(ca, cb), b = Math.max(ca, cb);
    if (c < a) c += 1200 * Math.ceil((a - c) / 1200 - 1e-9);
    if (c > b) c -= 1200 * Math.ceil((c - b) / 1200 - 1e-9);
    const j = Math.floor(((c - ca) / (cb - ca)) * p.n);
    return i0 + S.clamp(j, 0, p.n - 1);
  }
  // a step of a mass drawn on its own, on top, while it is selected or sounds
  function overlay(i, on) {
    const svg = svgEl.querySelector('svg');
    if (!svg || !geo) return null;
    let o = svg.querySelector(`.sp-seg[data-i="${i}"]`);
    if (on && !o) {
      const ns = notes();
      if (!ns[i + 1]) return null;
      svg.querySelector('.sp-dots').insertAdjacentHTML('beforebegin', segHTML(geo, ns, i, ' over'));
      o = svg.querySelector(`.sp-seg[data-i="${i}"]`);
    }
    return o;
  }
  // the selected step, when it lies in a mass, drawn on top, and the hidden dots of the selected note and of the
  // selected or sounding step's ends; overlays neither selected nor sounding go
  function markOverlays() {
    const svg = svgEl.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.sp-seg.over').forEach((o) => { if (+o.dataset.i !== st.sel.seg && !o.classList.contains('hot')) o.remove(); });
    if (st.sel.seg != null) overlay(st.sel.seg, true);
    const need = new Set([st.sel.i, st.sel.seg, st.sel.seg != null ? st.sel.seg + 1 : null]);
    svg.querySelectorAll('.sp-seg.hot').forEach((o) => { need.add(+o.dataset.i); need.add(+o.dataset.i + 1); });
    svg.querySelectorAll('.sp-dot.over').forEach((d) => { if (!need.has(+d.dataset.i) && !d.matches('.hot, .held')) d.remove(); });
    need.forEach((i) => { if (i != null && hidDot(i)) dotOver(i); });
  }

  // the selection and the chosen run on the picture's shapes, as renderSpiral draws them
  function markSpiral() {
    svgEl.querySelector('svg')?.classList.toggle('runs', st.path.length > 1 && !!st.path[st.t]);
    markOverlays();
    // the chosen run's marks only when it changed, the selection's only where it was and is (every shape per press: 60 ms
    // for 9999 steps)
    const [c0, c1] = curSteps();
    if (c0 !== curMarked[0] || c1 !== curMarked[1]) {
      curMarked = [c0, c1];
      svgEl.querySelectorAll('.sp-seg').forEach((g) => { const i = +g.dataset.i; g.classList.toggle('cur', i >= c0 && i < c1); });
      svgEl.querySelectorAll('.sp-mass').forEach((g) => g.classList.toggle('cur', +g.dataset.mass === st.t));
    }
    svgEl.querySelectorAll('.sp-seg.sel, .sp-dot.sel').forEach((g) => g.classList.remove('sel'));
    if (st.sel.seg != null) svgEl.querySelectorAll(`.sp-seg[data-i="${st.sel.seg}"]`).forEach((g) => g.classList.add('sel'));
    if (st.sel.i != null) svgEl.querySelector(`.sp-dot[data-i="${st.sel.i}"]`)?.classList.add('sel');
  }

  // the side circle: the notes folded into one octave; the scale on its ring (a selected step has no dot there: the
  // user, 2026-11-20)
  function renderClock(ns) {
    if (S.sideWait(renderClock)) return;
    ns = ns || notes();
    // every note; S.clock draws one dot to a pitch, the first dot of it, or the selected one (the 1/1 the comma brings
    // back is dot 0's until dot 13 is selected)
    const points = [], longs = longScale();
    ns.forEach((x, i) => points.push({ cents: x.fc, cls: x.cls, sel: st.sel.i === i, attrs: `data-i="${i}"${rAttr(x, longs)}` }));
    S.clock(clockEl, { points, rimSel: st.sel.rim });
  }

  /* ---- sound ---- */
  // a note with data-r lights wherever it shows through S.markScale, as every note; a long ratio's dots have none (its
  // key is made only when asked for, too slow for 600 of them), so only those are switched by hand
  function hotDot(i, on) {
    const x = notes()[i];
    if (!x) return;
    if (on && hidDot(i)) dotOver(i);   // a note inside a mass: its dot while it sounds
    if (rAttr(x, longScale())) S.markScale([x.str], on);
    else {
      svgEl.querySelector(`.sp-dot[data-i="${i}"]`)?.classList.toggle('hot', on);
      clockEl.querySelector(`.clock-dot[data-i="${i}"]`)?.classList.toggle('hot', on);
    }
    if (!on) markOverlays();
  }
  function soundDot(i) {
    const voice = S.audio.tone(freqOf(notes()[i].c));
    hotDot(i, true);
    return () => { voice.stop(); hotDot(i, false); };
  }
  // a step: its two ends together, the lower folded into the octave above the 1/1
  function soundSeg(i) {
    const ns = notes(), a = ns[i].c, b = ns[i + 1].c, f0 = freqOf(Math.min(a, b));
    const ch = S.audio.chord([f0, f0 * 2 ** (Math.abs(b - a) / 1200)]);
    overlay(i, true)?.classList.add('hot'); hotDot(i, true); hotDot(i + 1, true);   // a step of a mass: drawn while it sounds
    return () => { ch.stop(); svgEl.querySelector(`.sp-seg[data-i="${i}"]`)?.classList.remove('hot'); markOverlays(); hotDot(i, false); hotDot(i + 1, false); };
  }
  // a run (S.run) of [cents, dot] pairs: each dot lights while its note sounds
  const RUNS = ['[data-act="path"]', '[data-act="sscale"]'];
  const run = (sel, order) => S.run(sel, S.climb(order.map(([c]) => c)), (k) => { const i = order[k][1]; hotDot(i, true); return () => hotDot(i, false); });
  // the notes in the order the path reaches them
  const playPath = () => run(RUNS[0], notes().map((x, i) => [x.c, i]));
  // the notes in pitch order, each once, up to the octave (the last, 1200, stays above: freqOf would fold it onto the 1/1)
  const playScale = () => run(RUNS[1], S.pitchOrder(notes().map((x) => x.c)));

  return {
    title: 'Spiral',
    mount,
    // Enter plays the selected note (the chosen run's end by default), step, or the note picked on the rim
    playSel() {
      if (st.sel.rim != null) return st.sel.rim ? S.playNote(st.sel.rim) : null;
      if (st.sel.seg != null) return soundSeg(st.sel.seg);
      const n = steps();
      return soundDot(Math.min(st.sel.i ?? n, n));
    },
    MAXP, MAXN,
    path: () => st.path,
    // a preset's runs (the Spiral tab's menu)
    setPath(runs) {
      st.path = runs; st.t = null; st.sel = { i: steps() };   // its end, as an edit selects (i: null lit no dot, though the readout showed the end)
      save();
      if (el) render(true);
    },
    onHide: () => S.stopRun(...RUNS),
    // arrows walk along the path (or the rim); Backspace removes the chosen run
    onKeyDown(code) {
      if (code === 'Backspace') { if (st.path[st.t]) removeRun(st.t); return true; }
      const d = S.ARROWS[code];
      if (!d) return false;
      if (st.sel.rim != null) return S.rimStep(st.sel.rim, d);
      // from a step, its ends are a move away: → its upper, ← its lower
      const n = steps() + 1, from = st.sel.seg != null ? st.sel.seg + (d > 0 ? 1 : 0) - d : st.sel.i ?? n - 1, i = S.mod(from + d, n);
      select(i);
      S.click(() => soundDot(i));
      return true;
    },
  };
})();
