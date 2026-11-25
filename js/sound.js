'use strict';
// The app's tone (its spectrum and the shapes) and the audio engine.
(() => {
  const S = window.S;

  /* ---------- timbres ---------- */

  const series = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
  // the spectrum shapes, one list for the header's Tone and the Harmonics menu: same names, same
  // sound (64 partials, as many as Harmonics can show)
  // Sine heads the menu (the simplest); the default tone is still the sawtooth (amps below)
  S.SHAPES = {
    pure: ['Sine', (n) => (n === 1 ? 1 : 0)],
    saw: ['Sawtooth · 1/n', (n) => 1 / n],
    square: ['Square · odd 1/n', (n) => (n % 2 ? 1 / n : 0)],
    // a pulse wave a third of each period high: |sin(πn/3)|/n, so every third partial is silent
    pulse3: ['Pulse ⅓ · 1/n', (n) => (n % 3 ? 1 / n : 0)],
    triangle: ['Triangle · odd 1/n²', (n) => (n % 2 ? 1 / (n * n) : 0)],
    soft: ['Soft · 1/n²', (n) => 1 / (n * n)],
    flat: ['Flat', () => 0.7],
  };
  // One tone for the whole app: the Harmonics spectrum (64 amplitudes, the first N of them shown and
  // heard). The header's Tone and the Harmonics menu are two views of it: a shape's name when it
  // matches one, else Custom.
  const NAMPS = 64;
  S.state.amps = series(NAMPS, (n) => 1 / n);
  const stored = (key) => {
    const a = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(a) && a.length === NAMPS && a.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ? a : null;
  };
  try { S.state.amps = stored('scales.amps') || S.state.amps; } catch (e) {}
  S.saveAmps = () => S.keep('scales.amps', JSON.stringify(S.state.amps));
  S.amps = () => {
    const a = S.state.amps.slice(0, S.state.ampsN || 16);
    return a.some((x) => x > 0) ? a : [1];
  };
  // which shape the spectrum is (tol: how near counts), or 'custom'
  S.shapeOf = (tol = 1e-6) => {
    for (const [k, [, f]] of Object.entries(S.SHAPES)) {
      if (S.state.amps.every((a, i) => Math.abs(a - f(i + 1)) < tol)) return k;
    }
    return 'custom';
  };
  // set the spectrum to a shape; src says who did it, so that menu needn't redraw itself
  S.setShape = (k, src) => {
    const f = S.SHAPES[k] && S.SHAPES[k][1];
    if (!f) return;
    for (let n = 1; n <= NAMPS; n++) S.state.amps[n - 1] = f(n);
    S.state.toneCustom = false;
    S.saveAmps();
    S.emit('spectrum', src);
  };
  // Custom keeps the last painted spectrum apart from the shapes, so choosing a shape doesn't lose it.
  // Empty until something is painted (or, on load, the stored tone is already a painted one).
  S.state.toneSlot = null;
  try { S.state.toneSlot = stored('scales.toneSlot'); } catch (e) {}
  if (!S.state.toneSlot && S.shapeOf() === 'custom') S.state.toneSlot = S.state.amps.slice();
  S.state.toneCustom = S.shapeOf() === 'custom';   // the Tone menu reads Custom
  // painting fills Custom with what is painted
  S.saveToneSlot = () => S.keep('scales.toneSlot', JSON.stringify(S.state.toneSlot));
  S.keepToneSlot = () => {
    S.state.toneSlot = S.state.amps.slice();
    S.state.toneCustom = true;
    S.saveToneSlot();
  };
  // choosing Custom brings back the painted spectrum; while it is empty the tone stays as it is
  S.useToneSlot = (src) => {
    S.state.toneCustom = true;
    if (S.state.toneSlot) {
      S.state.toneSlot.forEach((a, i) => { S.state.amps[i] = a; });
      S.saveAmps();
    }
    S.emit('spectrum', src);
  };
  S.toneName = () => (S.state.toneCustom ? 'custom' : S.shapeOf());

  /* ---------- audio ---------- */

  // one loudness everywhere: a voice alone, or one of n sounding together (Chord's rule, its sum grows as √n)
  S.gainOf = (n) => (n > 1 ? 0.3 / Math.sqrt(n) : 0.26);

  S.audio = (() => {
    let ctx = null, out = null, immediate = false, pressing = 0, live = false;
    const waves = new Map();
    const voices = new Set();     // every voice still producing samples (incl. release tails)
    const sounding = new Set();   // voices not yet told to stop: what the Stop button reflects
    const seqs = new Set();
    const solos = new Map();

    // a running context costs battery even in silence: it sleeps once nothing has sounded for a minute, or as
    // soon as the page is hidden, and ac() wakes it on the next press or key. With MIDI on only hiding does: waking
    // can take long on a phone, and a piano's next note can't wait
    const IDLE_MS = 60000;
    let idle = null;
    const sleepCtx = () => { if (ctx && ctx.state === 'running' && !voices.size && !seqs.size) ctx.suspend(); };
    const sleepSoon = () => {
      clearTimeout(idle);
      idle = setTimeout(() => { if (voices.size || seqs.size || S.midi?.on) sleepSoon(); else sleepCtx(); }, IDLE_MS);
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) sleepCtx(); });

    const activity = () => {
      const now = sounding.size > 0 || seqs.size > 0;
      if (now !== live) { live = now; S.emit('activity', now); }
    };

    // The context's time now. Firefox holds currentTime still through a task (its output timestamp too): a note planned
    // after a long one (a full scale's list redrawn before an added note's click, 0.3 s and more) started in the past,
    // its 50 ms and most of its release already gone, at a fifth of its energy (the user, 2026-11-24; Chrome reads it
    // live). A timer notes the clock between tasks (anchor: a value and when it was seen, kept only while it moves, so a
    // suspended context leaves none fresh); a long task carries it forward. Measured in Firefox 160: after 0.1, 0.5 and
    // 2 s of work currentTime lagged by just that, the estimate by at most 7 ms. Taken only when clearly ahead
    let anchor = null, lastV = -1;
    setInterval(() => {
      if (!ctx || ctx.state !== 'running') return;
      const v = ctx.currentTime;
      if (v !== lastV) { lastV = v; anchor = { v, p: performance.now() }; }
    }, 25);
    function ctxNow(c) {
      const t = c.currentTime;
      if (!anchor || c.state !== 'running') return t;
      const age = performance.now() - anchor.p;
      if (age > 5000) return t;
      const est = anchor.v + age / 1000;
      return est > t + 0.03 ? est : t;
    }

    function ac() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 8;
        out = ctx.createGain();
        out.gain.value = 1;   // no volume control: the device's own buttons, or the tab's mute
        // the compressor reacts in 3 ms, so a big chord's onset passes 1 and would clip, which cracks: a soft ceiling
        // above 0.75, untouched below (a curve reads −1…1, hence the halving)
        const half = ctx.createGain();
        half.gain.value = 0.5;
        const ceil = ctx.createWaveShaper();
        ceil.curve = Float32Array.from({ length: 8193 }, (_, i) => {
          const x = 2 * (i / 4096 - 1), a = Math.abs(x);
          return a <= 0.75 ? x : Math.sign(x) * (0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25));
        });
        out.connect(comp).connect(half).connect(ceil).connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      sleepSoon();
      return ctx;
    }

    function wave(amps) {
      const key = amps.map((a) => a.toFixed(3)).join(',');
      let w = waves.get(key);
      if (!w) {
        const real = new Float32Array(amps.length + 1);
        const imag = new Float32Array(amps.length + 1);
        amps.forEach((a, i) => (imag[i + 1] = a));
        if (!amps.some((a) => a > 0)) imag[1] = 1e-6;
        w = ac().createPeriodicWave(real, imag);
        if (waves.size > 200) waves.clear();
        waves.set(key, w);
      }
      return w;
    }

    // a linear rise 0 → 1 over `attack` seconds, then 128 samples of 1 for the loop that holds it
    const rises = new Map();
    function rise(c, attack) {
      const key = c.sampleRate + ':' + attack;
      let b = rises.get(key);
      if (!b) {
        const n = Math.round(attack * c.sampleRate);
        b = c.createBuffer(1, n + 128, c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = i < n ? i / n : 1;
        rises.set(key, b);
      }
      return b;
    }

    // One pitch sounds once while anything holds it (the user, 2026-11-25: a chip and the readout, two dots of one note,
    // a key and a node doubled it). A press (S.audio.press, no dur) at a pitch a held press already sounds joins that
    // voice: each gets a handle, and the voice lets go when the last handle does; the first press's timbre and level
    // stay. opt.own keeps a voice to itself (Harmonics' painted partial, Beats' voices that glide: setFreq)
    const shared = new Set();   // {v, f, n}: a held press's voice, its frequency, how many handles hold it
    function tone(freq, opt = {}) {
      if (!pressing || opt.dur || opt.own) return voice(freq, opt);
      let p = [...shared].find((q) => q.v.held && Math.abs(Math.log2(q.f / freq)) < 1e-9);
      if (!p) { p = { v: voice(freq, opt), f: freq, n: 0 }; shared.add(p); }
      p.n++;
      let mine = true, last = false;
      const out = () => { if (!mine) return; mine = false; if (--p.n === 0) { last = true; shared.delete(p); } };
      const alone = () => mine && p.n === 1;
      return {
        raw: p.v,
        get t0() { return p.v.t0; },
        get timbre() { return p.v.timbre; },
        get held() { return mine && p.v.held; },
        // a stop again under immediately() cuts the tail, as a voice's own does, if this handle let it go
        stop(delay) { if (mine) { out(); if (last) p.v.stop(delay); } else if (last) p.v.stop(delay); },
        kill() { out(); if (last) p.v.kill(); },
        setFreq(f, g) { if (alone()) { shared.delete(p); p.v.setFreq(f, g); } },   // moved: no longer that pitch
        setGain(x) { if (alone()) p.v.setGain(x); },
        setAmps(a) { if (alone()) p.v.setAmps(a); },
      };
    }

    // Notes started by a press (click, tap, key) last at least 50 ms, so a quick click
    // still has a clear pitch; scheduled notes end exactly when asked.
    function voice(freq, opt = {}) {
      const c = ac();
      const t = Math.max(ctxNow(c), opt.at || 0);   // opt.at: a time planned ahead (a sequence's step)
      const amps = opt.amps || S.amps();
      const peak = opt.gain ?? S.gainOf(1);
      const release = opt.release ?? 0.25;
      const minEnd = t + (opt.min ?? pressing);
      const osc = c.createOscillator();
      osc.setPeriodicWave(wave(amps));
      // a pitch past what the audio can play (a run's far end, 3⁹⁹⁹ / 2⁹⁹⁹ some 584 octaves up) is a voice like any other,
      // marked, sparkling and stopped, but silent: past Nyquist the browser clamps it to Nyquist (3⁹⁹ / 2⁹⁹ crackled), and
      // past 3.4·10³⁸ Hz (float32) setValueAtTime threw, after a chord's first voices had started: no stop reached them
      const plays = (f) => Number.isFinite(f) && Math.abs(f) < c.sampleRate / 2;
      const audible = plays(freq);
      osc.frequency.setValueAtTime(audible ? freq : 0, t);
      // the attack is a clip of its own (rise), not a ramp on g: currentTime lags the audio, at times by more than
      // the attack (heard 2026-11-04, Bluetooth), and a ramp planned from a time already past starts at full level,
      // which clicks; a source started late plays from its beginning, so the rise always begins with the sound
      const g = c.createGain(), shape = c.createGain(), attack = opt.attack ?? 0.012;
      const env = c.createBufferSource();
      env.buffer = rise(c, attack);
      env.loop = true;   // its last samples (all 1) hold the level after the rise
      env.loopStart = Math.round(attack * c.sampleRate) / c.sampleRate;
      env.loopEnd = env.buffer.duration;
      shape.gain.value = 0;
      env.connect(shape.gain);
      g.gain.setValueAtTime(audible ? peak : 0, t);
      if (opt.decay && audible) g.gain.setTargetAtTime(peak * 0.55, t + 0.02, opt.decay);
      osc.connect(shape).connect(g).connect(out);
      osc.start(t);
      env.start(t);
      let stopped = false, level = peak;   // level: the peak, or what setGain last asked for
      // g's level at time tt, as scheduled (gain.value only knows the present: a fade planned
      // for later, as a key click's at its 50 ms, would hold 0 and cut off hard)
      const at = (tt) => {
        if (opt.decay && tt > t + 0.02) return level * (0.55 + 0.45 * Math.exp(-(tt - t - 0.02) / opt.decay));
        return level;
      };
      const fade = (tt, rel) => {
        if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(tt);   // Chrome, Safari
        else { g.gain.cancelScheduledValues(tt); g.gain.setValueAtTime(tt > ctxNow(c) + 0.005 ? at(tt) : g.gain.value, tt); }   // Firefox
        g.gain.setTargetAtTime(0, tt, rel / 4);
        const end = tt + rel * 1.6 + 0.05;
        try { osc.stop(end); env.stop(end); } catch (e) {}
      };
      const v = {
        t0: t,   // when it started, in the context's time (a sine starts at phase 0)
        stop(delay = 0) {
          if (immediate) { if (voices.has(v)) v.kill(); return; }   // also cuts a release tail
          if (stopped) return;
          stopped = true;
          const tt = Math.max(ctxNow(c) + delay, minEnd);
          fade(tt, release);
          // a scheduled stop (dur) keeps the voice "sounding" until it actually ends
          if (tt - ctxNow(c) < 0.02) { sounding.delete(v); activity(); }
          else setTimeout(() => { sounding.delete(v); activity(); }, (tt - ctxNow(c)) * 1000);
        },
        // cut at once, even if already releasing
        kill() {
          stopped = true;
          fade(ctxNow(c), 0.03);
          sounding.delete(v); activity();
        },
        setFreq(f, glide = 0.015) { if (audible && plays(f)) osc.frequency.setTargetAtTime(f, ctxNow(c), glide); },
        // a new peak level, reached smoothly (painting a Harmonics bar while it sounds)
        setGain(x) {
          if (stopped || !audible) return;
          const now = ctxNow(c);
          if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(now);
          else { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); }
          g.gain.setTargetAtTime(x, now, 0.015);
          level = x;
        },
        setAmps(a) { osc.setPeriodicWave(wave(a.some((x) => x > 0) ? a : [1e-6])); },
        timbre: !opt.amps,   // in the app's tone: follows painting and the Timbre field while it sounds (retone)
        get held() { return !stopped; },   // not yet told to stop (a stopped one may still count as sounding up to its 50 ms)
      };
      osc.onended = () => { voices.delete(v); sounding.delete(v); osc.disconnect(); env.disconnect(); shape.disconnect(); g.disconnect(); activity(); };
      voices.add(v);
      sounding.add(v);
      activity();
      if (opt.dur) v.stop(opt.dur + t - ctxNow(c));
      return v;
    }

    // several voices, one stop(); vel scales them (MIDI)
    function chord(freqs, { vel = 1, ...opt } = {}) {
      const gain = S.gainOf(freqs.length) * vel;
      const vs = freqs.map((f) => tone(f, { ...opt, gain }));
      return { stop: (d) => vs.forEach((v) => v.stop(d)) };
    }

    // schedule a melodic sequence; returns cancel(). freqs[i] may be a number, an array, or {f, gain},
    // or a function giving one of those when its turn comes (null: skipped, taking no time).
    // Notes never ring into the next one: each ends after 80% of a step with a short release.
    // Each step is planned on the audio clock, AHEAD before it is due, at the start plus whole steps: a busy page (a
    // 1000-note scale lights each note in several places) only delays the timer, never the sound (it was uneven on a
    // phone, the user, 2026-11-25); onStep comes when the note does
    const AHEAD = 0.1;
    function sequence(freqs, { step = 0.22, len = 0.5, onStep, ...opt } = {}) {
      len = Math.min(len, step * 0.8);
      opt = { release: Math.min(0.2, step * 0.45), attack: 0.008, ...opt };
      [...seqs].forEach((c) => c());   // one sequence at a time
      let i = 0, k = 0, cancelled = false, timer = null;
      const shows = new Set(), planned = new Set();   // planned: notes not yet begun, silenced by a cancel
      const t0 = ctxNow(ac()) + 0.01;
      const done = () => { seqs.delete(cancel); activity(); onStep && onStep(-1); };
      const next = () => {
        if (cancelled) return;
        const at = t0 + k * step, now = ctxNow(ac());
        if (i >= freqs.length) { timer = setTimeout(() => { if (!cancelled) { cancelled = true; done(); } }, Math.max(0, at - now) * 1000); return; }
        const item = typeof freqs[i] === 'function' ? freqs[i]() : freqs[i];
        if (item == null) { i++; next(); return; }
        [].concat(item).forEach((x) => {
          if (!x) return;
          const o = typeof x === 'object' ? x : { f: x };
          const v = tone(o.f, { dur: len, decay: 0.15, min: 0, ...opt, ...(o.gain != null ? { gain: o.gain } : {}), at });
          planned.add(v); setTimeout(() => planned.delete(v), Math.max(0, at - now) * 1000 + 20);
        });
        if (onStep) { const j = i, sh = setTimeout(() => { shows.delete(sh); if (!cancelled) onStep(j); }, Math.max(0, at - now) * 1000); shows.add(sh); }
        i++; k++;
        timer = setTimeout(next, Math.max(0, t0 + k * step - AHEAD - ctxNow(ac())) * 1000);
      };
      const cancel = () => { if (cancelled) return; cancelled = true; clearTimeout(timer); shows.forEach(clearTimeout); planned.forEach((v) => { if (v.t0 > ctxNow(ac())) v.kill(); }); done(); };
      seqs.add(cancel);
      next();
      return cancel;
    }

    // Browsers let sound start only after a gesture that counts as the user's: a key, a mouse press, or
    // on touch screens a finger lifting (not touching down). Every press here starts on touch-down, so the
    // first one on a phone found the sound asleep, and only Play or a chip (click, after the lift) woke it.
    // Wake it on every such gesture, anywhere: from the first lift on, every touch-down sounds.
    ['pointerup', 'touchend', 'click', 'keydown'].forEach((t) => document.addEventListener(t, () => ac(), true));

    // the context time whose samples reach the ears right now (output latency included)
    function heard() {
      const c = ac();
      if (c.getOutputTimestamp) {
        const o = c.getOutputTimestamp();
        if (o.contextTime) return o.contextTime + (performance.now() - o.performanceTime) / 1000;
      }
      return c.currentTime - (c.outputLatency || c.baseLatency || 0);
    }

    return {
      tone, chord, sequence, heard,
      // the tone changed: every voice in it still sounding takes the new spectrum (Beats sets its own)
      retone() { const a = S.amps(); sounding.forEach((v) => v.timbre && v.setAmps(a)); },
      // anything held or a sequence running, but `except` (painting a bar keeps quiet over a held tone and reshapes it instead)
      othersSound: (except) => seqs.size > 0 || [...sounding].some((v) => v !== (except && except.raw || except) && v.held),
      now: () => ctxNow(ac()),   // the context's time now (heard() is when it reaches the ears)
      // run fn with stops taking effect at once (used when gliding between notes)
      immediately(fn) { immediate = true; try { fn(); } finally { immediate = false; } },
      // run fn as a press: notes it starts get the 50 ms minimum (or min seconds)
      press(fn, min = 0.05) { pressing = min; try { return fn(); } finally { pressing = 0; } },
      // keep one sound per key: a new one cuts the previous at once
      solo(key, sound) {
        const prev = solos.get(key);
        if (prev && prev !== sound) S.audio.immediately(() => prev.stop());
        solos.set(key, sound);
        return sound;
      },
      panic() {
        immediate = true;
        try {
          [...seqs].forEach((c) => c());
          S.emit('panic');
          voices.forEach((v) => v.kill());
        } finally { immediate = false; }
        shared.clear();
        sounding.clear();
        activity();
      },
    };
  })();
})();
