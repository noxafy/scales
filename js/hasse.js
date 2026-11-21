'use strict';
// Hasse (a sub-view of the Numbers tab; what it shares with Table and Scatter is in numbers.js): the odd m = n·d of
// three primes; the first straight down, the second down to the right, the third down to the left; a direction × a
// prime puts it above the bar, ÷ below (st.hax: −3 is ÷3), so the picture keeps one shape; height = log₂ m, so a step's
// drop is its prime's size. The flattest spacing that fits the width without two numbers touching is searched on every
// draw. Its three directions are its own (scales.hasse).
(() => {
  const N = S.numbers, PRIMES = N.PRIMES, DEF_HAX = [3, 5, 7];
  const haxAbs = (st) => st.hax.map(Math.abs);
  // the key of m in Hasse: below the bar what the ÷ directions make of it
  const hkey = (st, m) => {
    let d = 1;
    for (const p of st.hax) if (p < 0) d *= (-p) ** N.expOf(m, -p);
    return d === 1 ? String(m) : `${m / d}/${d}`;
  };

  // the three directions: one pill each, as the Lattice's axes; picking another direction's prime swaps them, – takes
  // a direction out (at most two)
  const DIRS = [['down', 90], ['dright', 50], ['dleft', 130]];
  const axSel = (st, i) => `<label class="axis-pick ${st.hax[i] ? S.primeClass(Math.abs(st.hax[i])) : 'off'}"><svg class="arr" aria-hidden="true" viewBox="0 0 12 12" style="transform: rotate(${DIRS[i][1]}deg)"><path d="M1 6H10.5M6.5 2L10.5 6L6.5 10"/></svg><select data-hax="${i}" aria-label="Axis ${i + 1}">${[...PRIMES, ...PRIMES.map((p) => -p)].map((p) => `<option value="${p}"${p === st.hax[i] ? ' selected' : ''}>${p > 0 ? '×' : '÷'}${Math.abs(p)}</option>`).join('')}<option value="0"${st.hax[i] ? '' : ' selected'}>–</option></select></label>`;
  const tools = {
    DEF: { hax: DEF_HAX },
    // stored or from a link: what is unreadable is the default
    use(st, o) {
      const h = Array.isArray(o.hax) ? o.hax : [], on = h.filter(Boolean).map(Math.abs);
      st.hax = h.length === 3 && h.every((p) => p === 0 || PRIMES.includes(Math.abs(p))) && on.length && new Set(on).size === on.length ? [...h] : [...DEF_HAX];
    },
    out: (st) => ({ hax: st.hax }),
    html: (st) => `<div class="toolbar" data-tools><span class="ntools"><div class="axis-picks">${axSel(st, 0)}${axSel(st, 1)}${axSel(st, 2)}</div></span></div>`,
    wire(root, st, changed) {
      root.addEventListener('change', (e) => {
        const s = e.target.closest('[data-tools] [data-hax]');
        if (!s) return;
        const i = +s.dataset.hax, p = +s.value, j = p ? st.hax.findIndex((q) => Math.abs(q) === Math.abs(p)) : -1;
        if (!p && st.hax.filter(Boolean).length === 1) { s.value = st.hax[i]; return; }   // one direction at least
        if (j >= 0 && j !== i) st.hax[j] = st.hax[i];
        st.hax[i] = p;
        changed();
      });
    },
  };

  const PH = 24, GAP = 4;   // a number's pill: 24 high, as wide as its digits
  const kind = (st) => {
    const pillW = (m) => 12 + 8.5 * hkey(st, m).length;
    // the spacing with the smallest area whose numbers don't touch: it keeps one shape as More adds numbers
    // (the picture widens; the panel scrolls sideways), where fitting the width made it jump to twice the height
    function layout(ns) {
      const [, b, c] = haxAbs(st);
      const it = ns.map((n) => ({ n, eb: N.expOf(n, b), ec: N.expOf(n, c), ly: Math.log2(n), w: pillW(n) })).sort((p, q) => p.ly - q.ly);
      const L = Math.log2(Math.max(...ns));
      let best = null;
      const rng = (p) => p ? Array.from({ length: 60 }, (_, i) => 4 + 4 * i) : [0];   // an axis set to – has no spacing to search
      for (let hy = 32; hy <= 140; hy += 2) {   // below 32 the steps lie almost flat and stop reading as a climb
        for (const db of rng(b)) for (const dc of rng(c)) {
          let lo = Infinity, hi = -Infinity;
          for (const p of it) { p.x = p.eb * db - p.ec * dc; lo = Math.min(lo, p.x - p.w / 2); hi = Math.max(hi, p.x + p.w / 2); }
          const area = (hi - lo) * (hy * L + PH);
          if (best && area >= best.area) continue;
          let ok = true;
          for (let i = 0; ok && i < it.length; i++) {
            for (let j = i + 1; j < it.length && (it[j].ly - it[i].ly) * hy < PH + GAP; j++) {
              if (Math.abs(it[i].x - it[j].x) < (it[i].w + it[j].w) / 2 + GAP) { ok = false; break; }
            }
          }
          if (ok) best = { hy, db, dc, area };
        }
      }
      return best || { hy: 60, db: 40, dc: 40 };
    }
    const hasse = {
      want: 1000, min: 16,
      budget: 300, floor: 60,
      ps: () => haxAbs(st).filter(Boolean).sort((p, q) => p - q),
      top: (H) => H,
      size: () => 1,
      up: (H) => H * 4,
      down: (H) => Math.floor(H / 4),
      draw(fig, H) {
        const [a, b, c] = haxAbs(st), ns = N.smooth(hasse.ps(), H);
        const { hy, db, dc } = layout(ns);
        const pos = (n) => [N.expOf(n, b) * db - N.expOf(n, c) * dc, Math.log2(n) * hy];
        let x0 = Infinity, x1 = -Infinity, y1 = 0;
        for (const n of ns) { const [x, y] = pos(n), w = pillW(n) / 2; x0 = Math.min(x0, x - w); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y); }
        const set = new Set(ns);
        let edges = '', nodes = '';
        for (const n of ns) {
          const [x, y] = pos(n), w = pillW(n);
          for (const p of [a, b, c]) if (p && set.has(n * p)) { const [x2, y2] = pos(n * p); edges += `<line class="hedge ${S.primeClass(p)}" x1="${x}" y1="${y}" x2="${x2}" y2="${y2}"/>`; }
          const key = hkey(st, n);
          nodes += `<g class="hnode ${S.primeClass(n)}" data-n="${key}" data-r="${N.noteOf(key)}" transform="translate(${x},${y})"><title>${key} · ${N.noteOf(key)}</title><rect x="${-w / 2}" y="${-PH / 2}" width="${w}" height="${PH}" rx="${PH / 2}"/><text dy="${S.DY_SANS}">${key}</text></g>`;
        }
        const m = 4, vw = x1 - x0 + 2 * m, vh = y1 + PH + 2 * m;
        return `<svg class="hasse-svg" viewBox="${x0 - m} ${-PH / 2 - m} ${vw} ${vh}" width="${vw}" height="${vh}">${edges}${nodes}</svg>`;
      },
    };
    return hasse;
  };

  // arrows along the directions, on m: ↓ → ← multiply it by the prime drawn that way (down, down right, down left);
  // ↑ climbs back the way the arrows came down (trail), else divides by the first direction that divides
  function step(fig, from, code, st, trail) {
    const n = N.partsOf(from.dataset.n).reduce((x, y) => x * y);
    const [a, b, c] = haxAbs(st), at = (m) => fig.querySelector(`[data-n="${hkey(st, m)}"]`);
    if (code !== 'ArrowUp') {
      const p = { ArrowDown: a, ArrowRight: b, ArrowLeft: c }[code], to = p && at(n * p);
      if (to) trail.push(n);
      return to;
    }
    const back = trail.pop();
    if (back && n % back === 0 && haxAbs(st).includes(n / back) && at(back)) return at(back);
    trail.length = 0;
    const p = haxAbs(st).find((q) => q && n % q === 0);
    return p ? at(n / p) : null;
  }

  S.parts.hasse = N.part({ id: 'hasse', title: 'Hasse', tools, kind, step });
})();
