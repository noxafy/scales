'use strict';
// Spiral: put intervals together and see where they go. The path is a row of runs (count × interval, up or
// down; an interval is a ratio, cents or k\N); the chosen run's count and direction are edited in its chip, its interval with the picker below the row; the path is drawn on the pitch spiral: the angle is the place in the octave (as on every circle),
// the radius grows one turn per octave, so the end shows both where in the octave the stack lands and how
// many octaves it climbed, and how near it comes back to the 1/1. Nothing is decided ahead (no step count,
// no octaves). The Spiral tab's one view (tabs.js).
S.parts.spiral = (() => {
  const MAXN = 999, MAXP = 9999;   // steps in a run, in the whole path (the user: 9999 steps may take 200 ms to draw)
  // the path: runs {t: as typed, down, n}; t: the chosen run (null: "+" waits, the next interval picked adds a run); at: what is selected here, a note (index into the notes,
  // 0 = the 1/1), a step (seg: index into the steps) or rim: true, the selected note
  // (S.shownNote) none of its notes, picked on the rim or in the list, or selected elsewhere and not on the path
  const st = { path: [], t: 0, at: { i: null } };
  const steps = () => st.path.reduce((a, p) => a + p.n, 0);
  // an interval's text parsed once: a path of 9999 runs has a handful of texts, and a press parsed each run's twice. The
  // memos hold every text a path can have (at 1000 a path of 9999 different ones cleared them on every press, 110 ms)
  const MEMO = 2 * MAXP;
  const stepMemo = new Map();
  // a step's text: a ratio, cents, k\N, or a ratio with a tempered part (8/5+1\6: m, S.parseMixStep)
  const parseIv = (t) => S.parseStep(t) || S.parseMixStep(t);
  const step = (t) => {
    let x = stepMemo.get(t);
    if (x === undefined) { if (stepMemo.size > MEMO) stepMemo.clear(); x = parseIv(t); stepMemo.set(t, x); }
    return x;
  };
  // a run's interval as kept: a size, never below the 1/1, the arrow its direction (the user, 2026-11-22: one sign, not
  // two; ↓ 3/2 and ↑ 2/3 had been two chips, and a step of 1/3 sounded its upper tone 1902¢ under its lower). A descending
  // interval as typed (1/3, −700, a minus before anything: −7\12, −3/2) is its inverse with the arrow turned; {t, flip},
  // null if it reads as none. A zero step (1/1, 0, 0\N, with a minus too) has no direction and turns nothing
  const upright = (txt) => {
    let t = String(txt).trim(), flip = false;
    if (/^[-−]/.test(t)) { t = t.slice(1); flip = true; }
    let s = parseIv(t);
    if (!s) return null;
    if (s.c < 0) {
      const r = s.r && S.qMul({}, s.r, -1);
      s = s.m ? S.parseMixStep(`${S.qText(r)}${s.m.c > 0 ? '-' : '+'}${s.m.edo ? `${Math.abs(s.m.edo[0])}\\${s.m.edo[1]}` : S.roundC(Math.abs(s.m.c))}`)
        : r ? S.parseStep(S.qText(r)) : S.parseStep(String(-s.c));
      if (!s) return null;
      flip = !flip;
    }
    return { t: s.t, flip: flip && s.c !== 0 };
  };
  // a run as kept (a stored one, a link's, a preset's): upright, or null
  const uprightRun = (p) => { const u = p && upright(p.t); return u && { ...p, t: u.t, down: !!p.down !== u.flip }; };
  let stored = false, edit;
  try {
    const o = JSON.parse(localStorage.getItem('scales.spiral') || 'null');
    if (o && Array.isArray(o.path)) {
      for (const q of o.path) {
        const p = uprightRun(q);
        if (!p) continue;
        const n = Math.min(Math.max(1, Math.round(+p.n || 1)), MAXN, MAXP - steps());
        if (n < 1) break;
        st.path.push({ t: p.t, down: !!p.down, n });
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
  // sizes, as the runs are (upright)
  try { const t = JSON.parse(localStorage.getItem('scales.spiralTyped') || '[]'); if (Array.isArray(t)) typed = [...new Set(t.map((x) => upright(x)?.t).filter(Boolean))]; } catch (e) {}
  const keepTyped = (t) => {
    typed = [...typed.filter((x) => x !== t), t].slice(-12);
    try { localStorage.setItem('scales.spiralTyped', JSON.stringify(typed)); } catch (e) {}
  };

  let el, svgEl, clockEl, headEl, fitHead, runsEl, typeIn, picker, runDrag = null;

  // a note of the path. c: cents above the 1/1 (not folded), fc folded; str: its key, made when first asked for
  // (S.ratioOfMonzo, from its prime exponents e); short: its key is n/d (S.Q_DIGITS), else powers
  // a step's tempered part: a ratio with one its m, else the step itself
  const tempOf = (s) => s.m || s;
  // a ratio with a tempered part as a step's text (S.parseMixStep reads it): 8/5+1\6, 3/2+42
  const mixText = (r) => `${r.rpart.str}+${r.tpart.edo ? `${r.tpart.edo[0]}\\${r.tpart.edo[1]}` : S.roundC(r.tpart.cents)}`;
  // mix: a note with ratio steps and others, its key (S.mixKey: the ratio part and the tempered part, each exact)
  function note(c, e, s, down, mix = null) {
    const x = { c, fc: S.fold(c), s, down };
    if (!e) {   // a step that isn't a ratio is in the stack: 12-TET's k\12 when it lands on one, else cents; with ratio steps, both
      x.str = mix || S.noteOfCents(c); x.cls = S.ratio(x.str).cls; x.short = true;
      return x;
    }
    let top = 2, dn = 0, dd = 0;
    for (const p in e) {
      if (+p > top) top = +p;
      if (p !== '2') { const l = e[p] * Math.log10(+p); if (l > 0) dn += l; else dd -= l; }
    }
    x.cls = S.primeClass(top);
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
    // a text that isn't a ratio as an exact fraction of the octave (S.tempFrac), for the tempered part of a note that has both
    const fracs = new Map();
    const fracOf = (t) => { if (!fracs.has(t)) { const x = tempOf(parsed.get(t)); fracs.set(t, S.tempFrac(x.edo ? S.edoKey(x.edo[0], x.edo[1]) : S.centsKey(x.c))); } return fracs.get(t); };
    let e = {}, eC = 0;
    for (const p of st.path) {
      const s = parsed.get(p.t), sign = p.down ? -1 : 1;
      for (let j = 0; j < p.n; j++) {
        if (s.r) { e = S.qMul(e, s.r, sign); eC = S.qCents(e); }   // a fresh object: each note keeps its own
        if (!s.r || s.m) count.set(p.t, (count.get(p.t) || 0) + sign);   // a ratio with a tempered part: both
        let c = eC, ratio = true;
        for (const [t, k] of count) { if (!k) continue; c += k * tempOf(parsed.get(t)).c; ratio = false; }
        let mix = null;
        if (!ratio && Object.keys(e).some((q) => q !== '2' && e[q])) {
          let n = 0n, d = 1n;
          for (const [t, k] of count) { if (!k) continue; const f = fracOf(t); n = n * f[1] + BigInt(k) * f[0] * d; d *= f[1]; }
          mix = S.mixKey(e, S.tempKey([n, d]));
        }
        out.push(note(c, ratio ? e : null, s, p.down, mix));
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
    el = root; clockEl = side.clock;
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
    fitHead = S.fitHead(headEl);
    runsEl = el.querySelector('[data-runs]');
    // the controls edit a run (the chosen one by default), which becomes the chosen one; its end note is selected
    edit = (f, r = st.t) => { const p = st.path[r]; if (!p) return; st.t = r; f(p); st.at = { i: endOf(r) }; save(); render(true); };
    // an interval: the chosen run's, or, while "+" waits, a new run of 1 up
    // a descending one (upright) turns the run's arrow: 2/3 into a ↓ run makes it ↑ 3/2
    const pickIv = (txt) => {
      const u = upright(txt);
      if (!u) return;
      const t = u.t;
      if (st.path[st.t]) { edit((p) => { p.t = t; if (u.flip) p.down = !p.down; }); return; }
      if (steps() >= MAXP) return;
      st.path.push({ t, down: u.flip, n: 1 });
      st.t = st.path.length - 1; st.at = { i: steps() }; save(); render(true);
    };
    // the intervals: the shared picker (its library under "+ more", 12-TET's k\12 there too); its field
    // also takes cents and k\N, and an interval no chip shows stays in it, lit
    const put = (txt) => {
      const s = upright(txt);
      typeIn.value = txt; typeIn.classList.toggle('bad', !s);
      if (s) pickIv(txt);
    };
    picker = S.ratioPicker(el.querySelector('[data-picker]'), {
      exclude: ['1/1'],
      et: true,
      groups: [...S.RATIO_GROUPS, { id: 'commas', label: 'Commas', list: S.COMMAS.slice(0, 8) }],   // the Cycle's eight: a stack's shortfall, as a step
      isOn: (str) => str === runKey(st.path[st.t]),
      steps: stepChips,
      onTyped: (t) => { const u = upright(t); if (u && !onTop(u.t)) keepTyped(u.t); },   // the size, as a chip
      // a cents note (a scale chip) steps by its cents, a ratio with a tempered part by both (8/5+1\6); a step chip (13\19,
      // 653.2) is its step text
      onPick: (str) => { const r = S.ratio(str); pickIv(!r ? str : r.mix ? mixText(r) : r.edo ? `${r.edo[0]}\\${r.edo[1]}` : r.temp ? String(r.cents) : str); },
      // its one spelling, a minus before it when it goes down (pickIv turns the arrow)
      parse: (t) => { const u = upright(t); return u ? `${u.flip ? '-' : ''}${u.t}` : null; },
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
      const x = e.target.closest('[data-x]'), r = e.target.closest('[data-run]') || e.target.closest('.run-x')?.parentElement.querySelector('[data-run]');   // its × too
      if (x) { removeRun(+x.dataset.x); return; }
      const dir = e.target.closest('[data-dir]');
      if (dir) { edit((p) => { p.down = !p.down; }, +dir.dataset.dir); return; }
      if (e.target.closest('[data-act="more"]')) {
        st.t = null; render(false, true);
        return;
      }
      if (r) { st.t = +r.dataset.run; st.at = { i: endOf(st.t) }; render(true, true); }
    });
    // a run dragged by its interval moves in the path (S.chipDrag, as Beats' tones); chosen as it lifts, its end selected
    runDrag = S.chipDrag(runsEl, {
      handle: '[data-run], .run-x',   // the × between count and arrow is part of the interval
      items: () => st.path,
      order: (list, u) => { st.path = list; st.t = list.indexOf(u); st.at = { i: endOf(st.t) }; save(); render(true); },
      // chosen as it lifts: only its marks move (the row stays as drawn, so the press goes on), its end selected
      onLift: (u) => { const r = st.path.indexOf(u); if (r < 0 || st.t === r) return; st.t = r; st.at = { i: endOf(r) }; render(true, true); },
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
      if (!t.classList.contains('sp-dot')) { st.t = runOf(i); st.at = { seg: i }; render(true, true); return soundSeg(i); }
      select(i);
      return soundDot(i);
    }, { takeTouch: true, id: (t, e) => (t.classList.contains('sp-dot') ? `dot ${t.dataset.i}` : `seg ${which(t, e)}`) });
    // pointed at, a mass lights the step under the pointer, not the whole run (the user, 2026-11-20): that step is
    // drawn on top (overlay) with class hov, which takes the steps' hover look at once (a new shape's :hover waits for
    // the next move). Overlays take no events, so every move asks the mass (stepAt: a few operations), and a step
    // changes at its own edge, as where steps are drawn one by one
    // Only a mouse with no button down points: a press lets go of it (the sounding step shows instead, and a glide
    // walks), and letting go points again at once (it had stayed on the first step pressed until the mouse moved)
    const pointAt = (e) => {
      const t = e.pointerType === 'mouse' && !e.buttons && e.target.closest && e.target.closest('.sp-mass');
      setHov(t ? stepAt(t, e) : null);
    };
    svgEl.addEventListener('pointermove', pointAt);
    svgEl.addEventListener('pointerup', pointAt);
    svgEl.addEventListener('pointerdown', () => setHov(null));
    svgEl.addEventListener('pointerleave', () => setHov(null));
    // a tap on the picture's background lets go of the selection, here and in every tab, and of the chosen run, so
    // none is faint (the user, 2026-11-20); "+" then waits, as with no run chosen
    S.bgTap(svgEl.closest('.panel'), '[data-head], .sp-dot, .sp-seg, .sp-mass', () => {
      st.t = null;
      S.emit('pick', null);
    });
    S.clockHold(clockEl, '[data-i]', (d) => {
      const i = +d.dataset.i, ns = notes();
      if (!(st.at.i != null && ns[st.at.i] && samePitch(ns[st.at.i], ns[i]))) select(i);   // its note already selected (dot 13's 1/1): it stays there
      return soundDot(i);
    }, true);
    const shown = S.whenShown(root);
    // a note picked on the rim, in the list, by a key or typed in stays a rim note, as in the Lattice, even where the
    // path reaches it (the arrows then walk the scale); one selected in another tab selects its dot, if the path has it
    S.on('pick', shown(pickRim));
    // a note selected elsewhere: its dot; an interval: nothing (S.shownNote)
    S.on('select', shown((str, src) => { if (src !== 'spiral') showNote(S.shownNote()); }));
    S.on('settings', shown(() => render()));
    S.on('scale', () => render());   // a note may now read as a scale ratio
    new ResizeObserver(() => renderSpiral()).observe(svgEl);
    // the note selected by now, as every view mounted later starts (a note the path doesn't reach: as a rim note); a
    // step selected here before a reload stays selected (kept)
    const own = S.sel.iv && S.sel.iv.src === 'spiral' && takeUp();
    if (!own) st.at = { i: steps() };
    render();
    if (!own) S.sel.rim ? pickRim() : showNote(S.shownNote());
  }

  function removeRun(r) {
    st.path.splice(r, 1);
    // the chosen one gone: the run before it is chosen, else "+" waits (as Beats' tones)
    if (st.t === r) st.t = r > 0 ? r - 1 : null;
    else if (st.t > r) st.t--;
    st.at = { i: st.t != null ? endOf(st.t) : steps() }; save(); render(true);
  }
  function select(i) { st.at = { i }; render(true, true); }
  // the selected note (S.shownNote, none too) is none of the path's notes: the circle shows it, the picture nothing
  function pickRim() { st.at = { rim: true }; render(false, true); }
  function showNote(str) {
    if (!str) { pickRim(); return; }   // nothing selected: a dash, as every view
    const ns = notes();
    for (let i = ns.length - 1; i >= 0; i--) if (isNote(ns[i], str)) { st.at = { i }; render(false, true); return; }
    pickRim();
  }
  // step i as the interval it sounds (S.sel's iv): its size, its lower tone and its ends' notes; its note is that size
  // above the 1/1 (S.stepNote). It starts where its first note sounds, in the octave above the 1/1, and goes its run's way
  // from there (the user, 2026-11-23: ↓ 3/2 from the 1/1 at 440 Hz is 440 and 293.33 Hz; both ends folded had made it
  // 586.67 and 880), so a step down lies partly below the 1/1
  const segIv = (ns, i) => ({ s: ns[i + 1].s, low: S.fold(ns[i].c) + Math.min(0, ns[i + 1].c - ns[i].c), ends: [ns[i].str, ns[i + 1].str], at: { seg: i } });
  // a step selected here before a reload (or before this view was first shown): that step again while it is still that
  // interval, else nothing is selected. On mount, after an opening link has set the path
  function takeUp() {
    const kept = S.sel.iv, ns = notes(), i = kept.at && kept.at.seg, now = Number.isInteger(i) && i >= 0 && i < ns.length - 1 && segIv(ns, i);
    if (now && S.sameIv(now, kept)) { st.at = { seg: i }; return true; }
    S.select(null, 'spiral');
    return false;
  }

  // sameNotes: only the selection moved, so the picture keeps its shapes (a redraw during a press takes the touch's target away)
  function render(own = false, sameNotes = false) {
    syncToScale();
    const ns = notes();
    if (st.at.i != null && st.at.i > ns.length - 1) st.at.i = ns.length - 1;
    if (st.at.seg != null && st.at.seg > ns.length - 2) st.at = { i: ns.length - 1 };
    if (sameNotes) { markSpiral(); markRuns(); } else { renderSpiral(ns); renderRuns(); }
    renderClock(ns);
    if (own && !st.at.rim) {
      const iv = st.at.seg != null ? segIv(ns, st.at.seg) : null;
      S.select(iv ? S.stepNote(iv.s) : (ns[Math.min(st.at.i ?? ns.length - 1, ns.length - 1)] || ns[0]).str, 'spiral', 0, iv);
    }
    // where it went: the chosen run's climb in cents, else the whole path's (the user, 2026-11-20: in place of it, not
    // beside it); a run's from its interval times its count, in one step
    const p = st.path[st.t], n = p ? p.n : ns.length - 1, end = p ? (p.down ? -p.n : p.n) * step(p.t).c : ns[ns.length - 1].c;
    headEl.innerHTML = S.headHTML(`${n} step${n === 1 ? '' : 's'}`, `<span class="has-tip" title="${S.exactC(end)}">${S.fmtC(end)}¢</span>`);
    fitHead();   // on a phone the cents go under the count (S.fitHead)
    if (S.parts.spiral.onEdit) S.parts.spiral.onEdit();
  }

  // the note a run's interval is as a chip (folded ratio or k\N key), to light its chip
  const keyMemo = new Map();
  const runKey = (p) => {
    if (!p) return null;
    if (!keyMemo.has(p.t)) { const s = step(p.t); if (keyMemo.size > MEMO) keyMemo.clear(); keyMemo.set(p.t, !s ? null : s.m ? S.mixKey(s.r, s.m.edo ? S.edoKey(s.m.edo[0], s.m.edo[1]) : S.centsKey(s.m.c)) : s.r ? S.qText(s.r) : s.edo ? S.edoKey(s.edo[0], s.edo[1]) : s.c > 0 && s.c < 1200 ? S.centsKey(s.c) : null); }
    return keyMemo.get(p.t);
  };
  // the interval a run takes, as its chip reads it
  const textMemo = new Map();
  const runText = (t) => ivText(t);   // a run's chip reads as its step chip
  const ivText = (t) => { if (!textMemo.has(t)) { if (textMemo.size > MEMO) textMemo.clear(); textMemo.set(t, S.ivText(step(t))); } return textMemo.get(t); };   // as every chip (S.ivText)
  const clsMemo = new Map();
  const ivCls = (t) => {
    if (!clsMemo.has(t)) { const s = step(t); clsMemo.set(t, s.r && !s.m ? S.ratio(S.qNote(s.r)).cls : 'pt'); }
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
      onTap: () => { if (st.t !== r) { st.t = r; st.at = { i: endOf(r) }; render(true, true); } return runsEl.querySelector(`.run-n[data-n="${r}"]`); },
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
    S.keepFocus(runsEl, () => { runsEl.innerHTML = st.path.map((p, r) => `<span class="chip tok sp-run ${ivCls(p.t)}${r === st.t ? ' on' : ''}${runDrag ? runDrag.cls(p) : ''}" data-chip="${S.chipKey(p)}"><span class="run-n-slot"></span><button class="run-x" tabindex="-1" aria-hidden="true">×</button><button class="run-dir" data-dir="${r}" aria-label="${p.down ? 'Down' : 'Up'}">${arr(p)}</button><button data-run="${r}">${S.breakHTML(S.labelHTML(runText(p.t)))}</button><button class="tok-x" data-x="${r}" aria-label="Remove ${S.esc(p.t)}"><svg viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1L7 7M7 1L1 7"/></svg></button></span>`).join('')
      + (steps() < MAXP ? `<button class="chip more add-tone${p ? '' : ' on'}" data-act="more" aria-label="Add a run"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1V9M1 5H9"/></svg></button>` : '');
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
  let hov = null;   // the step of a mass the mouse points at
  const ov = new Map();   // the steps of masses drawn on top: step → {g: its shape, u: its panel-coloured copy, or null}
  const hot = new Map();   // sounding steps: step → presses sounding it
  let raised = null;   // the run drawn after the others (the chosen one, as drawn)
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
    return `<g class="sp-seg ${ivCls(s.t)}${s.r ? '' : ' temp'}${i >= cur0 && i < cur1 ? ' cur' : ''}${st.at.seg === i ? ' sel' : ''}${extra}" data-i="${i}"><title>${ns[i + 1].down ? '↓' : '↑'} ${s.r && s.t.includes('*') ? S.fmtMonzo(s.r) : s.t}</title>`
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
    g.dotR = n > 40 ? 3.5 : n > 24 ? 5 : 7;
    // the chosen run is drawn after the others, so where a path comes back over itself the run looked at shows whole (a
    // faint tempered run's hollow centre cut through a chosen ratio's band, the user, 2026-11-20)
    let segs = '', top = '', dots = '';
    let mi = 0;
    const cur = curMarked = curSteps();
    for (let i = 0; i < n; i++) {
      if (masses[mi] && masses[mi][1] === i) {   // a run drawn as one shape, in its interval's colour
        const [r, i0, k] = masses[mi++], t = st.path[r].t;
        const m = `<g class="sp-mass ${ivCls(t)}${r === st.t ? ' cur' : ''}" data-mass="${r}" data-from="${i0}"><path class="sp-fill" d="${shapeOf(g, cs[i0], cs[i0 + k])}"/></g>`;
        if (r === st.t) top += m; else segs += m;
        i = i0 + k - 1;
        continue;
      }
      if (i >= cur[0] && i < cur[1]) top += segHTML(g, ns, i, '', cur); else segs += segHTML(g, ns, i, '', cur);
    }
    segs += top;
    const longs = longScale();
    ns.forEach((x, i) => { if (!hidDot(i, n)) dots += dotHTML(ns, i, longs); });
    // press areas and the sounding glow reach no further than the next turn
    const vars = `--sp-hit:${f1(S.clamp(dr, BAND, 20))}px;--glow-max:${f1(Math.max(BAND, 2 * dr - BAND))}px`;
    hov = null; ov.clear(); raised = st.path[st.t] ? st.t : null;   // a new drawing: the next move points again
    svgEl.innerHTML = `<svg class="spiral-svg${st.path.length > 1 && st.path[st.t] ? ' runs' : ''}" style="${vars}" viewBox="0 0 ${W} ${W}" role="img" aria-label="Spiral of the path">${s}${segs}<g class="sp-top"></g><g class="sp-dots">${dots}</g></svg>`;
    syncOverlays();
  }
  // a note's dot. A note inside a mass (every step beside it in one) has none, as its steps (a thousand dots there,
  // overlapping, showed only their dark edges: the user, 2026-11-20); it is drawn on top while it is selected, sounds,
  // or borders the selected or sounding step (syncOverlays)
  const hidDot = (i, n = notes().length - 1) => !!geo && (i === 0 || geo.inMass.has(i - 1)) && (i === n || geo.inMass.has(i));
  function dotHTML(ns, i, longs = longScale(), extra = '') {
    const x = ns[i], n = ns.length - 1, [cx, cy] = at(x.c, R0 + ((x.c - geo.lo) / 1200) * geo.dr);
    return `<circle class="sp-dot ${x.cls}${st.at.i === i ? ' sel' : ''}${extra}" data-i="${i}"${rAttr(x, longs)} cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${geo.dotR}"></circle>`;   // one size, the ends too (they were 1 larger, from the first version: the user, 2026-11-20)
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
  // What lies on top of the picture follows three pieces of state (the user, 2026-11-20: overlays added and taken away
  // by hand in four places disagreed; a hovered step stuck while dragging and after letting go): the selected step
  // (st.at.seg), the sounding ones (hot) and the one the mouse points at (hov). syncOverlays brings the picture to
  // them, touching only what differs, and is called wherever one of them changes. A step of a mass is drawn on its
  // own (class over) in the layer sp-top, between the runs and the dots, kept in ov by reference; pointed at, a
  // panel-coloured copy of it (sp-under) lies just under it, a shape of its own so it doesn't fade with a faint run's
  // step, which then reads as it does alone, not faint on faint. A step that stops sounding loses hot before it goes,
  // so its glow and sparks (clock.js puts them in the layer, under the step) fade out as everywhere. Classes are set
  // after a shape is made, since clock.js sparkles on class changes, not new shapes. Steps drawn one by one sound by
  // class. The hidden dots (hidDot) of the selected note and of the ends of the selected and sounding steps are drawn
  // on top too. Its cost is a few small queries: what costs is the browser laying out the picture again after any
  // change of shape (about 25 ms at 9000 steps, before this too).
  function syncOverlays() {
    const svg = svgEl.querySelector('svg'), layer = svg && svg.querySelector('.sp-top');
    if (!layer || !geo) return;
    const ns = notes();
    svg.querySelectorAll('.sp-seg.hot:not(.over)').forEach((g) => { if (!hot.has(+g.dataset.i)) g.classList.remove('hot'); });
    hot.forEach((_, i) => { if (!geo.inMass.has(i)) svg.querySelector(`.sp-seg[data-i="${i}"]:not(.over)`)?.classList.add('hot'); });
    const want = new Set([st.at.seg, hov, ...hot.keys()].filter((i) => i != null && geo.inMass.has(i) && ns[i + 1]));
    ov.forEach((o, i) => {
      if (want.has(i)) return;
      o.g.classList.remove('hot');
      o.g.remove(); o.u?.remove();
      ov.delete(i);
    });
    want.forEach((i) => {
      let o = ov.get(i);
      if (!o) {
        layer.insertAdjacentHTML('beforeend', segHTML(geo, ns, i, ' over'));
        ov.set(i, (o = { g: layer.lastElementChild, u: null }));
      }
      o.g.classList.toggle('sel', st.at.seg === i);
      o.g.classList.toggle('hov', hov === i);
      o.g.classList.toggle('hot', hot.has(i));
      if (hov === i && !o.u) {
        const p = o.g.querySelector('.sp-band, .sp-fill');
        o.u = p.cloneNode();
        o.u.setAttribute('class', p.classList.contains('sp-fill') ? 'sp-under fill' : 'sp-under');
        o.g.before(o.u);
      } else if (hov !== i && o.u) { o.u.remove(); o.u = null; }
    });
    const need = new Set([st.at.i, st.at.seg, st.at.seg != null ? st.at.seg + 1 : null]);
    hot.forEach((_, i) => { need.add(i); need.add(i + 1); });
    svg.querySelectorAll('.sp-dot.over').forEach((d) => { if (!need.has(+d.dataset.i) && !d.matches('.hot, .held')) d.remove(); });
    need.forEach((i) => { if (i != null && hidDot(i)) dotOver(i); });
  }
  const setHov = (i) => { if (i !== hov) { hov = i; syncOverlays(); } };
  function setHot(i, d) {
    const k = (hot.get(i) || 0) + d;
    if (k > 0) hot.set(i, k); else hot.delete(i);
    syncOverlays();
  }

  // The chosen run is drawn after the others, so where the path comes back over itself the run looked at shows whole
  // (a faint tempered run's hollow centre had cut through a chosen ratio's band, the user, 2026-11-20). The run drawn
  // there so far goes back to its place in the path, so with none chosen the path is drawn in its own order, whatever
  // was chosen before. Every other shape stays in path order, so one pass finds both runs and the place.
  function raise(r) {
    const svg = svgEl.querySelector('svg'), layer = svg && svg.querySelector('.sp-top');
    if (!layer || r === raised) return;
    const span = (q) => (q == null || !st.path[q] ? [0, 0] : [endOf(q) - st.path[q].n, endOf(q)]);
    const [a0, a1] = span(raised), [b0, b1] = span(r), back = [], up = [];
    let ref = layer;
    for (const g of svg.querySelectorAll('.sp-mass, .sp-seg:not(.over)')) {
      const i = +(g.dataset.from ?? g.dataset.i);
      if (i >= a0 && i < a1) back.push(g);
      else if (i >= b0 && i < b1) up.push(g);
      else if (ref === layer && i >= a1 && a1 > a0) ref = g;   // the first shape of a later run
    }
    const put = (gs, at) => { if (!gs.length) return; const f = document.createDocumentFragment(); gs.forEach((g) => f.appendChild(g)); at.before(f); };
    put(back, ref);
    put(up, layer);
    raised = r;
  }
  // the selection and the chosen run on the picture's shapes, as renderSpiral draws them
  function markSpiral() {
    svgEl.querySelector('svg')?.classList.toggle('runs', st.path.length > 1 && !!st.path[st.t]);
    // the chosen run's marks only when it changed, the selection's only where it was and is (every shape per press: 60 ms
    // for 9999 steps)
    const [c0, c1] = curSteps();
    if (c0 !== curMarked[0] || c1 !== curMarked[1]) {
      curMarked = [c0, c1];
      svgEl.querySelectorAll('.sp-seg').forEach((g) => { const i = +g.dataset.i; g.classList.toggle('cur', i >= c0 && i < c1); });
      svgEl.querySelectorAll('.sp-mass').forEach((g) => g.classList.toggle('cur', +g.dataset.mass === st.t));
      raise(st.path[st.t] ? st.t : null);
    }
    svgEl.querySelectorAll('.sp-seg.sel, .sp-dot.sel').forEach((g) => g.classList.remove('sel'));
    if (st.at.seg != null) svgEl.querySelectorAll(`.sp-seg[data-i="${st.at.seg}"]`).forEach((g) => g.classList.add('sel'));
    if (st.at.i != null) svgEl.querySelector(`.sp-dot[data-i="${st.at.i}"]`)?.classList.add('sel');
    syncOverlays();
  }

  // the side circle: the notes folded into one octave; the scale on its ring (a selected step has no dot there: the
  // user, 2026-11-20)
  function renderClock(ns) {
    if (S.sideWait(renderClock)) return;
    ns = ns || notes();
    // every note; S.clock draws one dot to a pitch, the first dot of it, or the selected one (the 1/1 the comma brings
    // back is dot 0's until dot 13 is selected)
    const points = [], longs = longScale();
    ns.forEach((x, i) => points.push({ cents: x.fc, cls: x.cls, sel: st.at.i === i, attrs: `data-i="${i}"${rAttr(x, longs)}` }));
    S.clock(clockEl, { points, rimSel: st.at.rim ? S.shownNote() : null });
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
    if (!on) syncOverlays();
  }
  function soundDot(i) {
    const voice = S.audio.tone(freqOf(notes()[i].c));
    hotDot(i, true);
    return () => { voice.stop(); hotDot(i, false); };
  }
  // a step: its two ends together, from its first in the octave above the 1/1 (segIv)
  function soundSeg(i) {
    const iv = segIv(notes(), i), ch = S.dyad(iv.low, iv.s.c);
    setHot(i, 1); hotDot(i, true); hotDot(i + 1, true);
    return () => { ch.stop(); setHot(i, -1); hotDot(i, false); hotDot(i + 1, false); };
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
      if (st.at.rim) return S.shownNote() ? S.playNote(S.shownNote()) : null;
      if (st.at.seg != null) return soundSeg(st.at.seg);
      const n = steps();
      return soundDot(Math.min(st.at.i ?? n, n));
    },
    MAXP, MAXN,
    uprightRun,   // a run as kept (a link's, the Custom slot's): its interval a size, the arrow its direction; null if none
    path: () => st.path,
    // a preset's runs (the Spiral tab's menu)
    setPath(runs) {
      st.path = runs.map(uprightRun).filter(Boolean); st.t = null; st.at = { i: steps() };   // its end, as an edit selects (i: null lit no dot, though the readout showed the end)
      save();
      if (el) render(true);
    },
    onHide: () => S.stopRun(...RUNS),
    // arrows walk along the path (or the rim)
    onKeyDown(code) {
      const d = S.ARROWS[code];
      if (!d) return false;
      if (st.at.rim) return S.rimStep(S.shownNote(), d);
      // from a step, its ends are a move away: → its upper, ← its lower
      const n = steps() + 1, from = st.at.seg != null ? st.at.seg + (d > 0 ? 1 : 0) - d : st.at.i ?? n - 1, i = S.mod(from + d, n);
      select(i);
      S.click(() => soundDot(i));
      return true;
    },
  };
})();
