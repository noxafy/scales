'use strict';
// Keys: the keyboard under the circle, the computer keyboard as an instrument, MIDI input.
(() => {
  const S = window.S;

  /* ---------- the keyboard under the circle ---------- */

  // the letter keys drawn as a piano (the head's keyboard button opens it; open or shut in every list at once, kept in
  // this browser, scales.keyboard): each key in the colour of the note it plays and with its letter as a key glyph (no note
  // names: the place says the step, the user's call), Shift (held, or its glyph pressed) their second notes; pressed, a
  // key plays as its letter does, gliding across keys
  let keyboardOpen = false;
  try { keyboardOpen = localStorage.getItem('scales.keyboard') === '1'; } catch (e) {}
  S.showKeyboard = (on) => {
    keyboardOpen = on;
    try { on ? localStorage.setItem('scales.keyboard', '1') : localStorage.removeItem('scales.keyboard'); } catch (e) {}
    S.emit('kbd');
  };
  // its icon: piano keys, not a computer keyboard (the user, 2026-11-19), its lines as Undo's and Redo's, the black
  // keys filled, as on a piano
  const KEYBOARD_BTN = () => `<button class="icon-btn keyboard-btn${keyboardOpen ? ' on' : ''}" data-keyboard title="Keyboard" aria-label="Keyboard" aria-pressed="${keyboardOpen}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 13v7M15 13v7"/><path class="bk" d="M7.25 4h3.5v9h-3.5zM13.25 4h3.5v9h-3.5z"/></svg></button>`;
  // the steps of the white and the black keys (A S D F G H J K L ; and W E T Y U O P), as S.PIANO lays them out
  const WHITE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16], BLACK = [1, 3, 6, 8, 10, 13, 15];
  // the letters as this keyboard's layout prints them, where the browser tells (AZERTY's Q on A's place)
  let letters = (code) => (code === 'Semicolon' ? ';' : code.replace('Key', ''));
  try {
    navigator.keyboard?.getLayoutMap?.().then((m) => {
      if (!m || !m.size) return;
      letters = (code) => (m.get(code) || '').toUpperCase() || (code === 'Semicolon' ? ';' : code.replace('Key', ''));
      S.emit('kbd');
    }).catch(() => {});
  } catch (e) {}
  // a drawn key lights only while it or its letter is pressed, never for its note sounding elsewhere (a dot, MIDI, the
  // other key of its note an octave away): the keyboard isn't folded into the octave (the user's call). Pressed on
  // screen it is 'held' (S.holdOn); its letter held, 'hot' (kbDown: the steps whose letter is down)
  const kbDown = new Set();
  const keyboardLit = (k, on) => {
    on ? kbDown.add(k) : kbDown.delete(k);
    document.querySelectorAll(`.kb-key[data-piano="${k}"]`).forEach((x) => x.classList.toggle('hot', on));
  };
  S.keyboard = (kb) => {
    kb.className = 'kb';
    // drawn once, then each key's note changes in place: a held key stays the element it was (its 'held', its glide)
    const draw = () => {
      const key = (k, black, i) => `<button class="kb-key${black ? ' blk' : ''}" data-piano="${k}"${black ? ` style="--i: ${i}"` : ''}><kbd class="kb-letter"></kbd></button>`;
      // a black key stands on the line between the two white keys around it
      kb.innerHTML = `<div class="kb-keys">${WHITE.map((k) => key(k, false)).join('')}${BLACK.map((k) => key(k, true, WHITE.indexOf(k - 1) + 1)).join('')}</div>`
        // the foot: the 1/1's octave as a stepper, Z down, its note, X up (the note changing says what left and right do), and
        // Shift with what it does (Z and X shown with the keys: the user, 2026-11-19); on touch screens they are the only way to them
        + `<div class="kb-foot"><span class="kb-oct"><button class="kb-shift" data-oct="-1" aria-label="Octave down"><kbd data-l="KeyZ"></kbd></button><b class="kb-base" data-base></b><button class="kb-shift" data-oct="1" aria-label="Octave up"><kbd data-l="KeyX"></kbd></button>Octave</span>`
        + `<span class="kb-sec"><button class="kb-shift" data-shift aria-label="Shift"><kbd>Shift</kbd></button>Secondary notes</span></div>`;
    };
    const render = () => {
      kb.hidden = !keyboardOpen;
      if (!keyboardOpen) return;
      if (!kb.firstChild) draw();
      kb.querySelectorAll('.kb-key').forEach((x) => {
        const k = +x.dataset.piano, b = (shift && S.pianoSecond(k)) || S.pianoNote(k), r = b && S.ratio(b.str), l = letters(S.PIANO[k]);
        const cls = `kb-key${x.classList.contains('blk') ? ' blk' : ''} ${b ? r.cls : 'none'}${x.classList.contains('held') ? ' held' : ''}${kbDown.has(k) ? ' hot' : ''}`;
        if (x.className !== cls) x.className = cls;
        if (b) x.dataset.r = b.str; else delete x.dataset.r;
        x.title = b ? r.label : '';
        x.setAttribute('aria-label', b ? `${l} ${r.label}` : l);
        x.firstChild.textContent = l;
      });
      kb.querySelectorAll('[data-l]').forEach((x) => { x.textContent = letters(x.dataset.l); });
      kb.querySelector('[data-base]').textContent = S.midiName(S.settings.base);
      kb.querySelectorAll('[data-oct]').forEach((x) => { const m = S.settings.base + 12 * x.dataset.oct; x.disabled = m < S.BASE_MIN || m > S.BASE_MAX; });
      const sh = kb.querySelector('[data-shift]');
      sh.classList.toggle('on', shiftLatch); sh.classList.toggle('down', shift && !shiftLatch);
      sh.setAttribute('aria-pressed', shiftLatch);
    };
    kb.addEventListener('click', (e) => {
      if (e.target.closest('[data-shift]')) S.latchShift(!shiftLatch);
      const o = e.target.closest('[data-oct]');
      if (o) S.octave(+o.dataset.oct);
    });
    S.holdOn(kb, '.kb-key', (t) => keyNote(+t.dataset.piano), { takeTouch: true, id: (x) => x.dataset.piano });
    ['scale', 'mute', 'settings', 'kbd', 'shift'].forEach((ev) => S.on(ev, render));
    render();
  };

  /* ---------- keyboard as instrument ---------- */

  // a piano on the letter rows: A is the 1/1, W S E D F T G Y H U J K O L P ; the 12-TET steps above it
  S.PIANO = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];

  // returns { down(code) -> bool, up(code) } that keeps one voice per key
  S.keyVoices = (startFor) => {
    const held = new Map();
    return {
      down(code) {
        if (held.has(code)) return true;
        const stop = S.audio.press(() => startFor(code));
        if (!stop) return false;
        held.set(code, stop);
        return true;
      },
      up(code) { const s = held.get(code); if (s) { held.delete(code); s(); } },
      any: () => held.size > 0,
      releaseAll() { held.forEach((s) => s()); held.clear(); },
    };
  };
  // In the tabs with a scale list (views with scaleKeys: true) the piano keys play the sounding
  // scale note nearest to their 12-TET step, if one is within ±50¢ (else the key is silent); C holds the Chord
  // (k may lie in any octave: MIDI keys reach far below and above the 1/1)
  // Up to 12 sounding notes: each gets a key of its own, in pitch order, the keys chosen so that the notes stand as near
  // their keys as they can (the least sum of distances). Where every note's nearest key is its own (most scales) that is
  // the nearest key; where two notes want one key, or one stands over 50¢ from any, a neighbour key takes it instead of
  // Shift or silence (the Well-Tuned Piano: 4 keys were silent, 4 notes on Shift). More than 12: the nearest within ±50¢,
  // the rest on Shift (S.pianoSecond)
  let fitId = null, fit = null;
  const keyFit = () => {
    const au = S.audible(), id = au.join();
    if (id === fitId) return fit;
    fitId = id; fit = null;
    const n = au.length;
    if (!n || n > 12) return fit;
    const cs = au.map((x) => S.ratio(x).cents);
    let best = Infinity;
    // the first note on key f, the others on rising keys within f … f + 11 (one octave of keys: each step once)
    for (let f = -11; f <= 12; f++) {
      const cost = [[]], from = [[]];
      cost[0][0] = Math.abs(cs[0] - 100 * f);
      for (let i = 1; i < n; i++) {
        cost[i] = []; from[i] = [];
        for (let q = i; q <= 11; q++) {
          let m = Infinity, a = -1;
          for (let p = i - 1; p < q; p++) if (cost[i - 1][p] < m) { m = cost[i - 1][p]; a = p; }
          cost[i][q] = m + Math.abs(cs[i] - 100 * (f + q)); from[i][q] = a;
        }
      }
      let q = -1, m = Infinity;
      for (let x = n - 1; x <= 11; x++) if (cost[n - 1][x] < m) { m = cost[n - 1][x]; q = x; }
      if (m >= best - 1e-9) continue;
      best = m; fit = new Map();
      for (let i = n - 1; i >= 0; i--) { fit.set(S.mod(f + q, 12), { str: au[i], q: f + q, c: cs[i] }); q = i ? from[i][q] : q; }
    }
    return fit;
  };
  S.pianoNote = (k) => {
    const kf = keyFit();
    if (kf) { const x = kf.get(S.mod(k, 12)); return x ? { str: x.str, oct: (k - x.q) / 12, d: Math.abs(x.c - 100 * x.q) } : null; }
    let best = null;
    const o = Math.floor(k / 12);
    for (const str of S.audible()) for (const oct of [o - 1, o, o + 1]) {
      const d = Math.abs(S.ratio(str).cents + 1200 * oct - 100 * k);
      if (d <= 50 && (!best || d < best.d)) best = { str, oct, d };
    }
    return best;
  };
  // Shift + key: the closest note that is no key's own, within ±100¢. The notes left over go to the keys
  // closest first, each key and each note once, so a key that loses a note to a closer one takes its next
  S.pianoSecond = (k) => {
    const own = new Set();
    for (let p = 0; p < 12; p++) { const b = S.pianoNote(p); if (b) own.add(b.str); }
    const pairs = [];
    for (const str of S.audible()) if (!own.has(str)) for (let p = 0; p < 12; p++) for (const oct of [-1, 0, 1]) {
      const d = Math.abs(S.ratio(str).cents + 1200 * oct - 100 * p);
      if (d <= 100) pairs.push({ str, p, oct, d });
    }
    pairs.sort((a, b) => a.d - b.d);   // stable: ties go to the note listed first, then the lower key
    const o = Math.floor(k / 12), key = k - 12 * o, keys = new Set(), notes = new Set();
    for (const x of pairs) {
      if (keys.has(x.p) || notes.has(x.str)) continue;
      if (x.p === key) return { str: x.str, oct: x.oct + o, d: x.d };
      keys.add(x.p); notes.add(x.str);
    }
    return null;
  };
  // Shift, down or up, moves the held letter keys between their notes
  // Shift is the key held, or the on-screen keyboard's Shift chip latched (S.latchShift); 'shift' tells the keyboards
  let shift = false, shiftKey = false, shiftLatch = false, keysHeld = [];
  S.keysNow = () => keysHeld;
  const shiftFollowers = new Set();
  const setShift = () => { const on = shiftKey || shiftLatch; if (on !== shift) { shift = on; shiftFollowers.forEach((f) => f()); S.emit('shift', on); } };
  S.latchShift = (on) => { shiftLatch = on; const was = shift; setShift(); if (shift === was) S.emit('shift', shift); };
  // Shift pressed while latched hands the latch to the key: held now, it lets go with the key
  ['keydown', 'keyup'].forEach((t) => window.addEventListener(t, (e) => {
    if (t === 'keydown' && e.key === 'Shift' && !e.repeat && shiftLatch) { shiftLatch = false; S.emit('shift', true); }
    shiftKey = e.shiftKey; setShift();
  }, true));
  window.addEventListener('blur', () => { shiftKey = false; setShift(); });
  // one held key on step k, at loudness vel (0…1); returns its stop. With Shift held (a letter, an on-screen or a MIDI key)
  // it plays its second note if it has one, else its own
  const keyNote = (k, vel = 1) => {
    S.noteIn();
    const find = () => (shift && S.pianoSecond(k)) || S.pianoNote(k);
    let b = find();
    // the notes the keys sound right now, oldest first, in their octaves; a pedalled one counts until the pedal lifts
    const show = () => {
      keysHeld = keysHeld.filter((x) => x.key !== show);
      if (b) keysHeld.push({ key: show, str: b.str, oct: b.oct });
      S.emit('keys', keysHeld, !!b);
    };
    // while held it follows the mutes (and changes to the scale): its note may go silent, come back or
    // change, and a key held with no note starts one once a note is unmuted or added near its step
    const play = () => b && S.playScaleNotes([b.str], { octs: [b.oct], vel, later: true });
    let stop = play();   // the sound first; what the page shows of it follows
    if (b) { S.emitLater('pick', b.str, true, b.oct); show(); }   // a key also picks its note, as its list row does (true: from a key)
    const sync = () => {
      const n = find();
      if (n && b && n.str === b.str && n.oct === b.oct) return;
      if (stop) stop();
      b = n;
      stop = play();
      show();
    };
    const onShift = () => { const was = b; sync(); if (b && b !== was) S.emit('pick', b.str, true, b.oct); };
    S.on('scale', sync); S.on('mute', sync);
    shiftFollowers.add(onShift);
    return () => { S.off('scale', sync); S.off('mute', sync); shiftFollowers.delete(onShift); if (stop) stop(); b = null; show(); };
  };
  // the 1/1 an octave down (−1) or up (1), as far as its field goes: Z and X, or their drawn keys under the keyboard
  S.octave = (d) => {
    const m = S.settings.base + 12 * d;
    if (m >= S.BASE_MIN && m <= S.BASE_MAX) { S.settings.base = m; S.saveSettings(); S.emit('settings'); }
  };
  S.scaleKeys = S.keyVoices((code) => {
    // Z and X, by position as every key here: the 1/1's octave, as far as its field goes; a held key stays where it was pressed
    if (code === 'KeyZ' || code === 'KeyX') { S.octave(code === 'KeyX' ? 1 : -1); return null; }
    const k = S.PIANO.indexOf(code);
    if (k < 0) return null;
    const stop = keyNote(k);
    keyboardLit(k, true);
    return () => { stop(); keyboardLit(k, false); };
  });
  S.on('panic', () => S.scaleKeys.releaseAll());
  S.on('release', () => S.scaleKeys.releaseAll());

  /* ---------- MIDI input ---------- */
  // a MIDI keyboard plays like the piano keys, in every tab: key m is the 12-TET step m − the 1/1's key,
  // so it plays the nearest sounding scale note within ±50¢ in its own octave. Velocity sets the loudness
  // ((v/127)², the usual DLS curve); the sustain pedal (CC 64) holds released keys. Off until switched on
  // in the settings menu (the browser asks first); kept on across reloads (scales.midi)
  S.midi = (() => {
    const held = new Map(), sustained = new Set();
    let access = null, pedal = false;
    const off = (m) => { const s = held.get(m); if (s) { held.delete(m); s(); } };
    const releaseAll = () => { held.forEach((s) => s()); held.clear(); sustained.clear(); };
    // every tab of this page receives every note: the one last looked at plays them, also once it is in the background.
    // A held note still gets its note-off wherever it started
    let mine = true;
    const channel = window.BroadcastChannel ? new BroadcastChannel('scales.midi') : null;
    if (channel) channel.onmessage = () => { mine = false; };
    const claim = () => { if (access) { mine = true; channel?.postMessage(1); } };
    window.addEventListener('focus', claim);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) claim(); });
    const onMessage = ({ data }) => {
      S.noteIn();
      const [status, a, b] = data, type = status & 0xf0;
      if (type === 0x90 && b > 0) {
        if (!mine) return;
        off(a); sustained.delete(a);
        held.set(a, S.audio.press(() => keyNote(a - S.settings.base, (b / 127) ** 2)));
      } else if (type === 0x80 || type === 0x90) {
        if (pedal) sustained.add(a); else off(a);
      } else if (type === 0xb0 && a === 64) {
        pedal = b >= 64;
        if (!pedal) { sustained.forEach(off); sustained.clear(); }
      } else if (type === 0xb0 && (a === 120 || a === 123)) releaseAll();   // all sound off, all notes off
    };
    const attach = () => access && access.inputs.forEach((i) => (i.onmidimessage = onMessage));
    // the connected inputs' names, for the switch's tooltip
    const inputs = () => (access ? [...access.inputs.values()].map((i) => i.name).join(', ') || 'No MIDI device found' : '');
    S.on('panic', releaseAll);
    return {
      supported: !!navigator.requestMIDIAccess,
      get on() { return !!access; },
      // resolves to {on, why}: whether MIDI is now on, and the devices or the browser's reason for refusing
      async set(on) {
        try { on ? localStorage.setItem('scales.midi', '1') : localStorage.removeItem('scales.midi'); } catch (e) {}
        if (!on) {
          if (access) { access.inputs.forEach((i) => (i.onmidimessage = null)); access.onstatechange = null; }
          access = null; releaseAll(); pedal = false;
          return { on: false };
        }
        if (access) return { on: true, why: inputs() };
        try {
          access = await navigator.requestMIDIAccess();
          access.onstatechange = attach;   // a keyboard plugged in later
          attach();
          if (!document.hidden) claim();
          return { on: true, why: inputs() };
        } catch (e) {
          console.warn('MIDI refused:', e);
          try { localStorage.removeItem('scales.midi'); } catch (err) {}
          return { on: false, why: `MIDI refused: ${e.name}${e.message ? ' · ' + e.message : ''}` };
        }
      },
      stored() { try { return localStorage.getItem('scales.midi') === '1'; } catch (e) { return false; } },
      onMessage,   // for testing without a keyboard
    };
  })();

  S.keyboardOpen = () => keyboardOpen;   // the scale list's keyboard button (panel.js)
  S.KEYBOARD_BTN = KEYBOARD_BTN;
})();
