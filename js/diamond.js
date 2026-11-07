'use strict';
// Tonality diamond (Partch): odd numbers ("identities") on two edges, every cell is o/u folded into
// the octave. A line one way holds one denominator (an overtone chord), the other way one numerator
// (an undertone chord). Any set of identities can be chosen, not only 1 3 5 7 9 11, and any odd
// number can be typed in (factors of 2 are dropped: they only move a note by octaves).
S.parts.diamond = (() => {
  const IDS = [1, 3, 5, 7, 9, 11, 13, 15, 21, 25, 27, 33, 35, 39, 49];
  const MAX = 10;
  const isSquare = (v) => Number.isInteger(Math.sqrt(v));
  // a preset is a list, or a function of the chips there are (Squares also finds typed-in squares)
  const PRESETS = {
    p7: ['1 3 5 7', [1, 3, 5, 7]],
    base: ['1 3 5 7 9 15', [1, 3, 5, 7, 9, 15]],
    p13: ['1 3 5 7 9 11 13', [1, 3, 5, 7, 9, 11, 13]],
    prod: ['3·5·7 products', [1, 3, 5, 7, 15, 21, 35]],
    euler: ['3·5 grid', [1, 3, 5, 9, 15, 45]],
    sq: ['Squares', () => [...IDS, ...st.extra].filter(isSquare).sort((a, b) => a - b).slice(0, MAX)],
  };
  const presetIds = (k) => { const v = PRESETS[k][1]; return typeof v === 'function' ? v() : v; };
  const ORDERS = { prime: 'Prime', pitch: 'Pitch', size: 'Size', added: 'Custom' };
  const S2 = 34, PAD = 22;   // half-diagonal of a cell, margin (SVG units)
  // ids keep the order they were added in; extra = typed numbers that get a chip of their own
  // (a preset's number without a chip, like 45, gets one too while chosen)
  // then = the order last chosen before Prime: it orders the numbers within one prime colour
  const st = { ids: [...PRESETS[matchMedia('(max-width: 600px)').matches ? 'p7' : 'base'][1]], extra: [], order: 'prime', then: 'size', sel: null, edit: false, paintFrom: false, paintAdd: true };
  let el, figEl, clockEl, readEl, idsEl, idIn, presetSel, flashTimer;

  // the order along the edges: by largest prime (grey, orange, green, violet, …), pitch (as Partch
  // laid out 1 9 5 11 3 7), size, or the order of choosing
  const pitchOf = (v) => S.ratio(S.ratioKey(S.foldRatio(v, 1))).cents;
  const ordered = (order) => {
    if (order === 'added') return [...st.ids];
    if (order === 'pitch') return [...st.ids].sort((a, b) => pitchOf(a) - pitchOf(b));
    return [...st.ids].sort((a, b) => a - b);   // size
  };
  const odds = () => {
    if (st.order !== 'prime') return ordered(st.order);
    const rank = new Map(ordered(st.then).map((v, i) => [v, i]));
    return [...st.ids].sort((a, b) => S.largestPrime(a) - S.largestPrime(b) || rank.get(a) - rank.get(b));
  };
  const matchPreset = () => Object.keys(PRESETS).find((k) => {
    const v = presetIds(k);
    return v.length === st.ids.length && v.every((x) => st.ids.includes(x));
  }) || 'custom';
  const rkey = (o, u) => S.ratioKey(S.foldRatio(o, u));
  const uniq = () => [...new Set(odds().flatMap((o) => odds().map((u) => rkey(o, u))))]
    .sort((a, b) => S.ratio(a).cents - S.ratio(b).cents);

  // side: the Just intonation tab's shared panel lends its readout and circle
  function mount(root, side) {
    el = root;
    el.innerHTML = `
      <div class="toolbar">
        ${S.EDIT_BTN}
        <label class="field"><select class="dpreset" data-in="preset" aria-label="Preset">
          ${Object.entries(PRESETS).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}
          <option value="custom">Custom</option>
        </select></label>
        <div class="seg" data-seg="order" aria-label="Order">${Object.entries(ORDERS).map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="chips dids" data-ids></div>
      ${S.jiFig(`<div class="panel diamond-panel">${S.jiHead()}<div data-fig></div></div>`)}`;
    S.jiWire(el);
    figEl = el.querySelector('[data-fig]');
    new ResizeObserver(() => { const w = figEl.querySelector('svg')?.getBoundingClientRect().width; if (w && Math.abs(w - fitW) > 0.5) fit(); }).observe(figEl);
    clockEl = side.clock;
    readEl = side.read;

    idsEl = el.querySelector('[data-ids]');
    presetSel = el.querySelector('[data-in="preset"]');
    S.editSwitch(el, (on) => { st.edit = on; });
    S.seg(el, 'order', st.order, (v) => { if (v !== 'prime') st.then = v; st.order = v; renderFig(); });
    // the number field sits right after the last chip; it survives the chips being redrawn
    idIn = document.createElement('input');
    Object.assign(idIn, { type: 'search', enterKeyHint: 'done', className: 'ratio-in id-in', placeholder: 'n ⏎', inputMode: 'numeric', spellcheck: false });
    idIn.setAttribute('aria-label', 'add any number, Enter');
    idIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      let v = parseInt(idIn.value, 10);
      if (!(v > 0 && v < 1e6) || !/^\s*\d+\s*$/.test(idIn.value)) { idIn.classList.add('bad'); return; }
      while (v % 2 === 0) v /= 2;
      if (st.ids.includes(v)) { idIn.value = ''; highlight(v); return; }
      if (st.ids.length >= MAX) { idIn.classList.add('bad'); return; }
      if (!IDS.includes(v) && !st.extra.includes(v)) st.extra.push(v);
      st.ids = [...st.ids, v];
      idIn.value = '';
      render();
      highlight(v);
    });
    idIn.addEventListener('input', () => idIn.classList.remove('bad'));
    presetSel.addEventListener('change', () => {
      if (!PRESETS[presetSel.value]) return;
      st.ids = [...presetIds(presetSel.value)];
      st.sel = null;
      render();
      selectRatio(S.note.str, S.note.rim);   // the selected note again, in a cell of the new diamond if it has one
    });
    // a chip adds or removes an identity; pointing at one picks out its two lines
    idsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const v = +b.dataset.id;
      if (b.classList.contains('full')) return;
      if (st.ids.includes(v)) { if (st.ids.length > 2) st.ids = st.ids.filter((x) => x !== v); }
      else if (st.ids.length < MAX) st.ids = [...st.ids, v];
      const gone = st.sel && !(st.ids.includes(st.sel.o) && st.ids.includes(st.sel.u));
      if (gone) st.sel = null;
      render();
      if (gone) selectRatio(S.note.str, S.note.rim);
      lines(v);
    });
    idsEl.addEventListener('pointerover', (e) => { const b = e.target.closest('[data-id]'); lines(b ? +b.dataset.id : 0); });
    idsEl.addEventListener('pointerleave', () => lines(0));
    // pointing at an edge number lights its one line, the notes it plays
    figEl.addEventListener('pointerover', (e) => { const h = e.target.closest('.dhead'); lines(h ? +h.dataset.v : 0, h && h.dataset.side); });
    figEl.addEventListener('pointerleave', () => lines(0));

    // cells play their note; edge numbers play their whole line as a chord
    // with Edit on, a drag that starts on a cell adds (or removes) every cell it passes
    S.holdOn(figEl, '.dcell, .dhead', (t, e, glided) => {
      if (t.classList.contains('dhead')) {
        if (!glided) st.paintFrom = false;
        const v = +t.dataset.v, side = t.dataset.side;
        const cells = [...figEl.querySelectorAll(`.dcell[data-${side}="${v}"]`)];
        return play(cells.map((c) => c.dataset.r), cells);
      }
      if (!glided) { st.paintFrom = true; st.paintAdd = !S.ji.has(t.dataset.r); }
      if (st.edit && st.paintFrom) st.paintAdd ? S.ji.add(t.dataset.r) : S.ji.remove(t.dataset.r);
      st.sel = { o: +t.dataset.o, u: +t.dataset.u }; st.selStr = st.selRim = null;
      S.setNote(t.dataset.r, 'diamond');
      markSel(); renderRead();
      // every cell with the same ratio lights up with it
      return play([t.dataset.r], [...figEl.querySelectorAll(`.dcell[data-r="${t.dataset.r}"]`)]);
    }, { takeTouch: true });
    // the circle's dots and the rim's select their note: a cell with that ratio (the selected one if it
    // has it), or, for a rim note the diamond lacks, just the readout
    S.clockHold(clockEl, '[data-r]', (d) => { selectRatio(d.dataset.r); S.setNote(d.dataset.r, 'diamond'); return play([d.dataset.r], [...figEl.querySelectorAll(`.dcell[data-r="${d.dataset.r}"]`)]); }, (str) => selectRatio(str, true));
    const shown = S.whenShown(root);
    S.on('pick', shown((str) => selectRatio(str, true)));
    // a note selected in another tab: a cell with that ratio, else just the readout
    S.on('note', shown((str, src) => { if (src !== 'diamond') selectRatio(str); }));

    S.on('settings', render);
    S.on('scale', () => { renderChips(); renderClock(); });   // its numbers' chips, the rim
    S.on('jiset', () => {
      figEl.querySelectorAll('.dcell, .dlabel').forEach((c) => c.classList.toggle('in', S.ji.has(c.dataset.r)));   // a label's text follows its cell's fill
      renderClock();
    });
    render();
    selectRatio(S.note.str, S.note.rim);
  }

  // chord of distinct pitches, ascending within the octave above 1/1
  function play(strs, cells) {
    const rs = [...new Set(strs)];
    const ch = S.audio.chord(rs.map((s) => S.ratioFreq(s)));
    flash(rs, cells, true);
    return () => { ch.stop(); flash(rs, cells, false); };
  }
  function flash(rs, cells, on) {
    S.scaleHot(rs, on);
    cells.forEach((c) => c.classList.toggle('hot', on));
    rs.forEach((r) => clockEl.querySelectorAll(`.clock-dot[data-r="${r}"]`).forEach((d) => d.classList.toggle('hot', on)));
  }

  // the numbers the scale's notes need (each ratio's odd parts, above and below), as far as the field takes them,
  // so every note of the scale can get its cell; they come and go with the scale, as the Beats and Spiral chips do
  const scaleIds = () => {
    const out = [];
    for (const str of S.scale) {
      const r = S.ratio(str);
      if (!r || r.temp) continue;
      const odd = (s) => { let v = 1; for (const p in r.e) if (p !== '2' && Math.sign(r.e[p]) === s) v *= (+p) ** Math.abs(r.e[p]); return v; };
      for (const v of [odd(1), odd(-1)]) if (v > 1 && v < 1e6) out.push(v);
    }
    return out;
  };
  function renderChips() {
    const full = st.ids.length >= MAX, typing = document.activeElement === idIn;
    S.keepFocus(idsEl, () => {
      idsEl.innerHTML = [...IDS, ...[...new Set([...st.extra, ...scaleIds(), ...st.ids])].filter((v) => !IDS.includes(v)).sort((a, b) => a - b)].map((v) => {
        const on = st.ids.includes(v);
        return `<button class="chip ${S.primeClass(v)}${on ? ' on' : ''}${full && !on ? ' full' : ''}" data-id="${v}">${v}</button>`;
      }).join('');
      idsEl.appendChild(idIn);
    });
    if (typing) idIn.focus();
  }
  function render() {
    renderChips();
    presetSel.value = matchPreset();
    renderFig(); renderClock(); renderRead();
  }

  // a number typed in that is already there: point at it for a moment, as if hovered
  function highlight(v) {
    clearTimeout(flashTimer);
    lines(v);
    const chip = idsEl.querySelector(`[data-id="${v}"]`);
    chip && chip.classList.add('flash');
    flashTimer = setTimeout(() => { lines(0); chip && chip.classList.remove('flash'); }, 1400);
  }

  // v = 0 clears; otherwise only the cells with v above or below the line stay bright
  // (side 'o' or 'u': only that one line, as an edge number plays it)
  function lines(v, side = null) {
    const svg = figEl.querySelector('svg');
    if (!svg) return;
    const on = !!v && st.ids.includes(v);
    svg.classList.toggle('lining', on);
    const lit = new Set();
    svg.querySelectorAll('.dcell, .dlabel').forEach((c) => {
      const in1 = on && (side ? +c.dataset[side] === v : +c.dataset.o === v || +c.dataset.u === v);
      c.classList.toggle('line', in1);
      if (in1 && c.dataset.r) lit.add(c.dataset.r);
    });
    // the same notes light up in the circle
    clockEl.querySelectorAll('.clock-dot[data-r]').forEach((d) => d.classList.toggle('lit', lit.has(d.dataset.r)));
  }

  function renderFig() {
    const os = odds(), n = os.length;
    const W = 2 * PAD + S2 * (2 * n + 1), H = 2 * PAD + 2 * n * S2, MID = PAD + n * S2;
    // i indexes the numerator, j the denominator; -1 is the edge with the numbers
    const pos = (i, j) => [PAD + (i + j + 2) * S2, MID + (j - i) * S2];
    const dia = (x, y, r) => `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;
    let cells = '', heads = '';
    os.forEach((o, i) => os.forEach((u, j) => {
      const [x, y] = pos(i, j), str = rkey(o, u), r = S.ratio(str);
      const sel = st.sel && st.sel.o === o && st.sel.u === u;
      cells += `<g class="dcell ${r.cls}${S.ji.has(str) ? ' in' : ''}${sel ? ' sel' : ''}" data-o="${o}" data-u="${u}" data-r="${str}">
        <title>${o}/${u} · ${r.label} · ${S.exactC(r.cents)}</title>
        <polygon points="${dia(x, y, S2 - 2)}"/>
        <text x="${x}" y="${y}" dy="${S.DY_SANS}">${S.esc(r.label)}</text>
      </g>`;
    }));
    os.forEach((v, k) => {
      const [x1, y1] = pos(k, -1), [x2, y2] = pos(-1, k);
      heads += `<g class="dhead ${S.primeClass(v)}" data-side="o" data-v="${v}"><title>${v}/1 … ${v}/${os[n - 1]}</title><rect x="${x1 - 15}" y="${y1 - 15}" width="30" height="30" rx="15"/><text x="${x1}" y="${y1}" dy="${S.DY_SANS}">${v}</text></g>`;
      heads += `<g class="dhead ${S.primeClass(v)}" data-side="u" data-v="${v}"><title>1/${v} … ${os[n - 1]}/${v}</title><rect x="${x2 - 15}" y="${y2 - 15}" width="30" height="30" rx="15"/><text x="${x2}" y="${y2}" dy="${S.DY_SANS}">${v}</text></g>`;
    });
    figEl.innerHTML = `<svg class="diamond-svg" viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${H}">${cells}${heads}</svg>`;
    raiseSel();
    fit();
  }

  // Text keeps one on-screen size while the picture scales, so long numbers are fitted to the size it is drawn at
  // (again when that changes). An edge number too wide for its circle becomes a pill growing outward (left, where
  // nothing is); a cell's label (S.fmtRatio's form) on one line, else its halves stacked over a bar, else left out
  // (its tooltip and the readout still give it)
  let fitW = 0;
  function fit() {
    const svg = figEl.querySelector('svg'), bw = svg && svg.getBoundingClientRect().width;
    if (!bw) return;
    fitW = bw;
    const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-m')) || 14;
    const W = +svg.dataset.w, H = +svg.dataset.h;
    // a text's width in px at fs, whatever --kx is now
    const px = (t, s) => { t.textContent = s; return (t.getComputedTextLength() / (parseFloat(getComputedStyle(t).fontSize) || 1)) * fs; };
    const heads = [...svg.querySelectorAll('.dhead')].map((h) => {
      const t = h.querySelector('text'), r = h.querySelector('rect');
      return { t, r, cx: +r.getAttribute('x') + +r.getAttribute('width') - 15, cy: +r.getAttribute('y') + 15, w: px(t, h.dataset.v) };
    });
    // the view box's left edge depends on the pills, and their sizes on the scale it gives: settle in a few rounds
    let x0 = 0, k = W / bw;
    for (let i = 0; i < 4; i++) {
      const left = Math.min(0, ...heads.map((h) => h.cx + 15 - Math.max(30, h.w <= 30 / k - 4 ? 30 : (h.w + 12) * k) - 4));
      x0 = left; k = (W - x0) / bw;
    }
    heads.forEach((h) => {
      const w = h.w <= 30 / k - 4 ? 30 : Math.max(30, (h.w + 12) * k), x = h.cx + 15 - w;
      h.r.setAttribute('x', x.toFixed(2)); h.r.setAttribute('width', w.toFixed(2));
      h.t.setAttribute('x', (x + w / 2).toFixed(2));
    });
    svg.setAttribute('viewBox', `${x0.toFixed(2)} 0 ${(W - x0).toFixed(2)} ${H}`);
    svg.style.setProperty('--kx', k.toFixed(4)); svg.style.setProperty('--ky', k.toFixed(4));
    // cells, in px: a label (S.fmtRatio's form, as everywhere) on one line, else its two halves stacked over a bar,
    // may reach past its diamond up to a little past the corners beside it. Labels go in a layer above all cells
    // (a later cell's fill would cover what reaches into it). Placed shortest first, each clear of every label and
    // edge number placed before it; if one finds no place, no cell shows a label (all or none: gaps read as missing)
    const half = 0.45 * fs, off = 0.62 * fs, reach = 2 * S2 / k + 4;
    const placed = heads.map((h) => { const x = +h.r.getAttribute('x'), w = +h.r.getAttribute('width'); return [x / k, (h.cy - 15) / k, (x + w) / k, (h.cy + 15) / k]; });
    // side by side 4 px apart (2 px read as one run), one above another 2
    const free = (x0, y0, x1, y1) => placed.every(([a, b, c, d]) => x1 + 4 <= a || c + 4 <= x0 || y1 + 2 <= b || d + 2 <= y0);
    const items = [...svg.querySelectorAll('.dcell')].map((c) => {
      const t = c.querySelector('text'), cx = +t.getAttribute('x'), cy = +t.getAttribute('y'), label = S.ratio(c.dataset.r).label;
      return { c, t, cx, cy, x: cx / k, y: cy / k, label, w: px(t, label) };
    }).sort((p, q) => p.w - q.w);
    let html = '';
    const all = items.every(({ c, t, cx, cy, x, y, label, w }) => {
      const tag = `<g class="dlabel ${S.ratio(c.dataset.r).cls}${c.classList.contains('in') ? ' in' : ''}" data-o="${c.dataset.o}" data-u="${c.dataset.u}" data-r="${c.dataset.r}">`;
      if (w <= reach && free(x - w / 2, y - half, x + w / 2, y + half)) {
        placed.push([x - w / 2, y - half, x + w / 2, y + half]);
        html += `${tag}<text x="${cx}" y="${cy}" dy="${S.DY_SANS}">${S.esc(label)}</text></g>`;
        return true;
      }
      const [a, b = ''] = label.split(/\s*\/\s*/), ws = Math.max(px(t, a), px(t, b));
      if (!b || ws > reach || !free(x - ws / 2, y - off - half, x + ws / 2, y + off + half)) return false;
      placed.push([x - ws / 2, y - off - half, x + ws / 2, y + off + half]);
      const dy = off * k, wu = ws * k;
      html += `${tag}<line class="dfrac" x1="${(cx - wu / 2).toFixed(2)}" y1="${cy}" x2="${(cx + wu / 2).toFixed(2)}" y2="${cy}"/>` +
        `<text x="${cx}" y="${(cy - dy).toFixed(2)}" dy="${S.DY_SANS}">${S.esc(a)}</text><text x="${cx}" y="${(cy + dy).toFixed(2)}" dy="${S.DY_SANS}">${S.esc(b)}</text></g>`;
      return true;
    });
    items.forEach(({ t }) => { t.textContent = ''; });   // kept, empty: where the cell's centre is (its sparks)
    let layer = svg.querySelector('.dlabels');
    if (!layer) { layer = document.createElementNS('http://www.w3.org/2000/svg', 'g'); layer.setAttribute('class', 'dlabels'); svg.insertBefore(layer, svg.querySelector('.dhead')); }
    layer.innerHTML = all ? html : '';
  }

  // rim: chosen on the circle's rim or in the scale list, whose rim dot then turns blue
  function selectRatio(str, rim = false) {
    if (rim) st.sel = null;   // a rim note (or its scale list row) is picked as itself: only its rim dot turns blue
    else if (!(st.sel && rkey(st.sel.o, st.sel.u) === str)) {
      const c = figEl.querySelector(`.dcell[data-r="${str}"]`);
      st.sel = c ? { o: +c.dataset.o, u: +c.dataset.u } : null;
    }
    st.selStr = st.sel ? null : str;
    st.selRim = rim ? str : null;
    markSel(); renderRead();
  }
  function markSel() {
    figEl.querySelectorAll('.dcell').forEach((c) => c.classList.toggle('sel', !!st.sel && +c.dataset.o === st.sel.o && +c.dataset.u === st.sel.u));
    raiseSel();
    renderClock();
  }
  // the selected cell after the other cells, so its blue edge isn't covered by a neighbour's
  function raiseSel() {
    const c = figEl.querySelector('.dcell.sel');
    if (c) c.parentNode.insertBefore(c, figEl.querySelector('.dlabels, .dhead'));
  }

  function renderClock() {
    if (S.sideWait(renderClock)) return;
    // the selected cell's note, or a note the diamond lacks picked by its dot (2048/2025, one of Just intonation's); a rim pick marks its rim dot
    const selR = st.sel ? rkey(st.sel.o, st.sel.u) : !st.selRim && st.selStr;
    const points = [...new Set([...uniq(), ...S.ji.notes])].map((s) => {
      const r = S.ratio(s);
      return { cents: r.cents, rf: 0.8, r: 7, cls: r.cls + (S.ji.has(s) ? ' in' : '') + (s === selR ? ' sel' : ''), attrs: `data-r="${s}"`, spoke: true };
    });
    S.clock(clockEl, { points, rimSel: st.selRim });
  }

  function renderRead() { readEl.innerHTML = S.readout(st.sel ? rkey(st.sel.o, st.sel.u) : st.selStr || null); }

  // arrows walk the cells across their sides, the arrows turned 45° clockwise as the cells are: ↑ ↓ the
  // numerator (up right, down left), → ← the denominator (down right, up left); straight moves would
  // reach only every other cell (the user tried them). On a rim pick, around the rim.
  function onKeyDown(code) {
    const d = S.ARROWS[code];
    if (!d) return false;
    if (st.selRim) return S.rimStep(st.selRim, d);
    const os = odds(), n = os.length;
    if (!n) return false;
    let i = st.sel ? os.indexOf(st.sel.o) : -1, j = st.sel ? os.indexOf(st.sel.u) : -1;
    if (i < 0 || j < 0) i = j = 0;   // nothing chosen: the first 1/1
    else if (code === 'ArrowUp' || code === 'ArrowDown') i = S.clamp(i + d, 0, n - 1);
    else j = S.clamp(j + d, 0, n - 1);
    const str = rkey(os[i], os[j]);
    st.sel = { o: os[i], u: os[j] }; st.selStr = st.selRim = null;
    S.setNote(str, 'diamond');
    markSel(); renderRead();
    S.click(() => play([str], [...figEl.querySelectorAll(`.dcell[data-r="${str}"]`)]));
    return true;
  }

  return {
    title: 'Diamond',
    mount,
    onKeyDown,
  };
})();
