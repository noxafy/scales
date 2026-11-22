'use strict';
// The side panel and what views share: playing the scale and chords, Edit, the link and Use buttons, copying
// notes, menus, the rim, the scale list.
(() => {
  const S = window.S;

  /* ---------- playing, the shared buttons and menus ---------- */

  // Arrow keys: → ↑ one step on, ← ↓ one back. A selection reached by arrow sounds as a click: the
  // press minimum, 50 ms, as a quick mouse click. On a note picked on the rim (or in the list), every view walks the rim: the scale.
  S.ARROWS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
  // a fresh click cuts what the last one left ringing, as a fresh press does in S.holdOn
  let clickTail = null;
  S.click = (fn) => {
    if (clickTail) S.audio.immediately(clickTail);
    const stop = S.audio.press(fn);
    clickTail = typeof stop === 'function' ? stop : null;
    if (clickTail) clickTail();
  };
  S.rimStep = (str, d) => {
    const ns = S.scale;
    if (!ns.length) return false;
    const r = str && S.ratio(str);
    let i = r ? ns.indexOf(S.noteKey(str)) : d > 0 ? -1 : 0;   // nothing picked: from the scale's ends
    if (i < 0 && r) {   // a picked note no longer in the scale: the next one above or below it
      const c = r.cents, j = ns.findIndex((s) => S.ratio(s).cents > c);
      i = d > 0 ? (j < 0 ? ns.length : j) - 1 : (j < 0 ? ns.length : j);
    }
    const next = ns[S.mod(i + d, ns.length)];
    S.emit('pick', next);
    S.click(() => S.playScaleNotes([next]));
    return true;
  };
  // the element nearest from one in an arrow's direction, by where they are on screen (Numbers)
  S.spatialStep = (from, els, code) => {
    const [ux, uy] = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[code];
    const mid = (e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    const [x0, y0] = mid(from);
    // ahead, within a cone of about ±63°; with nothing there, anywhere ahead
    let best = null, bs = Infinity, wide = null, ws = Infinity;
    for (const e of els) {
      if (e === from) continue;
      const [x, y] = mid(e), a = (x - x0) * ux + (y - y0) * uy, p = Math.abs((x - x0) * uy - (y - y0) * ux);
      if (a < 1) continue;
      const s = a + 2 * p;
      if (p <= 2 * a) { if (s < bs) { bs = s; best = e; } }
      else if (s < ws) { ws = s; wide = e; }
    }
    return best || wide;
  };
  // "Scale" in every tab plays the scale, the notes on the rim, up to the octave; pressed again it stops
  // Edit (the Lattice): on, tapping or dragging over notes adds them to the Lattice's notes or removes them ('edit')
  S.EDIT_BTN = '<button class="btn quiet" data-act="edit" aria-pressed="false">Edit</button>';
  S.editing = false;
  const editShow = (b) => { b.classList.toggle('on', S.editing); b.setAttribute('aria-pressed', S.editing); };
  S.editSwitch = (root, onChange) => {
    const b = root.querySelector('[data-act="edit"]');
    editShow(b); onChange(S.editing);
    S.on('edit', onChange);
    b.addEventListener('click', (e) => {
      S.editing = !S.editing;
      if (e.detail) b.blur();   // clicked: from the keyboard the focus stays to go on from
      document.querySelectorAll('[data-act="edit"]').forEach(editShow);
      S.emit('edit', S.editing);
    });
  };
  // one pace for every run of notes (S.run): faster when there are many
  S.seqPace = (n) => ({ step: n > 17 ? 0.16 : 0.26, len: 0.45 });
  // every button that plays a run of notes (Scale, the Lattice's Scale, the Cycle's Chain and Scale, the Spiral's Path
  // and Scale) starts on the press, as Chord does (a click waits for the release), Enter and Space too
  S.seqBtn = (btn, play) => {
    btn.addEventListener('pointerdown', (e) => { if (e.button === 0) play(); });
    btn.addEventListener('click', (e) => { if (e.detail === 0) play(); });
  };
  S.SCALE_BTN = '<button class="btn quiet" data-play-scale><span class="ico seq"></span>Scale</button>';
  // notes lit wherever they show while they sound; returns what puts them out
  S.lightNotes = (strs) => { strs = strs.filter(Boolean); S.markScale(strs, true); return () => S.markScale(strs, false); };
  // The run of notes that sounds, one at a time (as S.audio.sequence): every one of the buttons that started it (sel)
  // looks held while it sounds, also in a view opened meanwhile, and step(k) lights the k-th note it plays, returning
  // what puts it out. A press on those buttons while it runs stops it; on another run's, that run starts instead
  let run = null;
  const runLit = (on) => run && document.querySelectorAll(run.sel).forEach((b) => b.classList.toggle('held', on));
  S.run = (sel, freqs, step) => {
    if (run) { const same = run.sel === sel; run.cancel(); if (same) return; }
    if (!freqs.length) return;
    const me = { sel };
    let off = null;
    run = me; runLit(true);
    me.cancel = S.audio.sequence(freqs, {
      ...S.seqPace(freqs.length),
      onStep: (k) => {
        if (off) { off(); off = null; }
        if (k >= 0) { off = step(k) || null; return; }
        if (run === me) { runLit(false); run = null; }
      },
    });
  };
  // stop the run if one of these buttons started it (none given: whatever runs)
  S.stopRun = (...sels) => { if (run && (!sels.length || sels.includes(run.sel))) run.cancel(); };
  S.on('shown', () => runLit(true));
  S.playScale = () => {
    if (!S.audible().length) { S.stopRun('[data-play-scale]'); return; }
    // each note looks at the mutes when its turn comes, so muting while it runs takes effect at once;
    // it ends on the lowest note sounding by then, an octave up
    let cur = null;
    const at = (str, oct) => () => {
      cur = str && S.inScale(str) && !S.isSilent(str) ? str : null;
      return cur && S.ratioFreq(cur, oct);
    };
    S.run('[data-play-scale]', [...S.scale.map((r) => at(r, 0)), () => at(S.audible()[0], 1)()], () => S.lightNotes([cur]));
  };
  // over the Lattice's picture, as over the Cycle's: Scale for its own notes
  // the link with the scale: in the gap beside the side panel, beside the preset menu (tabs.js) where that panel is a drawer
  const linkBtn = (cls) => `<button class="icon-btn link-btn ${cls}" data-latticelink title="Link with scale" aria-label="Link with scale" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><g class="linked"><path d="M10 14a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.2-1.2"/></g>` +
    // unlinked: the chain broken, its two ends apart, a crack between them
    `<g class="broken"><path d="M18.8 12.3l1.8-1.8a5 5 0 0 0-7.1-7.1l-1.8 1.8"/><path d="M5.2 11.7l-1.8 1.8a5 5 0 0 0 7.1 7.1l1.8-1.8"/><path d="M8 2v3M2 8h3M16 19v3M19 16h3"/></g></svg></button>`;
  S.latticeHead = (lead = '') => `<div class="toolbar chart-head">${lead}<span class="head-btns"><button class="btn quiet" data-act="lscale"><span class="ico seq"></span>Scale</button></span></div>`;
  S.LATTICE_LINK = linkBtn('in-menu');
  S.latticeFig = (inner) => `<div class="gap-fig">${inner}${linkBtn('in-gap')}</div>`;
  // Use as scale in the Cycle and the Spiral: an arrow toward the scale list where the Lattice has its link (the user,
  // 2026-11-12; the link's own "Use as scale" carries the same arrow), across the gap, or beside the preset menu where
  // the side panel is a drawer. It acts once: never "on", only off while the scale is already these notes.
  // Its view wires it (S.useWire)
  const useBtn = (cls) => `<button class="icon-btn link-btn use-btn ${cls}" data-toscale title="Use as scale" aria-label="Use as scale"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg></button>`;
  S.USE_BTN = useBtn('in-menu');
  S.useFig = (inner) => `<div class="gap-fig">${inner}${useBtn('in-gap')}</div>`;
  // el: a part inside its tab; notes(): what goes in. Returns sync(), which turns both arrows off while the scale is them
  // A press: Use as scale at once while the scale is empty or the 1/1 alone (nothing to keep), else a menu, as the link's:
  // Use as scale, or Add to scale (the user, 2026-11-19), off while every note is already in
  S.useWire = (el, notes) => {
    const tab = el.closest('.view') || el, btns = () => tab.querySelectorAll('[data-toscale]');
    tab.addEventListener('click', (e) => {
      const b = e.target.closest('[data-toscale]');
      if (!b) return;
      const open = S.linkPopShown();
      S.closeLinkPop();
      if (open) return;
      const ns = notes();
      if (!S.scale.length || S.scale.join() === '1/1') { S.useAsScale(ns); return; }
      S.openLinkPop(b, [['to', 'Use as scale', () => S.useAsScale(ns)], ['add', 'Add to scale', () => S.addAllToScale(ns), ns.every((x) => S.inScale(x))]]);
    });
    return () => {
      const ns = notes(), same = ns.length === S.scale.length && ns.every((x) => S.inScale(x));
      btns().forEach((b) => { b.disabled = same; });
    };
  };
  const playLattice = () => {
    const ns = [...S.latticeNotes.notes];
    if (!ns.length) { S.stopRun('[data-act="lscale"]'); return; }
    S.run('[data-act="lscale"]', [...ns.map((r) => S.ratioFreq(r, 0)), S.ratioFreq(ns[0], 1)], (k) => S.lightNotes([ns[k % ns.length]]));
  };
  S.latticeWire = (root) => {
    S.seqBtn(root.querySelector('[data-act="lscale"]'), playLattice);
    S.markLink();
  };
  S.markLink = () => document.querySelectorAll('[data-latticelink]').forEach((b) => { b.classList.toggle('on', S.latticeNotes.linked); b.setAttribute('aria-pressed', S.latticeNotes.linked); b.title = S.latticeNotes.linked ? 'Unlink from scale' : 'Link with scale'; });
  S.on('latticelink', S.markLink);
  // a note as text to copy, each in a form the note fields read back: a ratio as its numbers (12009693184/11717731181)
  // while they have at most S.COPY_DIGITS digits, factored (2¹³·67·21881 / 13·211·877·4871) and its exact cents; k\N and
  // its cents; cents. Forms that read alike once spaces go are one (3/2 and 3 / 2), and the 1/1 has nothing to factor.
  // Longer numbers only factored: 3¹⁰⁰⁰⁰⁰ written out is 48 000 digits, and making them took seconds
  S.COPY_DIGITS = 100;
  S.noteCopies = (str) => {
    const r = S.ratio(str), out = [];
    if (!r) return out;
    const add = (t) => { if (!out.some((x) => x.replace(/\s/g, '') === t.replace(/\s/g, ''))) out.push(t); };
    if (r.e) {
      const nd = S.qND(r.e, S.COPY_DIGITS);
      if (nd) add(`${nd[0]}/${nd[1]}`);
      if (Object.keys(r.e).length) add(S.fmtMonzo(r.e));
    } else if (r.edo) add(r.label);
    else if (r.mix) add(S.noteText(str));
    add(`${S.roundC(r.cents)}¢`);
    return out;
  };
  // the one form Ctrl+C copies, and an edited note starts from: the numbers while short (S.Q_DIGITS), else factored
  S.noteText = (str) => {
    const r = S.ratio(str);
    if (!r) return '';
    if (r.e) return S.qND(r.e, S.Q_DIGITS) ? S.noteCopies(str)[0] : S.fmtMonzo(r.e);
    if (r.mix) return `${S.noteText(r.rpart.str)} + ${S.noteText(r.tpart.str)}`;   // as S.parseNote reads it back
    return r.edo ? r.label : `${S.roundC(r.cents)}¢`;
  };
  // a short word at the foot of the screen that something happened out of sight (a copy), gone after a moment
  let toastEl = null, toastT = 0;
  S.toast = (msg) => {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 1600);
  };
  // onto the clipboard; outside https (a phone on the LAN) the clipboard API is missing, a hidden field copies instead
  S.copyText = (text) => {
    const done = () => S.toast(`Copied ${text}`);
    const old = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0;';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      ok ? done() : S.toast('Couldn’t copy');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, old);
    else old();
  };
  // Ctrl+C / ⌘C with nothing selected and no field focused (app.js): the selected note (S.sel), as S.noteText writes it.
  // From the keydown, not the copy event: Safari fires none while nothing is selected
  S.copyNote = () => {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return false;
    const text = S.noteText(S.sel.note);
    if (!text) return false;
    S.copyText(text);
    return true;
  };
  // a small menu under a button, in the look of the dropdowns' list: items [{ label, value?, cls?, act }], null a rule
  // between them. Shut by a choice, a press elsewhere, Esc, a scroll or a resize; opened from the keyboard, its first
  // item has the focus, and shutting gives it back to the button
  let notePop = null;
  const closeNotePop = (refocus) => {
    if (!notePop) return;
    const { pop, btn } = notePop;
    notePop = null;
    pop.remove();
    btn.setAttribute('aria-expanded', 'false');
    if (refocus && document.contains(btn)) btn.focus();
  };
  S.openMenu = (btn, items, byKey) => {
    const again = notePop && notePop.btn === btn;
    closeNotePop(false);
    if (again) return;
    const pop = document.createElement('div');
    pop.className = 'sel-pop note-pop';
    pop.setAttribute('role', 'menu');
    pop.innerHTML = items.map((it, i) => (it ? `<button class="sel-opt${it.cls ? ' ' + it.cls : ''}" role="menuitem" data-i="${i}"><span>${S.esc(it.label)}</span>${it.value ? `<span class="mi-v">${S.labelHTML(it.value)}</span>` : ''}</button>` : '<div class="mi-sep" role="separator"></div>')).join('');
    document.body.append(pop);
    const box = btn.getBoundingClientRect(), edge = 8, w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${S.clamp(box.right - w, edge, Math.max(edge, innerWidth - w - edge))}px`;
    pop.style.top = `${box.bottom + 4 + h <= innerHeight - edge || box.top - 4 - h < edge ? box.bottom + 4 : box.top - 4 - h}px`;
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    pop.addEventListener('click', (e) => {
      const o = e.target.closest('[data-i]');
      if (!o) return;
      closeNotePop(e.detail === 0);
      items[+o.dataset.i].act(e.detail === 0);   // chosen from the keyboard (Enter, Space)
    });
    notePop = { pop, btn, at: box.top + ',' + box.left };
    btn.setAttribute('aria-expanded', 'true');
    if (byKey) pop.querySelector('button').focus();
  };
  // on the window, first: the list's buttons keep their presses from the document (M, ⋮), and a press on M shuts it too
  window.addEventListener('pointerdown', (e) => { if (notePop && !notePop.btn.contains(e.target) && !notePop.pop.contains(e.target)) closeNotePop(false); }, true);
  // a scroll that moved its button away (one landing just after it opened, from a scroll that brought the button into view, left it where it was)
  window.addEventListener('scroll', (e) => {
    if (!notePop || notePop.pop.contains(e.target)) return;
    const b = notePop.btn.getBoundingClientRect();
    if (b.top + ',' + b.left !== notePop.at) closeNotePop(false);
  }, true);
  window.addEventListener('resize', () => closeNotePop(false));
  S.on('panic', () => closeNotePop(true));   // Esc
  // ↑ ↓ (Home, End) move through its items (the way menu's too), stopping at the ends as the dropdowns' list does; from
  // its button (opened with a mouse) ↓ goes to the first, ↑ to the last. Enter or Space chooses. The views never see these arrows
  window.addEventListener('keydown', (e) => {
    const pop = notePop ? notePop.pop : linkPop;
    if (!pop || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const opts = [...pop.querySelectorAll('.sel-opt:not(:disabled)')], i = opts.indexOf(document.activeElement);
    if (!opts.length) return;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1
      : i < 0 ? (e.key === 'ArrowDown' ? 0 : opts.length - 1) : S.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, opts.length - 1);
    opts[to].focus();
  }, true);

  // the link's direction, and the Cycle's and Spiral's arrow, in the look of the dropdowns' list: opts [way, label, act, off];
  // way 'to' (→, towards the scale), 'from' (←), 'add' (→ with a plus over its head). Placed and moved through as S.openMenu
  let linkPop = null;
  const closeLinkPop = () => { if (linkPop) { linkPop.remove(); linkPop = null; } };
  const LINK_ICON = {
    to: '<svg class="arr" viewBox="0 0 18 12" aria-hidden="true"><path d="M3 6H12.5M8.5 2L12.5 6L8.5 10"/></svg>',
    from: '<svg class="arr" viewBox="0 0 18 12" aria-hidden="true"><path d="M13 6H3.5M7.5 2L3.5 6L7.5 10"/></svg>',
    add: '<svg class="arr" viewBox="0 0 18 12" aria-hidden="true"><path d="M3 6H12.5M8.5 2L12.5 6L8.5 10M15.5 0v4.4M13.3 2.2h4.4"/></svg>',   // the arrow with a small plus over its head, as "add to" icons draw it
  };
  S.openLinkPop = (b, opts) => {
    closeLinkPop();
    linkPop = document.createElement('div');
    linkPop.className = 'sel-pop link-pop';
    linkPop.setAttribute('role', 'menu');
    linkPop.innerHTML = opts.map(([way, label, , off], i) => `<button class="sel-opt" role="menuitem" data-way="${i}"${off ? ' disabled' : ''}>${LINK_ICON[way]}${label}</button>`).join('');
    document.body.append(linkPop);
    const box = b.getBoundingClientRect(), edge = 8, h = linkPop.offsetHeight;
    linkPop.style.left = `${S.clamp(box.left, edge, Math.max(edge, innerWidth - linkPop.offsetWidth - edge))}px`;
    linkPop.style.top = `${box.bottom + 4 + h <= innerHeight - edge || box.top - 4 - h < edge ? box.bottom + 4 : box.top - 4 - h}px`;   // above when there's no room below
    if (b.matches(':focus-visible')) linkPop.querySelector('.sel-opt:not(:disabled)')?.focus({ preventScroll: true });   // opened from the keyboard
    linkPop.addEventListener('pointerdown', (e) => e.stopPropagation());
    linkPop.addEventListener('click', (e) => {
      const o = e.target.closest('[data-way]');
      if (!o || o.disabled) return;
      closeLinkPop();
      opts[+o.dataset.way][2]();
    });
  };
  S.linkPopShown = () => !!linkPop;
  S.closeLinkPop = closeLinkPop;
  const openLinkPop = (b) => S.openLinkPop(b, [['to', 'Use as scale', S.latticeNotes.linkTo], ['from', 'From scale', S.latticeNotes.linkFrom], ['add', 'Add to scale', S.latticeNotes.linkAdd, S.latticeNotes.notes.every((x) => S.inScale(x))]]);   // off when it adds nothing, as the Cycle's
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-latticelink]');
    if (!b) return;
    const open = linkPop;
    closeLinkPop();
    if (open) return;
    if (S.latticeNotes.linked) { S.latticeNotes.setLinked(false); return; }
    const way = S.latticeNotes.linkWay();
    if (way === 'same') S.latticeNotes.setLinked(true);
    else if (way === 'to') S.latticeNotes.linkTo();
    else if (way === 'from') S.latticeNotes.linkFrom();
    else openLinkPop(b);
  });
  document.addEventListener('pointerdown', (e) => { if (linkPop && !e.target.closest('[data-latticelink], [data-toscale]')) closeLinkPop(); });
  window.addEventListener('scroll', closeLinkPop, true);
  window.addEventListener('resize', closeLinkPop);
  S.on('panic', closeLinkPop);
  // starts on press, like Chord (a click waits for the release); Enter on the focused button still works
  document.addEventListener('pointerdown', (e) => { if (e.button === 0 && e.target.closest('[data-play-scale]')) S.playScale(); });
  document.addEventListener('click', (e) => { if (e.detail === 0 && e.target.closest('[data-play-scale]')) S.playScale(); });
  // Chord: the whole scale at once (every tab with a scale list, next to Scale), while held; it follows mutes and scale edits
  S.CHORD_BTN = '<button class="btn quiet" data-chord><span class="ico chord"></span>Chord</button>';
  // the top of every side panel: the readout (pinned to the window's bottom on narrow windows) and Chord and Scale.
  // reads: the readout box's content (the sub-tabs add one readout per sub-view later)
  S.sideTop = (reads = '') => `<div class="side-top"><div data-reads data-pin>${reads}</div><div class="toolbar side-head">${S.CHORD_BTN}${S.SCALE_BTN}</div></div>`;
  // while held it follows the mutes (and removals): a muted note's voice stops, an unmuted one starts
  S.playChord = () => {
    const ns = S.audible();
    if (!ns.length) return null;
    const on = new Map();
    let gain = null;
    const sync = () => {
      const want = new Set(S.audible()), g = S.gainOf(want.size);
      on.forEach((v, str) => { if (!want.has(str)) { v.stop(); on.delete(str); S.markScale([str], false); } });
      // one loudness for the whole chord, however many notes it has by now
      if (g !== gain) { gain = g; on.forEach((v) => v.setGain(g)); }
      want.forEach((str) => { if (!on.has(str)) { on.set(str, S.audio.tone(S.ratioFreq(str), { gain })); S.markScale([str], true); } });
    };
    const quit = () => { S.off('scale', sync); S.off('panic', quit); };   // Stop: no note comes back
    sync();
    S.on('scale', sync); S.on('panic', quit);
    return () => { quit(); on.forEach((v) => v.stop()); S.markScale([...on.keys()], false); on.clear(); };
  };
  let chordOn = null;
  // Chord on a scale gathered from the harmonics (five or more notes, all among the first 16's eight tones; a preset as it stands doesn't count):
  // while it sounds, the rim itself sends out a sounding dot's ripple and sparks, also on a circle drawn anew meanwhile
  const SERIES = ['1/1', '9/8', '5/4', '11/8', '3/2', '13/8', '7/4', '15/8'];
  const isSeries = () => {
    const ns = S.audible();
    return ns.length >= 5 && ns.every((x) => SERIES.includes(x)) && !S.views.lattice.isPreset(ns);
  };
  // each stretch of the ring has the colour of the sounding notes beside it, blending from one dot to the next
  const RIM_ARCS = 120;
  const rimNotes = () => S.audible().map((str) => {
    const r = S.ratio(str);
    return { a: (r.cents * .3 + 270) % 360, c: `var(--${r.temp ? 'ink' : r.cls})` };   // 0¢ at the top
  }).sort((x, y) => x.a - y.a);
  const rimColour = (ns, a) => {
    if (!ns.length) return 'var(--ink-2)';
    const k = ns.findIndex((n) => n.a > a), to = ns[k < 0 ? 0 : k], from = ns[((k < 0 ? 0 : k) + ns.length - 1) % ns.length];
    const gap = (to.a - from.a + 360) % 360 || 360;
    return `color-mix(in oklab, ${to.c} ${((a - from.a + 360) % 360 / gap * 100).toFixed(1)}%, ${from.c})`;
  };
  const rimPaint = (g) => {
    const key = S.audible().join();
    if (g.dataset.notes === key) return;
    g.dataset.notes = key;
    const ns = rimNotes();
    g.querySelectorAll('.ripple.rim path').forEach((arc, i) => { arc.style.stroke = rimColour(ns, (i + .5) * 360 / RIM_ARCS); });
    g.querySelectorAll('.spark').forEach((sp) => { sp.style.fill = rimColour(ns, (parseFloat(sp.style.getPropertyValue('--a')) + 360) % 360); });
  };
  const rimArcs = (r) => Array.from({ length: RIM_ARCS }, (_, i) => {
    const pt = (a) => `${(r * Math.cos(a * Math.PI / 180)).toFixed(2)} ${(r * Math.sin(a * Math.PI / 180)).toFixed(2)}`, w = 360 / RIM_ARCS;
    return `<path d="M${pt(i * w)}A${r} ${r} 0 0 1 ${pt((i + 1) * w + .3)}"/>`;   // a little over, so no seams
  }).join('');
  // the rule and the colours follow the notes while the chord sounds; a circle drawn anew gets its ring back
  let rimOn = false;
  const rimDraw = () => {
    if (rimOn) document.querySelectorAll('.clock').forEach((svg) => {
      const face = svg.querySelector('.clock-face');
      if (!face) return;
      const c = +face.getAttribute('cx'), r = +face.getAttribute('r') * S.CLOCK_SCALE;   // round the scale's ring
      if (!S.sparksOf(svg)) S.sparkle(svg, svg, c, c, `<g class="ripple rim" style="--s:${(r + 16) / r}">${rimArcs(r)}</g>`, S.roundRipple(r)[1], null, 72);
      rimPaint(S.sparksOf(svg));
    });
  };
  const rimSync = () => {
    rimOn = isSeries();
    if (!rimOn) document.querySelectorAll('.clock').forEach(S.unsparkle);
    rimDraw();
  };
  const rimWatch = new MutationObserver(rimDraw);
  const rimStop = () => { S.off('scale', rimSync); rimWatch.disconnect(); rimOn = false; document.querySelectorAll('.clock').forEach(S.unsparkle); };
  const chordRim = () => {
    const stop = S.playChord();
    if (!stop) return stop;
    rimSync();
    S.on('scale', rimSync);
    rimWatch.observe(document.body, { childList: true, subtree: true });
    return () => { stop(); rimStop(); };
  };
  S.on('panic', rimStop);
  S.stopChord = S.playHold('[data-chord]', () => (chordOn = S.audio.press(chordRim)), () => { if (chordOn) { chordOn(); chordOn = null; } });
  S.on('panic', S.stopChord);

  // the scale's dots play their note; the note names around the circle the 12-TET notes above the 1/1
  const rimPlay = (d) => S.playScaleNotes([d.dataset.sr]);
  const etPlay = (d) => {
    const stop = S.playScaleNotes([d.dataset.ek]);   // what shows this pitch lights; the button itself is held, as a button is
    d.classList.add('held');
    return () => { stop(); d.classList.remove('held'); };
  };
  // a circle's own dots (sel) plus its scale's and the note names, in one holdOn, so a held press glides
  // across all of them; such a circle is marked .own-rim. pick (given: the view
  // selects rim notes): a pressed scale note or note name (its 12-TET note, k\12) is picked, 'pick', as a list row is, so
  // the shared note follows too (only the view's own callback ran: its readout moved, S.sel stayed); the view's
  // 'pick' listener selects it. A dot marked data-pick (data-r: its note) is a place to go, not one of the view's own
  // notes (Beats: the bars' notes): a press on it does what a press on a scale note does
  S.clockHold = (el, sel, start, pick = null) => {
    el.classList.add('own-rim');
    // while held, what is above the circle keeps its height, so the circle stays under the pointer: a long
    // ratio's headline wraps to more lines (a Spiral of 600 steps moved it 118 px mid-glide); it settles on release.
    // The headline keeps the lines it had (.hold: cut with an ellipsis), the box its height (whatever else wraps)
    const top = () => el.closest('.panel')?.querySelector('.side-top');
    const unlock = () => { const t = top(); if (t) { t.classList.remove('hold'); t.style.height = ''; t.style.removeProperty('--hl-lines'); } };
    el.addEventListener('pointerdown', () => {
      const t = top();
      if (!t || t.classList.contains('hold')) return;
      const hl = t.querySelector('.readout .hl');
      t.style.setProperty('--hl-lines', Math.max(1, Math.round((hl?.offsetHeight || 36) / 36)));
      t.style.height = `${t.offsetHeight}px`;
      t.classList.add('hold');
    }, true);
    window.addEventListener('pointerup', unlock);
    window.addEventListener('pointercancel', unlock);
    S.on('release', unlock);
    S.holdOn(el, `${sel}, .rim, [data-et], [data-own], [data-pick]`, (d, e, glided) => {
      S.sel.oct = 0;   // whatever it is, it sounds folded
      if (d.matches('[data-own]')) return S.playNote(d.dataset.r);   // the selected note's own dot: it is already selected
      if (d.matches('[data-et]')) { if (pick) S.emit('pick', d.dataset.ek, false, 0, true); return etPlay(d); }
      if (d.matches('.rim')) { if (pick) S.emit('pick', d.dataset.sr); return rimPlay(d); }
      if (d.matches('[data-pick]')) { if (pick) S.emit('pick', d.dataset.r, false, 0, true); return S.playScaleNotes([d.dataset.r]); }
      return start(d, e, glided);
    });
  };
  // A tap on a picture's background (in area, on nothing matching skip), begun and ended there: fn, which lets go of
  // the selection (Cycle, Spiral). Where the press began decides, as a press that redraws the picture (an arc's)
  // may send its click to what is left there
  S.bgTap = (area, skip, fn) => {
    let bg = false;
    const off = (t) => !t.closest(skip) && !t.closest('button, input, select, a');
    area.addEventListener('pointerdown', (e) => { bg = e.button === 0 && off(e.target); }, true);
    area.addEventListener('click', (e) => { if (bg && off(e.target)) fn(e); bg = false; });
  };
  S.holdOn(document.documentElement, '.clockwrap:not(.own-rim) .rim', rimPlay);
  // the readout's headline ratio plays its note
  S.holdOn(document.documentElement, '[data-ro]', (d) => S.playNote(d.dataset.ro));
  // touch screens show no tooltips: a tap on a readout's cents or deviation (or a .has-tip, the Spiral's length) shows its title (every digit) in a box
  // above it, until the next touch anywhere but on it (a long press on it selects its value, to copy); a mouse keeps the
  // tooltip (the user: only on touch, so the tooltips stay one kind)
  let tip = null, tipOf = null, tipAgain = false;
  const untip = () => { tip?.remove(); tip = tipOf = null; };
  document.addEventListener('pointerdown', (e) => {
    if (tip && tip.contains(e.target)) return;
    tipAgain = !!tipOf && tipOf.contains(e.target);
    if (tip) untip();
  }, true);
  document.addEventListener('pointerup', (e) => {
    const t = e.pointerType === 'touch' && e.target.closest('.readout .sub [title], .has-tip[title]');
    if (!t || tipAgain) return;   // a second tap on it closes it
    tip = document.createElement('div');
    tip.className = 'tip-pop';
    tip.textContent = t.title;
    document.body.appendChild(tip);
    tipOf = t;
    const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${S.clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
    tip.style.top = `${r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6}px`;
  });
  window.addEventListener('scroll', untip, true);

  // The list under each circle: one row per note (name ± deviation, ratio, cents) and the step to
  // the next between rows; hold a row or a step to hear it, glide along; ⋮ opens the note's menu: edit it
  // in place, copy it (S.noteCopies), delete it.
  // M mutes a note, as on a mixer channel (Scale, Chord and the keys skip it; the steps join the
  // sounding notes), and brings it back.
  // the scale as a Scala file (.scl): the notes that sound, the 1/1 implicit as degree 0, 2/1 the last; a ratio stays
  // a ratio while both sides fit 32 bits (what Scala and most synths read), else cents, which need a point
  const SCL_INT = 2 ** 31 - 1;
  S.sclText = (name) => {
    const ns = S.audible().filter((x) => x !== '1/1');
    const pitch = (str) => {
      const r = S.ratio(str);
      if (!r.temp && r.nd && r.nd[0] <= SCL_INT && r.nd[1] <= SCL_INT) return `${r.nd[0]}/${r.nd[1]}`;
      return r.cents.toFixed(6);
    };
    const hz = S.fmtHz(S.baseFreq()), lines = [
      `! ${name}.scl`,
      `! 1/1 = ${S.midiName(S.settings.base)} = ${hz} Hz`,
      '!',
      location.href.length <= 2000 ? location.href : name,
      ` ${ns.length + 1}`,
      '!',
      ...ns.map((x) => ` ${pitch(x)}`),
      ' 2/1',
    ];
    return lines.join('\r\n') + '\r\n';
  };
  S.saveScl = () => {
    if (S.link) S.link.write();   // the address the file names: an edit's write may still be waiting
    const J = S.views.lattice, name = (J && J.presetOf && J.presetOf(S.audible())) || 'scale';
    const file = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'scale';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([S.sclText(name)], { type: 'text/plain' }));
    a.download = `${file}.scl`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  S.scaleList = (el) => {
    el.classList.add('scale-list');
    // the row marked (.sel) is the picked scale note's (S.clock's data-ringed), in the shown circle of this panel: a note
    // selected in the view's picture (a lattice node, a Spiral dot) marks no row
    let side = null;
    const rimSel = () => {
      if (!side || !side.contains(el)) { side = el.parentElement; while (side && !side.querySelector('.clock')) side = side.parentElement; }
      const clock = side && [...side.querySelectorAll('.clock')].find((c) => !c.closest('[hidden]'));
      return (clock && clock.dataset.ringed) || null;
    };
    const kb = document.createElement('div');
    S.keyboard(kb);
    // a note typed straight into the scale (5/4, 700, 7\12, 3^5/2^7): Enter adds it, picks it and plays it, and the
    // field stays for the next; drawn once, as the keyboard, so a re-render keeps its focus and text. At the list's end,
    // a drawn plus until focused: above the rows, it read as a note to play (the user's test, 2026-11-19)
    const add = document.createElement('div');
    add.className = 'sadd';
    add.innerHTML = '<input type="search" enterkeyhint="done" class="ratio-in sadd-in" placeholder=" " spellcheck="false" autocomplete="off" aria-label="Add a note to the scale: p/q, cents or k\\N, Enter to add">';
    const addIn = add.firstChild;
    addIn.addEventListener('focus', () => { addIn.placeholder = 'p/q, ¢ or k\\N ⏎'; });
    addIn.addEventListener('blur', () => { addIn.placeholder = ' '; });   // empty: the drawn plus shows (style.css)
    addIn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return;   // Stop, and the field lets go (app.js)
      e.stopPropagation();   // letters are text here, not piano keys
      if (e.key !== 'Enter' || e.repeat) return;
      e.preventDefault();
      const str = S.noteKey(S.parseNote(addIn.value) || '');
      if (!str) { addIn.classList.add('bad'); return; }
      const note = str === '2/1' ? '1/1' : str;
      addIn.value = '';
      S.addToScale(note);
      S.emit('pick', note);
      S.click(() => S.playScaleNotes([note]));
    });
    addIn.addEventListener('keyup', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    addIn.addEventListener('input', () => addIn.classList.remove('bad'));
    // a note changed in place (its menu's Edit): its ratio becomes a field holding it as Ctrl+C copies it. Enter puts what
    // it reads as in the note's place (muted if it was, one undo), picks it and plays it, as the add field does; Esc or
    // leaving the field keeps the note
    // Chosen from the keyboard, Enter gives the focus to the new note's ⋮, to go on from there; chosen with a mouse or a
    // finger, the focus just leaves (no ring on the ⋮, and a phone's keyboard goes)
    let editing = null, editByKey = false;
    const edit = (str, byKey) => {
      editing = str;
      editByKey = byKey;
      render();
      const inp = el.querySelector('.srow-edit');
      if (inp) { inp.focus(); inp.select(); }
    };
    const endEdit = () => { if (editing === null) return; editing = null; render(); };
    const commit = (inp) => {
      const old = editing, key = S.parseNote(inp.value), str = key === '2/1' ? '1/1' : key;
      if (!str) { inp.classList.add('bad'); return; }
      editing = null;
      if (str === old) render();
      else S.setScale(S.scale.map((x) => (x === old ? str : x)), [...S.silent].map((x) => (x === old ? str : x)));
      S.emit('pick', str);
      S.click(() => S.playScaleNotes([str]));   // heard, as a note typed into the add field is
      if (editByKey) el.querySelector(`[data-more="${CSS.escape(str)}"]`)?.focus();
      else inp.blur();
    };
    el.addEventListener('keydown', (e) => {
      const inp = e.target.closest('.srow-edit');
      if (!inp || e.key === 'Escape') return;   // Esc: Stop, and the field lets go (app.js), which ends the edit
      e.stopPropagation();   // letters are text here, not piano keys
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); commit(inp); }
    });
    el.addEventListener('keyup', (e) => { if (e.key !== 'Escape' && e.target.closest('.srow-edit')) e.stopPropagation(); });
    el.addEventListener('input', (e) => e.target.classList.contains('srow-edit') && e.target.classList.remove('bad'));
    el.addEventListener('focusout', (e) => { if (e.target.classList.contains('srow-edit')) setTimeout(endEdit); });
    // ⋮: the note's menu
    const menu = (btn, byKey) => {
      const str = btn.dataset.more;
      S.openMenu(btn, [
        { label: 'Edit', act: (byKey) => edit(str, byKey) },
        null,
        ...S.noteCopies(str).map((t) => ({ label: 'Copy', value: t, act: () => S.copyText(t) })),
        null,
        { label: 'Remove', cls: 'danger', act: () => S.removeFromScale(str) },
      ], byKey);
    };
    // patched, not rebuilt: a button pressed with Enter or tapped stays the one it was (its focus, its on edge at once)
    const render = () => {
      S.patch(el, html(), [kb, add]);
      const head = el.firstElementChild;
      if (head.nextSibling !== kb) head.after(kb);   // the keyboard under the head, the field at the end, kept as they are (a held key stays held)
      if (add.parentNode !== el) el.append(add);
      while (add.nextSibling) el.insertBefore(add.nextSibling, add);   // new rows land after it: they move, not the field (a moved field loses its focus)
      fit();
    };
    // tight only when the list's own columns would make it wider than its panel (style.css, .scale-list.tight): a
    // number too long for the ratio column; measured untight each time, on each change and each change of width
    const fit = () => {
      el.classList.remove('tight');
      if (el.scrollWidth > el.clientWidth + 0.5) el.classList.add('tight');
    };
    let fitW = -1;
    new ResizeObserver(() => { if (el.clientWidth !== fitW) { fitW = el.clientWidth; fit(); } }).observe(el);
    const html = () => {
      const ns = S.scale, au = S.audible(), sel = rimSel();
      // empty: the head stays, its Clear greyed out
      const head = `<div class="list-head"><h3>Scale</h3><span class="list-btns">${S.KEYBOARD_BTN()}<button class="icon-btn undo-btn" data-undo title="Undo" aria-label="Undo"${S.canUndoScale() ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button><button class="icon-btn undo-btn redo-btn" data-redo title="Redo" aria-label="Redo"${S.canRedoScale() ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></button><button class="btn quiet clear-btn" data-clear${ns.length ? '' : ' disabled'}>Clear</button></span></div>`;
      if (!ns.length) return head;
      let rows = '';
      ns.forEach((str) => {
        const r = S.ratio(str), sp = S.spell(str), i = au.indexOf(str), mute = i < 0;
        rows += `<div class="srow ${r.cls}${mute ? ' mute' : ''}${str === sel ? ' sel' : ''}" data-r="${str}">
          <button class="smute" data-mute="${str}" aria-pressed="${mute}" aria-label="mute ${str}" title="Mute">M</button>
          <b>${S.labelHTML(sp.name)}</b>
          <span class="mono num dev ${Math.abs(sp.dev) > 10 ? 'far' : ''}" title="${S.exactDev(sp.dev)}">${S.fmtDev(sp.dev)}</span><span></span>
          ${str === editing ? `<input type="search" class="ratio-in srow-edit" value="${S.esc(S.noteText(str))}" enterkeyhint="done" spellcheck="false" autocomplete="off" aria-label="Change ${str}: p/q, cents or k\\N, Enter to change, Esc to keep">`
            : `<span class="mono"${S.ndTip(r) ? ` title="${S.ndTip(r)}"` : ''}>${S.breakHTML(S.labelHTML(r.label))}</span>`}
          <span class="mono num" title="${S.exactC(r.cents)}">${S.fmtC(r.cents)}</span>
          <button class="srm" data-more="${str}" aria-label="${str}: edit, copy, remove" title="Edit, copy, remove" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 4 16" aria-hidden="true"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/></svg></button>
        </div>`;
        if (mute) return;
        const next = au[i + 1] ?? au[0], wrap = i === au.length - 1;
        const a = S.ratio(str), b = S.ratio(next), step = S.stepLabel(a, b, wrap);
        const c = au.length > 1 ? (wrap ? 1200 : 0) + b.cents - a.cents : 1200;
        rows += `<div class="sstep" data-a="${str}" data-b="${next}"${wrap ? ' data-wrap="1"' : ''}>
          <span>↕</span><span class="mono">${step ? S.breakHTML(S.labelHTML(step)) : ''}</span><span class="mono num" title="${S.roundC(c)}¢${step || a.temp || b.temp || au.length < 2 ? '' : ' · ' + S.stepText(a, b, wrap)}">${S.fmtC(c)}</span></div>`;   // a difference: to the app's precision, as a deviation
      });
      return `${head}<div class="shead"><span></span><span>note</span><span>vs 12</span><span></span><span>ratio</span><span>¢</span><span></span></div>${rows}`;
    };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-keyboard]')) S.showKeyboard(!S.keyboardOpen());
      const more = e.target.closest('[data-more]');
      if (more) menu(more, e.detail === 0);
      if (e.target.closest('[data-clear]')) S.setScale([]);
      if (e.target.closest('[data-undo]')) S.undoScale();
      if (e.target.closest('[data-redo]')) S.redoScale();
    });
    // a row also picks its note, as its rim dot and piano key do ('pick': Lattice, Diamond and Spiral select it)
    // A touch may turn into a scroll (pan-y): the browser then cancels the pointer (or the finger glides on
    // first), so a touch picks its row only when it is let go there
    // a press that puts its interval into a step field keeps that field's focus
    const into = (e) => !(e && e.target.closest && e.target.closest('button')) && S.stepFields.get(document.activeElement);
    el.addEventListener('mousedown', (e) => { if (into(e) && e.target.closest('.srow, .sstep')) e.preventDefault(); });
    S.holdOn(el, '.srow, .sstep', (t, e) => {
      const put = into(e);
      if (put) {
        const row = t.classList.contains('srow');
        put(row ? S.stepText(S.ratio('1/1'), S.ratio(t.dataset.r)) : S.stepText(S.ratio(t.dataset.a), S.ratio(t.dataset.b), !!t.dataset.wrap));
        return row ? S.playScaleNotes([t.dataset.r]) : S.playScaleNotes([t.dataset.a, t.dataset.b], { octs: [0, t.dataset.wrap ? 1 : 0] });
      }
      if (!t.classList.contains('srow')) return S.playScaleNotes([t.dataset.a, t.dataset.b], { octs: [0, t.dataset.wrap ? 1 : 0] });
      const pick = !(e && e.target.closest && e.target.closest('button'));
      if (pick && !(e && e.pointerType === 'touch')) S.emit('pick', t.dataset.r);
      const stop = S.playScaleNotes([t.dataset.r]);
      if (!pick || !e || e.pointerType !== 'touch') return stop;
      let up = false;
      // capture: runs before holdOn's own pointerup handler stops this press
      const lift = (ev) => { if (ev.pointerId === e.pointerId) up = true; };
      window.addEventListener('pointerup', lift, true);
      return () => {
        window.removeEventListener('pointerup', lift, true);
        if (stop) stop();
        if (up) S.emit('pick', t.dataset.r);
      };
    }, { list: true });
    S.on('scale', render);
    S.on('settings', render);
    S.on('kbd', render);
    // the selected rim dot's row is marked (.sel) whenever a circle is drawn or shown; nothing scrolls to it. Only the
    // mark moves: patching the list and measuring its width (fit) forced a layout of the whole page in the middle of a
    // press (30 ms beside a Spiral of 9999 steps)
    const markSel = () => {
      const sel = rimSel(), was = el.querySelector('.srow.sel');
      if ((was ? was.dataset.r : null) === sel) return;
      el.querySelectorAll('.srow').forEach((r) => r.classList.toggle('sel', r.dataset.r === sel));
    };
    S.on('rimsel', markSel);
    S.on('shown', markSel);
    render();
  };
})();
