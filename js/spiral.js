'use strict';
// Spiral: put intervals together and see where they go. The path is a row of runs (count × interval, up or
// down; an interval is a ratio, cents or k\N); the chosen run's count and direction are edited in its chip, its interval with the picker below the row; the path is drawn on the pitch spiral: the angle is the place in the octave (as on every circle),
// the radius grows one turn per octave, so the end shows both where in the octave the stack lands and how
// many octaves it climbed, and how near it comes back to the 1/1. Nothing is decided ahead (no step count,
// no octaves). A sub-view of the Temperament tab.
S.parts.spiral = (() => {
  const MAXN = 999, MAXP = 9999;   // steps in a run, in the whole path (the user: 9999 steps may take 200 ms to draw)
  // the path: runs {t: as typed, down, n}; t: the chosen run (null: "+" waits, the next interval picked adds a run); sel: the selected note (index into the notes,
  // 0 = the 1/1), a step (seg: index into the steps) or a note picked on the rim or in the list (rim)
  const st = { path: [], t: 0, sel: { i: null }, arp: null };
  const steps = () => st.path.reduce((a, p) => a + p.n, 0);
  // an interval's text parsed once: a path of 9999 runs has a handful of texts, and a press parsed each run's twice
  const stepMemo = new Map();
  const step = (t) => {
    let x = stepMemo.get(t);
    if (x === undefined) { if (stepMemo.size > 1000) stepMemo.clear(); x = S.parseStep(t); stepMemo.set(t, x); }
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
  // the notes the path reaches, made again only when the path changes. Each note's cents come afresh from how many
  // of each step lie below it (never summed along); its ratio from its prime exponents, so a step costs the same
  // however far the path has climbed
  let memo = null;
  function notes() {
    const sig = JSON.stringify(st.path);
    if (memo && memo.sig === sig) return memo.ns;
    const parsed = new Map(st.path.map((p) => [p.t, step(p.t)]));
    const out = [note(0, {}, null, false)], count = new Map();
    let e = {};
    for (const p of st.path) {
      const s = parsed.get(p.t), sign = p.down ? -1 : 1;
      for (let j = 0; j < p.n; j++) {
        count.set(p.t, (count.get(p.t) || 0) + sign);
        let c = 0, ratio = true;
        for (const [t, k] of count) { if (!k) continue; c += k * parsed.get(t).c; if (!parsed.get(t).r) ratio = false; }
        if (s.r) e = S.qMul(e, s.r, sign);   // a fresh object: each note keeps its own
        out.push(note(c, ratio ? e : null, s, p.down));
      }
    }
    return (memo = { sig, ns: out }).ns;
  }
  // one pitch (S.EXACT decides, as everywhere), the keys compared only when the pitches agree
  const samePitch = (a, b) => Math.abs(a.fc - b.fc) < S.EXACT || Math.abs(Math.abs(a.fc - b.fc) - 1200) < S.EXACT;
  const isNote = (x, str) => { const r = S.ratio(str); return !!r && samePitch(x, { fc: S.fold(r.cents) }) && x.str === str; };
  // a dot's data-r: its key when short, and a long one only when the scale holds it (so it lights with the scale)
  const longScale = () => S.scale.filter((k) => k.includes('*'));
  const rAttr = (x, longs) => (x.short || longs.some((k) => isNote(x, k)) ? ` data-r="${x.str}"` : '');
  const freqOf = (c) => S.baseFreq() * 2 ** (S.fold(c) / 1200);   // every note sounds in the octave above the 1/1

  function mount(root, side) {
    el = root; clockEl = side.clock; readEl = side.read;
    el.innerHTML = `
      <div class="toolbar sp-runs" data-runs></div>
      <div class="sp-pick" data-picker></div>
      <div class="panel">
        <div class="toolbar chart-head">
          <span class="mono" data-head></span>
          <span class="head-btns"><button class="btn quiet" data-act="path"><span class="ico seq"></span>Path</button><button class="btn quiet" data-act="sscale"><span class="ico seq"></span>Scale</button></span>
        </div>
        <div data-svg></div>
      </div>`;
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
      onPick: (str) => { const r = S.ratio(str); pickIv(r.edo ? `${r.edo[0]}\\${r.edo[1]}` : r.temp ? String(r.cents) : str); },   // a cents note (a scale chip) steps by its cents
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
    S.seqBtn(el.querySelector('[data-act="path"]'), playPath);
    S.seqBtn(el.querySelector('[data-act="sscale"]'), playScale);

    // a dot plays its note; a segment its two ends together; glide across them
    S.holdOn(svgEl, '.sp-dot, .sp-seg', (t) => {
      const i = +t.dataset.i;
      if (t.classList.contains('sp-seg')) { st.t = runOf(i); st.sel = { seg: i }; render(true, true); return soundSeg(i); }
      select(i);
      return soundDot(i);
    }, { takeTouch: true });
    S.clockHold(clockEl, '[data-i], [data-iv]', (d) => {
      if (d.dataset.iv) return soundIv(d);   // the selected step's dot: its note, the selection stays
      const i = +d.dataset.i, ns = notes();
      if (!(st.sel.i != null && ns[st.sel.i] && samePitch(ns[st.sel.i], ns[i]))) select(i);   // its note already selected (dot 13's 1/1): it stays there
      return soundDot(i);
    }, pickRim);
    const shown = S.whenShown(root);
    // a note picked on the rim, in the list, by a key or typed in stays a rim note, as in Just intonation, even where the
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
    if (!keyMemo.has(p.t)) { const s = step(p.t); if (keyMemo.size > 1000) keyMemo.clear(); keyMemo.set(p.t, !s ? null : s.r ? S.qText(s.r) : s.edo ? S.edoKey(s.edo[0], s.edo[1]) : s.c > 0 && s.c < 1200 ? S.centsKey(s.c) : null); }
    return keyMemo.get(p.t);
  };
  // the interval a run takes, as its chip reads it
  const textMemo = new Map();
  const ivText = (t) => { if (!textMemo.has(t)) { const s = step(t); if (textMemo.size > 1000) textMemo.clear(); textMemo.set(t, s.r ? S.fmtRatio(null, 4, s.r) : s.edo ? s.t : `${S.fmtC(s.c)}¢`); } return textMemo.get(t); };   // 3¹² / 2¹⁹, as the Cycle's labels
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
      out.push({ key: s.t, c: s.c, cls: ivCls(s.t), on: s.t === cur, html: S.breakHTML(S.labelHTML(ivText(s.t))), title: S.stepTip(s, ivText(s.t)) });
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
    S.keepFocus(runsEl, () => { runsEl.innerHTML = st.path.map((p, r) => `<span class="chip tok sp-run ${ivCls(p.t)}${r === st.t ? ' on' : ''}"><span class="run-n-slot"></span><span class="run-x">×</span><button class="run-dir" data-dir="${r}" aria-label="${p.down ? 'Down' : 'Up'}">${arr(p)}</button><button data-run="${r}">${S.breakHTML(S.labelHTML(ivText(p.t)))}</button><button class="tok-x" data-x="${r}" aria-label="remove"><svg viewBox="0 0 8 8"><path d="M1 1L7 7M7 1L1 7"/></svg></button></span>`).join('')
      + (steps() < MAXP ? `<button class="chip more add-tone${p ? '' : ' on'}" data-act="more" aria-label="Add a run"><svg viewBox="0 0 10 10"><path d="M5 1V9M1 5H9"/></svg></button>` : '');
    runsEl.querySelectorAll('.run-n-slot').forEach((slot, r) => slot.replaceWith(countIn(r))); });
  }

  // the picture: the pitch spiral from the lowest octave the path touches to the highest; spokes at the 12
  // 12-TET steps, named outside; the path along the spiral, each step in its interval's colour
  function renderSpiral(ns = notes()) {
    const W = 480, C = W / 2, R0 = 34, RM = 196;
    const cs = ns.map((x) => x.c);
    const lo = 1200 * Math.floor(Math.min(...cs) / 1200 + 1e-9), hi = Math.max(lo + 1200, 1200 * Math.ceil(Math.max(...cs) / 1200 - 1e-9));
    const dr = (RM - R0) / ((hi - lo) / 1200);
    const P = (c) => { const a = (c / 1200) * 2 * Math.PI, r = R0 + ((c - lo) / 1200) * dr; return [C + r * Math.sin(a), C - r * Math.cos(a)]; };
    // points close enough that no chord strays more than tol from the curve (its sagitta r·θ²/8; 0.1 unit, at most 30¢
    // apart); a drawing that would need more than PTS points loosens tol to fit, up to half a unit. Where turns lie
    // under half a unit apart, the 4-wide bands bury every turn but the first and last under eight others, so those
    // between take chords up to 2 units off (999 fifths, 584 turns: about 20 ms in all, not 50)
    const PTS = 15000, cmin = Math.min(...cs), cmax = Math.max(...cs);
    const span = (cmin - lo) + (hi - cmax) + cs.reduce((a, c, i) => a + (i ? Math.abs(c - cs[i - 1]) : 0), 0);
    const stepOf = (r, t) => Math.min(t < 2 ? 30 : 120, (1200 / (2 * Math.PI)) * Math.sqrt((8 * t) / r));   // buried turns: no cap
    const tol = S.clamp(0.1 * (span / stepOf((R0 + RM) / 2, 0.1) / PTS) ** 2, 0.1, 0.5);
    const dense = dr < 0.5, f1 = (v) => Math.round(v * 10) / 10;
    const stepAt = (c) => stepOf(R0 + ((c - lo) / 1200) * dr, dense && c - lo > 1200 && hi - c > 1200 ? 2 : tol);
    const line = (c0, c1) => {
      const up = c1 >= c0;
      let [x, y] = P(c0), d = `M${f1(x)} ${f1(y)}`;
      for (let c = c0; ;) {
        const h = stepAt(c);
        c = up ? Math.min(c1, c + h) : Math.max(c1, c - h);
        [x, y] = P(c); d += `L${f1(x)} ${f1(y)}`;
        if (c === c1) return d;
      }
    };
    let g = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI, sx = Math.sin(a), cy = -Math.cos(a);
      g += `<line class="sp-spoke${i ? '' : ' one'}" x1="${C + R0 * 0.6 * sx}" y1="${C + R0 * 0.6 * cy}" x2="${C + RM * sx}" y2="${C + RM * cy}"/>`;
      g += `<text class="sp-name" x="${C + (RM + 20) * sx}" y="${C + (RM + 20) * cy}" dy="${S.DY_SANS}">${S.midiName(S.settings.base + i).replace(/-?\d+$/, '')}</text>`;
    }
    // the guide only where the path isn't: its bands cover it everywhere between the lowest and highest note
    g += `<path class="sp-guide" d="${cmin > lo ? line(lo, cmin) : ''}${cmax < hi ? line(cmax, hi) : ''}"/>`;
    const n = ns.length - 1, dotR = n > 60 ? 3.5 : n > 24 ? 5 : 7;
    let segs = '', dots = '';
    const [cur0, cur1] = curSteps();
    for (let i = 0; i < n; i++) {
      const s = ns[i + 1].s, cls = ivCls(s.t), d = line(ns[i].c, ns[i + 1].c);
      segs += `<g class="sp-seg ${cls}${s.r ? '' : ' temp'}${i >= cur0 && i < cur1 ? ' cur' : ''}${st.sel.seg === i ? ' sel' : ''}" data-i="${i}"><title>${ns[i + 1].down ? '↓' : '↑'} ${s.r && s.t.includes('*') ? S.fmtMonzo(s.r) : s.t}</title><path class="sp-band" d="${d}"/>${s.r ? '' : `<path class="sp-in" d="${d}"/>`}${dense ? '' : `<path class="sp-hit" d="${d}"/>`}</g>`;   // dense: the bands cover the disc and take the presses themselves   // the hollow centre only for a tempered step (a ratio's draws nothing)
    }
    const longs = longScale();
    ns.forEach((x, i) => {
      const [cx, cy] = P(x.c);
      dots += `<circle class="sp-dot ${x.cls}${st.sel.i === i ? ' sel' : ''}${i === n ? ' end' : ''}" data-i="${i}"${rAttr(x, longs)} cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${i === 0 || i === n ? dotR + 1 : dotR}"></circle>`;
    });
    svgEl.innerHTML = `<svg class="spiral-svg${st.path.length > 1 && st.path[st.t] ? ' runs' : ''}${dense ? ' dense' : ''}" viewBox="0 0 ${W} ${W}" role="img" aria-label="Spiral of the path">${g}${segs}${dots}</svg>`;
  }

  // the selection and the chosen run on the picture's shapes, as renderSpiral draws them
  function markSpiral() {
    svgEl.querySelector('svg')?.classList.toggle('runs', st.path.length > 1 && !!st.path[st.t]);
    const [c0, c1] = curSteps();
    svgEl.querySelectorAll('.sp-seg').forEach((g) => {
      const i = +g.dataset.i;
      g.classList.toggle('cur', i >= c0 && i < c1);
      g.classList.toggle('sel', st.sel.seg === i);
    });
    svgEl.querySelectorAll('.sp-dot').forEach((d) => d.classList.toggle('sel', st.sel.i === +d.dataset.i));
  }

  // the side circle: the notes folded into one octave, faint; the scale on its rim; a selected step as a
  // dot of its own, at its size above the 1/1
  function renderClock(ns) {
    if (S.sideWait(renderClock)) return;
    ns = ns || notes();
    // each note once, at its first dot; selected when any dot of it is (the 1/1 the comma brings back is dot 0's)
    const points = [], sel = st.sel.i != null ? ns[st.sel.i] : null, longs = longScale();
    S.pitchOrder(ns.map((x) => x.c)).slice(0, -1).forEach(([, i]) => {
      const x = ns[i];
      points.push({ cents: x.fc, rf: 0.8, r: ns.length > 40 ? 4 : 6, cls: x.cls + (sel && samePitch(x, sel) ? ' sel' : ''), attrs: `data-i="${i}"${rAttr(x, longs)}`, spoke: true });
    });
    if (st.sel.seg != null) {
      const str = segNote(ns, st.sel.seg), r = S.ratio(str);
      points.push({ cents: S.fold(r.cents), rf: 0.8, r: 6, cls: r.cls + ' sel', attrs: `data-iv="${st.sel.seg}" data-r="${str}"`, spoke: true });
    }
    S.clock(clockEl, { size: 320, points, rimSel: st.sel.rim });
  }

  /* ---- sound ---- */
  function hotDot(i, on) {
    const d = svgEl.querySelector(`.sp-dot[data-i="${i}"]`);
    d?.classList.toggle('hot', on);
    clockEl.querySelector(`.clock-dot[data-i="${i}"]`)?.classList.toggle('hot', on);
    if (d) S.scaleHot([notes()[i].str], on);
  }
  function soundDot(i) {
    const voice = S.audio.tone(freqOf(notes()[i].c));
    hotDot(i, true);
    return () => { voice.stop(); hotDot(i, false); };
  }
  const hotIv = (i, on) => clockEl.querySelector(`.clock-dot[data-iv="${i}"]`)?.classList.toggle('hot', on);
  // the selected step's dot plays its note
  function soundIv(d) {
    const voice = S.audio.tone(freqOf(S.ratio(d.dataset.r).cents)), i = d.dataset.iv;
    hotIv(i, true);
    return () => { voice.stop(); hotIv(i, false); };
  }
  // a step: its two ends together, the lower folded into the octave above the 1/1
  function soundSeg(i) {
    const ns = notes(), a = ns[i].c, b = ns[i + 1].c, f0 = freqOf(Math.min(a, b));
    const ch = S.audio.chord([f0, f0 * 2 ** (Math.abs(b - a) / 1200)]);
    // the step's own dot on the circle lights only when heard: when its note is one of the two ends (2/1 is 1/1 there)
    const pc = (str) => (str === '2/1' ? '1/1' : str);
    const iv = clockEl.querySelector(`.clock-dot[data-iv="${i}"]`)?.dataset.r;
    const heard = !!iv && [ns[i], ns[i + 1]].some((x) => isNote(x, pc(iv)));
    svgEl.querySelector(`.sp-seg[data-i="${i}"]`)?.classList.add('hot'); hotDot(i, true); hotDot(i + 1, true); if (heard) hotIv(i, true);
    return () => { ch.stop(); svgEl.querySelector(`.sp-seg[data-i="${i}"]`)?.classList.remove('hot'); hotDot(i, false); hotDot(i + 1, false); if (heard) hotIv(i, false); };
  }
  // the button of the run that sounds looks held (S.seqBtn), the other not; none once it ends or stops
  const seqLit = (act) => document.querySelectorAll('[data-act="path"], [data-act="sscale"]').forEach((b) => b.classList.toggle('held', b.dataset.act === act));
  function run(order, fs = order.map(([c]) => freqOf(c)), act) {
    if (st.arp) { st.arp(); return; }
    const ns = notes();
    let last = -1;
    st.arp = S.audio.sequence(fs, {
      ...S.seqPace(order.length),
      onStep: (k) => {
        if (last >= 0) hotDot(last, false);
        if (k < 0 || k >= order.length) { last = -1; if (k < 0) { st.arp = null; seqLit(null); } return; }
        last = order[k][1]; hotDot(last, true);
      },
    });
    seqLit(act);
    return ns;
  }
  // the notes in the order the path reaches them
  const playPath = () => { const ns = notes(); return run(ns.map((x, i) => [x.c, i]), S.climb(ns.map((x) => x.c)), 'path'); };
  // the notes in pitch order, each once, up to the octave
  function playScale() {
    const ord = S.pitchOrder(notes().map((x) => x.c));
    run(ord, S.climb(ord.map(([c]) => c)), 'sscale');   // the last, 1200, stays above: freqOf would fold it onto the 1/1
  }

  return {
    title: 'Spiral',
    mount,
    // Enter plays the selected note (the chosen run's end by default), step, or the note picked on the rim
    playSel() {
      if (st.sel.rim != null) return S.playNote(st.sel.rim);
      if (st.sel.seg != null) return soundSeg(st.sel.seg);
      const n = steps();
      return soundDot(Math.min(st.sel.i ?? n, n));
    },
    MAXP, MAXN,
    path: () => st.path,
    // a preset's runs (the Temperament tab's menu)
    setPath(runs) {
      st.path = runs; st.t = null; st.sel = { i: steps() };   // its end, as an edit selects (i: null lit no dot, though the readout showed the end)
      save();
      if (el) render(true);
    },
    onHide: () => { if (st.arp) st.arp(); },
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
