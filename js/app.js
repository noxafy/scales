'use strict';
// Shell: tabs, hash routing, global controls, keyboard dispatch.
(() => {
  const ORDER = ['harmonics', 'discover', 'temper'];
  // the hashes of a tab's sub-views (Just intonation, Temperament) open that tab; the tab's own hash
  // (#discover, #temper) opens its last one
  const tabOf = (id) => ORDER.find((t) => S.views[t].subs && S.views[t].subs.includes(id));
  const main = document.getElementById('main');
  const tabs = document.getElementById('tabs');
  const mounted = {};
  // the 1/1 and Tone fields live in the settings menu; a view with a [data-tone-slot] (Harmonics) shows a
  // copy of Tone in its own head (the user prefers the menu staying the same in every tab)
  const toneField = document.querySelector('.g-tone');
  const toneSels = [];
  let current = null;
  // Enter plays what is selected, as a press does: at least 50 ms, as long as it is held (the view's playSel)
  const enter = S.keyVoices(() => { const v = S.views[current]; return v.playSel ? v.playSel() : null; });

  tabs.innerHTML = ORDER.map((id) => `<a href="#${id}" data-id="${id}">${S.views[id].title}</a>`).join('');

  function show(id) {
    let sub = null;
    if (tabOf(id)) { sub = id; id = tabOf(id); }
    if (!ORDER.includes(id)) id = ORDER[0];   // an unknown hash (#edo, gone; #constructor) shows the first tab
    if (id === current) { if (S.views[id].subs) pickSub(id, sub); return; }
    if (current) {
      S.views[current].onHide && S.views[current].onHide();
      mounted[current].hidden = true;
    }
    if (!mounted[id]) {
      const el = document.createElement('section');
      el.className = 'view view-' + id;
      main.appendChild(el);
      S.views[id].mount(el);
      mounted[id] = el;
      const slot = el.querySelector('[data-tone-slot]');
      if (slot) {
        const c = toneField.cloneNode(true), sel = c.querySelector('select');
        sel.removeAttribute('id'); slot.append(c); wireTone(sel);
      }
    }
    mounted[id].hidden = false;
    S.emit('shown');
    if (S.views[id].subs) pickSub(id, sub);
    current = id;
    pin();
    document.body.dataset.view = id;
    tabs.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === id));
    S.views[id].onShow && S.views[id].onShow();
    fitHeader();
  }

  function pickSub(id, sub) {
    S.views[id].pick(sub);
    const k = S.views[id].sub();
    tabs.querySelector(`[data-id="${id}"]`).href = '#' + k;   // the tab goes back to the last one
  }

  // phones: the tabs share the corner buttons' row, with shorter names when the full ones don't fit
  // (the user's order: one row first, abbreviations only where needed); a row of their own only as a last resort
  const top = document.querySelector('header.top');
  const phone = matchMedia('(max-width: 680px)'), lastBtn = document.getElementById('g-settings');
  const SHORT = [{}, { discover: 'Just int.' }, { harmonics: 'Harm.', discover: 'Just int.', temper: 'Temp.' }];
  function fitHeader() {
    top.classList.remove('tabs2');
    const links = [...tabs.children];
    for (const short of SHORT) {
      links.forEach((a) => { a.textContent = short[a.dataset.id] || S.views[a.dataset.id].title; });
      if (!phone.matches || lastBtn.offsetTop < tabs.offsetTop + tabs.offsetHeight) return;   // settings, the last, didn't wrap
    }
    top.classList.add('tabs2');
  }
  window.addEventListener('resize', fitHeader);

  // narrow windows: the view's readout ([data-pin]) is pinned to the window's bottom, so a press in the picture
  // shows its note while the drawer is shut; a comment keeps its place to go back to
  const narrow = matchMedia('(max-width: 960px)'), pinSlot = document.querySelector('[data-pin-slot]'), homes = new Map();
  function pin() {
    for (const [p, home] of homes) home.replaceWith(p);
    homes.clear();
    const p = current && narrow.matches && mounted[current].querySelector('[data-pin]');
    if (p) { const home = document.createComment('pin'); p.replaceWith(home); homes.set(p, home); pinSlot.append(p); }
    headH();
  }
  // the drawer runs from the header to the bar, and its tab stands on the bar
  const pinBar = document.getElementById('g-pin');
  function headH() {
    document.documentElement.style.setProperty('--pin-b', Math.max(0, top.getBoundingClientRect().bottom) + 'px');
    document.documentElement.style.setProperty('--pin-h', pinBar.offsetHeight + 'px');
  }
  narrow.addEventListener('change', () => { if (!narrow.matches) openDrawer(false); pin(); });
  window.addEventListener('resize', headH);
  new ResizeObserver(headH).observe(pinBar);   // a readout that wraps makes the bar taller
  window.addEventListener('scroll', () => { if (document.body.classList.contains('drawer-open')) headH(); }, { passive: true });

  /* globals */
  const anchor = document.getElementById('g-anchor');
  const hz = document.getElementById('g-hz');
  // the 1/1 as two dropdowns, its name (C … B) and its octave (each with its Hz): changing one leaves the other
  const base = document.getElementById('g-base'), basePc = document.getElementById('g-base-pc');
  for (let k = 0; k < 12; k++) basePc.add(new Option(S.midiName(60 + k).replace(/-?\d+$/, ''), k));
  const fillBase = () => {
    const pc = S.mod(S.settings.base, 12);
    base.innerHTML = '';
    for (let m = S.BASE_MIN + pc; m <= S.BASE_MAX; m += 12) base.add(new Option(`${Math.floor(m / 12) - 1} · ${S.fmtHz(S.midiFreq(m))} Hz`, m));
    base.value = S.settings.base;
    basePc.value = pc;
  };
  S.basePitchClass = (pc) => {
    const m = 12 * Math.floor(S.settings.base / 12) + pc;   // octaves 0–7 hold every name: always in range
    if (m === S.settings.base) return;
    S.settings.base = m; S.saveSettings();
    S.emit('settings');
  };
  basePc.addEventListener('change', () => S.basePitchClass(+basePc.value));
  for (let m = 21; m <= 108; m++) anchor.add(new Option(S.midiName(m), m));
  anchor.value = S.settings.anchorMidi;
  hz.value = S.settings.anchorHz;
  // switching the anchor note keeps the tuning: the new note takes its exact frequency, derived afresh from the
  // note and Hz last given (ref), so going back gives those again; only the box shows it rounded
  let ref = { m: S.settings.anchorMidi, hz: S.settings.anchorHz };
  const hzAt = (m) => (m === ref.m ? ref.hz : ref.hz * 2 ** ((m - ref.m) / 12));
  const showHz = () => { const m = S.settings.anchorMidi; hz.value = m === ref.m ? ref.hz : Math.round(S.settings.anchorHz * 100) / 100; };
  anchor.addEventListener('change', () => {
    const m = +anchor.value;
    S.settings.anchorHz = hzAt(m);
    S.settings.anchorMidi = m;
    showHz();
    S.saveSettings();
  });
  hz.addEventListener('change', () => {
    const v = parseFloat(hz.value);
    if (!(v >= 10 && v <= 5000)) { showHz(); return; }
    S.settings.anchorHz = v; ref = { m: S.settings.anchorMidi, hz: v }; S.saveSettings(); S.emit('settings');
  });
  fillBase();
  S.on('settings', () => {
    const { anchorMidi: m, anchorHz: f } = S.settings;
    if (hzAt(m) !== f) ref = { m, hz: f };   // a link's tuning
    anchor.value = m; showHz(); fillBase();
  });
  base.addEventListener('change', () => {
    S.settings.base = +base.value; S.saveSettings();
    S.emit('settings');
  });

  // Tone: the Harmonics spectrum by name (in the settings menu; on Harmonics also in its panel's head)
  const showTone = () => toneSels.forEach((t) => (t.value = S.toneName()));
  function wireTone(timbre) {
    toneSels.push(timbre);
    timbre.innerHTML = '';
    Object.entries(S.SHAPES).forEach(([k, [label]]) => timbre.add(new Option(label, k)));
    timbre.add(new Option('Custom', 'custom'));
    timbre.value = S.toneName();
    timbre.addEventListener('change', () => {
      if (timbre.value === 'custom') S.useCustom('header'); else S.setShape(timbre.value, 'header');
      showTone();
    });
  }
  wireTone(document.getElementById('g-timbre'));
  S.on('spectrum', showTone);

  // the settings menu: tuning anchor, theme, deleting what this site saved
  const setBtn = document.getElementById('g-settings'), menu = document.getElementById('g-menu');
  const openMenu = (on) => { menu.hidden = !on; setBtn.setAttribute('aria-expanded', on); setBtn.classList.toggle('on', on); };
  setBtn.addEventListener('click', () => openMenu(menu.hidden));
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('.settings')) openMenu(false); });
  S.closeMenu = () => { if (menu.hidden) return false; openMenu(false); return true; };

  // theme: follow the system (auto), or force light / dark
  const applyTheme = (t) => {
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try { t === 'auto' ? localStorage.removeItem('scales.theme') : localStorage.setItem('scales.theme', t); } catch (e) {}
    S.emit('theme');
  };
  S.seg(menu, 'theme', document.documentElement.dataset.theme || 'auto', applyTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S.emit('theme'));

  // MIDI input: disabled where the browser has none (Safari); a refusal turns it back off and names why
  const midiSeg = menu.querySelector('[data-seg="midi"]');
  if (!S.midi.supported) {
    midiSeg.querySelectorAll('button').forEach((b) => (b.disabled = true));
    midiSeg.querySelector('[data-v="off"]').classList.add('on');
    midiSeg.title = 'Not available in this browser. Try Chrome, Edge or Firefox.';
  } else {
    const result = (r) => { markMidi(r.on ? 'on' : 'off'); midiSeg.title = r.why || ''; };
    const markMidi = S.seg(menu, 'midi', 'off', async (v) => result(await S.midi.set(v === 'on')));
    if (S.midi.stored()) S.midi.set(true).then(result);
  }

  // Experimental (Beta): the same page from the scales_beta folder (the beta deploy), and back; the view (hash) comes along
  const beta = document.getElementById('g-beta'), BASE = /\/scales(_beta)?(?=\/|$)/;
  const dir = location.pathname.match(BASE);
  beta.setAttribute('aria-checked', !!(dir && dir[1]));
  if (!dir) { beta.disabled = true; beta.title = 'Only where the page is served from a scales or scales_beta folder'; }
  beta.addEventListener('click', () => {
    const on = beta.getAttribute('aria-checked') !== 'true';
    beta.setAttribute('aria-checked', on);
    S.link.stop();
    location.href = location.pathname.replace(BASE, on ? '/scales_beta' : '/scales') + location.search + location.hash;
  });

  // every scales.* key in this browser; a second press within 4 s confirms, then the page starts fresh
  const wipe = document.getElementById('g-wipe');
  let wipeArmed = null;
  wipe.addEventListener('click', () => {
    if (!wipeArmed) {
      wipe.classList.add('armed'); wipe.textContent = 'Reset? Press again';
      wipeArmed = setTimeout(() => { wipeArmed = null; wipe.classList.remove('armed'); wipe.textContent = 'Reset to defaults'; }, 4000);
      return;
    }
    try { Object.keys(localStorage).filter((k) => k.startsWith('scales.')).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    S.link.stop();
    history.replaceState(null, '', '#' + S.link.read().tab);
    location.reload();
  });

  // narrow windows (the side panel would go under the picture): it is a drawer from the right instead,
  // opened by its tab above the pinned bar; the picture stays playable beside it
  const drawerBtn = document.getElementById('g-drawer');
  const openDrawer = (on) => { headH(); document.body.classList.toggle('drawer-open', on); drawerBtn.classList.toggle('on', on); drawerBtn.setAttribute('aria-expanded', on); S.emit('shown'); };
  let drag = null, dragged = false;
  drawerBtn.addEventListener('click', () => { if (dragged) { dragged = false; return; } openDrawer(!document.body.classList.contains('drawer-open')); });
  // so does a tap on the pinned bar's background, begun and ended there, off any text (Stop, Add to scale and pressable
  // notes keep theirs; a tap on the readout's cents shows their exact value (core.js, .tip-pop) and opens nothing)
  const onText = (t, x, y) => {
    const w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT), r = document.createRange();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) if (x >= b.left - 4 && x <= b.right + 4 && y >= b.top - 4 && y <= b.bottom + 4) return true;
    }
    return false;
  };
  const pinOwn = (e) => !e.target.closest('button, a, input, select, label, [data-ro], [data-pair]') && !onText(e.target, e.clientX, e.clientY);
  let pinDown = false;
  pinBar.addEventListener('pointerdown', (e) => { pinDown = pinOwn(e); });
  pinBar.addEventListener('click', (e) => { if (pinDown && pinOwn(e)) drawerBtn.click(); });
  // the tab can be dragged either way, and a finger swiping right anywhere on the open drawer pushes it back; it follows,
  // and on letting go it goes the way it was flung, else to the nearer side. Controls and the circle's notes keep their own presses
  drawerBtn.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const side = mounted[current] && mounted[current].querySelector('.panel.side');
    if (!side) return;
    headH();
    const x0 = document.body.classList.contains('drawer-open') ? 0 : side.offsetWidth;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, side, w: side.offsetWidth, x0, at: x0, t: e.timeStamp, v: 0, moved: false, tab: true };
    dragged = false;
  });
  main.addEventListener('pointerdown', (e) => {
    const side = e.target.closest('.panel.side');
    if (!side || e.pointerType !== 'touch' || !narrow.matches || !document.body.classList.contains('drawer-open')) return;
    if (e.target.closest('button, select, input, a, .clock-dot, .clock-hit, .clock-label')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, side, w: side.offsetWidth, x0: 0, at: 0, t: e.timeStamp, v: 0, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (drag.tab) { if (Math.abs(dx) < 6) return; }
      else {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= dx) { drag = null; return; }   // the list scrolling
        if (dx < 10 || dx < 1.5 * Math.abs(dy)) return;
      }
      drag.moved = true;
      document.body.classList.add('drawer-drag');
      if (drag.tab) S.emit('shown');   // the circle that waited for the drawer
      else {
        const id = drag.id;
        drag.id = null;   // this cancel is for a note the press started (S.holdOn), not for the swipe
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id }));
        drag.id = id;
      }
    }
    const at = S.clamp(drag.x0 + dx, 0, drag.w), dt = e.timeStamp - drag.t;
    if (dt > 0) drag.v = 0.7 * ((at - drag.at) / dt) + 0.3 * drag.v;   // px per ms, + towards shut, smoothed
    drag.at = at; drag.t = e.timeStamp;
    drag.side.style.transform = `translateX(${at}px)`;
    drawerBtn.style.transform = `translateX(${at - drag.w + 1}px)`;
  });
  const dragEnd = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    dragged = d.tab;   // the click that follows is not a tap
    const open = Math.abs(d.v) > 0.5 ? d.v < 0 : d.at < d.w / 2;   // a fling: 500 px/s
    d.side.style.transform = drawerBtn.style.transform = '';
    document.body.classList.remove('drawer-drag');
    openDrawer(open);
    setTimeout(() => { dragged = false; }, 0);
  };
  window.addEventListener('pointerup', dragEnd);
  window.addEventListener('pointercancel', dragEnd);
  S.closeDrawer = () => { if (!document.body.classList.contains('drawer-open')) return false; openDrawer(false); return true; };

  const panic = document.getElementById('g-panic'), corner = top.querySelector('.corner');
  // phones: the header scrolls away, so Stop moves into the pinned bar's edge strip
  const placeStop = () => { (phone.matches ? document.querySelector('[data-stop-slot]') : corner).prepend(panic); document.body.classList.toggle('stop-pin', phone.matches); fitHeader(); };
  phone.addEventListener('change', placeStop);
  placeStop();
  panic.addEventListener('click', () => S.audio.panic());
  S.on('activity', (on) => panic.classList.toggle('live', on));

  // a link read on opening, or typed or pasted over an open page; a tab or sub-view link has no fields, and Back's
  // old addresses (written here) only say which tab: the state stays. Then the address is written back
  const route = (opening) => {
    const { tab, fields } = S.link.read();
    // a link that can't be read must still leave a page
    if (fields && (opening || !S.link.own())) { try { S.link.apply(fields); } catch (e) { console.warn('link not read:', e); } }
    show(tab);
    S.link.write(S.views[current].subs ? S.views[current].sub() : current);
  };
  window.addEventListener('hashchange', () => route(false));
  route(true);

  // a chosen dropdown lets go of focus, so the keys reach the page again
  document.addEventListener('change', (e) => { if (e.target.matches('select')) e.target.blur(); });

  /* keyboard */
  const isEnter = (code) => code === 'Enter' || code === 'NumpadEnter';
  S.on('release', () => enter.releaseAll());
  const typing = (e) => e.target.closest && e.target.closest('input[type=text], input[type=number], textarea, select');
  // what a field held when it got the focus: Esc puts it back
  const atFocus = new WeakMap();
  document.addEventListener('focusin', (e) => { if (e.target.matches('input')) atFocus.set(e.target, e.target.value); });
  // Space and Enter belong to a control reached by keyboard (Tab); one that a mouse or finger left focused keeps
  // no claim on them (:focus-visible tells the two apart)
  const claimsKey = (code) => {
    const a = document.activeElement;
    if (!a || !a.matches(':focus-visible')) return false;
    return a.matches('button') ? code === 'Space' || isEnter(code) : a.matches('a') && isEnter(code);
  };
  window.addEventListener('keydown', (e) => {
    // Esc is Stop, wherever the focus is; it also leaves a field or shuts the menu or drawer
    if (e.code === 'Escape') {
      S.audio.panic();
      S.closeMenu() || (matchMedia('(max-width: 960px)').matches && S.closeDrawer());
      const f = document.activeElement;
      if (f && f.matches('input')) { e.preventDefault();   /* a search field would empty itself */ if (atFocus.has(f)) f.value = atFocus.get(f); f.classList.remove('bad'); f.blur(); }
      return;
    }
    // an open list has the arrows and Enter; the piano keys go on playing
    if (pop && (e.code === 'ArrowUp' || e.code === 'ArrowDown' || isEnter(e.code))) {
      e.preventDefault();
      const opts = [...pop.querySelectorAll('.sel-opt')], cur = pop.querySelector('.cur');
      if (isEnter(e.code)) { if (cur && !e.repeat) popChoose(cur); return; }
      const to = opts[S.clamp(opts.indexOf(cur) + (e.code === 'ArrowDown' ? 1 : -1), 0, opts.length - 1)];
      popCur(to); to.scrollIntoView({ block: 'nearest' });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyC' && !e.shiftKey && !e.altKey && !(e.target.closest && e.target.closest('input, textarea, select')) && S.copyNote()) { e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey && !typing(e)) { e.preventDefault(); S.undoScale(); return; }
    if ((e.metaKey || e.ctrlKey) && ((e.code === 'KeyZ' && e.shiftKey) || (e.code === 'KeyY' && !e.shiftKey)) && !typing(e)) { e.preventDefault(); S.redoScale(); return; }
    // Alt reaches the views only with arrows (Beats: Alt+arrow = 0.1¢)
    if (e.metaKey || e.ctrlKey || (e.altKey && !e.code.startsWith('Arrow')) || typing(e)) return;
    if (claimsKey(e.code)) return;
    // Space doesn't press again whatever button was clicked last
    if (e.code === 'Space' && document.activeElement && document.activeElement.matches('button')) document.activeElement.blur();
    const v = S.views[current];
    // held arrows keep stepping; held note keys don't retrigger
    if (e.repeat && !e.code.startsWith('Arrow')) { if (isEnter(e.code) || S.PIANO.includes(e.code)) e.preventDefault(); return; }
    // Enter is the selection's, not the last clicked button's
    if (isEnter(e.code)) {
      if (document.activeElement && document.activeElement.matches('button, a')) document.activeElement.blur();
      e.preventDefault();
      enter.down('Enter');
      return;
    }
    if ((v.onKeyDown && v.onKeyDown(e.code, e)) || (v.scaleKeys && S.scaleKeys.down(e.code))) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const v = S.views[current];
    v.onKeyUp && v.onKeyUp(e.code, e);
    S.scaleKeys.up(e.code);
    if (isEnter(e.code)) enter.up('Enter');
  });
  window.addEventListener('blur', () => S.emit('release'));
  // the browser's dropdown takes held keys' repeats as a search and never lets their keyups through. With a mouse a list
  // of our own opens instead, which leaves the piano keys alone (touch keeps the phone's picker, the keyboard the browser's)
  let pop = null, popSel = null;
  const shutPop = () => { if (pop) { pop.remove(); pop = popSel = null; } };
  const mouse = matchMedia('(hover: hover) and (pointer: fine)');
  const popChoose = (o) => {
    const sel = popSel;
    shutPop();
    sel.value = o.dataset.v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const popCur = (o) => { pop.querySelector('.cur')?.classList.remove('cur'); o.classList.add('cur'); };
  const openPop = (sel) => {
    shutPop();
    popSel = sel;
    pop = document.createElement('div');
    pop.className = 'sel-pop';
    pop.setAttribute('role', 'listbox');
    const row = (o) => `<div class="sel-opt${o.selected ? ' on cur' : ''}" role="option" data-v="${o.value.replace(/"/g, '&quot;')}">${o.textContent}</div>`;
    const usable = (o) => !o.disabled && !o.hidden;
    pop.innerHTML = [...sel.children].map((c) => (c.matches('optgroup')
      ? `<div class="sel-group">${c.label}</div>${[...c.children].filter(usable).map(row).join('')}`
      : usable(c) ? row(c) : '')).join('');
    document.body.append(pop);
    const box = sel.getBoundingClientRect(), gap = 4, edge = 8;
    const below = innerHeight - box.bottom - gap - edge, above = box.top - gap - edge, down = below >= pop.offsetHeight || below >= above;
    pop.style.maxHeight = `${down ? below : above}px`;
    pop.style.minWidth = `${box.width}px`;
    pop.style.left = `${S.clamp(box.left, edge, Math.max(edge, innerWidth - pop.offsetWidth - edge))}px`;
    pop.style.top = `${down ? box.bottom + gap : box.top - gap - pop.offsetHeight}px`;
    pop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());   // the settings menu and this list stay open
    pop.addEventListener('click', (e) => {
      const o = e.target.closest('.sel-opt');
      if (o) popChoose(o);
    });
    pop.addEventListener('pointermove', (e) => { const o = e.target.closest('.sel-opt'); if (o) popCur(o); });
  };
  document.addEventListener('mousedown', (e) => {
    const sel = e.target.closest('select');
    if (!sel || sel.disabled || !(mouse.matches || S.scaleKeys.any() || enter.any())) return;
    e.preventDefault();
    if (popSel === sel) shutPop(); else openPop(sel);
  }, true);
  document.addEventListener('pointerdown', (e) => { if (pop && !e.target.closest('select')) shutPop(); });
  // it stands where its dropdown stood: anything moving that away shuts it
  window.addEventListener('scroll', (e) => { if (pop && !pop.contains(e.target)) shutPop(); }, true);
  window.addEventListener('resize', shutPop);
  S.on('panic', shutPop);
})();
