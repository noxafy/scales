'use strict';
// A tab: one or more sub-views (S.parts) on the left, under a row with a menu of links (none for a single
// sub-view) and the tab's head (its preset menu); on the right one panel for them all (Chord, Scale, the circle
// with the scale on its rim, the list). Only the circle's inside and the readout follow the chosen one.
// subs: S.parts ids; routes: {hash: [sub, label]}, menu links of their own (Numbers' Table, Hasse, Scatter are
// one sub-view: onRoute(hash) sets it); dim: those that show their notes faint inside the circle, but for class
// `in` (lit: all of them lit, no spokes but the chosen one's); head: HTML at the right end of the menu row;
// onMount(el): wires it; onPick(k): a sub-view was chosen.
S.subTab = ({ title, subs, routes = null, dim = {}, lit = false, head = '', onMount, onPick, onRoute }) => {
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
      clocks[k] = add('clocks', 'clockwrap' + (dim[k] ? ' dim' : '') + (lit ? ' lit-all' : ''));
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
      if (code === 'Delete' || code === 'Backspace') {
        // Delete (a Mac's ⌫) takes the note in the readout out of the scale (Undo brings it back)
        const str = reads[cur].querySelector('[data-ro]')?.dataset.ro;
        if (!str || !S.inScale(str)) return false;
        S.removeFromScale(str);
        return true;
      }
      return !!(S.parts[cur].onKeyDown && S.parts[cur].onKeyDown(code, e));
    },
  };
};
