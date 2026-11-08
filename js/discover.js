'use strict';
// Just intonation: Lattice, Diamond and Numbers as one tab of sub-views (S.subTab), with the scale presets.
S.views.discover = (() => {
  // scale presets as lattice points [powers of 3, 5, 7, 11, 13]: scales found from the harmonics (Temperament will get
  // tempered ones of its own). A preset sets the notes chosen here (S.ji), and through them the scale only while linked. Grouped by prime limit. Modes that only
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
    if (!S.ji.notes.length || S.ji.notes.join() === '1/1') return 'none';
    for (const [, g] of PRESETS) {
      for (const [k, [, notes]] of Object.entries(g)) {
        if (notes.length === S.ji.notes.length && presetStrs(notes).every(S.ji.has)) return k;
      }
    }
    return 'custom';
  };
  // Custom keeps the last painted notes apart from the presets, so choosing a preset doesn't lose them (as
  // the Tone menu's Custom does). Filled by every change that makes no preset (the 1/1 alone or no notes are not kept).
  let slot = null, custom = false;   // custom: the menu reads Custom
  try {
    const saved = JSON.parse(localStorage.getItem('scales.scaleSlot') || 'null');
    if (Array.isArray(saved) && saved.length) slot = saved;
  } catch (e) {}
  const keepNotes = () => {
    custom = matchPreset() === 'custom';
    if (!custom || !S.ji.notes.length) return;
    slot = S.ji.notes.slice();
    S.keep('scales.scaleSlot', JSON.stringify(slot));
  };
  if (!slot) keepNotes(); else custom = matchPreset() === 'custom';
  S.on('jiset', keepNotes);
  const PRESET_SEL = `<span class="sub-tools"><label class="field preset"><select data-preset aria-label="Scale preset">
    <option value="none" hidden disabled>Presets…</option>
    ${PRESETS.map(([g, list]) => `<optgroup label="${g}">${Object.entries(list).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}</optgroup>`).join('')}
    <option value="custom">Custom</option></select></label>${S.JI_LINK}</span>`;   // one group: the menu and the link wrap together

  // the preset menu at the right end of the menu row, on narrow windows the link beside it
  const onMount = (el) => {
    S.markLink();
    const sel = el.querySelector('[data-preset]');
    sel.addEventListener('change', () => {
      // Custom brings back the kept notes; while none are kept the notes stay and the menu reads Custom
      const notes = presetNotes(sel.value), list = notes ? presetStrs(notes) : slot;
      if (!list) { custom = true; return; }
      S.ji.set(list);
      S.emit('preset');   // the Lattice moves its view onto the notes
      sel.blur();
    });
    const showPreset = () => { sel.value = custom ? 'custom' : matchPreset(); };
    S.on('jiset', showPreset);
    showPreset();
  };

  const view = S.subTab({
    title: 'Just intonation',
    subs: ['lattice', 'diamond', 'numbers'],
    dim: { lattice: true, diamond: true, numbers: true },   // these show their notes faint inside the circle
    head: PRESET_SEL,
    onMount,
    onPick: () => S.stopJi(),
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
  view.setSlot = (list) => { slot = list; S.keep('scales.scaleSlot', JSON.stringify(slot)); };
  const hide = view.onHide;
  view.onHide = () => { S.stopJi(); hide(); };
  return view;
})();
