'use strict';
// The pitch clock, the ripples and sparks of what sounds, and notes lit while they sound.
(() => {
  const S = window.S;

  /* ---------- pitch clock ---------- */

  // One octave as a circle: 0¢ at top, clockwise. Inside the rim (ticks and names) two rings: the view's own notes
  // (S.CLOCK_VIEW), a line, and inside it the scale's (S.CLOCK_SCALE): what is in the scale is in the circle. The scale sat
  // on the rim itself and testers didn't read it as "my scale" (the user's test, 2026-11-19; the user's design)
  // the view's ring halfway between the ticks' inner end (0.94) and the line; the scale's as far inside the line
  S.CLOCK_VIEW = 0.83; S.CLOCK_SEP = 0.72; S.CLOCK_SCALE = 2 * S.CLOCK_SEP - S.CLOCK_VIEW;
  // one size for every circle, in every tab (views once chose it, all the same)
  S.CLOCK_SIZE = 320;
  S.clockPos = (cents, rf = 1) => {
    const c = S.CLOCK_SIZE / 2, R = c - 30;
    const a = (cents / 1200) * 2 * Math.PI;
    return [c + R * rf * Math.sin(a), c - R * rf * Math.cos(a)];
  };

  // S.clock(el, {…}) describes the whole circle; only what differs from the last description reaches the page, so what
  // stays keeps running (ripples, sparks, the Chord's rim). Every piece has a key and its markup.
  // Its classes are changed one by one: what others set on a dot (hot, lit) stays until they take it off.
  const clocks = new WeakMap(), boxes = new Set();
  const svgOf = (html) => { const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); t.innerHTML = html; return t; };
  const clockUpdate = (d, html, was) => {
    const to = svgOf(html).firstElementChild, words = (s) => (s || '').split(' ').filter(Boolean);
    const cls0 = words(svgOf(was).firstElementChild.getAttribute('class')), cls1 = words(to.getAttribute('class'));
    for (const { name, value } of [...to.attributes]) if (name !== 'class' && d.getAttribute(name) !== value) d.setAttribute(name, value);
    if (d.getAttribute('cx') !== null) sparks.get(d)?.setAttribute('transform', `translate(${d.getAttribute('cx')},${d.getAttribute('cy')})`);
    if (to.textContent !== d.textContent) d.textContent = to.textContent;
    cls0.filter((c) => !cls1.includes(c)).forEach((c) => d.classList.remove(c));
    cls1.filter((c) => !cls0.includes(c)).forEach((c) => d.classList.add(c));
    if (cls0.includes('hot') && !cls1.includes('hot') && hotCount.has(d.dataset.r || d.dataset.sr)) d.classList.add('hot');   // the scale's sound still marks it
  };
  // A view says which points are its notes and which note is selected; the circle decides everything else, alike in
  // every tab: its size, the 12 ticks and names, the scale's ring, one dot to a spot, the dots' size, the rings.
  // points: { cents, cls (its colour and states the view keeps: hot, held, mute), attrs (data-*: what a press does),
  // sel (this point is the selected one), faint (shown, not the view's own: faint until it sounds or is selected) }
  // sel: the selected note's key, when no point is flagged (selected elsewhere); rimSel: a note picked on the rim
  S.clock = (el, { points = [], rimSel = null, sel = null }) => {
    const size = S.CLOCK_SIZE, ticks = 12;
    let box = clocks.get(el);
    if (!box || box.svg.parentNode !== el) {
      el.innerHTML = `<svg class="clock" viewBox="0 0 ${size} ${size}" role="img" aria-label="pitch clock"></svg>`;
      box = { svg: el.firstChild, now: new Map() };
      clocks.set(el, box);
      boxes.add(box);
    }
    box.el = el; box.args = { points, rimSel, sel };   // drawn again as they were when a hidden note sounds (S.markScale)
    const c = size / 2, R = c - 30, root = S.baseIdx();
    const P = (cents, rf) => S.clockPos(cents, rf);
    // under: below every dot, so a hit ring never covers a neighbouring dot
    const under = [], over = [];
    under.push(['face', `<circle class="clock-face" cx="${c}" cy="${c}" r="${R}"/>`]);
    under.push(['inner', `<circle class="clock-inner" cx="${c}" cy="${c}" r="${R * S.CLOCK_SEP}"/>`]);
    // 12 ticks, the 1/1's drawn as every other (the user, 2026-11-20: its name says where it is), and 12 note names:
    // each plays its 12-TET note (hold, glide), a reference to compare with that needs no setting up. Each is a round
    // button (.clock-et, drawn just before its name; as bare labels they played with no look of it, the user's test,
    // 2026-11-19), held while pressed and otherwise plain: a sound elsewhere never lights it, and the note it picks is
    // shown by a dot inside (below), not by it (the user, 2026-11-19: buttons don't light)
    for (let i = 0; i < ticks; i++) {
      const cents = (i * 1200) / ticks;
      const [x1, y1] = P(cents, 0.94), [x2, y2] = P(cents, 1.0), [lx, ly] = P(cents, 1.13);
      under.push(['t' + i, `<line class="clock-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`]);
      under.push(['e' + i, `<circle class="clock-et" cx="${lx}" cy="${ly}" r="12" data-et="${i}" data-ek="${S.edoKey(i, 12)}"/>`]);
      under.push(['l' + i, `<text class="clock-label et" x="${lx}" y="${ly}" dy="${S.DY_SANS}">${S.NAMES[S.mod(root + i, 12)]}</text>`]);
    }
    // one size for every dot, the scale's and the view's, in every circle, however many, and one press area round it
    // (overlapping ones are pressed by the nearest centre, S.holdOn)
    const DOT_R = 5, HIT_R = 12;
    // One ring at a time (the user, 2026-11-20): a note picked by a scale dot, a list row, a key or MIDI that the scale
    // has is ringed on the scale's ring; one selected in a picture (sel; or in another tab's, S.sel.rim false), picked
    // by a note name (S.sel.outer) or not in the scale, on the view's ring. Ringing both, or always the view's, was tried the same day
    const inner = !sel && !!rimSel && S.scale.includes(rimSel) && S.sel.note === rimSel && S.sel.rim && !S.sel.outer;
    // Both rings, one rule (the user, 2026-11-24): every note is a dot, and of dots on one spot the note played last is
    // on top. Dots on one spot cover each other whole, so each spot draws only that one: a spot is a quarter unit of its
    // ring (about a quarter pixel; 0.44¢ on the view's ring), not a pitch (10 000 Spiral notes 0.01¢ apart were 10 000
    // dots over one another, 100 ms a change). On a spot: the note played last (playedAt, S.markScale), else the selected one,
    // else one the view holds (not faint), else the first. A note of a spot that sounds while another shows is drawn
    // there at once (S.markScale draws the circle again), and lights alone: only what sounds lights (two dots on one spot
    // rippled twice as strong, the user, 2026-11-19). Across spots too the note played last is on top (raise, and
    // raised again after a redraw); the selected dot no longer goes back on top once nothing sounds
    const isSel = (p) => !!p.sel;
    const keyOf = (p) => p.note ?? /data-r="([^"]*)"/.exec(p.attrs || '')?.[1];
    const rank = (p) => { const k = keyOf(p), t = k ? playedAt.get(k) : undefined; return t !== undefined ? 2 + t : isSel(p) ? 1 : 0; };
    const better = (p, had) => rank(p) !== rank(had) ? rank(p) > rank(had) : !p.faint && had.faint;
    const spots = (list, rf) => {
      const n = Math.round((2 * Math.PI * R * rf) / 0.25), one = new Map(), at = new Map();
      for (const p of list) {
        const k = S.mod(Math.round((S.fold(p.cents) / 1200) * n), n), had = one.get(k), r = keyOf(p);
        if (!had || better(p, had)) one.set(k, p);
        if (r != null) at.set(r, k);
      }
      return { shown: [...one.values()], at, one };
    };
    // the scale's ring
    const sc = spots(S.scale.map((str) => ({ note: str, cents: S.ratio(str).cents, sel: inner && str === rimSel })), S.CLOCK_SCALE);
    for (const p of sc.shown.sort((a, b) => rank(a) - rank(b))) {
      const str = p.note, r = S.ratio(str), [x, y] = P(r.cents, S.CLOCK_SCALE);
      under.push(['rh ' + str, `<circle class="clock-hit rim" cx="${x}" cy="${y}" r="${HIT_R}" data-sr="${str}"/>`]);
      over.push(['r ' + str, `<circle class="clock-dot rim ${r.cls}${S.isSilent(str) ? ' mute' : ''}${p.sel ? ' sel' : ''}" cx="${x}" cy="${y}" r="${DOT_R}" data-sr="${str}"/>`]);
    }
    // The selected note on the view's ring, the one place that draws it: sel (selected in the view's picture or elsewhere),
    // or a picked note (rimSel) not ringed on the scale's ring (above). The view's own dot of that pitch is ringed, or else a dot of its own (data-own: a press plays it, the
    // selection stays), drawn as any note (hollow when tempered), lit as any note's dot. Only from what the view passes:
    // a circle that read the shared selection itself drew a stale dot in views that draw before they share it
    const selK = sel || (inner ? null : rimSel) || null;
    const selR = selK && S.ratio(selK);
    const has = (p) => (p.attrs || '').includes(`data-r="${selK}"`);
    const all = !selR || points.some(isSel) ? points : points.some(has) ? points.map((p) => (has(p) ? { ...p, sel: true } : p))
      : [...points, { cents: selR.cents, cls: selR.cls || 'pt', sel: true, attrs: `data-own data-r="${selK}"` }];
    const vw = spots(all, S.CLOCK_VIEW);
    // which spot each note is on and which note each spot shows, per ring: what S.markScale asks
    box.hidden = (str) => [sc, vw].some((g) => {
      const k = g.at.get(str);
      return k !== undefined && keyOf(g.one.get(k)) !== str;
    });
    vw.shown.sort((a, b) => rank(a) - rank(b)).forEach((p, i) => {
      // no spoke from the centre: with one the selected dot looked like a hand to drag round (the user's test, 2026-11-19)
      const [x, y] = P(p.cents, S.CLOCK_VIEW), id = p.id || p.attrs || i;
      const cls = `${p.cls || ''}${isSel(p) ? ' sel' : ''}${p.faint ? ' faint' : ''}`;
      if (p.attrs) under.push(['h ' + id, `<circle class="clock-hit" cx="${x}" cy="${y}" r="${HIT_R}" ${p.attrs}/>`]);   // its hit ring, under every dot
      over.push(['d ' + id, `<circle class="clock-dot ${cls}" cx="${x}" cy="${y}" r="${DOT_R}" ${p.attrs || ''}/>`]);
    });
    const { svg, now } = box, next = new Map(), fresh = [[], []];
    [under, over].forEach((list, top) => list.forEach(([key, html]) => {
      const had = now.get(key);
      if (!had) { fresh[top].push([key, html]); return; }
      if (had.html !== html) { clockUpdate(had.el, html, had.html); had.html = html; }
      next.set(key, had);
      now.delete(key);
    }));
    now.forEach(({ el: gone }) => { unsparkle(gone); gone.remove(); });
    // new pieces: those below the dots go under the first dot; a sounding one lights up once it is in, so it gets its sparks
    const first = svg.querySelector('.clock-dot'), lit = [];
    fresh.forEach((list, top) => {
      if (!list.length) return;
      const made = svgOf(list.map((x) => x[1]).join('')), frag = document.createDocumentFragment();
      [...made.children].forEach((d, i) => {
        next.set(list[i][0], { el: d, html: list[i][1] });
        if (d.classList.contains('hot')) { d.classList.remove('hot'); lit.push(d); }
        frag.appendChild(d);
      });
      svg.insertBefore(frag, top ? null : first);
    });
    box.now = next;
    // new dots go on top of the rest: the notes played since, then, go back over them, in the order they were played
    if (fresh[1].length) [...svg.querySelectorAll(':scope > .clock-dot')].map((d) => [playedAt.get(d.dataset.sr ?? d.dataset.r), d])
      .filter(([t]) => t !== undefined).sort((a, b) => a[0] - b[0]).forEach(([, d]) => raise(d));
    lit.forEach((d) => d.classList.add('hot'));
    box.svg.dataset.ringed = inner ? rimSel : '';   // the scale note ringed, for its list row
    S.emit('rimsel');   // the scale list marks the row of the picked scale note
  };
  // a mute changes only the rim dots' look: every circle's, in place, no view drawn anew. A later S.clock still agrees
  // (it changes classes one by one, from what it drew to what it draws)
  S.on('mute', () => document.querySelectorAll('.clock-dot.rim[data-sr]').forEach((d) => d.classList.toggle('mute', S.isSilent(d.dataset.sr))));

  // A dot that starts sounding moves to the top of its circle, so a
  // neighbour it overlaps never hides it (SVG has no z-index: later siblings paint on top).
  // Sounding dots and nodes also send out a ripple and little sparks until they stop.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sparks = new WeakMap();
  // ripple: its markup; spot(i, a): where spark i leaves from, [x, y, angle, start radius] (a round dot:
  // its centre, r + 2). The group goes into `inside`, before `before` (an interval: under its band)
  const sparkle = (host, inside, cx, cy, ripple, spot, before = null, count = 10) => {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'sparks');
    g.setAttribute('transform', `translate(${cx},${cy})`);
    let h = ripple;
    for (let i = 0; i < count; i++) {
      const [x, y, a, r0] = spot(i, ((i * 360) + (i % 2 ? 140 : 0)) / count);
      const c = `<circle class="spark" r="${i % 3 ? 1.3 : 1.9}" style="--a:${a}deg;--r0:${r0}px;--r1:${r0 + 11 + (i % 3) * 5}px;animation-delay:${(i * 0.137) % 0.9}s"/>`;
      h += x || y ? `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${c}</g>` : c;
    }
    g.innerHTML = h;
    inside.insertBefore(g, before);
    sparks.set(host, g);
  };
  const round = (r) => [`<circle class="ripple" r="${r}" style="--s:${(r + 16) / r}"/>`, (i, a) => [0, 0, a, r + 2]];
  // a pill or button, w × h: the ripple grows 16 every way, sparks leave from its edge
  const boxy = (w, h, rx) => [
    `<rect class="ripple" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${rx}" style="--s:${(w + 32) / w};--sy:${(h + 32) / h}"/>`,
    (i, a) => {
      const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180), t = Math.min(w / 2 / Math.abs(c), h / 2 / Math.abs(s));
      return [c * t, s * t, a, 2];
    },
  ];
  // an interval (Cycle and Spiral arcs): a glow along its band, sparks off both sides of it; --glow-max (the Spiral's,
  // twice the turns' spacing less a band) keeps it off the next turn
  const along = (band) => {
    const cs = getComputedStyle(band), w = parseFloat(cs.strokeWidth) || 4, L = band.getTotalLength();
    const w1 = Math.max(w, Math.min(w + 18, parseFloat(cs.getPropertyValue('--glow-max')) || Infinity));
    return [
      `<path class="ripple line" d="${band.getAttribute('d')}" style="--w0:${w}px;--w1:${w1}px"/>`,
      (i, a) => {
        const l = L * (((i * 3) % 10) + 0.5) / 10, p = band.getPointAtLength(l);
        const q0 = band.getPointAtLength(Math.max(0, l - 1)), q1 = band.getPointAtLength(Math.min(L, l + 1));
        const t = Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180 / Math.PI;
        return [p.x, p.y, t + (i % 2 ? 90 : -90) + (a % 36) - 7, w / 2 + 1];
      },
    ];
  };
  // a dot's sparks, so a dot that moves while it sounds (Beats) can take them along
  S.sparksOf = (d) => sparks.get(d);
  const unsparkle = (host) => {
    const g = sparks.get(host);
    if (!g) return;
    sparks.delete(host);
    // a Table number's sparks sit in a little SVG of their own
    const box = g.parentNode && g.parentNode.classList.contains('spark-box') ? g.parentNode : g;
    box.classList.add('out');
    setTimeout(() => box.remove(), 250);
  };
  // a dot to the top of its circle
  const raise = (d) => { if (d.parentNode && d.parentNode.lastElementChild !== d) d.parentNode.appendChild(d); };
  const DOTS = '.clock-dot, .cycle-svg .cdot, .sp-dot, .sdot';
  new MutationObserver((records) => {
    for (const { target: d } of records) {
      if (!d.classList || !d.matches(`${DOTS}, .node, .dcell, .carc, .iarc, .sp-seg, .hnode, .nnum, .kb-key`)) continue;
      const on = d.matches('.hot, .held') && !d.matches('.kb-key.none');   // a key with no note sounds nothing
      if (!on) {
        unsparkle(d);   // it stays on top: played last (S.clock)
        continue;
      }
      // played last, on top, seen or not (a circle in a closed drawer or another tab shows it so when it shows)
      if (d.matches(DOTS) && !sparks.has(d)) raise(d);
      // sparks nobody can see cost and show nothing
      if (d.closest('[hidden]') || (d.closest('.panel.side') ? S.sideClosed() : S.mainCovered())) continue;
      if (sparks.has(d)) {
        // a sounding dot that becomes the selected one comes on top at once (Beats while Play sounds)
        if (d.classList.contains('clock-dot') && d.classList.contains('sel')) raise(d);
        continue;
      }
      if (d.matches(DOTS)) {
        const svg = d.parentNode;
        if (!svg) continue;
        raise(d);
        sparkle(d, svg, +d.getAttribute('cx'), +d.getAttribute('cy'), ...round(+d.getAttribute('r')));
      } else if (d.classList.contains('dcell')) {
        // a Diamond cell: on top of its neighbours (before the edge numbers), ripple from its own diamond
        const t = d.querySelector('text'), p = d.querySelector('polygon');
        const head = d.parentNode && d.parentNode.querySelector(':scope > .dlabels, :scope > .dhead');   // under the labels
        if (head) d.parentNode.insertBefore(d, head);
        const cx = +t.getAttribute('x'), cy = +t.getAttribute('y');
        const r = cy - +p.getAttribute('points').split(' ')[0].split(',')[1];
        sparkle(d, d, cx, cy, `<polygon class="ripple" points="0,${-r} ${r},0 0,${r} ${-r},0" style="--s:${(r + 16) / r}"/>`, round(r)[1]);
      } else if (d.matches('.carc, .iarc, .sp-seg')) {
        const band = d.querySelector('.a-band, .sp-band, .sp-fill');
        if (!band || !d.parentNode || !band.getTotalLength()) continue;
        sparkle(d, d.parentNode, 0, 0, ...along(band), d);
      } else if (d.classList.contains('hnode')) {
        // a Hasse number: a pill
        const rc = d.querySelector('rect');
        raise(d);
        sparkle(d, d, 0, 0, ...boxy(+rc.getAttribute('width'), +rc.getAttribute('height'), +rc.getAttribute('rx')));
      } else if (d.matches('.nnum, .kb-key')) {
        // a Table number or a key is a button: its sparks in a little SVG at its centre
        const box = document.createElementNS(SVGNS, 'svg');
        box.setAttribute('class', 'spark-box');
        d.appendChild(box);
        sparkle(d, box, 0, 0, ...boxy(d.offsetWidth, d.offsetHeight, 8));
      } else {
        raise(d);
        sparkle(d, d, 0, 0, ...round(+(d.querySelector('.base')?.getAttribute('r') || 22)));
      }
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Text sized with calc(var(--fs-…) * var(--kx)) has one on-screen size in every picture, however
  // large the picture is drawn: each SVG gets --kx/--ky = SVG units per screen pixel (two, because
  // the Spiral chart stretches).
  const kSvgs = new WeakSet();
  const fitK = (svg) => {
    const vb = svg.viewBox && svg.viewBox.baseVal, box = svg.getBoundingClientRect();
    if (!vb || !vb.width || !box.width) return;
    const kx = vb.width / box.width;
    // preserveAspectRatio="none" scales each axis on its own; otherwise both by the same factor
    const ky = svg.getAttribute('preserveAspectRatio') === 'none' ? vb.height / box.height : kx;
    svg.style.setProperty('--kx', kx.toFixed(4));
    svg.style.setProperty('--ky', ky.toFixed(4));
  };
  const kRO = new ResizeObserver((es) => es.forEach((e) => fitK(e.target)));
  const hasSvg = (n) => n.nodeType === 1 && (n.tagName === 'svg' || n.firstElementChild && n.querySelector('svg'));
  new MutationObserver((records) => {
    // most batches are dots and sparks inside an existing picture: no new SVG, no page-wide search
    if (!records.some((r) => [...r.addedNodes].some(hasSvg))) return;
    document.querySelectorAll('svg.clock, svg.lattice-svg, svg.diamond-svg, svg.curve-svg, svg.cycle-svg, svg.spiral-svg').forEach((svg) => {
      if (kSvgs.has(svg)) return;   // its size changing is kRO's: measuring all of them forced a layout on every redraw
      kSvgs.add(svg); kRO.observe(svg);
      fitK(svg);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- notes sounding ---------- */

  // a note sounding: everything showing that ratio lights up with it, in every tab: list rows,
  // rim dots, the dots inside the circles, lattice nodes, diamond cells, numbers
  // rendering a picture again (a key or row picking its note redraws the circle) keeps the marks:
  // hotCount holds how many sounds mark each ratio, and redrawn elements get them back
  const hotCount = new Map();
  // the readout's headline too (data-rn: its note; the user, 2026-11-24: it plays, so it shows playing whatever
  // sounds its note), not with sparks
  // One pass over what can show a note, each checked against a set: a selector with one [data-r="…"] per note cost
  // 2.4 s for a 1000-note chord over a page of 39 000 elements, and 4.6 ms for each note of a run (Chrome, 2026-11-25)
  const BY_R = '.srow[data-r], :is(.clock-dot, .node, .dcell, .dbar, .cdot, .sp-dot, .nnum, .hnode, .sdot)[data-r]';
  const KINDS = `${BY_R}, .clock-dot.rim[data-sr], .sp-dot[data-also], .readout .hl[data-rn]`;
  const hits = (x, want) => {
    const d = x.dataset;
    return (d.r != null && want.has(d.r) && x.matches(BY_R)) || (d.sr != null && want.has(d.sr) && x.matches('.clock-dot.rim'))
      || (d.also != null && x.matches('.sp-dot') && d.also.split(' ').some((q) => want.has(q))) || (d.rn != null && want.has(d.rn) && x.matches('.readout .hl'));
  };
  const hotAll = (strs, within = document) => {
    const want = strs instanceof Set ? strs : new Set(strs);
    if (!want.size) return [];
    return [...within.querySelectorAll(KINDS)].filter((x) => hits(x, want));
  };
  S.markScale = (strs, on) => {
    const changed = new Set();
    for (const str of strs) {
      if (!on && !hotCount.has(str)) continue;
      const n = (hotCount.get(str) || 0) + (on ? 1 : -1);
      if (n > 0) hotCount.set(str, n); else hotCount.delete(str);
      if (on || n <= 0) changed.add(str);
    }
    if (on) played(changed);
    if (changed.size) hotAll(changed).forEach((x) => x.classList.toggle('hot', on));
  };
  // the order notes were last played in (S.clock: on a spot, and across spots, the latest on top); a note played while
  // a circle shows another on its spot draws that circle again, before it lights, so its own dot is there to light
  const playedAt = new Map();
  let playTick = 0;
  // each circle drawn once for all the notes that came together (a 1000-note chord drew circles 584 times)
  const played = (strs) => {
    for (const str of strs) {
      playedAt.delete(str);
      playedAt.set(str, ++playTick);
      if (playedAt.size > 20000) playedAt.delete(playedAt.keys().next().value);
    }
    boxes.forEach((b) => {
      if (!b.svg.isConnected) { boxes.delete(b); return; }
      if (b.hidden && [...strs].some((str) => b.hidden(str))) S.clock(b.el, b.args);
    });
  };
  // only for something new that shows a note, not for a sounding dot's own sparks or its coming to the top
  const showsNote = (x) => x.nodeType === 1 && !x.classList.contains('hot') && !x.matches('.sparks, .spark-box') && (x.matches('[data-r], [data-sr], [data-rn]') || x.querySelector('[data-r], [data-sr], [data-rn]'));
  new MutationObserver((records) => {
    if (!hotCount.size) return;
    // only inside what was added: a redrawn circle needn't search a full Scatter
    const fresh = new Set(records.flatMap((r) => [...r.addedNodes].filter(showsNote)).map((x) => x.parentNode));
    fresh.forEach((box) => { if (box) hotAll(hotCount.keys(), box).forEach((y) => { if (!y.classList.contains('hot')) y.classList.add('hot'); }); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  // the same from a key or MIDI note: a frame drawn between two notes of a chord holds up the next one, so all
  // that came within a few ms light up at once
  const hotWait = new Map();
  const markLater = (strs, on) => {
    strs.forEach((str) => hotWait.set(str, (hotWait.get(str) || 0) + (on ? 1 : -1)));
    S.later('hot', () => {
      const all = [...hotWait];
      hotWait.clear();
      [true, false].forEach((on) => S.markScale(all.flatMap(([str, n]) => (n > 0 === on ? Array(Math.abs(n)).fill(str) : [])), on));
    }, S.LATER.HOT);
  };
  S.on('panic', () => hotWait.clear());
  // notes held on into a view or drawer that just showed: their sparks, which hidden dots didn't get
  S.on('shown', () => { if (hotCount.size) hotAll(hotCount.keys()).forEach((x) => { x.classList.remove('hot'); x.classList.add('hot'); }); });
  S.on('panic', () => { const strs = new Set(hotCount.keys()); hotCount.clear(); hotAll(strs).forEach((x) => x.classList.remove('hot')); });
  // a note sounding now (a picture that sets its own classes keeps the mark through this)
  S.isHot = (str) => hotCount.has(str);
  S.playScaleNotes = (strs, opt = {}) => {
    const ch = S.audio.chord(strs.map((s, i) => S.ratioFreq(s, opt.octs ? opt.octs[i] : 0)), { vel: opt.vel ?? 1 });
    const mark = opt.later ? markLater : S.markScale;
    mark(strs, true);
    // a stop may come twice (S.holdOn calls a released press's stop again to cut its tail): the mark goes once, or
    // a key's second 'off' cancels the next press's 'on' waiting with it in markLater (the row lit only the first time)
    let marked = true;
    return () => { ch.stop(); if (marked) { marked = false; mark(strs, false); } };
  };

  // the rim's ripple (panel.js)
  S.sparkle = sparkle;
  S.unsparkle = unsparkle;
  S.roundRipple = round;
})();
