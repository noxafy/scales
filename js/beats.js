'use strict';
// Tones against each other: hear and see beating partials, scrub the dissonance curve.
// A row of tones (the 1/1 at first), one of them active: the chips, the curve and the nudges move it.
// Lives inside the Harmonics tab and sounds with the spectrum painted there.
S.parts.beats = (() => {
  const WINDOWS = [0.1, 0.5, 2];
  const CMAX = 1200;   // one octave, 1/1 to 2/1, as everywhere: past it the circle and the names would fold
  // the step buttons and the keys that do the same
  const NUDGES = [[-10, 'Shift+←'], [-1, '←'], [-0.1, 'Alt+←'], [0.1, 'Alt+→'], [1, '→'], [10, 'Shift+→']];
  // "+ more": every dip the curve labels for some spectrum preset (each shape at 8 or 16 partials,
  // 1/1 at C3, C4 or C5), apart from the everyday chips.
  const DIPS = [
    { label: '3', list: ['16/9'] },
    { label: '5', list: ['10/9', '9/5'] },
    { label: '7', list: ['8/7', '7/6', '9/7', '10/7', '12/7'] },
    { label: '11', list: ['12/11', '11/10', '11/9', '14/11', '15/11', '11/8', '16/11', '11/7', '11/6'] },
    { label: '13', list: ['14/13', '13/12', '15/13', '13/11', '16/13', '13/10', '13/9', '13/8', '13/7'] },
  ];
  // tones: { c: cents above the 1/1, str: its ratio when it has one }, in the order added; act: the one
  // the chips, the curve and the nudges move (null: "+" is waiting, and the next of those adds a tone).
  // The first is always the 1/1 (root): it never moves and can't be removed, only muted (mute1)
  const MAXT = 12;   // room for a wide jazz chord
  const ONE = () => [{ c: 0, str: '1/1', root: true }];
  const st = { tones: ONE(), act: null, mute1: false, scrub: null, press: null, snap: true, win: 0.5, curve: null, keys: [], fromKeys: false };
  // the tones, the active one and the 1/1's mute are kept across reloads (scales.beats), as the scale is
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem('scales.beats') || 'null');
      if (!v || !Array.isArray(v.tones)) return;
      const ts = v.tones.filter((t) => t && Number.isFinite(t.c) && t.c >= 0 && t.c <= CMAX && (t.str == null || S.ratio(t.str)))
        .slice(0, MAXT - 1).map((t) => t.from && S.ratio(t.from) && Number.isInteger(t.off)
          ? { c: S.ratio(t.from).cents + t.off / 10, str: null, root: false, from: t.from, off: t.off }   // as nudgeAct makes it
          : { c: t.str ? S.ratio(t.str).cents : t.c, str: t.str ?? null, root: false });
      st.tones = [...ONE(), ...ts];
      st.act = Number.isInteger(v.act) && v.act > 0 ? st.tones[v.act] || null : null;
      st.mute1 = !!v.mute1;
    } catch (e) {}
  }
  let saveTimer = null;
  function store() {
    clearTimeout(saveTimer); saveTimer = null;
    const tones = st.tones.slice(1).map((t) => ({ c: t.c, str: t.str, from: t.from, off: t.off }));
    try { localStorage.setItem('scales.beats', JSON.stringify({ tones, act: st.tones.indexOf(st.act), mute1: st.mute1 })); } catch (e) {}
  }
  // at most every 200 ms while a tone moves; a reload in between still keeps the last one
  function save() { if (!saveTimer) saveTimer = setTimeout(store, 200); }
  window.addEventListener('pagehide', () => { if (saveTimer) store(); });
  load();
  let el, playBtn, rowEl, readEl, curveEl, waveEl, clockEl, beatsEl, picker;

  const fOf = (t) => S.baseFreq() * 2 ** (t.c / 1200);
  // what sounds and counts (sound, curve, signal, pairs): every tone but a muted 1/1
  const heard = () => st.tones.filter((t) => !(t.root && st.mute1));
  const others = () => heard().filter((t) => t !== st.act);
  const sameNote = (t, s, c) => (s ? t.str === s : !t.str && Math.abs(t.c - c) < 0.001);
  // a tone as the chips name it: its ratio, else its cents
  const toneLabel = (t) => (t.str ? S.labelHTML(S.ratio(t.str).label) : `${S.fmtC(t.c)}¢`);   // as the readout (S.fmtC: a chip keeps its width while it moves)
  // the Harmonics spectrum, every partial shown there
  const partials = () => S.amps();

  function mount(root, opt = {}) {
    el = root;
    // the side panel (Chord, Scale, circle, list) goes where the page puts it (opt.side: Harmonics runs it
    // from the top of the page, beside its bars)
    const side = opt.side || el;
    el.innerHTML = `
        <div class="panel beats-panel">
          <div class="panel-head">
            <h3>Roughness</h3>
            <button class="btn quiet" data-act="play"><span class="ico play"></span><span>Play</span></button>
          </div>
          <div class="beats-head">
            <div class="tone-row" data-tones></div>
            <div class="beats-pick" data-picker hidden></div>
            <div class="tools beats-tools">
              <div class="nudges">${NUDGES.map(([d, key]) => `<button class="nudge" data-d="${d}" title="${key}">${d < 0 ? '−' + -d : '+' + d}</button>`).join('')}</div>
              <button class="btn quiet on" data-act="snap" aria-pressed="true" title="Lock onto dips (Shift: the opposite)">Snap</button>
            </div>
          </div>
          <div class="curve" data-curve></div>
          <div class="beats-low">
            <div class="beats-signal">
              <div class="wave-head"><h3>Signal</h3>
                <div class="seg small" data-seg="win">${WINDOWS.map((k) => `<button data-v="${k}">${k}s</button>`).join('')}</div>
              </div>
              <canvas class="wave" data-wave height="110"></canvas>
            </div>
            <div class="beats-pairs">
              <h3>Partial pairs within ±40 Hz</h3>
              <div class="beat-list" data-beats></div>
            </div>
          </div>
        </div>`;
    side.insertAdjacentHTML('beforeend', `
          ${S.sideTop('<div class="readout" data-read></div>')}
          <div class="clockwrap dim beats-clock" data-clock></div>
          <div data-list></div>`);
    rowEl = el.querySelector('[data-tones]');
    readEl = side.querySelector('[data-read]');
    playBtn = el.querySelector('[data-act="play"]');
    S.playHold(playBtn, startPlay, stopPlay);
    curveEl = el.querySelector('[data-curve]');
    waveEl = el.querySelector('[data-wave]');
    beatsEl = el.querySelector('[data-beats]');
    clockEl = side.querySelector('[data-clock]');
    S.scaleList(side.querySelector('[data-list]'));

    // a nudge steps the active tone once; held, it keeps stepping (like a held arrow key). While "+" waits
    // it adds a tone, stepped from the 1/1 (a step down stays on the 1/1)
    const nudge = (b) => nudgeAct(+b.dataset.d);
    let repeat = null;
    const release = () => { clearTimeout(repeat); clearInterval(repeat); repeat = null; };
    el.querySelectorAll('.nudge[data-d]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        if (e.button) return;
        release();
        nudge(b);
        repeat = setTimeout(() => { repeat = setInterval(() => nudge(b), 50); }, 400);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => b.addEventListener(t, release));
      b.addEventListener('click', (e) => { if (!e.detail) nudge(b); });   // keyboard Enter/Space
    });

    // the tone row: press a tone to hear it alone and make it the active one; drag it to move it in the
    // row (the 1/1 stays first); × takes it out; the 1/1 is an on/off toggle; + waits for the next chip
    // or curve press to add a tone
    let drag = null;
    rowEl.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-tok]');
      if (!b || e.button) return;
      e.preventDefault();
      const t = st.tones[+b.dataset.tok];
      st.rimSel = null;   // picked as a tone: its own dot is ringed
      if (st.act !== t) { st.act = t; tonesChanged(); } else rowPlayed();
      const v = S.audio.press(() => S.audio.tone(fOf(t), { amps: partials() }));
      drag = { t, v, x: e.clientX, y: e.clientY, id: e.pointerId, moving: false };
      try { rowEl.setPointerCapture(e.pointerId); } catch (err) {}
      markHeld();
    });
    rowEl.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moving) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        drag.moving = true;   // a drag, not a press: the tone stops, the chip follows
        drag.v.stop();
      }
      dragTo(drag.t, e.clientX, e.clientY);
    });
    const dragEnd = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moving) drag.v.stop();
      drag = null;
      markHeld();
    };
    rowEl.addEventListener('pointerup', dragEnd);
    rowEl.addEventListener('pointercancel', dragEnd);
    // the pressed (sounding) or dragged chip
    const markHeld = () => rowEl.querySelectorAll('.chip.tok').forEach((c) => {
      const t = st.tones[+c.querySelector('[data-tok]').dataset.tok];
      c.classList.toggle('held', !!drag && !drag.moving && drag.t === t);
      c.classList.toggle('drag', !!drag && drag.moving && drag.t === t);
    });
    // the dragged tone goes before or after the chip nearest the pointer
    function dragTo(t, x, y) {
      let near = null, best = Infinity;
      rowEl.querySelectorAll('.chip.tok').forEach((c) => {
        const r = c.getBoundingClientRect(), d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
        if (d < best) { best = d; near = { u: st.tones[+c.querySelector('[data-tok]').dataset.tok], after: x > r.left + r.width / 2 }; }
      });
      if (!near || near.u === t) return;
      const rest = st.tones.filter((u) => u !== t), j = Math.max(1, rest.indexOf(near.u) + (near.after ? 1 : 0));
      rest.splice(j, 0, t);
      if (rest.every((u, i) => u === st.tones[i])) return;
      st.tones = rest;
      save();
      renderRow();
      markHeld();
    }
    rowEl.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-x], [data-addtone], [data-mute1], [data-lib]')) e.stopPropagation(); }, true);
    rowEl.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]'), add = e.target.closest('[data-addtone]'), m = e.target.closest('[data-mute1]');
      if (m) { st.mute1 = !st.mute1; if (e.detail) m.blur(); tonesChanged(); return; }   // from the keyboard the focus stays
      // the library (the ratio picker) stays hidden until asked for (the user's call), below the row
      if (e.target.closest('[data-lib]')) { libOpen = !libOpen; el.querySelector('[data-picker]').hidden = !libOpen; renderRow(); return; }
      if (x) removeTone(st.tones[+x.dataset.x]);
      else if (add) { st.act = null; tonesChanged(); }
    });

    // the circle: a tone's dot plays it alone and makes it active, as its chip does; a rim note moves the
    // active tone there (or adds it while "+" waits), as its picker chip does. The 1/1's dot does the
    // same as a rim 1/1 (the user's call): the active tone goes onto it, drawn over the 1/1's own dot
    S.clockHold(clockEl, '[data-ti]', (d) => {
      let t = st.tones[+d.dataset.ti];
      if (!t) return null;
      if (t.root) { rimPick('1/1', false); if (st.act) t = st.act; }
      else { st.rimSel = null; if (st.act !== t) { st.act = t; tonesChanged(); } else rowPlayed(); }
      const v = S.audio.tone(fOf(t), { amps: partials() });
      st.dotHeld = t;
      renderClock();
      return () => { v.stop(); if (st.dotHeld === t) { st.dotHeld = null; renderClock(); } };
    }, rimPick);

    // a list row picks its note, as a rim note does (only while this page shows: 'pick' comes from every
    // tab). Keys go their own way: a press makes the row what the keys hold then, a release leaves it
    S.on('pick', (s, key) => {
      if (!el.offsetParent) noteDue = true;
      else if (!key && s) rimPick(s);
    });
    S.on('note', (s, src) => { if (src !== 'beats') noteDue = true; });
    S.on('keys', (held, pressed) => {
      st.keys = held;
      if (!el.offsetParent) { keysMissed = true; return; }
      if (pressed) rowFromKeys();
      keysSoon(pressed);
    });
    // keys that came or went while another tab showed: held on into this one, they are the row as if pressed here
    st.keys = S.keysNow();
    keysMissed = st.keys.length > 0;
    try { noteDue = !!localStorage.getItem('scales.note'); } catch (e) {}   // a first visit: the note follows this page instead
    S.on('shown', () => {
      if (el.closest('[hidden]')) return;
      if (noteDue) followNote();
      if (keysMissed) { keysMissed = false; if (st.keys.length) rowFromKeys(); keysSoon(st.keys.length > 0); }
      else if (Object.values(due).some(Boolean)) drawDue();
    });

    const snapBtn = el.querySelector('[data-act="snap"]');
    snapBtn.addEventListener('click', (e) => {
      st.snap = !st.snap;
      snapBtn.classList.toggle('on', st.snap);
      snapBtn.setAttribute('aria-pressed', st.snap);
      if (e.detail) snapBtn.blur();   // clicked: from the keyboard the focus stays to go on from
      // turned on near a dip: go there at once
      const m = st.snap && st.act && (st.curve?.minima || []).find((m) => Math.abs(m.c - st.act.c) < 6);
      if (m && (st.act.str !== m.str || Math.abs(st.act.c - m.c) > 0.001)) moveAct(m.c, m.str);
    });
    // hold the cents headline: the tones together (Enter too)
    S.holdOn(readEl, '[data-pair]', () => pressTones());
    beatsEl.addEventListener('click', (e) => { if (e.target.closest('[data-earmore]')) { rowsN += ROWS_STEP; renderBeats(); } });
    // hold a pair: only those two partials sound, as plain sines, each as loud as it is in the whole sound
    // (glide along)
    S.holdOn(beatsEl, '.brow[data-pp], .brow[data-ear]', (d) => {
      const k = partialGain();
      let vs, sel, env;
      if (d.dataset.ear) {
        // a beat the ear makes: the partials that make it. Its dot swings as two equal partials
        // would, |cos(x/2)|, like a real pair's (the ear tones are far too faint for their true depth to show)
        vs = d.dataset.ear.split(';').map((s) => s.split(',').map(Number)).map(([f, a]) => S.audio.tone(f, { amps: [1], gain: k * a }));
        const [df, kp, kq] = d.dataset.env.split(',').map(Number);
        sel = `.brow[data-ear="${d.dataset.ear}"] .pulse`;
        env = (t) => Math.sqrt(0.5 + 0.5 * Math.cos(2 * Math.PI * df * t + (earPh[kq] - earPh[kp]) * Math.PI / 180));
      } else {
        const [fa, aa, fb, ab] = d.dataset.pp.split(',').map(Number);
        vs = [S.audio.tone(fa, { amps: [1], gain: k * aa }), S.audio.tone(fb, { amps: [1], gain: k * ab })];
        // two sines started together, a·sin + b·sin, swell and fade with |a + b·e^(2πiΔf·t)|
        sel = `.brow[data-pp="${d.dataset.pp}"] .pulse`;
        env = (t) => Math.sqrt(aa * aa + ab * ab + 2 * aa * ab * Math.cos(2 * Math.PI * (fa - fb) * t)) / (aa + ab);
      }
      // only its own pulse runs: the other pairs don't sound
      // its dot follows the loudness heard, drawn at the time that reaches the ears (a row redrawn meanwhile too)
      const t0 = vs[0].t0;
      let raf = 0;
      heldRows.add(d);
      const draw = () => {
        const p = beatsEl.querySelector(sel);
        if (p) {
          p.closest('.brow').classList.add('hot');
          p.style.animationName = 'none';   // the name only: the shorthand would wipe the row's inline duration
          p.style.transform = `scale(${Math.max(0.12, env(Math.max(0, S.audio.heard() - t0))).toFixed(3)})`;
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
      return () => {
        vs.forEach((v) => v.stop());
        cancelAnimationFrame(raf);
        heldRows.delete(d);
        if (pairsKept) { pairsKept = false; due.pairs = true; drawDue(); }   // the list it was kept in: after a glide, with the next row held
        beatsEl.querySelectorAll('.brow.hot').forEach((r) => r.classList.remove('hot'));
        beatsEl.querySelectorAll('.pulse').forEach((p) => { p.style.animationName = ''; p.style.transform = ''; });
      };
    });
    S.seg(el, 'win', String(st.win), (v) => { st.win = +v; drawWave(); });

    picker = S.ratioPicker(el.querySelector('[data-picker]'), {
      exclude: ['1/1', '2/1'],   // the 1/1 is the tone row's first chip
      groups: DIPS,
      // the active tone's chip is filled, the other tones' chips are ringed
      isOn: (s) => !!st.act && st.act.str === s,
      isAlso: (s) => others().some((t) => t.str === s),
      et: true,
      onPick: (s) => {
        const c = S.ratio(s).cents;
        if (c > CMAX) return;
        // the active tone's own chip again lets go of it
        if (st.act && sameNote(st.act, s, c)) { removeTone(st.act); return; }
        if (!st.act && st.tones.length >= MAXT) return;
        moveAct(c, s, true);   // a chip is an exact note: 5\12 stays 5\12, whatever ratio reads 500.0
        blip();
      },
    });

    // scrub the curve: press and drag; the sound follows the cursor
    const scrubTo = (e) => {
      const svg = curveEl.querySelector('svg'), r = svg.getBoundingClientRect();
      const c = ((e.clientX - r.left) / r.width) * CMAX;
      // gentle magnet towards minima while Snap is on; Shift does the opposite
      const m = st.snap !== e.shiftKey && (st.curve?.minima || []).find((m) => Math.abs(m.c - c) < 6);
      if (m) moveAct(m.c, m.str);
      else moveAct(S.clamp(c, 0, CMAX));
    };
    // a press anywhere, the cursor included, places the active tone there (or adds one)
    let scrubbing = null;
    curveEl.addEventListener('pointerdown', (e) => {
      if (e.button || !e.target.closest('svg')) return;
      if (!st.act && st.tones.length >= MAXT) return;
      e.preventDefault();
      scrubbing = e.pointerId;
      try { curveEl.setPointerCapture(e.pointerId); } catch (err) {}
      scrubTo(e);
      st.scrub = S.audio.press(startVoices);   // a quick tap lasts 50 ms, like every press
      markPlaying();
    });
    curveEl.addEventListener('pointermove', (e) => {
      if (scrubbing !== e.pointerId) return;
      scrubTo(e);
    });
    const end = (e) => {
      if (scrubbing !== e.pointerId) return;
      scrubbing = null;
      if (st.scrub) { st.scrub.stop(); st.scrub = null; }
      markPlaying();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    new ResizeObserver(() => drawWave()).observe(waveEl);
    let curveW = 0;   // relabel the curve when its on-screen width changes
    new ResizeObserver(() => { if (curveEl.clientWidth !== curveW && st.curve) { curveW = curveEl.clientWidth; renderCurve(); } }).observe(curveEl);
    S.on('settings', () => { computeCurve(); render(); });
    // painting the spectrum reshapes the curve, the signal and the sounding tones
    let specQueued = false;
    S.on('spectrum', () => {
      [st.play, st.scrub, st.press].forEach((v) => v && v.setAmps(partials()));
      if (specQueued) return;
      specQueued = true;
      requestAnimationFrame(() => { specQueued = false; computeCurve(); render(); });
    });
    S.on('theme', () => drawWave());   // the signal is painted on a canvas with the accent colour
    S.on('scale', () => { renderRead(); renderClock(); });
    S.on('panic', () => { stopPlay(); st.scrub = null; st.press = null; clearTimeout(st.blipping); st.blipping = null; markPlaying(); });
    computeCurve();
    renderRow();
    render();
  }

  // the ratios a position or the readout can name: every chip (everyday, the scale, typed ones, the
  // "+ more" dips) and 2/1
  const known = () => [...new Set([...S.CORE_RATIOS, ...S.scale, ...S.typed, ...DIPS.flatMap((g) => g.list), '2/1'])];
  // a position on the curve sits on the 0.1¢ grid, exactly: 702.0 is not 3/2 (Snap reaches the ratios).
  // Only the notes that lie on the grid are notes: 0 the 1/1, 1200 the 2/1, an EDO's step k\N (S.edoOf, as every
  // note is named: 500.0 is 5\12, 240.0 1\5)
  function gridNote(c) {
    c = Math.round(c * 10) / 10;
    if (c === 0) return [c, '1/1'];
    if (c === CMAX) return [c, '2/1'];
    const e = S.edoOf(c);
    return [c, e ? S.edoKey(e[0], e[1]) : null];
  }
  // a nudge (or arrow key) counts from the note the tone came from, in tenths of a cent: 3/2 + 2¢ is
  // 703.955…¢, and − 2¢ gives 3/2 again; from a note on the grid (7\12, a curve position) it stays on
  // the grid (7\12 + 2¢ = 702.0). While "+" waits it adds a tone, stepped from the 1/1
  function nudgeAct(d) {
    const t = st.act;
    const from = t ? t.from || t.str : '1/1';
    const c0 = from ? S.ratio(from).cents : t.c;
    const off = (t?.off || 0) + Math.round(d * 10);
    const c = c0 + off / 10;
    if (Math.abs(c0 * 10 - Math.round(c0 * 10)) < 1e-6 || c < 0 || c > CMAX) moveAct(c);
    else moveAct(c, off ? null : from, true, off ? { from, off } : null);
  }
  // a scale note (rim, list row, piano key) moves the active tone there, or adds it while "+" waits
  // the active tone and the selected note are one across tabs: what was selected while another page showed, and back
  function followNote() {
    noteDue = false;
    if (S.note.str) rimPick(S.note.str, S.note.rim);
    else if (st.act) { st.act = null; tonesChanged(); }
  }
  function shareAct() {
    if (noteDue || !st.act) return;
    const str = S.noteKey(st.act.str || S.centsKey(st.act.c));
    if (str !== S.note.str) S.setNote(str, 'beats');
  }
  // picked on the rim (or in the list, or by a key): the rim dot is ringed, as in every view, not the tone's dot over it
  function rimPick(s, rim = true) {
    const c = S.ratio(s).cents;
    st.rimSel = rim ? s : null;
    if (st.act ? sameNote(st.act, s, c) : st.tones.length >= MAXT) { renderRead(); renderClock(); return; }   // its octave may have changed
    const oct = S.note.oct;
    moveAct(c, s, true);
    S.note.oct = oct;
  }
  // the row becomes the notes the keys hold, folded, the last pressed active; the 1/1 counts only if played.
  // Last pressed, it is a tone of its own as the circle's 1/1 dot makes, and the first chip mutes, so one 1/1 sounds
  function rowFromKeys() {
    const strs = [...new Set(st.keys.map((k) => k.str))], last = st.keys[st.keys.length - 1].str;
    const rest = strs.filter((s) => s !== '1/1' || last === '1/1').slice(1 - MAXT);
    st.mute1 = last === '1/1' || !strs.includes('1/1');
    st.tones = [st.tones[0], ...rest.map((str) => st.tones.find((t) => !t.root && t.str === str) || { c: S.ratio(str).cents, str, root: false })];
    st.act = st.tones.find((t) => !t.root && t.str === last) || null;
  }
  // the keys of a chord land within milliseconds and sound must not wait for this: drawn once they pause, in pieces, so
  // a note coming in waits for one piece at most and the pieces still to come start over with what it changed
  let keysRow = false, keysMissed = false, noteDue = false, due = { curve: false, wave: false, clock: false, pairs: false };
  function keysSoon(row) {
    keysRow = keysRow || row;
    due.pairs = true;
    S.later('beats:row', () => {
      if (!keysRow) return;
      keysRow = false; due.curve = due.wave = due.clock = true;
      curveRun = null;
      st.fromKeys = false; save(); picker.render(); renderRow(); sync(); st.fromKeys = true;
      renderRead();
      drawDue();
    });
    drawDue();
  }
  // the pairs follow every chord; the curve and wave are heavy, so they wait for a pause. What the drawer covers or
  // holds stays due until it shows
  function drawDue() {
    S.later('beats:pairs', () => { if (due.pairs && !S.mainCovered()) { due.pairs = false; renderBeats(); } });
    S.later('beats:curve', () => { if (due.curve && !S.mainCovered()) { due.curve = false; curveSoon(renderCurve); } }, S.LATER.REST);
    S.later('beats:wave', () => { if (due.wave && !S.mainCovered()) { due.wave = false; drawWave(); } }, S.LATER.REST);
    S.later('beats:clock', () => { if (due.clock && !S.sideClosed()) { due.clock = false; renderClock(); } }, S.LATER.REST);
  }
  // the row, played or edited by hand: the readout leaves the key's octave
  function rowHeard() { if (st.fromKeys) { st.fromKeys = false; S.note.oct = 0; renderRead(); } }
  // the row sounds in its one octave, so the readout does too
  function rowPlayed() { rowHeard(); S.note.oct = 0; renderRead(); }
  // the active tone to c cents above the 1/1 (str: its ratio, from a chip or a dip; exact: a chip's value,
  // kept as it is; nudged: {from, off}, the note it was nudged from and the tenths since); with none
  // active ("+" waiting) a new tone is added there
  function moveAct(c, str = null, exact = false, nudged = null) {
    c = S.clamp(c, 0, CMAX);
    // a note keeps its exact cents (3/2: 701.955000865…, as it sounds)
    if (!nudged) [c, str] = str ? [S.ratio(str).cents, str] : exact ? [c, str] : gridNote(c);
    const { from, off } = nudged || {};
    rowHeard();
    if (!st.act) {
      if (st.tones.length >= MAXT) return;
      st.act = { c, str, root: false, from, off };
      st.tones.push(st.act);
      tonesChanged();
      return;
    }
    const relit = st.act.str !== str || !str;
    Object.assign(st.act, { c, str, from, off });
    if (relit) { picker.render(); renderRow(); }
    save();
    sync();
    renderSoon();
  }
  // × (or the active tone's chip again): the tone before it becomes active, if it is not the 1/1; else
  // "+" waits
  function removeTone(t) {
    const i = st.tones.indexOf(t);
    if (i < 1) return;
    st.tones.splice(i, 1);
    if (st.act === t) st.act = st.tones[i - 1].root ? null : st.tones[i - 1];
    tonesChanged();
  }
  // tones added, removed or another one made active: the curve is against a new set of tones
  function tonesChanged() {
    st.fromKeys = false;
    save();
    computeCurve();
    picker.render();
    renderRow();
    sync();
    renderSoon();
  }
  const sync = () => [st.play, st.scrub, st.press].forEach((v) => v && v.sync());

  // the 1/1 first, an on/off toggle (blue while it sounds); then a chip per tone in its prime colour (the
  // active one filled, as its chip in the picker) with ×; then "+" (lit while it waits for a new tone)
  let libOpen = false;   // kept until reload
  function renderRow() {
    S.keepFocus(rowEl, () => { rowEl.innerHTML = st.tones.map((t, i) => {
      if (t.root) return `<button class="chip tok-root${st.mute1 ? '' : ' on'}" data-mute1 aria-pressed="${!st.mute1}">1/1</button>`;
      const r = t.str && S.ratio(t.str);
      return `<span class="chip tok ${r ? r.cls : 'pt'}${t === st.act ? ' on' : ''}"><button data-tok="${i}">${toneLabel(t)}</button><button class="tok-x" data-x="${i}" aria-label="remove"><svg viewBox="0 0 8 8"><path d="M1 1L7 7M7 1L1 7"/></svg></button></span>`;
    }).join('') + (st.tones.length >= MAXT ? '' : `<button class="chip more add-tone${st.act ? '' : ' on'}" data-addtone aria-label="add a tone"><svg viewBox="0 0 10 10"><path d="M5 1V9M1 5H9"/></svg></button>`)
      + `<button class="chip more lib-tog${libOpen ? ' open' : ''}" data-lib aria-expanded="${libOpen}"><span>Show library</span><span>Hide library</span></button>`; });
  }

  /* ---- sound ---- */
  // one voice per tone; sync() follows the tone row (moved, added, removed tones)
  // a painted amplitude as a sine's gain, as loud as that partial in the whole sound: every tone sounding at
  // startVoices' gain, its wave scaled to a peak of 1 (a PeriodicWave is normalised to its peak)
  let peakOf = { key: '', peak: 1 };
  function partialGain() {
    const amps = partials(), n = heard().length, key = amps.join(',');
    if (peakOf.key !== key) {
      let peak = 0;
      for (let s = 0; s < 4096; s++) {
        let y = 0;
        for (let i = 0; i < amps.length; i++) if (amps[i]) y += amps[i] * Math.sin(2 * Math.PI * (i + 1) * s / 4096);
        peak = Math.max(peak, Math.abs(y));
      }
      peakOf = { key, peak: peak || 1 };
    }
    return S.gainOf(n) / peakOf.peak;
  }
  // each voice keeps its fundamental's phase (radians, context time; partial n is at n times it), carried
  // over every move, so the pair dots can follow the beating heard
  function startVoices() {
    const vs = new Map(), ph = new Map();
    const sync = () => {
      const ts = heard();
      for (const [t, v] of vs) if (!ts.includes(t)) { v.stop(); vs.delete(t); ph.delete(t); }
      const gain = S.gainOf(ts.length);   // as loud as Chord
      for (const t of ts) {
        const v = vs.get(t), f = fOf(t);
        if (!v) { const nv = S.audio.tone(f, { amps: partials(), gain }); vs.set(t, nv); ph.set(t, { f, p: 0, t0: nv.t0 }); continue; }
        const e = ph.get(t);
        if (e.f !== f) { const now = S.audio.now(); e.p += 2 * Math.PI * e.f * (now - e.t0); e.t0 = now; e.f = f; }
        v.setFreq(f, 0.01);
      }
    };
    sync();
    return {
      stop: (d) => vs.forEach((v) => v.stop(d)),
      sync,
      setAmps: (x) => vs.forEach((v) => v.setAmps(x)),
      phase: (t, at) => { const e = ph.get(t); return e ? e.p + 2 * Math.PI * e.f * (at - e.t0) : null; },
    };
  }
  // a chip sounds the tones together (same voices, same envelope as every note), for a moment; it is
  // stopped by a timer, not scheduled ahead, so its release is exactly a press's in every browser
  // Play: the tones together while held, as Chord and Harmonics' Play
  function startPlay() {
    rowPlayed();
    st.play = S.audio.press(startVoices);
    playBtn.classList.add('held');
    markPlaying();
  }
  function stopPlay() {
    if (!st.play) return;
    st.play.stop(); st.play = null;
    playBtn.classList.remove('held');
    markPlaying();
  }
  function blip() {
    const vs = startVoices(), v = S.audio.solo('beats-blip', vs);
    st.blipV = vs;
    setTimeout(() => v.stop(), 750);
    clearTimeout(st.blipping);
    st.blipping = setTimeout(() => { st.blipping = null; markPlaying(); }, 1000);
    markPlaying();
  }

  /* ---- Sethares/Plomp–Levelt roughness ---- */
  // pairs: partials² of them (4096 at 64), but only near ones add anything: far ones are skipped before
  // the exponentials (e^-12 is nothing)
  function roughness(fa, fb, amps) {
    let d = 0;
    for (let i = 0; i < amps.length; i++) {
      if (!amps[i]) continue;
      const x = (i + 1) * fa;
      // from sd = 3.42 below x up: 3.42 / 0.24 · (0.0207 y + 18.96) = x − y gives y = (x − 270.2) / 1.295, a little under it here
      for (let j = Math.max(0, Math.floor((x - 271) / 1.295 / fb) - 1); j < amps.length; j++) {
        if (!amps[j]) continue;
        const y = (j + 1) * fb;
        const s = 0.24 / (0.0207 * (x < y ? x : y) + 18.96), sd = s * (x > y ? x - y : y - x);
        if (sd > 3.42) { if (y > x) break; continue; }   // 3.51 · 3.42 = 12; higher j only gets farther
        d += Math.min(amps[i], amps[j]) * (Math.exp(-3.51 * sd) - Math.exp(-5.75 * sd));
      }
    }
    return d;
  }
  // the curve: the active tone (or the one "+" would add) at every cent above the 1/1, against all the
  // other tones. Each dip is named as a note: the simplest step from one of the other tones
  function curveAt(c, os, amps) {
    const f = S.baseFreq() * 2 ** (c / 1200);
    return os.reduce((d, t) => d + roughness(fOf(t), f, amps), 0);
  }
  function nameDip(c, os) {
    let best = null;
    for (const t of os) {
      const up = c >= t.c, r = S.nearestSimple(Math.abs(c - t.c), 16, 6);
      if (!r || (best && r.p + r.q >= best.w)) continue;
      const exact = t.c + (up ? 1 : -1) * S.cents(r.p / r.q);
      let str = null, key = `${Math.round(exact)}¢`, cls = 'pt';
      if (t.str && !S.ratio(t.str).temp) {   // a tempered tone (k\N) has no ratio to multiply
        const x = S.ratio(S.qNote(S.qMul(S.ratio(t.str).e, S.monzoOf(r.p, r.q), up ? 1 : -1)));
        // past the octave the note folds back: keep the cents, not the folded ratio
        if (Math.abs(x.cents - exact) < 0.01) { str = x.str; key = x.label; cls = x.cls; }
      }
      best = { w: r.p + r.q, c: exact, str, key, cls };
    }
    return best;
  }
  function computeCurve() {
    curveRun = null;
    const it = curveSteps();
    while (!it.next().done);
  }
  // the same a little at a time, so a note gets in between; a new chord drops what is under way (curveRun = null).
  // With many partials this is the heaviest thing on the page
  let curveRun = null;
  function curveSoon(done) {
    const it = curveSteps();
    curveRun = it;
    const step = () => {
      if (curveRun !== it) return;
      const t = performance.now();
      let r;
      do r = it.next(); while (!r.done && performance.now() - t < 6);
      if (r.done) { curveRun = null; done(); } else setTimeout(step, 0);
    };
    step();
  }
  function* curveSteps() {
    const amps = partials(), os = others();
    const xs = [], ds = [];
    for (let c = 0; c <= CMAX; c += 1) { xs.push(c); ds.push(curveAt(c, os, amps)); yield; }
    const max = Math.max(...ds) || 1;
    const minima = [];
    for (let i = 0; i < ds.length; i++) {
      yield;
      let isMin = true, rimL = 0, rimR = 0;
      for (let k = -6; k <= 6 && isMin; k++) if (k && ds[i + k] !== undefined && ds[i + k] < ds[i]) isMin = false;
      if (!isMin) continue;
      // prominence: how far it dips below its surroundings within ±40¢ (at 0¢ only the right side counts, at 1200¢ the left)
      for (let k = 1; k <= 40; k++) {
        if (ds[i - k] !== undefined) rimL = Math.max(rimL, ds[i - k]);
        if (ds[i + k] !== undefined) rimR = Math.max(rimR, ds[i + k]);
      }
      if (Math.min(i > 0 ? rimL : Infinity, i < ds.length - 1 ? rimR : Infinity) - ds[i] < 0.006 * max) continue;   // a rim of 0 is a rim: past roughness' cutoff the curve is flat, no dip
      let best = xs[i], bd = ds[i];
      for (let c = Math.max(0, xs[i] - 1); c <= Math.min(CMAX, xs[i] + 1); c += 0.05) {
        const d = curveAt(c, os, amps);
        if (d < bd) { bd = d; best = c; }
        yield;
      }
      const m = nameDip(best, os);
      if (m && m.c >= 0 && m.c <= CMAX && !minima.some((x) => Math.abs(x.c - m.c) < 0.01)) minima.push({ ...m, d: curveAt(m.c, os, amps) });
    }
    st.curve = { xs, ds, max, minima };
  }

  /* ---- rendering ---- */
  let queued = false;
  function renderSoon() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }
  function render() { renderRead(); renderCurve(); drawWave(); renderBeats(); renderClock(); }

  // the tones inside the circle (their prime colour, hollow without a ratio; the active one with the
  // blue edge, a muted 1/1 faint), the scale on its rim. Drawn anew only when the tones, the scale or the
  // 1/1 change; a moving tone's dot (and its sparks) just moves
  let clockKey = '';
  function renderClock() {
    if (S.sideWait(renderClock)) return;
    if (!clockEl) return;
    const SIZE = 320;
    const key = [st.tones.map((t) => t.str || '¢').join(), st.mute1, S.scale.join(), [...S.silent].join(), S.baseIdx()].join('|');
    if (key !== clockKey) {
      clockKey = key;
      const points = st.tones.map((t, i) => ({ cents: t.c, rf: 0.8, r: 7, attrs: `data-ti="${i}"`, spoke: true }));
      S.clock(clockEl, { size: SIZE, points });
    }
    const playing = !!(st.play || st.scrub || st.press || st.blipping), on = heard();
    const rimSel = st.rimSel && st.act && st.act.str === st.rimSel ? st.rimSel : null;   // moved off it (a nudge): the tone's dot again
    clockEl.querySelectorAll('.clock-dot.rim').forEach((d) => d.classList.toggle('sel', d.dataset.sr === rimSel));
    clockEl.querySelectorAll('.clock-dot[data-ti]').forEach((d) => {
      const t = st.tones[+d.dataset.ti];
      if (!t) return;
      const [x, y] = S.clockPos(SIZE, t.c, 0.8);
      if (+d.getAttribute('cx') !== x || +d.getAttribute('cy') !== y) {
        d.setAttribute('cx', x); d.setAttribute('cy', y);
        const hit = clockEl.querySelector(`.clock-hit[data-ti="${d.dataset.ti}"]`);
        if (hit) { hit.setAttribute('cx', x); hit.setAttribute('cy', y); }
        S.sparksOf(d)?.setAttribute('transform', `translate(${x},${y})`);
      }
      const cls = t.str ? S.ratio(t.str).cls : 'pt', lit = on.includes(t);
      const want = `clock-dot ${cls}${lit ? ' lit' : ''}${t === st.act && !rimSel ? ' sel' : ''}${(playing && lit) || st.dotHeld === t ? ' hot' : ''}`;
      if (d.getAttribute('class') !== want) d.setAttribute('class', want);
    });
    // the active tone's spoke (.clockwrap.dim shows only a selected one)
    clockEl.querySelectorAll('.clock-spoke').forEach((l, i) => {
      const t = st.tones[i];
      if (!t) return;
      const [x0, y0] = S.clockPos(SIZE, t.c, 0.08), [x, y] = S.clockPos(SIZE, t.c, 0.8);
      l.setAttribute('x1', x0); l.setAttribute('y1', y0); l.setAttribute('x2', x); l.setAttribute('y2', y);
      l.setAttribute('class', `clock-spoke ${t.str ? S.ratio(t.str).cls : 'pt'}${t === st.act ? ' sel' : ''}`);
    });
  }

  // the active tone, as the other tabs' readout: its note (the ratio, or k\N, when it is exactly that note,
  // else its cents, one decimal) and Add to scale; below, its cents when the headline is a note, then
  // its pitch
  function renderRead() {
    shareAct();
    const t = st.act;
    if (!t) {
      readEl.innerHTML = `<div class="big"><span class="mono hl none">–</span></div>
        <div class="sub mono"><span title="${S.exactHz(fOf(st.tones[0]))}">${S.fmtHz(fOf(st.tones[0]))} Hz</span> ·${toneLabel(st.tones[0])}</div>`;
      return;
    }
    // its own note, or a chip's note it is exactly on (a 12-TET chip on a tempered note of the scale)
    let r = t.str && S.ratio(t.str);
    if (!r) r = known().map(S.ratio).find((x) => x && Math.abs(x.cents - t.c) < S.EXACT) || null;
    if (r && r.temp && !r.edo) r = null;   // a pitch in cents (a scale note) reads as cents
    const nd = S.ndTip(r);
    const f = fOf(t) * 2 ** (t.str ? S.noteOct(t.str) : 0), n = S.noteOf(f);   // the octave a key played it in
    // the cents always open the line below (as S.readout), also under a headline in cents: on a touch screen a tap
    // there shows every digit (the headline plays); their tooltips hold them too
    const near = `<b title="${S.exactC(t.c)}">${S.fmtC(t.c)}¢</b> · `;
    readEl.innerHTML = `
      <div class="big"><span class="mono hl" data-pair${r ? (nd ? ` title="${nd}"` : '') : ` title="${S.exactC(t.c)}"`}>${r ? S.breakHTML(S.labelHTML(r.label)) : `${S.fmtC(t.c)}¢`}</span>${S.addBtn(t.str || (r && r.str) || S.centsKey(t.c))}</div>
      <div class="sub mono">${near}<span title="${S.exactHz(f)}">${S.fmtHz(f)} Hz</span> · ${n.name}${n.oct} <span title="${S.exactDev(S.etDev(t.c))}">${S.fmtDev(n.dev)}</span></div>`;
  }

  function renderCurve() {
    const { xs, ds, max, minima } = st.curve;
    // k = drawing units per screen pixel: labels are 14 px on screen (CSS, --kx) at any width, and the
    // room below the curve is laid out in screen pixels too
    const k = 640 / (curveEl.clientWidth || 640);
    // The picture is always 180 units + 104 px tall; the curve takes as much of it as the dip labels
    // leave free (the tallest curve that still labels as many dips as the 180-unit one)
    const W = 640, top = 10, total = 180 + Math.round(104 * k), limit = total - 28 * k;   // labels end above the cent numbers
    const sorted = [...minima].sort((a, b) => a.w - b.w || a.c - b.c);
    const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const X = (c) => (c / CMAX) * W;
    // labels sit below each dip; one that would touch a placed label or leader line steps down a row
    // (dips have different heights, so rows don't line up: test the actual boxes). Simple ratios are
    // placed first, so a crowded stretch keeps 5/4 and drops 13/12, not the other way round
    function layout(H) {
      const Y = (d) => H - (d / max) * (H - top);
      // lowest point of the curve between x0 and x1 (largest y), so a label clears it across its width
      const low = (x0, x1) => xs.reduce((lo, c, i) => { const cx = X(c); return cx >= x0 && cx <= x1 ? Math.max(lo, Y(ds[i])) : lo; }, -Infinity);
      const boxes = [], lines = [];
      let out = '', shown = 0;
      sorted.forEach((m) => {
        const key = m.key;
        const x = X(m.c), y = Y(m.d), w = (key.length * 8.5 + 4) * k;
        const tx = S.clamp(x, w / 2, W - w / 2);   // a label at either end stays inside the picture
        const ty0 = Math.max(y + 22 * k, low(x - w / 2, x + w / 2) + 20 * k);
        let place = null;
        for (let ty = ty0; ty <= limit; ty += 17 * k) {
          const box = { x0: tx - w / 2, x1: tx + w / 2, y0: ty - 13 * k, y1: ty + 3 * k };
          const line = ty - y > 28 * k ? { x0: x - k, x1: x + k, y0: y + 3, y1: ty - 14 * k } : null;
          if (boxes.some((b) => hits(b, box) || (line && hits(b, line))) || lines.some((l) => hits(l, box))) continue;
          place = { ty, box, line };
          break;
        }
        if (!place) { out += `<g class="min ${m.cls}"><circle cx="${x}" cy="${y}" r="2.6"><title>${key}</title></circle></g>`; return; }
        const { ty, box, line } = place;
        boxes.push(box);
        if (line) lines.push(line);
        shown++;
        out += `<g class="min ${m.cls}"><circle cx="${x}" cy="${y}" r="${2.6 * k}"/>
          ${line ? `<line x1="${x}" y1="${y + 3}" x2="${x}" y2="${ty - 14 * k}"/>` : ''}<text x="${tx}" y="${ty}">${key}</text></g>`;
      });
      return { H, Y, out, shown };
    }
    let L = layout(180);
    for (let h = Math.floor(total - 50 * k); h > 180; h -= 4) {
      const t = layout(h);
      if (t.shown >= L.shown) { L = t; break; }
    }
    const { H, Y } = L;
    let path = '';
    xs.forEach((c, i) => (path += (i ? 'L' : 'M') + X(c).toFixed(1) + ' ' + Y(ds[i]).toFixed(1)));
    let s = `<svg viewBox="0 0 ${W} ${total}" class="curve-svg">`;
    // cent numbers every 100¢, or every 200 / 300¢ when they would be under 40 px apart (phones)
    const every = [1, 2, 3].find((n) => X(n * 100) / k >= 40) || 4;
    for (let i = 0; i <= 12; i++) s += `<line class="grid" x1="${X(i * 100)}" x2="${X(i * 100)}" y1="${top}" y2="${H}"/>${i % every || i === 12 ? '' : `<text class="gl" x="${X(i * 100)}" y="${total - 4 * k}">${i * 100}</text>`}`;
    s += `<path class="fillarea" d="${path}L${W} ${H}L0 ${H}Z"/><path class="line" d="${path}"/>` + L.out;
    // the other tones stand on the axis as short marks in their colour; the active one is the cursor
    others().forEach((t) => { if (t.c <= CMAX) s += `<line class="tone-mark ${t.str ? S.ratio(t.str).cls : 'pt'}" x1="${X(t.c)}" x2="${X(t.c)}" y1="${H - 8 * k}" y2="${H}"/>`; });
    if (st.act) {
      const cx = X(st.act.c), cy = Y(curveAt(st.act.c, others(), partials()));
      s += `<line class="cursor" x1="${cx}" x2="${cx}" y1="${top}" y2="${H}"/><circle class="cursor-dot" cx="${cx}" cy="${cy}" r="6"/>`;
    }
    curveEl.innerHTML = s + '</svg>';
  }

  function drawWave() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, waveEl.clientWidth), h = waveEl.clientHeight || 110;
    if (waveEl.width !== Math.round(w * dpr) || waveEl.height !== Math.round(h * dpr)) { waveEl.width = Math.round(w * dpr); waveEl.height = h * dpr; }
    const g = waveEl.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const amps = partials(), fs = heard().map(fOf);
    if (!fs.length) return;
    const norm = amps.reduce((a, b) => a + b, 0) * fs.length || 1;
    const T = st.win, mid = h / 2, amp = h / 2 - 4;
    const at = (t) => {
      let v = 0;
      // the partials' sines from the first's: sin((k + 1)θ) = 2 cos θ · sin kθ − sin((k − 1)θ)
      for (const f of fs) {
        const th = 2 * Math.PI * f * t, c2 = 2 * Math.cos(th);
        let s0 = 0, s1 = Math.sin(th);
        for (let i = 0; i < amps.length; i++) {
          v += amps[i] * s1;
          const s2 = c2 * s1 - s0;
          s0 = s1; s1 = s2;
        }
      }
      return mid - (v / norm) * amp;
    };
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#2f6bff';
    // periods of the highest sounding partial per screen pixel; samples: at least 3 per device pixel and
    // 8 per period of that partial. Few enough: one line through them all (it stays whole when zoomed in).
    // Too many (long windows): each pixel's lowest to highest value, joined to its neighbours
    const top = amps.reduce((m, a, i) => (a ? i + 1 : m), 1) * Math.max(...fs);
    const per = Math.ceil(Math.max(3 * dpr, (8 * top * T) / w));
    if (per * w <= 24000) {
      const n = per * w;
      g.strokeStyle = accent; g.lineWidth = 1.25; g.lineJoin = 'round';
      g.beginPath();
      for (let k = 0; k <= n; k++) { const x = (k / n) * w, y = at((k / n) * T); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      return;
    }
    g.fillStyle = accent;
    const sub = 16;
    let prev = at(0);
    for (let px = 0; px < w; px++) {
      let lo = prev, hi = prev;
      for (let k = 1; k <= sub; k++) {
        const y = at(((px + k / sub) / w) * T);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
        prev = y;
      }
      g.fillRect(px, lo - 0.6, 1, hi - lo + 1.2);
    }
  }

  // the pulses only animate while the tones are actually sounding
  function markPlaying() {
    const on = !!(st.play || st.scrub || st.press || st.blipping || st.keys.length);
    beatsEl.classList.toggle('playing', on);
    if (on && !pulseRaf) pulseRaf = requestAnimationFrame(drawPulses);
    renderClock();
  }
  // while the tones sound, every pair's dot follows its beat in their phases (as a held row does); a held
  // row draws its own
  let pulseRaf = 0, rowMeta = [];
  function drawPulses() {
    const vs = st.play || st.scrub || st.press || (st.blipping && st.blipV);
    const rows = beatsEl.querySelectorAll('.brow[data-i]');
    if (!vs || !vs.phase) {
      pulseRaf = 0;
      rows.forEach((r) => { if (!r.classList.contains('hot')) { const p = r.querySelector('.pulse'); p.style.animationName = ''; p.style.transform = ''; } });
      return;
    }
    const at = S.audio.heard(), phi = (terms) => terms.reduce((s, [p, c]) => s + c * p.n * vs.phase(p.t, at), 0);
    rows.forEach((r) => {
      const m = rowMeta[r.dataset.i], p = r.querySelector('.pulse');
      if (!m || r.classList.contains('hot') || p.classList.contains('still')) return;
      if (m.tp.some(([q]) => vs.phase(q.t, at) == null) || m.tq.some(([q]) => vs.phase(q.t, at) == null)) return;
      const x = phi(m.tq) - phi(m.tp) + m.c;
      const e = m.ear ? Math.sqrt(0.5 + 0.5 * Math.cos(x)) : Math.sqrt(m.a * m.a + m.b * m.b + 2 * m.a * m.b * Math.cos(x)) / (m.a + m.b);
      p.style.animationName = 'none';
      p.style.transform = `scale(${Math.max(0.12, e).toFixed(3)})`;
    });
    pulseRaf = requestAnimationFrame(drawPulses);
  }

  // tones the ear adds to two partials of different tones: the cubic difference tone 2f₁ − f₂, strong
  // only while the two are close (−20 dB or so at 11:10, next to nothing past 3:2), and the weaker
  // difference tone f₂ − f₁. Loudness crude, relative to the painted amplitudes of every partial shown
  const EAR_PARTIALS = 8, ROWS_FIRST = 5, ROWS_STEP = 20;   // rows shown at first, and added by each "+ more"
  let rowsN = ROWS_FIRST;
  // the ear tones' phases in degrees, by kind (0 a real partial, 1 the b − a tone, 2 the 2a − b tone)
  const earPh = [0, 135, 90];
  function earTones(ts, amps, floor) {
    const ps = [];
    // each tone's EAR_PARTIALS loudest partials only (the lower one first when equal)
    const loud = amps.map((a, i) => i).filter((i) => amps[i] && amps[i] >= floor).sort((i, j) => amps[j] - amps[i] || i - j).slice(0, EAR_PARTIALS);
    ts.forEach((t, k) => { const f = fOf(t); for (const i of loud) ps.push({ f: (i + 1) * f, a: amps[i], k, t, n: i + 1 }); });
    const out = [];
    for (let x = 0; x < ps.length; x++) for (let y = x + 1; y < ps.length; y++) {
      if (ps[x].k === ps[y].k) continue;   // one tone's own ear tones fall on its partials
      if (Math.abs(ps[x].f - ps[y].f) < 40) continue;   // two partials that close beat as they are: the pair is listed
      const [lo, hi] = ps[x].f <= ps[y].f ? [ps[x], ps[y]] : [ps[y], ps[x]], m = Math.min(lo.a, hi.a), r = hi.f / lo.f;
      const cdt = 0.25 * m * Math.exp(-(r - 1) / 0.12), dt = 0.03 * m;
      // ph: the phase against a sine started with the partials, set by ear, as the ear's own delays shift
      // what the maths gives (x²: cos(b − a), π/2; x³: ±sin(2a − b)). 1/1 + 1195¢ (pure) fixes the b − a
      // tone (against a real partial), 1/1 + 700¢ (pure) the 2a − b one (against the b − a tone)
      if (cdt >= floor && 2 * lo.f - hi.f > 20) out.push({ f: 2 * lo.f - hi.f, a: cdt, k: 2, terms: [[lo, 2], [hi, -1]], src: [lo, hi] });
      if (dt >= floor && hi.f - lo.f > 20) out.push({ f: hi.f - lo.f, a: dt, k: 1, terms: [[hi, 1], [lo, -1]], src: [lo, hi] });
    }
    return { ps, ear: out };
  }
  // beats in which an ear tone takes part (against a partial or another ear tone); locked ones left out.
  // The n loudest, exactly, without making them all (12 tones make some 200 000): the components are placed
  // loudest first, and a beat is as loud as its quieter part, so each one placed makes its beats with those
  // already placed at its own level, in falling order; once n + 1 are found the rest can only be quieter.
  // Left out: rows whose partials hold a real beating pair (holding one, that pair is what is heard; it has
  // its own row). And one row per set of partials (the loudest): holding it plays them, so two rows would
  // sound the same. Ordered by the level estimate: no audibility measure, but it put the heard rows on top
  function earBeats(ts, amps, floor, n) {
    const { ps, ear } = earTones(ts, amps, floor);
    const order = ps.map((p) => ({ f: p.f, a: p.a, k: 0, terms: [[p, 1]], src: [p] })).concat(ear).sort((a, b) => b.a - a.a);
    const real = (src) => src.some((p, i) => src.some((q, j) => j > i && p.k !== q.k && Math.abs(p.f - q.f) >= 0.05 && Math.abs(p.f - q.f) < 40));
    const at = (f) => { let lo = 0, hi = placed.length; while (lo < hi) { const m = (lo + hi) >> 1; if (placed[m].f < f) lo = m + 1; else hi = m; } return lo; };
    const placed = [], rows = [], keys = new Set(), sets = new Set();
    // components of one level go together (the same partial of two tones), so ties fall by beat rate
    for (let g = 0, h; g < order.length; g = h) {
      const a = order[g].a;
      for (h = g; h < order.length && order[h].a === a; h++);
      if (rows.length > n && a < rows[rows.length - 1].w) break;
      const fresh = [], pair = (p, q) => {
        const bf = Math.abs(q.f - p.f);
        if (bf < 0.05 || bf >= 40 || (!p.src[1] && !q.src[1])) return;
        const [lo, hi] = p.f <= q.f ? [p, q] : [q, p];
        fresh.push({ fa: lo.f, fb: hi.f, kp: lo.k, kq: hi.k, tp: lo.terms, tq: hi.terms, bf, w: a, src: [...new Set([...p.src, ...q.src])] });
      };
      for (let x = g; x < h; x++) {
        const q = order[x];
        for (let i = at(q.f - 40); i < placed.length && placed[i].f < q.f + 40; i++) pair(placed[i], q);
        for (let y = g; y < x; y++) pair(order[y], q);
      }
      for (const b of fresh.sort((a, b) => a.bf - b.bf || a.fa - b.fa || a.fb - b.fb)) {
        const key = `${b.fa.toFixed(2)},${b.fb.toFixed(2)}`, set = b.src.map((p) => p.f.toFixed(3)).sort().join(',');
        if (keys.has(key) || sets.has(set) || real(b.src)) continue;
        keys.add(key); sets.add(set); rows.push(b);
      }
      for (let x = g; x < h; x++) placed.splice(at(order[x].f), 0, order[x]);
    }
    rows.sort((a, b) => b.w - a.w || a.bf - b.bf || a.fa - b.fa || a.fb - b.fb);
    return { rows: rows.slice(0, n), more: rows.length > n };
  }
  // only what can be heard: the quieter of the two at most 50 dB under the loudest partial. The pair
  // count only guards the page (the list scrolls past five)
  const fHz = (f) => (f < 1000 ? f.toFixed(1) : String(Math.round(f)));   // an ear row's frequencies: at most 999.9, so the badges line up in a narrow tile
  const FLOOR = 10 ** (-50 / 20), PAIR_ROWS = 200;
  // pairs of partials from two different tones, named by partial number and tone: 3·5/4 ~ 2·3/2. The
  // beating ones first, then the locked ones, each by loudness; then the beats the ear makes
  // the pairs' tones: the keys sounding now at their real pitch (far below the row's one octave and above
  // it; LIVE_MAX guards the page under a held pedal), else the row, so a chord let go leaves its pairs to press
  const LIVE_MAX = 24;
  function pairTones() {
    if (!st.keys.length) return heard();
    const seen = new Map();
    for (const k of st.keys.slice(-LIVE_MAX)) seen.set(`${k.str}@${k.oct}`, { c: S.ratio(k.str).cents + 1200 * k.oct, str: k.str });
    return [...seen.values()];
  }
  // a held row sounds, so it stays whatever the list becomes meanwhile, where it is on screen, under the finger
  const heldRows = new Set();
  let pairsKept = false;
  function renderBeats() {
    const rows = [...heldRows], at = rows.map((r) => [[...beatsEl.children].indexOf(r), r.getBoundingClientRect().top]);
    drawBeats();
    rows.forEach((r, k) => {
      [...beatsEl.children].find((x) => x.dataset.pp === r.dataset.pp && x.dataset.ear === r.dataset.ear)?.remove();
      beatsEl.insertBefore(r, beatsEl.children[at[k][0]] || null);
      r.style.marginTop = '';
      const room = at[k][1] - r.getBoundingClientRect().top;
      if (room > 0) r.style.marginTop = `${room}px`;
      pairsKept = true;
    });
  }
  function drawBeats() {
    markPlaying();
    const amps = partials(), ts = pairTones(), amax = Math.max(...amps), floor = FLOOR * amax;
    // the tooltip: the quieter partner's loudness, in dB under the loudest partial
    const dB = (w) => `${(20 * Math.log10(w / amax)).toFixed(1).replace('-', '−')} dB`;
    if (ts.length < 2) { beatsEl.innerHTML = ''; return; }
    const list = [];
    for (let a = 0; a < ts.length; a++) for (let b = a + 1; b < ts.length; b++) {
      const [ta, tb] = ts[a].c <= ts[b].c ? [ts[a], ts[b]] : [ts[b], ts[a]], fa = fOf(ta), fb = fOf(tb);
      for (let i = 0; i < amps.length; i++) {
        if (!amps[i] || amps[i] < floor) continue;
        // only the partials of b within 40 Hz of this one
        const fi = (i + 1) * fa, jEnd = Math.min(amps.length - 1, Math.floor((fi + 40) / fb) - 1);
        for (let j = Math.max(0, Math.ceil((fi - 40) / fb) - 1); j <= jEnd; j++) {
          if (!amps[j] || amps[j] < floor) continue;
          const bf = Math.abs(fi - (j + 1) * fb);
          if (bf < 40) list.push({ i: i + 1, j: j + 1, ta, tb, bf, w: Math.min(amps[i], amps[j]), lock: bf < 0.05 });
        }
      }
    }
    list.sort((a, b) => a.lock - b.lock || b.w - a.w || a.bf - b.bf);
    // the ear's beats are the costly ones: only made if the first rows have room for them
    const top = list.slice(0, Math.min(rowsN, PAIR_ROWS)), room = rowsN - top.length;
    const { rows: ear, more: earMore } = room > 0 ? earBeats(ts, amps, floor, room) : { rows: [], more: true };
    const more = list.length > top.length || earMore;
    const wmax = top.reduce((m, b) => Math.max(m, b.w), 0) || ear.reduce((m, b) => Math.max(m, b.w), 0);
    const pulse = (bf, w) => `<span class="pulse${bf < 0.05 ? ' still' : ''}" style="--w:${0.3 + 0.7 * Math.min(1, w / wmax)};animation-duration:${bf < 0.05 ? 0 : 1 / Math.min(bf, 12)}s"></span>`;
    rowMeta = top.map((b) => ({ tp: [[{ t: b.ta, n: b.i }, 1]], tq: [[{ t: b.tb, n: b.j }, 1]], a: amps[b.i - 1], b: amps[b.j - 1], c: 0 }))
      .concat(ear.map((b) => ({ ear: true, tp: b.tp, tq: b.tq, c: (earPh[b.kq] - earPh[b.kp]) * Math.PI / 180 })));
    let ri = 0;
    beatsEl.innerHTML = top.length || ear.length
      ? top.map((b) => `<div class="brow" data-i="${ri++}" title="${dB(b.w)}" data-pp="${b.i * fOf(b.ta)},${amps[b.i - 1]},${b.j * fOf(b.tb)},${amps[b.j - 1]}"><span class="mono">${b.i}·${toneLabel(b.ta)} ~ ${b.j}·${toneLabel(b.tb)}</span>
          ${pulse(b.bf, b.w)}
          <span class="mono num">${b.lock ? 'locked' : b.bf.toFixed(2) + ' Hz'}</span></div>`).join('')
        + ear.map((b) => `<div class="brow" data-i="${ri++}" title="${dB(b.w)}" data-ear="${b.src.map((p) => `${p.f},${p.a}`).join(';')}" data-env="${b.fb - b.fa},${b.kp},${b.kq}"><span class="mono ear-pair"><span>${fHz(b.fa)} ~ ${fHz(b.fb)}</span><span class="ear">ear</span></span>
          ${pulse(b.bf, b.w)}
          <span class="mono num">${b.bf.toFixed(2)} Hz</span></div>`).join('')
        + (more ? '<button class="chip" data-earmore>+ more</button>' : '')
      : '';
  }

  // the tones together, while the headline is held or Enter is down
  function pressTones() {
    if (!st.act) return;
    rowPlayed();
    const v = S.audio.solo('beats-blip', startVoices());
    st.press = v;
    markPlaying();
    return () => { v.stop(); if (st.press === v) st.press = null; markPlaying(); };
  }

  return {
    mount,
    stop: stopPlay,
    playSel: () => pressTones(),
    onKeyDown(code, e) {
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      if (code === 'ArrowRight' || code === 'ArrowUp') { nudgeAct(step); return true; }
      if (code === 'ArrowLeft' || code === 'ArrowDown') { nudgeAct(-step); return true; }
      return false;
    },
  };
})();
