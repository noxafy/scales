'use strict';
// Harmonic series: sculpt a spectrum and hear single partials.
// Its Play sounds the 1/1 with these overtones. Below it, tones of that spectrum beat against each other
// (S.parts.beats, with a Play of its own); one Play sounds at a time.
S.views.harmonics = (() => {
  const defaultN = () => (matchMedia('(min-width: 961px)').matches ? 16 : 8);
  const st = { N: defaultN() };
  const amps = () => S.state.customAmps;
  const f0 = () => S.baseFreq();   // the fundamental is the top bar's 1/1
  S.state.customN = st.N;
  let el, grid, playBtn, markN;

  // the colour key: each prime is also a partial (hold to hear it); 11 and 13 matter less. 2 stands for
  // the 1/1 and its octaves (partials 1, 2, 4, 8 …)
  const PRIMES = [[2, 'octave'], [3, 'fifth'], [5, 'third'], [7, 'seventh'], [11, ''], [13, '']];
  const ofPrime = (p, n) => S.primeClass(n) === S.primeClass(p);

  const foldN = (n) => { let d = 1; while (d * 2 <= n) d *= 2; const g = S.gcd(n, d); return [n / g, d / g]; };

  function mount(root) {
    el = root;
    el.innerHTML = `
      <div class="split">
      <div class="harm-main">
      <div class="panel harm-panel">
        <div class="panel-head">
          <h3>Harmonics</h3>
          <div class="toolbar">
            <span class="tone-slot" data-tone-slot></span>   <!-- the settings menu's Timbre (app.js) -->
            <div class="seg" data-seg="N" aria-label="Partials"><button data-v="8">8</button><button data-v="16">16</button><button data-v="32">32</button><button data-v="64">64</button></div>
          </div>
          <button class="btn primary" data-act="harm"><span class="ico play"></span><span>Play</span></button>
        </div>
        <div class="primes" data-primes>${PRIMES.map(([p, name]) => `<button class="pbtn ${S.primeClass(p)}${p > 7 ? ' sm' : ''}" data-p="${p}">
          ${name ? `<b>${p}</b><small><span>${foldN(p).join('/')}</span> <span>${name}</span></small>` : `<b>${foldN(p).join('/')}</b>`}</button>`).join('')}</div>
        <div class="partials" data-grid></div>
      </div>
      <div class="beats-part" data-beats-part></div>
      </div>
      <div class="panel side" data-side></div>   <!-- Beats' Chord, Scale, circle and list, from the top -->
      </div>`;
    grid = el.querySelector('[data-grid]');

    markN = S.seg(el, 'N', st.N, (v) => { st.N = +v; S.state.customN = st.N; renderGrid(); changed(); });
    // Tone (the header's field, shown in this toolbar) changed the spectrum
    S.on('spectrum', (src) => { if (src === 'header') renderFills(); if (st.play) st.play.setAmps(S.amps()); });

    // Play: the 1/1 with the painted overtones, nothing else (Beats' Play sounds its tones); either Play
    // stops the other. Neither has a key: Space is Scale here too
    playBtn = el.querySelector('[data-act="harm"]');
    S.playToggle(playBtn, () => !!st.play, startPlay, stopPlay);   // a tap latches, a hold plays while held
    S.on('settings', () => { if (st.play) st.play.setFreq(f0()); });
    S.on('panic', stopPlay);

    // hold a partial number to hear it alone; glide across them
    const partialHold = (b) => {
      const n = +b.dataset.n;
      S.emit('pick', S.ratioKey(foldN(n)), false, 31 - Math.clz32(n));   // picks its ratio, in the octave it sounds in, as a scale list row does: Beats' active tone, every tab's selected note
      const v = S.audio.tone(n * f0(), { amps: [1] });
      hot(n, true);
      return () => { v.stop(); hot(n, false); };
    };
    S.holdOn(grid, '.pnum', partialHold);
    // a prime button sounds every shown partial of its colour as painted (just the prime itself if all
    // are silent) and picks them out
    const primesEl = el.querySelector('[data-primes]');
    S.holdOn(primesEl, '.pbtn', (b) => {
      const p = +b.dataset.p;
      S.emit('pick', S.ratioKey(foldN(p)));   // picks its ratio (2: the 1/1), as a partial number does
      const a = amps().slice(0, st.N).map((x, i) => (ofPrime(p, i + 1) ? x : 0));
      if (!a.some((x) => x > 0)) a[p - 1] = 1;
      const ns = a.flatMap((x, i) => (x > 0 ? [i + 1] : []));
      const v = S.audio.tone(f0(), { amps: a });
      ns.forEach((n) => hot(n, true));
      b.classList.add('held'); markPrime(p);
      return () => { v.stop(); ns.forEach((n) => hot(n, false)); b.classList.remove('held'); };
    });
    primesEl.addEventListener('pointerover', (e) => { const b = e.target.closest('.pbtn'); if (b) markPrime(+b.dataset.p); });
    primesEl.addEventListener('pointerleave', () => markPrime(0));

    paintable();
    renderGrid();
    S.parts.beats.mount(el.querySelector('[data-beats-part]'), { onPlay: stopPlay, side: el.querySelector('[data-side]') });
    S.on('settings', () => renderMeta());
  }

  // p = 0 clears; partials are coloured by their largest prime
  function markPrime(p) {
    grid.classList.toggle('pmarking', !!p);
    grid.querySelectorAll('.pcol').forEach((c) => c.classList.toggle('pmark', !!p && ofPrime(p, +c.dataset.n)));
  }

  function startPlay() {
    S.parts.beats.stop();
    st.play = S.audio.press(() => S.audio.tone(f0()));   // Chord's loudness for one note
    S.scaleHot(['1/1'], true);
    playBtn.classList.add('on');
    playBtn.querySelector('.ico').className = 'ico stop';
  }
  function stopPlay() {
    if (!st.play) return;
    st.play.stop(); st.play = null;
    S.scaleHot(['1/1'], false);
    playBtn.classList.remove('on');
    playBtn.querySelector('.ico').className = 'ico play';
  }

  /* ---- painting the spectrum ---- */
  // the bar being painted sounds its partial alone, as loud as it is painted (as its number does at full
  // height), and follows the stroke from bar to bar
  const PAINT_GAIN = S.gainOf(1);
  function paintable() {
    let painting = false, rects = [], voice = null, vn = 0;
    const sound = (n, a) => {
      if (n !== vn) {
        if (voice) { voice.stop(); hot(vn, false); }
        voice = S.audio.press(() => S.audio.tone(n * f0(), { amps: [1], gain: PAINT_GAIN * a }));
        vn = n; hot(n, true);
      } else voice.setGain(PAINT_GAIN * a);
    };
    const quiet = () => { if (voice) { voice.stop(); hot(vn, false); } voice = null; vn = 0; };
    const paintAt = (e) => {
      for (const r of rects) {
        if (e.clientX >= r.left && e.clientX < r.right) {
          let a = 1 - (e.clientY - r.top) / r.height;
          a = S.clamp(a, 0, 1);
          if (a < 0.03) a = 0;
          amps()[r.n - 1] = a;
          r.fill.style.height = a * 100 + '%';
          r.col.classList.toggle('silent', a === 0);
          sound(r.n, a);
          break;
        }
      }
      changed();
    };
    grid.addEventListener('pointerdown', (e) => {
      if (e.button || !e.target.closest('.bar')) return;
      e.preventDefault();
      painting = true;
      rects = [...grid.querySelectorAll('.bar')].map((b) => {
        const r = b.getBoundingClientRect();
        return { left: r.left - 3, right: r.right + 3, top: r.top, height: r.height, n: +b.parentNode.dataset.n, fill: b.firstElementChild, col: b.parentNode };
      });
      try { grid.setPointerCapture(e.pointerId); } catch (err) {}
      paintAt(e);
    });
    grid.addEventListener('pointermove', (e) => { if (painting) paintAt(e); });
    // with .bar's touch-action: none, for browsers that still start a swipe of their own (back, forward, reload)
    grid.addEventListener('touchstart', (e) => { if (e.target.closest('.bar')) e.preventDefault(); }, { passive: false });
    const end = () => {
      if (!painting) return;
      painting = false;
      quiet();
      // painted back (near enough) onto a preset: snap to it and name it
      const k = S.shapeOf(0.03);
      if (k !== 'custom') { S.setShape(k, 'harmonics'); renderFills(); } else S.keepCustom();
      S.saveCustomAmps();
    };
    grid.addEventListener('pointerup', end);
    grid.addEventListener('pointercancel', end);
  }

  function renderGrid() {
    let s = '';
    for (let n = 1; n <= st.N; n++) {
      const a = amps()[n - 1];
      s += `<div class="pcol ${S.primeClass(n)}${a === 0 ? ' silent' : ''}" data-n="${n}">
        <div class="bar"><div class="fill" style="height:${a * 100}%"></div></div>
        <button class="pnum" data-n="${n}" title="hold to hear partial ${n}">${n}</button>
        <div class="pmeta"></div>
      </div>`;
    }
    grid.innerHTML = s;
    grid.style.setProperty('--cols', st.N);
    grid.classList.toggle('few', st.N <= 8);
    // with 8 bars there is no partial 11 or 13 to point at
    el.querySelector('[data-primes]').classList.toggle('upto8', st.N < 11);
    renderMeta();
  }

  function renderFills() {
    grid.querySelectorAll('.pcol').forEach((c) => {
      const a = amps()[c.dataset.n - 1];
      c.querySelector('.fill').style.height = a * 100 + '%';
      c.classList.toggle('silent', a === 0);
    });
  }

  function renderMeta() {
    grid.querySelectorAll('.pcol').forEach((c) => {
      const n = +c.dataset.n, f = n * f0(), note = S.noteOf(f), [p, q] = foldN(n);
      const dev = Math.round(note.dev);
      c.querySelector('.pmeta').innerHTML =
        `<span class="rlabel">${p}/${q}</span>` +
        `<span class="note">${note.name}${note.oct}</span>` +
        `<span class="dev ${Math.abs(dev) > 15 ? 'far' : ''}" title="${S.exactDev(S.etDev(1200 * Math.log2(n)))}">${Math.abs(note.dev) < S.EXACT ? '·' : (note.dev > 0 ? '+' : '−') + Math.abs(dev) + '¢'}</span>`;
      c.title = `${n} · ${S.fmtHz(f)} Hz · ${p}/${q} · ${note.name}${note.oct} ${S.fmtDev(note.dev)}`;
    });
  }

  function hot(n, on) {
    S.scaleHot([S.ratioKey(foldN(n))], on);
    const c = grid.querySelector(`.pcol[data-n="${n}"]`);
    c && c.classList.toggle('hot', on);
  }

  /* ---- sound ---- */
  // the spectrum changed: the beating pair, its curve and its signal follow
  function changed() { S.emit('spectrum'); }

  return {
    title: 'Harmonics',
    mount,
    N: () => st.N,
    defaultN,
    // the link's bar count
    setN(n) {
      st.N = n; S.state.customN = n;
      if (el) { markN(n); renderGrid(); }
      changed();
    },
    playSel: () => S.parts.beats.playSel(),
    onHide() { stopPlay(); S.parts.beats.stop(); },
    onKeyDown(code, e) {
      // Space plays the scale, as in every tab with a circle and a scale list; the piano keys and C (Chord) too
      if (code === 'Space') { S.playScale(); return true; }
      return S.parts.beats.onKeyDown(code, e) || S.scaleKeys.down(code);
    },
  };
})();
