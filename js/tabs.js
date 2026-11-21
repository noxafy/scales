'use strict';
// The tabs of sub-views (S.subTab), in their order: Lattice, Cycle, Spiral, Numbers. Harmonics is a view of its own
// (harmonics.js).

// A tab: one or more sub-views (S.parts) on the left, under a row with a menu of links (none for a single
// sub-view) and the tab's head (its preset menu); on the right one panel for them all (Chord, Scale, the circle
// with the scale on its rim, the list). Only the circle's inside and the readout follow the chosen one.
// subs: S.parts ids; routes: {hash: [sub, label]}, menu links of their own (Numbers' Table, Hasse, Scatter are
// one sub-view: onRoute(hash) sets it); head: HTML at the right end of the menu row (which notes inside the circle
// are faint each sub-view says itself, S.clock's faint);
// onMount(el): wires it; onPick(k): a sub-view was chosen.
S.subTab = ({ title, subs, routes = null, head = '', onMount, onPick, onRoute }) => {
  const hosts = {}, reads = {}, clocks = {};
  const links = routes ? Object.entries(routes).map(([h, [k, label]]) => [h, k, label]) : subs.map((k) => [k, k, S.parts[k].title]);
  let el, cur = null, curRoute = null, markSub, boxes;

  function mount(root) {
    el = root;
    el.innerHTML = `
      <div class="split">
        <div class="disc-main">
          <div class="sub-head">
            ${links.length > 1 ? `<nav class="sub-tabs">${links.map(([h, , label]) => `<a href="#${h}" data-v="${h}">${label}</a>`).join('')}</nav>` : ''}
            ${head}
          </div>
          <div data-hosts></div>
        </div>
        <div class="panel side">
          ${S.sideTop()}
          <div data-clocks></div>
          <div data-list></div>
        </div>
      </div>`;
    // narrow windows: the side panel is a drawer, and the readout ([data-pin]) is pinned to the window's bottom
    S.scaleList(el.querySelector('[data-list]'));
    // kept by reference: on narrow windows the readouts' box lives in the pinned bar, outside el
    boxes = { hosts: el.querySelector('[data-hosts]'), reads: el.querySelector('[data-reads]'), clocks: el.querySelector('[data-clocks]') };
    // a menu of links: the hash names the sub-view, so links, reloads and Back keep it
    markSub = (k) => el.querySelectorAll('.sub-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.v === k));
    if (onMount) onMount(el);
  }

  // k: a sub-view or a route; a sub-view's own hash keeps its last route
  function pick(k) {
    const link = links.find(([h]) => h === k) || (subs.includes(k) && (links.find(([h, s]) => h === curRoute && s === k) || links.find(([, s]) => s === k)))
      || links.find(([h]) => h === curRoute) || links[0];
    const route = link[0];
    k = link[1];
    if (route !== curRoute) { curRoute = route; if (onRoute) onRoute(route); markSub(route); }
    if (k === cur) return;
    if (cur) {
      S.parts[cur].onHide && S.parts[cur].onHide();
      S.scaleKeys.releaseAll();
      hosts[cur].hidden = reads[cur].hidden = clocks[cur].hidden = true;
    }
    if (!hosts[k]) {
      const add = (where, cls) => { const d = document.createElement('div'); d.className = cls; boxes[where].appendChild(d); return d; };
      hosts[k] = add('hosts', 'subview sub-' + k);
      reads[k] = add('reads', 'readout');
      clocks[k] = add('clocks', 'clockwrap');
      S.parts[k].mount(hosts[k], { read: reads[k], clock: clocks[k] });
    }
    hosts[k].hidden = reads[k].hidden = clocks[k].hidden = false;
    S.emit('shown');
    cur = k;
    document.body.dataset.sub = k;
    if (onPick) onPick(k);
  }

  return {
    title,
    subs,
    routes: [...new Set([...subs, ...links.map(([h]) => h)])],
    scaleKeys: true,
    mount,
    pick,
    sub: () => cur,
    route: () => curRoute,
    onHide: () => { S.parts[cur].onHide && S.parts[cur].onHide(); },
    // Enter: the sub-view's own selection (a Cycle step as its interval), else the readout's note
    playSel: () => {
      if (S.parts[cur].playSel) return S.parts[cur].playSel();
      const str = reads[cur].querySelector('[data-ro]')?.dataset.ro;
      return str ? S.playNote(str) : null;
    },
    onKeyDown: (code, e) => {
      if (code === 'KeyM') {
        // M mutes or unmutes the note in the readout, if it is in the scale
        const str = reads[cur].querySelector('[data-ro]')?.dataset.ro;
        if (!str || !S.inScale(str)) return false;
        S.setSilent(str, !S.isSilent(str));
        return true;
      }
      return !!(S.parts[cur].onKeyDown && S.parts[cur].onKeyDown(code, e));
    },
  };
};

// The Lattice tab (S.subTab of one sub-view), with the scale presets and the link with the scale (the user, 2026-11-12:
// five tabs, presets per view). The Numbers tab, which has neither, is last.
S.views.lattice = (() => {
  // scale presets as lattice points [powers of 3, 5, 7, 11, 13]: scales found from the harmonics (the Cycle and
  // Spiral have tempered ones of their own). A preset sets the notes chosen here (S.latticeNotes), and through them the scale only while linked. Grouped by prime limit. Modes that only
  // pick notes from a 12-tone scale are left out: that is combining notes, not tuning; Major 9/8 is the one exception, its steps heard in order. 5-limit comes first: Major on top, and 3-limit is only one line of the lattice.
  // a combination product set: the products of k of the numbers, as ratio strings (folded by S.noteKey)
  const cps = (xs, k) => {
    const out = [], go = (from, left, p) => {
      if (!left) { out.push(`${p}/1`); return; }
      for (let i = from; i < xs.length; i++) go(i + 1, left - 1, p * xs[i]);
    };
    go(0, k, 1);
    return out;
  };
  // Mersenne's twelve notes: major and minor differ only in the whole tone
  const mersenne = (tone) => ['1/1', '25/24', tone, '75/64', '5/4', '4/3', '25/18', '3/2', '25/16', '5/3', '16/9', '15/8'];
  const PRESETS = [
    ['5-limit', {
      major: ['Major 9/8 (Ptolemy)', [[0, 0], [2, 0], [0, 1], [-1, 0], [1, 0], [-1, 1], [1, 1]]],
      jpenta: ['Major pentatonic', [[0, 0], [2, 0], [0, 1], [1, 0], [-1, 1]]],
      jminpenta: ['Minor pentatonic', [[0, 0], [1, -1], [-1, 0], [1, 0], [2, -1]]],
      // Ellis's block of 4 fifths × 3 thirds, and its mirror around the 1/1: three notes a comma apart
      duodene: ['Duodene', [-1, 0, 1, 2].flatMap((b) => [-1, 0, 1].map((c) => [b, c]))],
      duodene10: ['Duodene 10/9', [-2, -1, 0, 1].flatMap((b) => [-1, 0, 1].map((c) => [b, c]))],
      mersmaj: ['Mersenne major', mersenne('9/8')],
      mersmin: ['Mersenne minor', mersenne('10/9')],
      // the 22 shrutis as usually given in ratios (a modern reading): every degree but Sa and Pa twice
      shruti: ['22 shrutis', [[0, 0], [-5, 0], [-1, -1], [-2, 1], [2, 0], [-3, 0], [1, -1], [0, 1], [4, 0], [-1, 0], [3, -1],
        [2, 1], [6, 0], [1, 0], [-4, 0], [0, -1], [-1, 1], [3, 0], [-2, 0], [2, -1], [1, 1], [5, 0]]],
    }],
    ['3-limit', {
      penta: ['Pentatonic, Pythagorean', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]],
      pchrom: ['Chromatic, Pythagorean', [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((b) => [b, 0])],
      // Safi al-Din's 17 (13th century): the fifths chain from 12 below the 1/1 to 4 above
      safi: ['Safi al-Din 17', Array.from({ length: 17 }, (_, i) => [i - 12, 0])],
    }],
    ['7-limit', {
      blues: ['Septimal blues', [[0, 0, 0], [-1, 0, 1], [-1, 0, 0], [0, -1, 1], [1, 0, 0], [0, 0, 1]]],
      otonal: ['Overtones 8:9:10:12:14:15', [[0, 0, 0], [2, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 1, 0]]],
      hexany: ['Hexany', [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1]]],
      // our own: 6:7:9 and 14:18:21 on 1/1, 4/3, 3/2, the blues and 21/20, one note per piano key: the white keys are the septimal major, C D E♭ F G A♭ B♭ the minor
      sepchrom: ['Septimal chromatic', '1/1 21/20 9/8 7/6 9/7 4/3 7/5 3/2 14/9 12/7 7/4 27/14'.split(' ')],
      // Archytas' three genera (as in Scala: arch_enh, ptolemy_diat5, arch_chrom), each two tetrachords a 9/8 apart
      archdiat: ['Archytas diatonic', [[0, 0, 0], [-3, 0, 1], [-3, 0, 0], [-1, 0, 0], [1, 0, 0], [-2, 0, 1], [-2, 0, 0]]],
      archchrom: ['Archytas chromatic', [[0, 0, 0], [-3, 0, 1], [2, 0, 0], [-1, 0, 0], [1, 0, 0], [-2, 0, 1], [3, 0, 0]]],
      archytas: ['Archytas enharmonic', [[0, 0, 0], [-3, 0, 1], [-1, -1, 0], [-1, 0, 0], [1, 0, 0], [-2, 0, 1], [0, -1, 0]]],
      wtp: ['Well-Tuned Piano (La Monte Young)', [[0, 0, 0], [4, 0, 1], [2, 0, 0], [1, 0, 2], [1, 0, 1], [3, 0, 2], [3, 0, 1],
        [1, 0, 0], [0, 0, 2], [0, 0, 1], [2, 0, 2], [2, 0, 1]]],
    }],
    ['11-limit', {
      // Wilson's combination product sets, beside the Hexany: the products of 2 of 1 3 5 7 11, of 3 of 1 3 5 7 9 11
      dekany: ['Dekany', cps([1, 3, 5, 7, 11], 2)],
      eikosany: ['Eikosany', cps([1, 3, 5, 7, 9, 11], 3)],
      // Partch's 43 (Genesis of a Music): ratios, not lattice points (any note is a ratio string here)
      partch: ['Partch 43', ('1/1 81/80 33/32 21/20 16/15 12/11 11/10 10/9 9/8 8/7 7/6 32/27 6/5 11/9 5/4 14/11 9/7 21/16 '
        + '4/3 27/20 11/8 7/5 10/7 16/11 40/27 3/2 32/21 14/9 11/7 8/5 18/11 5/3 27/16 12/7 7/4 16/9 9/5 20/11 11/6 15/8 '
        + '40/21 64/33 160/81').split(' ')],
      // neutral steps, the just roots of maqam theory (Scala: ptolemy_hom; rast_11-limit, two Rast tetrachords 9/8 27/22 4/3)
      equable: ['Ptolemy equable diatonic', [[0, 0], [1, 0, 0, -1], [1, -1], [-1, 0], [1, 0], [2, 0, 0, -1], [2, -1]]],
      rast: ['Rast', [[0, 0], [2, 0], [3, 0, 0, -1], [-1, 0], [1, 0], [3, 0], [4, 0, 0, -1]]],
    }],
    ['13-limit', {
      harm16: ['Harmonics 8–16', [[0, 0], [2, 0], [0, 1], [0, 0, 0, 1], [1, 0], [0, 0, 0, 0, 1], [0, 0, 1], [1, 1]]],
      sub16: ['Subharmonics 8–16', [[0, 0], [-1, -1], [0, 0, -1], [0, 0, 0, 0, -1], [-1, 0], [0, 0, 0, -1], [0, -1], [-2, 0]]],
    }],
  ];
  const presetNotes = (k) => { for (const [, g] of PRESETS) if (g[k]) return g[k][1]; return null; };
  const presetStrs = (notes) => notes.map((x) => {
    if (typeof x === 'string') return S.noteKey(x);
    const [b, c, d = 0, e = 0, f = 0] = x;
    return S.qNote({ 3: b, 5: c, 7: d, 11: e, 13: f });
  });
  // which preset the chosen notes are, if any (same notes, any order); only the 1/1 or nothing: none yet, the menu reads Presets…
  const matchPreset = () => {
    if (!S.latticeNotes.notes.length || S.latticeNotes.notes.join() === '1/1') return 'none';
    for (const [, g] of PRESETS) {
      for (const [k, [, notes]] of Object.entries(g)) {
        if (notes.length === S.latticeNotes.notes.length && presetStrs(notes).every(S.latticeNotes.has)) return k;
      }
    }
    return 'custom';
  };
  // Custom keeps the last painted notes apart from the presets, so choosing a preset doesn't lose them (as
  // the Tone menu's Custom does). Filled by every change that makes no preset (the 1/1 alone or no notes are not kept).
  let slot = null, custom = false;   // custom: the menu reads Custom
  try {
    const saved = JSON.parse(localStorage.getItem('scales.latSlot') || 'null');
    if (Array.isArray(saved) && saved.length) slot = saved;
  } catch (e) {}
  const keepNotes = () => {
    custom = matchPreset() === 'custom';
    if (!custom || !S.latticeNotes.notes.length) return;
    slot = S.latticeNotes.notes.slice();
    S.keep('scales.latSlot', JSON.stringify(slot));
  };
  if (!slot) keepNotes(); else custom = matchPreset() === 'custom';
  S.on('latticeset', keepNotes);
  const PRESET_SEL = `<span class="sub-tools"><label class="field preset"><select data-preset aria-label="Scale preset">
    <option value="none" hidden disabled>Presets…</option>
    ${PRESETS.map(([g, list]) => `<optgroup label="${g}">${Object.entries(list).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}</optgroup>`).join('')}
    <option value="custom">Custom</option></select></label>${S.LATTICE_LINK}</span>`;   // one group: the menu and the link wrap together

  // the preset menu at the right end of the menu row, on narrow windows the link beside it
  const onMount = (el) => {
    S.markLink();
    const sel = el.querySelector('[data-preset]');
    sel.addEventListener('change', () => {
      // Custom brings back the kept notes; while none are kept the notes stay and the menu reads Custom
      const notes = presetNotes(sel.value), list = notes ? presetStrs(notes) : slot;
      if (!list) { custom = true; return; }
      S.latticeNotes.set(list);
      S.emit('preset');   // the Lattice moves its view onto the notes
      sel.blur();
    });
    const showPreset = () => { sel.value = custom ? 'custom' : matchPreset(); };
    S.on('latticeset', showPreset);
    showPreset();
  };

  const view = S.subTab({
    title: 'Lattice',
    subs: ['lattice'],
    head: PRESET_SEL,
    onMount,
    onPick: () => S.stopRun('[data-act="lscale"]'),
  });
  // the link: presets by their exact label, the Custom slot
  view.presetByName = (name) => {
    for (const [, g] of PRESETS) for (const [label, notes] of Object.values(g)) if (label === name) return presetStrs(notes);
    return null;
  };
  view.presetName = () => {
    const k = !custom && matchPreset();
    if (!k || k === 'custom') return null;
    for (const [, g] of PRESETS) if (g[k]) return g[k][0];
    return null;
  };
  // the label of the preset these notes are exactly, or null (the .scl file's name)
  view.presetOf = (list) => {
    for (const [, g] of PRESETS) for (const [label, notes] of Object.values(g)) { const ps = presetStrs(notes); if (ps.length === list.length && ps.every((x) => list.includes(x))) return label; }
    return null;
  };
  view.noPreset = () => matchPreset() === 'none';
  // these notes are exactly a preset (Chord's rim leaves those out)
  view.isPreset = (list) => PRESETS.some(([, g]) => Object.values(g).some(([, notes]) => notes.length === list.length && presetStrs(notes).every((x) => list.includes(x))));
  view.slot = () => slot;
  view.setSlot = (list) => { slot = list; S.keep('scales.latSlot', JSON.stringify(slot)); };
  const hide = view.onHide;
  view.onHide = () => { S.stopRun('[data-act="lscale"]'); hide(); };
  return view;
})();

