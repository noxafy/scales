'use strict';
// A tiny event bus and the DOM helpers every view uses.
(() => {
  const S = window.S;

  /* ---------- tiny event bus ---------- */

  const handlers = {};
  S.on = (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn);
  S.on('spectrum', () => S.audio.retone());
  S.off = (ev, fn) => { const h = handlers[ev]; if (h && h.includes(fn)) h.splice(h.indexOf(fn), 1); };
  // each listener on its own: one that throws (a view's bug) is reported and the others still run, so a link is still read whole
  S.emit = (ev, ...a) => [...(handlers[ev] || [])].forEach((fn) => { try { fn(...a); } catch (e) { setTimeout(() => { throw e; }); } });

  // Sound comes first. MIDI and keys arrive on the page's one thread, so a note waits for whatever is being drawn:
  // what a note makes the page draw goes through S.later, one piece a task. Each piece has a pace [quiet, max]: it runs
  // once no note has come for quiet ms, at most max ms after it was asked for. Asking again under the same key replaces
  // what was waiting and keeps its place, so a burst of notes draws once and no piece starves
  S.LATER = { HOT: [8, 16], SOON: [30, 100], REST: [120, 800] };
  // on phones the picture and the side panel take turns: what can't be seen needn't move
  const narrowW = matchMedia('(max-width: 960px)'), phoneW = matchMedia('(max-width: 450px)');
  S.sideClosed = () => narrowW.matches && !document.body.classList.contains('drawer-open') && !document.body.classList.contains('drawer-drag');
  S.mainCovered = () => phoneW.matches && document.body.classList.contains('drawer-open');
  // first line of what draws only into the side panel: true (so return) while the drawer is shut; it runs when the drawer opens
  const sideDue = new Set();
  S.sideWait = (fn) => { if (!S.sideClosed()) { sideDue.delete(fn); return false; } sideDue.add(fn); return true; };
  S.on('shown', () => { if (!S.sideClosed()) { const fns = [...sideDue]; sideDue.clear(); fns.forEach((f) => f()); } });
  const later = new Map();
  let laterTimer = null, lastNote = 0;
  const laterAt = (p) => Math.min(lastNote + p.pace[0], p.since + p.pace[1]);
  const laterArm = () => {
    clearTimeout(laterTimer);
    laterTimer = null;
    if (!later.size) return;
    let at = Infinity;
    later.forEach((p) => { at = Math.min(at, laterAt(p)); });
    laterTimer = setTimeout(laterTick, Math.max(0, at - performance.now()));
  };
  const laterTick = () => {
    const now = performance.now();
    const due = [...later].find(([, p]) => laterAt(p) <= now);
    if (due) later.delete(due[0]);
    try { if (due) due[1].fn(); } finally { laterArm(); }
  };
  S.later = (key, fn, pace = S.LATER.SOON) => {
    const p = later.get(key);
    if (p) p.fn = fn; else later.set(key, { fn, pace, since: performance.now() });
    laterArm();
  };
  S.noteIn = () => { lastNote = performance.now(); };
  // a view's listeners to what's selected elsewhere (S.on('pick', shown(fn))): a hidden view draws nothing and
  // catches up when it next shows; each listener keeps its own latest call, replayed in the order they came
  S.whenShown = (el) => {
    const wait = new Map();
    S.on('shown', () => {
      if (!wait.size || el.closest('[hidden]')) return;
      const ws = [...wait.values()]; wait.clear(); ws.forEach((w) => w());
    });
    return (fn) => { const key = {}; return (...a) => { wait.delete(key); if (el.closest('[hidden]')) wait.set(key, () => fn(...a)); else fn(...a); }; };
  };
  // an event through S.later: each listener in a task of its own
  // keyed by the listener itself, not its place in the list, which S.off shifts
  const laterId = new WeakMap();
  let laterIds = 0;
  S.emitLater = (ev, ...a) => (handlers[ev] || []).forEach((fn) => {
    if (!laterId.has(fn)) laterId.set(fn, ++laterIds);
    S.later(`${ev}:${laterId.get(fn)}`, () => fn(...a));
  });

  // The selection, one for every tab (Beats keeps its own tones): a press in one picture selects it in the others
  // ('select', with the view that did it), each showing it its own way; a rim dot, list row or piano key picks a note
  // as itself ('pick', rim). A view mounted later starts on it. note: the note selected (a key, folded), what the
  // other tabs select and + adds. A selected interval (a Cycle step or inner interval, a Spiral step: two tones sound) is
  // iv: {s: its size (S.parseStep's or S.parseMixStep's form), low: where its lower tone sounds (cents above the 1/1; a Spiral step down starts in the octave above it and goes below), ends:
  // its two notes, src: the view it was pressed in, at: where there (the view's own selection, {arc: 3})}, and note
  // the note it makes above the 1/1, folded, which + adds. An interval is selected where it was pressed, and only there
  // (the user, 2026-11-22: "the same interval" is the same size to the eye, the same two notes to the code, and the
  // two disagree): the other views follow S.shownNote, which is none. Kept across reloads (scales.sel), as the scale
  // and Beats' tones are; an interval with its place, which its view takes up again if it is still that interval
  S.sel = { note: null, rim: false };   // nothing selected at first: a dash, no ring
  try {
    const v = JSON.parse(localStorage.getItem('scales.sel')), k = v && typeof v.note === 'string' && S.noteKey(v.note);
    if (k && S.ratio(k)) {
      S.sel = { note: k, rim: !!v.rim, outer: !!v.outer };
      const iv = v.iv, s = iv && typeof iv.t === 'string' && (S.parseStep(iv.t) || S.parseMixStep(iv.t));
      if (s) S.sel.iv = { s, low: +iv.low, ends: iv.ends, src: iv.src, at: iv.at };
    }
  } catch (e) {}
  const keepSel = () => {
    const iv = S.sel.iv && { t: S.sel.iv.s.t, low: S.sel.iv.low, ends: S.sel.iv.ends, src: S.sel.iv.src, at: S.sel.iv.at };
    try { localStorage.setItem('scales.sel', JSON.stringify({ ...S.sel, iv })); } catch (e) {}
    S.showRead();
  };
  S.select = (note, src, oct = 0, iv = null) => { S.sel = { note, rim: false, oct, iv: iv && { ...iv, src } }; keepSel(); S.emit('select', note, src); };
  // the note the other views show: the selected note; none while an interval is selected
  S.shownNote = () => (S.sel.iv ? null : S.sel.note);
  // the same interval: the same size, the same lower tone and the same two notes (an interval kept across a reload,
  // against what its place holds now)
  S.sameIv = (a, b) => a.s.t === b.s.t && Math.abs(a.low - b.low) < S.EXACT && a.ends[0] === b.ends[0] && a.ends[1] === b.ends[1];
  // outer: picked by a circle's note name (or a place to go, data-pick), which shows on the view's ring; every other pick
  // (a scale dot, a list row, a key, MIDI) shows on the scale's ring when the scale has it (S.clock)
  S.on('pick', (note, key, oct = 0, outer = false) => { S.sel = { note, rim: true, oct, outer }; keepSel(); });
  S.on('scale', S.showRead);
  S.on('settings', S.showRead);
  // the octave the selected note sounds in changed: the readout shows that pitch
  S.setOct = (oct) => { if ((S.sel.oct || 0) === oct) return; S.sel.oct = oct; S.showRead(); };
  // the octave the selected note sounded in, from a key, MIDI, a partial number or a prime button (0 otherwise): readouts show that pitch, and pressing or Enter plays it.
  // A press that selects it sounds folded, so S.select comes before the readout is drawn
  S.noteOct = (str) => (S.sel.note === str && S.sel.oct) || 0;
  S.playNote = (str) => S.playScaleNotes([str], { octs: [S.noteOct(str)] });
  // two tones together, the lower low cents above the 1/1, the upper c cents above it (a Cycle arc, a Spiral step)
  S.dyad = (low, c) => { const f0 = S.centsFreq(low); return S.audio.chord([f0, f0 * 2 ** (c / 1200)]); };
  // the selection, as the readout's headline plays it and Enter where a view has nothing of its own: an interval as its
  // two tones (its ends lit wherever they show), a note as itself
  S.playSel = () => {
    const { note, iv } = S.sel;
    if (!iv) return note ? S.playNote(note) : null;
    const ch = S.dyad(iv.low, iv.s.c);
    S.markScale(iv.ends, true);
    return () => { ch.stop(); S.markScale(iv.ends, false); };
  };
  // an interval (S.parseStep's form) as the note it makes above the 1/1, folded: a selected step's note
  S.stepNote = (s) => (s.m ? S.mixKey(s.r, s.m.edo ? S.edoKey(s.m.edo[0], s.m.edo[1]) : S.centsKey(s.m.c)) : s.r ? S.qNote(s.r) : s.edo ? S.edoKey(s.edo[0], s.edo[1]) : S.noteOfCents(s.c));
  // the scale replaced by choice (Use as scale): the note on the selected one's key now, as a held key takes it; none: nothing selected
  S.useAsScale = (list) => {
    S.latticeNotes.setLinked(false);   // the Cycle's would otherwise overwrite the Lattice's notes
    S.setScale(list);
    if (!S.sel.note) return;
    const b = S.pianoNote(Math.round(S.ratio(S.sel.note).cents / 100));
    S.emit('pick', b ? b.str : null);
  };

  /* ---------- DOM helpers ---------- */

  S.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // A Play button (Chord, Harmonics' Play): it sounds while held, as every note does: from touch-down to letting go, at
  // least a press's minimum (start runs its notes in S.audio.press). Enter or Space on the focused button: the same
  // minimum. btn: the button, or a selector for buttons anywhere in the page (Chord, one in every side panel).
  // While it sounds (start returned something) the button looks held, every one of a selector's, also in a view
  // opened meanwhile. Returns the stop that also ends that look: what Stop and leaving a view call
  S.playHold = (btn, start, stop) => {
    const many = typeof btn === 'string';
    const root = many ? document : btn;
    const hit = (e) => (many ? e.target.closest(btn) : btn);
    let on = false;
    const lit = (x) => { on = x; (many ? document.querySelectorAll(btn) : [btn]).forEach((b) => b.classList.toggle('held', x)); };
    const halt = () => { stop(); if (on) lit(false); };
    const go = () => { halt(); if (start()) lit(true); };
    if (many) S.on('shown', () => lit(on));
    let down = null;
    root.addEventListener('pointerdown', (e) => {
      const b = hit(e);
      if (!b || e.button) return;
      go();
      down = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
    });
    // let go: the focus goes too, so the piano keys pressed next don't ring the button as the keyboard's
    const up = (e) => { if (down !== e.pointerId) return; down = null; halt(); const b = hit(e); if (b) b.blur(); };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('contextmenu', (e) => { if (hit(e)) e.preventDefault(); });   // a long press on touch screens
    root.addEventListener('click', (e) => { if (!e.detail && hit(e)) { go(); halt(); } });
    return halt;
  };

  // Brings root's children to the markup in html without replacing what stays: what is still there keeps being
  // the element it was (the keyboard's focus, the :hover a tap left, a press in S.holdOn), with only its changed
  // attributes and text written. Children match by their note (data-r), a step by its two (data-a, data-b), the
  // rest by tag, first class and place among those alike. 'hot' and 'held' are kept: lit from outside (S.markScale,
  // S.holdOn), not in the markup. The nodes in `keep` (the keyboard under the list's head) stay where they are.
  const LIVE = ['hot', 'held'];
  const keyOf = (x, seen) => {
    if (x.nodeType === 1 && x.dataset.r) return 'r:' + x.dataset.r;
    if (x.nodeType === 1 && x.dataset.a) return `s:${x.dataset.a}>${x.dataset.b}`;
    const k = x.nodeType === 1 ? `${x.nodeName}.${x.classList[0] || ''}` : '#' + x.nodeType;
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return `${k}:${n}`;
  };
  const patchNode = (to, from) => {
    if (to.nodeType !== 1) { if (to.data !== from.data) to.data = from.data; return; }
    const cls = [from.getAttribute('class') || '', ...LIVE.filter((c) => to.classList.contains(c))].join(' ').trim();
    if ((to.getAttribute('class') || '') !== cls) cls ? to.setAttribute('class', cls) : to.removeAttribute('class');
    for (const { name, value } of from.attributes) if (name !== 'class' && to.getAttribute(name) !== value) to.setAttribute(name, value);
    for (const { name } of [...to.attributes]) if (name !== 'class' && !from.hasAttribute(name)) to.removeAttribute(name);
    patchKids(to, from);
  };
  const patchKids = (to, from, keep = []) => {
    const have = new Map(), seen = new Map();
    for (const x of to.childNodes) if (!keep.includes(x)) have.set(keyOf(x, seen), x);
    seen.clear();
    const want = [...from.childNodes].map((w) => {
      const k = keyOf(w, seen), old = have.get(k);
      if (!old || old.nodeName !== w.nodeName) return [w, null];
      have.delete(k);
      return [w, old];
    });
    // the gone first: then what stays is already in its place, never moved (a moved node loses the focus)
    have.forEach((x) => x.remove());
    let at = to.firstChild;
    for (const [w, old] of want) {
      while (at && keep.includes(at)) at = at.nextSibling;
      if (old) patchNode(old, w);
      const node = old || w;
      if (node === at) at = at.nextSibling;
      else to.insertBefore(node, at);
    }
  };
  S.patch = (root, html, keep) => {
    const t = document.createElement('template');
    t.innerHTML = html;
    patchKids(root, t.content, keep);
  };

  // A part drawn anew (innerHTML) gives the focus back to its new copy of the control that had it, the one with the
  // same data-* attributes: Enter or Space on a chip whose row redraws (Beats' 1/1, Diamond's numbers, Spiral's
  // directions) left the focus on the page, and a second Enter did nothing
  S.keepFocus = (root, draw) => {
    const a = document.activeElement, data = a && a !== root && root.contains(a) ? Object.entries(a.dataset) : [];
    draw();
    if (!data.length || root.contains(a)) return;
    const sel = data.map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${CSS.escape(v)}"]`).join('');
    root.querySelector(sel)?.focus({ preventScroll: true });   // it had the focus already: showing it again would scroll the page from under the pointer (a Spiral arc pressed far below its run)
  };

  // Press-and-hold on any element matching `sel` inside root (survives re-renders).
  // start(el, event, glided) returns a stop function (or nothing). While held, moving
  // onto another matching element stops the first and starts the other at once.
  let lastScroll = -1e9;
  document.addEventListener('scroll', () => { lastScroll = performance.now(); }, { capture: true, passive: true });
  S.holdOn = (root, sel, start, opt) => {
    const live = new Map();
    const tails = [];   // released presses whose notes may still be ringing out
    // what counts as the same element for gliding (opt.id(el, e): the keyboard's keys are their step, whatever note they
    // show; a Spiral mass is the step under the pointer)
    const ident = (opt && opt.id) || ((el) => Object.entries(el.dataset).filter(([k]) => k !== 'state').join('|') || el);
    const begin = (el, e, glided) => {
      // a fresh press cuts what earlier presses here left ringing
      if (!glided) S.audio.immediately(() => tails.splice(0).forEach((f) => f()));
      let cut = null;
      const stop = S.audio.press(() => start(el, e, glided));
      if (typeof stop !== 'function') return null;
      el.classList.add('held');
      return {
        id: ident(el, e),
        stop: () => {
          stop(); el.classList.remove('held');
          // remember a hard cut for this press: calling stop() again inside immediately() kills the tail
          cut = () => S.audio.immediately(() => stop());
          tails.push(cut);
          if (tails.length > 8) tails.shift();
        },
      };
    };
    // round things that overlap (circle dots, Scatter's numbers): the press goes to the one whose centre is nearest,
    // not the one drawn on top, so a dot half under its neighbour still plays from its own half
    const at = (x, y, top) => {
      if (!top || top.tagName !== 'circle') return top;
      let best = top, bd = Infinity;
      for (const u of document.elementsFromPoint(x, y)) {
        const el = u.closest(sel);
        if (!el || el.tagName !== 'circle' || !root.contains(el)) continue;
        const b = el.getBoundingClientRect(), d = (b.x + b.width / 2 - x) ** 2 + (b.y + b.height / 2 - y) ** 2;
        if (d < bd - 0.01) { bd = d; best = el; }   // a tie keeps the one on top
      }
      return best;
    };
    // no scrolling from these, in browsers that ignore touch-action on what is inside an SVG; suppresses their click
    if (opt && opt.takeTouch) root.addEventListener('touchstart', (e) => { if (e.target.closest(sel)) e.preventDefault(); }, { passive: false });
    root.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      // opt.list: a touch that stops a scroll still coasting only stops it
      if (opt && opt.list && e.pointerType === 'touch' && performance.now() - lastScroll < 150) return;
      const el = at(e.clientX, e.clientY, e.target.closest(sel));
      if (!el || !root.contains(el)) return;
      e.preventDefault();
      // on the shape itself too: a press may redraw the picture (Cycle, Spiral), and touchstart, which comes after this, then never reaches root
      if (opt && opt.takeTouch && e.pointerType === 'touch') e.target.addEventListener('touchstart', (t) => t.preventDefault(), { passive: false, once: true });
      if (e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId);
      end(e);   // a press whose release never came (let go outside the window) ends here, not with Stop
      const h = begin(el, e, false);
      if (h) live.set(e.pointerId, h);
    });
    window.addEventListener('pointermove', (e) => {
      const h = live.get(e.pointerId);
      if (!h || (opt && opt.list && e.pointerType === 'touch')) return;   // a list: a finger moving on scrolls, it doesn't glide
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const el = under && at(e.clientX, e.clientY, under.closest(sel));
      if (!el || !root.contains(el) || ident(el, e) === h.id) return;
      S.audio.immediately(() => h.stop());
      const n = begin(el, e, true);
      n ? live.set(e.pointerId, n) : live.delete(e.pointerId);
    });
    const end = (e) => { const h = live.get(e.pointerId); if (h) { live.delete(e.pointerId); h.stop(); } };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // Stop ends the press itself: its drawing goes with the sound, and a glide brings no note back; so does the window
    // losing focus ('release', as held keys): its pointerup may never come
    const endAll = () => { live.forEach((h) => h.stop()); live.clear(); };
    S.on('panic', endAll);
    S.on('release', endAll);
  };

  // segmented control: <div class="seg" data-seg="name"><button data-v="..">
  S.seg = (root, name, value, onChange) => {
    const el = root.querySelector(`[data-seg="${name}"]`);
    const mark = (v) => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    mark(value);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      mark(b.dataset.v);
      onChange(b.dataset.v);
    });
    return mark;
  };

  // a count field (Cycle's Outer and Inner, the Spiral's run): applied on change (Enter, leaving it, its arrows), not
  // per keystroke: typing 12 went through 1. Past its limits it turns red and stays so until left, then shows the
  // present value again. max: a number or a function; set(v): false refuses; show(): puts the present value back
  S.numIn = (inp, max, set, show) => {
    const fits = (v) => v >= 1 && v <= (typeof max === 'function' ? max() : max);
    inp.addEventListener('input', () => inp.classList.toggle('bad', !fits(Math.round(+inp.value))));
    inp.addEventListener('change', () => {
      const v = Math.round(+inp.value);
      if (fits(v) && set(v) !== false) inp.classList.remove('bad');
      if (!inp.classList.contains('bad')) show();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', () => { inp.classList.remove('bad'); show(); });
  };
  // a count field also drags (Spiral's runs, Cycle's Outer and Inner): up or right adds, down or left takes away, a step
  // per 16 px (8 was too sensitive, the user: ±5–10 is the range that matters); a press that doesn't move types (onTap
  // first, if given). set(n) returning false refuses n (the field turns red until let go); get() is the count now
  S.numDrag = (inp, { get, set, max, min = 1, onStart, onEnd, onTap }) => {
    inp.classList.add('drag-n');
    inp.addEventListener('pointerdown', (e) => {
      if (e.button || document.activeElement === inp) return;   // while typing, a press is the field's own
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, n0 = get(), hi = typeof max === 'function' ? max() : max;
      let moved = false, last = n0;
      const move = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!moved) { moved = true; if (onStart) onStart(); }
        const n = S.clamp(n0 + Math.round((dx - dy) / 16), min, hi);
        if (n === last) return;
        last = n;
        inp.classList.toggle('bad', n !== get() && set(n) === false);
        if (!inp.classList.contains('bad')) inp.value = get();
      };
      const end = (ev) => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
        inp.classList.remove('bad');
        inp.value = get();
        if (moved) { if (onEnd) onEnd(); return; }
        if (ev.type !== 'pointerup') return;
        const f = (onTap && onTap()) || inp;
        f.focus(); f.select();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
    });
  };

  // A key per object (a Beats tone, a Spiral run) for its chip's data-chip, kept while the object lives, so a row drawn
  // anew knows which chip was which
  // A chart's head of two pieces, a count and its cents ("4 free · 2784.4¢", "35 steps · 12493.8¢"), beside its buttons:
  // it shrinks before the buttons move, and where the cents don't fit beside the count they take a line under it,
  // without the dot (class `two`: measured with the dot shown, the cents wrapped or the buttons pushed under it; again when the line's width changes). Two lines fit the
  // bar's 36 px, so nothing moves (a size there once pushed the buttons onto a line of their own on phones).
  // S.fitHead(el) once; then el.innerHTML = S.headHTML(first, second) and fit()
  S.headHTML = (a, b) => `<span>${a}</span>${b ? `<span class="head-2"><span class="dot">&nbsp;· </span>${b}</span>` : ''}`;
  S.fitHead = (el) => {
    el.classList.add('fit-head');
    const fit = () => {
      const c = el.querySelector('.head-2');
      el.classList.remove('two');
      const pushed = () => [...el.parentElement.children].some((k) => k !== el && k.offsetTop > el.offsetTop + el.offsetHeight / 2);   // the buttons went under it
      el.classList.toggle('two', !!c && (pushed() || c.offsetTop > el.firstChild.offsetTop));
      if (el.classList.contains('two') && pushed()) el.classList.remove('two');   // the cents alone too wide (999 × 999999999¢): one line over the buttons
    };
    new ResizeObserver(fit).observe(el.parentElement);
    return fit;
  };
  const objKeys = new WeakMap();
  let lastKey = 0;
  S.chipKey = (o) => { if (!objKeys.has(o)) objKeys.set(o, ++lastKey); return objKeys.get(o); };
  // fn() draws the row anew; each chip ([data-chip]) then slides from where it was shown (mid-slide too) to its new place;
  // the chip keyed `skip` (the one being dragged, which follows the pointer) doesn't
  S.SLIDE_MS = 180;
  const stillMotion = matchMedia('(prefers-reduced-motion: reduce)');
  S.flip = (row, fn, skip) => {
    const was = new Map();
    row.querySelectorAll('[data-chip]').forEach((c) => was.set(c.dataset.chip, c.getBoundingClientRect()));
    fn();
    if (stillMotion.matches) return;
    row.querySelectorAll('[data-chip]').forEach((c) => {
      const a = was.get(c.dataset.chip);
      if (!a || c.dataset.chip === skip) return;
      const b = c.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: S.SLIDE_MS, easing: 'ease-out' });
    });
  };
  // A row of chips put in order by dragging (Beats' tones, the Spiral's runs). A press on a chip's handle starts
  // (start(item): Beats sounds the tone and returns its stop, the chip 'held' meanwhile); a move of 6 px drags it
  // instead (the stop runs, the chip 'drag'), before or after the chip nearest the pointer, never before the first
  // `fixed` items; order(list, item) keeps the new order and draws the row anew, inside S.flip, so the chips slide.
  // Chips carry data-chip = S.chipKey(item) and the class cls(item) gives. On a touch screen a swipe scrolls (the
  // handle's touch-action lets it; the press stops with it) and a chip moves after a hold, as icons on a phone's home
  // screen. A press that dragged takes no click.
  // The chip being moved lifts (scaled up, a shadow under it: 'lift' on a touch screen once the hold allows a drag,
  // before it moves; 'drag' while it moves, with a mouse from its first move) and follows the pointer (the CSS
  // translate, apart from the slides' transform), so it is seen to pass its neighbours; let go, it settles into its
  // place (the user, 2026-11-20: with no look of its own it seemed lost, and the hold had no sign it had taken)
  // onLift(item): the chip has lifted, on touch once the hold allows a drag, with a mouse at its first move (the Spiral
  // chooses its run then: chosen on lift, the user, 2026-11-20, so it is drawn whole in the picture while it moves)
  S.chipDrag = (row, { handle, items, fixed = 0, start, order, onLift }) => {
    const HOLD_MS = 300;
    let d = null;
    const keyOf = (u) => String(S.chipKey(u));
    const itemOf = (c) => items().find((u) => keyOf(u) === c.dataset.chip);
    const chipOf = (u) => row.querySelector(`[data-chip="${keyOf(u)}"]`);
    const cls = (u) => (d && d.u === u ? (d.moving ? ' drag' : (d.lift ? ' lift' : '') + (d.stop ? ' held' : '')) : '');
    const mark = () => row.querySelectorAll('[data-chip]').forEach((c) => {
      const on = !!d && keyOf(d.u) === c.dataset.chip;
      c.classList.toggle('held', on && !d.moving && !!d.stop);
      c.classList.toggle('lift', on && !d.moving && d.lift);
      c.classList.toggle('drag', on && d.moving);
    });
    // where a chip lies: its centre as shown, less a slide's transform and its own translate (scaling keeps the centre)
    const slot = (c) => {
      const r = c.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(c).transform), t = (c.style.translate || '0px 0px').split(' ').map(parseFloat);
      return { cx: r.left + r.width / 2 - m.e - (t[0] || 0), cy: r.top + r.height / 2 - m.f - (t[1] || 0), w: c.offsetWidth };
    };
    // the dragged chip under the pointer, held where it was grabbed, but never out of the chips' own span (followed
    // anywhere on the screen it was surreal, the user, 2026-11-20): along a row of one line it only slides sideways,
    // from the first chip's place to the last's
    const span = () => {
      const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      row.querySelectorAll('[data-chip]').forEach((c) => {
        const s = slot(c), w = c.offsetWidth / 2, h = c.offsetHeight / 2;
        b.left = Math.min(b.left, s.cx - w); b.right = Math.max(b.right, s.cx + w);
        b.top = Math.min(b.top, s.cy - h); b.bottom = Math.max(b.bottom, s.cy + h);
      });
      return b;
    };
    const follow = (x, y) => {
      const c = chipOf(d.u);
      if (!c) return;
      c.getAnimations().forEach((a) => a.cancel());
      const s = slot(c), b = span(), w = c.offsetWidth / 2, h = c.offsetHeight / 2;
      const cx = S.clamp(x - d.gx, b.left + w, Math.max(b.left + w, b.right - w)), cy = S.clamp(y - d.gy, b.top + h, Math.max(b.top + h, b.bottom - h));
      c.style.translate = `${cx - s.cx}px ${cy - s.cy}px`;
    };
    // once held, the finger moves the chip and the page stays put. A touch's moves keep going to the element first
    // touched, and a row drawn anew takes it out of the page, so its moves no longer reach the window: the page
    // scrolled and the drag was cancelled after the first new place (the user, 2026-11-20). So the touched element
    // listens too, from the touch on (a listener added mid-touch may come too late to stop a scroll)
    const still = (e) => { if (d && d.armed && e.cancelable) e.preventDefault(); };
    const listen = (on) => [window, d.tgt].forEach((t) => t && t[on ? 'addEventListener' : 'removeEventListener']('touchmove', still, { passive: false }));
    row.addEventListener('pointerdown', (e) => {
      const h = e.target.closest(handle), c = h && h.closest('[data-chip]');
      if (!c || e.button) return;
      const u = itemOf(c);
      if (!u) return;
      e.preventDefault();
      const touch = e.pointerType === 'touch';
      if (d) { clearTimeout(d.timer); if (d.tgt) listen(false); if (d.stop) d.stop(); }   // a second finger: the first press ends
      const s = slot(c);
      d = { u, x: e.clientX, y: e.clientY, gx: e.clientX - s.cx, gy: e.clientY - s.cy, id: e.pointerId, moving: false, armed: !touch, lift: false, timer: 0, stop: null, tgt: touch ? e.target : null };
      d.stop = (start && start(u)) || null;
      if (touch) { const dd = d; listen(true); dd.timer = setTimeout(() => { dd.armed = dd.lift = true; if (d !== dd) return; mark(); if (onLift) onLift(dd.u); }, HOLD_MS); }
      mark();
    });
    row.addEventListener('pointermove', (e) => {
      if (!d || d.id !== e.pointerId) return;
      if (!d.moving) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
        if (!d.armed) { clearTimeout(d.timer); d.timer = 0; return; }   // moved before the hold: no drag, it stays a press
        d.moving = true;   // a drag, not a press: the sound stops, the chip follows
        // the row takes the pointer only now: the row is drawn anew as the chip passes others, and a removed chip hears
        // nothing; taken on the press, the release went to the row, so a plain click reached no chip (the Spiral's
        // run wasn't chosen, the user, 2026-11-20)
        try { row.setPointerCapture(e.pointerId); } catch (err) {}
        row.classList.add('chips-moving');   // a captured pointer shows the row's cursor, not the chip's
        if (d.stop) { d.stop(); d.stop = null; }
        if (row.contains(document.activeElement)) document.activeElement.blur();   // a count being typed lets the row be drawn
        mark();
        if (onLift && !d.lift) { d.lift = true; onLift(d.u); }   // with a mouse it lifts as it moves (on touch it had at the hold)
      }
      dragTo(e.clientX, e.clientY);
      follow(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (!d || d.id !== e.pointerId) return;
      clearTimeout(d.timer);
      if (d.tgt) listen(false);
      if (d.stop) d.stop();
      const c = d.moving && chipOf(d.u);
      if (d.moving) {   // the click that follows the drag is not a press
        const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        row.addEventListener('click', eat, true);
        setTimeout(() => row.removeEventListener('click', eat, true), 0);
      }
      d = null;
      row.classList.remove('chips-moving');
      mark();
      // let go: it settles into its place, still over the others
      if (c && c.style.translate) {
        const from = c.style.translate;
        c.style.translate = '';
        if (!stillMotion.matches) {
          c.classList.add('settle');
          c.animate([{ translate: from }, { translate: '0px 0px' }], { duration: S.SLIDE_MS, easing: 'ease-out' }).finished
            .then(() => c.classList.remove('settle'), () => c.classList.remove('settle'));
        }
      }
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
    // The row as it is: the box, its gaps, each child's size (with its fractions: a break predicted a pixel off is a
    // wrong line; the dragged chip's without its lift's scale), measured once per move
    function measure() {
      const cs = getComputedStyle(row), b = row.getBoundingClientRect(), pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
      const drag = chipOf(d.u), size = new Map();
      const kids = [...row.children].filter((c) => c.offsetWidth > 0).map((c) => {
        const r = c.getBoundingClientRect(), q = { k: c.dataset.chip ?? null, w: c === drag ? c.offsetWidth : r.width, h: c === drag ? c.offsetHeight : r.height };
        if (q.k) size.set(q.k, q);
        return q;
      });
      return { kids, size, gx: parseFloat(cs.columnGap) || 0, gy: parseFloat(cs.rowGap) || 0, x0: b.left + row.clientLeft + pl, y0: b.top + row.clientTop + pt,
        W: row.clientWidth - pl - (parseFloat(cs.paddingRight) || 0) };
    }
    // where the chips would lie in another order: the row's own line breaking (flex-wrap), the chips taking the chips'
    // places among the other children (the 1/1, +, Show library); per key {l: left edge, cx, cy: its line's middle, hh: half
    // its line's height}, and h: the row's height
    function slotIn(m, list) {
      const keyed = list.map(keyOf).filter((k) => m.size.has(k)), at = new Map(), line = [];
      let k = 0, x = 0, y = m.y0, lineH = 0;
      const close = () => { for (const p of line) { p.cy = y + lineH / 2; p.hh = lineH / 2; } line.length = 0; };
      for (const kid of m.kids) {
        const q = kid.k ? m.size.get(keyed[k++]) : kid;
        if (x > 0 && x + q.w > m.W + 0.5) { close(); y += lineH + m.gy; x = 0; lineH = 0; }
        if (q.k) { const p = { l: m.x0 + x, cx: m.x0 + x + q.w / 2, w: q.w, h: q.h }; at.set(q.k, p); line.push(p); }
        x += q.w + m.gx; lineH = Math.max(lineH, q.h);
      }
      close();
      return { at, h: y + lineH - m.y0 };
    }
    // Where the chip goes: an order counts when, laid out anew, the chip as shown sits in its reading place: the chips on
    // lines above it come before it, those below after, and on its line those whose middle its leading edge has passed (a
    // middle it covers may lie either side); one starting where it starts, as in a stack of long chips, once its middle is
    // passed in height. A counting order stays when made, so nothing flickers. While the current order counts, another
    // that counts wins only by a slot (left edge and line) nearer the shown chip, a few px past halfway (HYST): a wide
    // chip and a short one swapped both count, the short one moving too. When it doesn't, the counting order passing the
    // fewest chips, or one nearer by HYST (as the next move would take); if none counts, the nearest slot. Tried and dropped (the user, 2026-11-20): by the pointer, a third
    // into the neighbour (a wide chip held at its right end needed ~600 px); nearest slot alone (two orders give the chip
    // one place: the longest run in the middle never went last; and a chip put at the end, wrapping to a new line, had to
    // be pulled to that line's left end); by middles alone (~310 px past a short chip, a place skipped in a stack). With
    // many chips only the places near the shown one are tried
    const HYST = 4;
    function dragTo(x, y) {
      const m = measure(), list = items(), key = keyOf(d.u), me = m.size.get(key);
      if (!me) return;
      // where it is shown: held inside the chips' span (the pointer's own height, below a row of one line, read as after
      // all: the chip swapped back, the user, 2026-11-21). The span of each order as laid out, as the chip will be held
      // once it is made: the present span, which a move changes, made a still pointer move chips back and forth
      const hw = me.w / 2, hh = me.h / 2;
      const held = (b) => { const cx = S.clamp(x - d.gx, b.left + hw, Math.max(b.left + hw, b.right - hw)); return { l: cx - hw, cy: S.clamp(y - d.gy, b.top + hh, Math.max(b.top + hh, b.bottom - hh)) }; };
      const spanOf = (L) => {
        const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        for (const q of L.at.values()) { b.left = Math.min(b.left, q.l); b.right = Math.max(b.right, q.l + q.w); b.top = Math.min(b.top, q.cy - q.h / 2); b.bottom = Math.max(b.bottom, q.cy + q.h / 2); }
        return b;
      };
      const want = held(span());   // only to find the chips near it
      const rest = list.filter((u) => u !== d.u), cur = list.indexOf(d.u);
      const score = (o, j) => {
        const L = slotIn(m, o), p = L.at.get(key);
        if (!p) return null;
        const want = held(spanOf(L));
        let ok = true;
        o.forEach((u, i) => {
          const k = keyOf(u), q = L.at.get(k);
          if (k === key || !q || !ok) return;
          const band = q.hh + m.gy / 2;
          let rel = 0;   // 1 before the chip, -1 after, 0 either
          if (want.cy > q.cy + band) rel = 1;
          else if (want.cy < q.cy - band) rel = -1;
          else if (Math.abs(q.l - want.l) <= 1) rel = want.cy >= q.cy ? 1 : -1;   // at its height too: held in the span, the last line's middle is as low as it goes
          else if (q.cx < want.l) rel = 1;
          else if (q.cx > want.l + me.w) rel = -1;
          if ((rel === 1 && i > j) || (rel === -1 && i < j)) ok = false;
        });
        return { o, j, ok, f: Math.hypot(want.l - p.l, want.cy - p.cy), h: L.h };
      };
      let js = [];
      for (let j = fixed; j <= rest.length; j++) js.push(j);
      if (js.length > 40) {   // a long row: the places beside the chips nearest the shown one, and the ends
        const near = [...row.querySelectorAll('[data-chip]')].map((c) => { const s = slot(c); return { k: c.dataset.chip, dist: Math.hypot(s.cx - s.w / 2 - want.l, s.cy - want.cy) }; })
          .sort((a, b) => a.dist - b.dist).slice(0, 12);
        const set = new Set([fixed, rest.length, cur]);
        for (const n of near) { const i = rest.findIndex((u) => keyOf(u) === n.k); if (i >= 0) { set.add(i); set.add(i + 1); } }
        js = [...set].filter((j) => j >= fixed && j <= rest.length);
      }
      const now = score(list, cur);
      if (!now) return;
      const all = [];
      for (const j of js) {
        if (j === cur) continue;
        const o = rest.slice();
        o.splice(j, 0, d.u);
        const sc = score(o, j);
        if (sc) all.push(sc);
      }
      const near = (a, b) => a.f - b.f || a.h - b.h, ok = all.filter((c) => c.ok);
      let best;
      if (now.ok) best = ok.sort(near).find((c) => c.f < now.f - HYST);   // both fit (a wide chip and a short one swapped): the nearer
      else if (ok.length) {   // several: the fewest passed, unless another is nearer by HYST, as the next move would choose
        const few = ok.slice().sort((a, b) => Math.abs(a.j - cur) - Math.abs(b.j - cur) || near(a, b))[0];
        best = ok.sort(near).find((c) => c.f < few.f - HYST) || few;
      } else best = all.sort(near).find((c) => c.f < now.f - HYST);
      best = best && best.o;
      if (!best) return;
      S.flip(row, () => order(best, d.u), key);
      mark();
    }
    return { cls };
  };

  S.typed = [];
  try { const t = JSON.parse(localStorage.getItem('scales.typed')); if (Array.isArray(t)) S.typed = t.filter((x) => typeof x === 'string' && S.ratio(x)).slice(-12); } catch (e) {}
  // the everyday intervals, always visible in pickers
  S.CORE_RATIOS = ['1/1', '16/15', '9/8', '6/5', '5/4', '4/3', '7/5', '3/2', '8/5', '5/3', '7/4', '15/8', '2/1'];

  // Ratio picker: the everyday chips and "+ more", whose library (grouped by prime limit, or the given groups) opens right
  // below them; then, under a rule, this browser's own chips (the scale's other notes, tempered ones too, and typed ones)
  // and the free p/q field that makes them
  // grouped by prime limit (or the given groups). isOn(str) marks chips; onPick(str) on click.
  // With et: true, dashed 12-TET chips (labelled by cents) pick the tempered notes k\12 (1200: the 2/1).
  // isAlso (Beats, the Lattice's axes): notes also chosen besides the one that is on: kept among this browser's chips, drawn as any
  // parse (Spiral: unfolded): typed text → the string picked, or null (default: S.parseNote); onField(input): after each render (the field is drawn anew; a focused one keeps focus and text)
  // steps (Spiral): () => more chips among this browser's own, {key, c, cls, on, html, title}, intervals no note chip shows (9/4, 700¢);
  // onTyped(str): what Enter in the field picks, before onPick; core: the first row (Lattice: the primes' first steps)
  // The own row (under the rule) shows OWN_MAX chips, the lowest, every chosen one and every step chip (few: the path's
  // intervals and 12 typed), until "+ n more": a scale of 500 notes hid the field under screens of them. Opened, they stay
  // open, with no "less" (the user, 2026-11-21), until the library is hidden (collapse)
  const OWN_MAX = 12;
  S.ratioPicker = (root, { isOn, onPick, et = false, isAlso = () => false, exclude = [], groups = S.RATIO_GROUPS,
    parse = S.parseNote, placeholder = 'p/q, ¢ or k\\N ⏎', onField, steps, onTyped, core = S.CORE_RATIOS }) => {
    let open = false, ownAll = false;
    root.classList.add('picker');
    const chip = (s, extra = '') => {
      if (exclude.includes(s)) return '';
      const r = S.ratio(s);
      return r ? `<button class="chip ${r.cls}${isOn(s) ? ' on' : ''}${extra}" data-r="${s}" title="${[S.ndTip(r, S.wideLabel(r)), S.exactC(r.cents)].filter(Boolean).join(' · ')}">${S.breakHTML(S.labelHTML(S.wideLabel(r)))}</button>` : '';
    };
    const byCents = (list) => [...list].sort((a, b) => S.ratio(a).cents - S.ratio(b).cents);
    // simplest first: smaller n·d (Tenney height), ties by pitch
    const bySimplicity = (list) => [...list].sort((a, b) => {
      const x = S.ratio(a), y = S.ratio(b);
      const h = (r) => (r.nd ? Number(r.n * r.d) : Infinity);   // a long one last, its n/d never made
      return h(x) - h(y) || x.cents - y.cents;
    });
    const input = `<input type="search" enterkeyhint="done" class="ratio-in" placeholder="${placeholder}" spellcheck="false" aria-label="${placeholder.replace(' ⏎', '')}, Enter to use">`;
    // this browser's own chips, by pitch: the scale's notes, typed ratios and the view's own steps; keep: chosen (on or also)
    // a view's steps (the Spiral's): {key, c, cls, on, html(), title()}, all kept in the short row while there are at most
    // OWN_MAX, past that the chosen one, the rest behind "+ more" as any own chip (all kept, 9999 different intervals were
    // 9999 chips, drawn anew on every press)
    let stepList = [];
    const own = (fresh = true) => { if (fresh) stepList = steps ? steps() : []; return ownOf(); };
    const ownOf = () => [...new Set([...S.scale, ...S.typed])].filter((s) => S.ratio(s) && !core.includes(s) && !exclude.includes(s))
      .map((s) => ({ key: s, c: S.ratio(s).cents, keep: isOn(s) || isAlso(s), html: () => chip(s) }))
      .concat(stepList.map((x) => ({ key: x.key, step: true, c: x.c, keep: x.on || stepList.length <= OWN_MAX, html: () => `<button class="chip own-step ${x.cls}${x.on ? ' on' : ''}" data-r="${x.key}" title="${x.title()}">${x.html()}</button>` })))
      .sort((a, b) => a.c - b.c);
    const ownShown = (items) => (ownAll || items.length <= OWN_MAX ? items : items.filter((x, i) => i < OWN_MAX || x.keep));
    const render = () => {
      const old = root.querySelector('.ratio-in'), kept = old && document.activeElement === old ? old.value : null;
      const items = own(), shown = ownShown(items);
      const extras = shown.map((x) => x.html());
      if (items.length > OWN_MAX && !ownAll) extras.push(`<button class="chip more" data-ownmore>+ ${items.length - shown.length} more</button>`);
      root.innerHTML = `
        <div class="chips">${core.map((s) => chip(s)).join('')}
          <button class="chip more${open ? ' open' : ''}" data-more><span>+ more</span><span>− less</span></button>
        </div>
        ${open ? `<div class="library">${groups.map((g) => `
          <div class="lib-row"><span class="lib-label">${g.label}</span><div class="chips">${bySimplicity(g.list).map((s) => chip(s)).join('')}</div></div>`).join('')}
          ${et ? `<div class="lib-row"><span class="lib-label">EDO</span><div class="chips">${Array.from({ length: 12 }, (_, i) => {
            const s = i === 11 ? '2/1' : S.edoKey(i + 1, 12);
            if (exclude.includes(s)) return '';
            return `<button class="chip et${isOn(s) ? ' on' : ''}" data-r="${s}" title="${(i + 1) * 100}¢">${S.labelHTML(S.ratio(s).label)}</button>`;   // the note it gives, as the tone chips name it (4\12 reads 1\3)
          }).join('')}</div></div>` : ''}
        </div>` : ''}
        <div class="chips picker-own">${extras.join('')}${input}</div>`;
      const inp = root.querySelector('.ratio-in');
      if (kept != null && inp) { inp.value = kept; inp.focus({ preventScroll: true }); }
      if (onField && inp) onField(inp, kept != null);
    };
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { open = !open; if (!open) ownAll = false; render(); return; }
      // the button goes with the row it opened: from the keyboard the focus moves on to the field
      if (e.target.closest('[data-ownmore]')) { ownAll = true; render(); if (!e.detail) root.querySelector('.ratio-in')?.focus(); return; }
      const c = e.target.closest('[data-r]');
      if (c) { onPick(c.dataset.r); render(); }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('.ratio-in')) return;
      const str = parse(e.target.value);
      if (!str) { e.target.classList.add('bad'); return; }
      // typed ratios stay at hand as chips (a ratio in the octave, or one with cents; the Spiral's 9/4 or 700¢ don't)
      const r = S.ratio(str);
      if (r && (!r.temp || r.mix) && S.noteKey(str) === str && !S.typed.includes(str) && !core.includes(str)) { S.typed = [...S.typed, str].slice(-12); try { localStorage.setItem('scales.typed', JSON.stringify(S.typed)); } catch (e) {} }
      e.target.value = '';
      if (onTyped) onTyped(str);
      onPick(str);
      render();
      root.querySelector('.ratio-in').focus();
    });
    root.addEventListener('input', (e) => e.target.classList && e.target.classList.remove('bad'));
    S.on('scale', S.whenShown(root)(render));   // a hidden picker draws when it next shows
    render();
    // only what is chosen moved (a Spiral arc pressed): the chips' marks, not a hundred chips drawn anew
    const mark = () => {
      stepList = steps ? steps() : [];   // once: a long path's steps take a while
      // a chosen chip that the short row leaves out: the row anew, with it
      if (!ownAll) {
        const there = new Set([...root.querySelectorAll('.picker-own .chip[data-r]')].map((c) => (c.classList.contains('own-step') ? 's' : 'n') + c.dataset.r));
        if (own(false).some((x) => x.keep && !there.has((x.step ? 's' : 'n') + x.key))) { render(); return; }
      }
      const stepOn = new Set(stepList.filter((x) => x.on).map((x) => x.key));
      root.querySelectorAll('.chip[data-r]').forEach((c) => {
        const s = c.dataset.r, on = c.classList.contains('own-step') ? stepOn.has(s) : isOn(s);
        c.classList.toggle('on', on);
      });
    };
    // the library hidden (Beats' Hide library, the Lattice's pop shut): this browser's own chips back to the short row
    const collapse = () => { if (ownAll) { ownAll = false; render(); } };
    return { render, mark, collapse };
  };

  // Text centred on a point (a dot, a cell): baseline shift so the digits' and capitals' ink sits
  // on the centre, measured with canvas font metrics (dominant-baseline centres the em box instead)
  S.DY_SANS = '.352em';
})();
