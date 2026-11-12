'use strict';
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
  try { const o = JSON.parse(localStorage.getItem('scales.spiralSlot') || 'null'); if (Array.isArray(o) && o.length && o.every((p) => p && S.parseStep(p.t))) pathSlot = o; } catch (e) {}
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
    dim: { cycle: true },
    lit: true,   // every note inside the circle is the Cycle's: nothing is merely shown
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
    dim: { spiral: true },
    lit: true,
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