// The Cycle tab and the Spiral tab (S.subTab of one sub-view each), each with its own preset menu at the right end
// of its menu row (the user, 2026-11-12: five tabs, one preset menu per view; one menu had set both). The Cycle's
// presets live in cycle.js. The Spiral has its own few (the user: a preset whose steps are typed cents or a ratio
// only there to close a cycle reads as noise in the Spiral, Greater diesis as an octave with 648/625 on top):
// stacks of plain intervals, and each comma as two stacks, one up, one down, ending on the comma. A menu shows the
// preset its view matches, else Custom; Custom is a slot of its own in each (the last cycle or path that matched none).
(() => {
  const C = S.parts.cycle, P = S.parts.spiral;
  const same = (a, b) => a.length === b.length && a.every((p, i) => p.t === b[i].t && p.n === b[i].n && !!p.down === !!b[i].down);
  let pathSlot = null;   // the Spiral's Custom (scales.spiralSlot); the Cycle keeps its own (scales.cycleSlot)
  try {
    const o = JSON.parse(localStorage.getItem('scales.spiralSlot') || 'null');
    if (Array.isArray(o) && o.length && o.every((p) => p && S.parseStep(p.t))) {
      // counts as the Spiral keeps them: whole, 1 to MAXN a run, MAXP in all
      let left = P.MAXP;
      const runs = o.map((p) => { const n = Math.min(Math.max(1, Math.round(+p.n || 1)), P.MAXN, left); left -= n; return { t: p.t, down: !!p.down, n }; }).filter((p) => p.n >= 1);
      if (runs.length) pathSlot = runs;
    }
  } catch (e) {}
  const menu = (list) => `<label class="field preset"><select data-preset aria-label="Preset">
      ${list.filter((p) => !p[2]).map(([k, name]) => `<option value="${k}">${name}</option>`).join('')}
      <optgroup label="Commas">${list.filter((p) => p[2]).map(([k, name]) => `<option value="${k}">${name}</option>`).join('')}</optgroup>
      <option value="custom">Custom</option><option value="none" hidden disabled>Presets…</option></select></label>`;
  // the Spiral's presets: [key, name, group, () => runs]. The Cycle's comma sums (a comma typed as a step) and
  // everything with typed cents or a closing step (well temperaments, meantones, Bohlen–Pierce, Carlos) stay Cycle-only
  const up = (n, t) => ({ t, down: false, n });
  const SP = [
    ['fifths', '12 fifths, pure', null, () => [up(12, '3/2')]],
    ['fifths53', '53 fifths, pure', null, () => [up(53, '3/2')]],
    ['tet', '12-TET', null, () => C.pathOf('tet')],
    ['major', 'Major 9/8 (Ptolemy)', null, () => C.pathOf('major')],
    ...C.presets.filter(([k, , g]) => g && /^c[A-Z]/.test(k)).map(([k, name, g]) => [k, name, g, () => C.stackOf(k)]),
  ];
  const spPath = (k) => { const p = SP.find((q) => q[0] === k); return p ? p[3]() : null; };
  let cSel = null, pSel = null;

  S.views.cycle = S.subTab({
    title: 'Cycle',
    subs: ['cycle'],
    head: `<span class="sub-tools">${menu(C.presets)}${S.USE_BTN}</span>`,   // the arrow beside the menu where the side panel is a drawer
    onMount(el) {
      cSel = el.querySelector('[data-preset]');
      cSel.addEventListener('change', () => { C.use(cSel.value); cSel.blur(); syncCycle(); });
      syncCycle();
    },
  });
  function syncCycle() { if (cSel) cSel.value = C.match(); }

  const view = S.subTab({
    title: 'Spiral',
    subs: ['spiral'],
    head: `<span class="sub-tools">${menu(SP)}${S.USE_BTN}</span>`,
    onMount(el) {
      pSel = el.querySelector('[data-preset]');
      pSel.addEventListener('change', () => {
        const k = pSel.value;
        if (k !== 'custom') P.setPath(spPath(k));
        else if (pathSlot) P.setPath(pathSlot.map((p) => ({ ...p })));
        pSel.blur();
        syncPath();
      });
      syncPath();
    },
  });
  const pathKey = () => SP.find(([q]) => same(P.path(), spPath(q)));
  function syncPath() {
    const k = pathKey();
    if (pSel) pSel.value = k ? k[0] : P.path().length ? 'custom' : 'none';   // no runs: no preset yet, as the Lattice's empty menu
    if (k || !P.path().length) return;   // no runs at all are not kept
    pathSlot = P.path().map((p) => ({ t: p.t, down: !!p.down, n: p.n }));
    S.keep('scales.spiralSlot', JSON.stringify(pathSlot));
  }
  C.onEdit = syncCycle;
  P.onEdit = syncPath;
  // the link: the path's preset name (null: Custom) and the slot
  view.pathName = () => (pathKey() ? pathKey()[1] : null);
  view.pathSlot = () => pathSlot;
  view.pathByName = (name) => { const p = SP.find((q) => q[1] === name); return p ? p[3]() : null; };
  // a link's Custom; none given: the path itself if it is one (as a Custom path always is), else this tab's slot stays
  view.keepPath = (runs) => {
    if (!pathKey()) runs = P.path().map((p) => ({ t: p.t, down: !!p.down, n: p.n }));
    if (!runs || !runs.length) return;
    pathSlot = runs;
    S.keep('scales.spiralSlot', JSON.stringify(pathSlot));
  };
  S.views.spiral = view;
})();

// The Numbers tab (Table, Hasse, Scatter, Diamond): no notes of its own, so no presets, Edit or link
S.views.numbers = (() => {
  const N = () => S.parts.numbers;
  const view = S.subTab({
    title: 'Numbers',
    subs: ['numbers', 'diamond'],
    routes: { table: ['numbers', 'Table'], diamond: ['diamond', 'Diamond'], hasse: ['numbers', 'Hasse'], scatter: ['numbers', 'Scatter'] },   // the grids of ratios, then the numbers' structure (the user, 2026-11-12)
    onRoute: (h) => { if (h !== 'diamond') N().setView(h); },
  });
  // #numbers opens Table, Hasse or Scatter as last chosen
  const pick = view.pick;
  view.pick = (k) => pick(!k || k === 'numbers' ? view.route() || N().view() : k);
  return view;
})();
