'use strict';
// Temperament: tempered tunings next to the scale (the cycle of n steps over k octaves, and the spiral of
// stacked intervals), as Just intonation is for the rational ones. One preset menu for both, at the right
// end of the menu row (as Just intonation's): a preset sets the Cycle and makes its steps the Spiral's path.
// It shows the preset the chosen sub-view matches, else Custom. Custom is a slot of its own in each
// sub-view (the last cycle or path that matched no preset); choosing it brings the chosen sub-view's back.
(() => {
  const C = S.parts.cycle, P = S.parts.spiral;
  const same = (a, b) => a.length === b.length && a.every((p, i) => p.t === b[i].t && p.n === b[i].n && !!p.down === !!b[i].down);
  let sel, pathSlot = null;   // the Spiral's Custom (scales.spiralSlot); the Cycle keeps its own (scales.cycleSlot)
  try { const o = JSON.parse(localStorage.getItem('scales.spiralSlot') || 'null'); if (Array.isArray(o) && o.length && o.every((p) => p && S.parseStep(p.t))) pathSlot = o; } catch (e) {}
  const view = S.subTab({
    title: 'Temperament',
    subs: ['cycle', 'spiral'],
    dim: { cycle: true, spiral: true },
    lit: true,   // every note inside the circle is the chosen one's: nothing is merely shown, as in Just intonation
    head: `<label class="field preset"><select data-preset aria-label="Preset">
      ${C.presets.filter((p) => !p[2]).map(([k, name]) => `<option value="${k}">${name}</option>`).join('')}
      <optgroup label="Commas">${C.presets.filter((p) => p[2]).map(([k, name]) => `<option value="${k}">${name}</option>`).join('')}</optgroup>
      <option value="custom">Custom</option><option value="none" hidden disabled>Presets…</option></select></label>`,
    onMount(el) {
      sel = el.querySelector('[data-preset]');
      sel.addEventListener('change', () => {
        // read once: C.use re-renders a mounted Cycle, whose onEdit syncs the menu to the old path
        const k = sel.value;
        if (k !== 'custom') { C.use(k); P.setPath(C.pathOf(k)); }
        else if (view.sub() !== 'spiral') C.use('custom');
        else if (pathSlot) P.setPath(pathSlot.map((p) => ({ ...p })));
        sel.blur();
        sync();
      });
    },
    onPick: () => sync(),
  });
  function sync() {
    if (!sel) return;
    if (view.sub() !== 'spiral') { sel.value = C.match(); return; }
    const k = C.presets.find(([q]) => same(P.path(), C.pathOf(q)));
    sel.value = k ? k[0] : P.path().length ? 'custom' : 'none';   // no runs: no preset yet, as Just intonation's empty menu
    if (k || !P.path().length) return;   // no runs at all are not kept
    pathSlot = P.path().map((p) => ({ t: p.t, down: !!p.down, n: p.n }));
    S.keep('scales.spiralSlot', JSON.stringify(pathSlot));
  }
  C.onEdit = P.onEdit = sync;
  // the link: the path's preset name (null: Custom) and the slot
  const pathKey = () => C.presets.find(([q]) => same(P.path(), C.pathOf(q)));
  view.pathName = () => (pathKey() ? pathKey()[1] : null);
  view.pathSlot = () => pathSlot;
  // a link's Custom; none given: the path itself if it is one (as a Custom path always is), else this tab's slot stays
  view.keepPath = (runs) => {
    if (!pathKey()) runs = P.path().map((p) => ({ t: p.t, down: !!p.down, n: p.n }));
    if (!runs || !runs.length) return;
    pathSlot = runs;
    S.keep('scales.spiralSlot', JSON.stringify(pathSlot));
  };
  S.views.temper = view;
})();
