'use strict';
// Scatter (a sub-view of the Numbers tab; what it shares with Table and Hasse is in numbers.js): the odd families. A
// ratio n/d of m = n·d lies t · D(x) from the middle, t = ln(n/d) / ln(m) (1 for an overtone, −1 for an undertone,
// between for the rest), x = ln(Ω(m) · P(m)) (prime factors with repeats, times the largest), D with 0…2 squeezed next
// to the middle (only 3, 5, 9 and 7 lie there) and the 1 (Ω = 0) in the middle; y down = m^⅔. Its own primes
// (scales.scatter).
S.parts.scatter = S.numbers.part({
  id: 'scatter',
  title: 'Scatter',
  tools: S.numbers.primeTools,
  kind: (st) => {
    const N = S.numbers, odd = () => N.primeTools.odd(st);
    let SW = 0;
    const xOf = (n) => { const f = N.factors(n); return f.length ? Math.log(f.length * f[f.length - 1]) : -Infinity; };
    return {
      want: 128, min: 8,   // as the Table: m below 2^7, More doubles it
      budget: 4000, floor: 500,
      last: 2 ** 20,   // as far as the Table reaches (9 px per unit of m^⅔: some 90 000 px down)
      ps: odd,
      top: (M) => M,
      size: (n, w) => 2 ** w,
      up: (M) => M * 2,
      down: (M) => Math.floor(M / 2),
      resize(fig) { const w = fig.clientWidth; if (w && Math.abs(w - SW) > 8) { SW = w; return true; } return false; },
      draw(fig, SMAX) {
        SW = fig.clientWidth || 600;
        const W = SW, ns = N.smooth(odd(), SMAX);
        const xmax = Math.max(2.5, ...ns.slice(1).map(xOf)) + 0.1, ML = 44, MR = 14, MT = 16, R = 5, HIT = 12, ONE = 18;
        const mid = (ML + W - MR) / 2, pw = (W - MR - ML) / 2 - R - ONE, F = 0.12, xs = Math.log(3) - 0.1;
        const D = (x) => (x === -Infinity ? 0 : ONE + (x < 2 ? ((x - xs) / (2 - xs)) * F * pw : F * pw + ((x - 2) / (xmax - 2)) * (1 - F) * pw));
        // 9 px per unit of m^⅔ (128 lands 219 px down, 1000 888; odd numbers only, so they stand sparse). A dot closer than 11 px
        // to one placed before it moves aside, in turn right and left
        const yv = (n) => n ** (2 / 3), s = 9, Y = (n) => MT + (yv(n) - 1) * s;
        const dots = [];
        for (const m of ns) {
          const y = Y(m), lm = Math.log(m);
          for (const key of N.family(m)) {
            const [n, d] = N.partsOf(key), x0 = mid + (m > 1 ? Math.log(n / d) / lm : 0) * D(xOf(m));
            const near = [];   // m only grows, so the dots within reach are the last ones placed
            for (let i = dots.length - 1; i >= 0 && y - dots[i].y < 11; i--) near.push(dots[i]);
            const x = [0, 11, -11, 22, -22, 33, -33].map((o) => x0 + o).find((a) => near.every((o) => Math.hypot(a - o.x, y - o.y) >= 11)) ?? x0;
            dots.push({ key, m, x, y });
          }
        }
        const hi = SMAX, h = Y(hi) + MT;   // to the range's end (128, 256 …), so its label shows
        // y labels at the powers of 2, the Table's bands, from the end up while they stay 18 px apart
        const tick = [];
        for (let v = hi; v > 1 && (!tick.length || Y(tick[tick.length - 1]) - Y(v) >= 18); v /= 2) tick.push(v);
        let g = '';
        for (const v of tick) g += `<line class="sgrid" x1="${ML - 4}" x2="${W - MR / 2}" y1="${Y(v)}" y2="${Y(v)}"/><text class="stick l" x="2" y="${Y(v)}" dy="${S.DY_SANS}">${v}</text>`;
        // a wider ring under each dot takes presses near it (a 5 px dot was hard to hit with a finger); later dots' on top
        for (const o of dots) g += `<circle class="sdot-hit" data-hit="${o.key}" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${HIT}"/>`;
        for (const o of dots) g += `<circle class="sdot ${S.primeClass(o.m)}" data-n="${o.key}" data-r="${N.noteOf(o.key)}" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${R}"><title>${o.key} · ${N.noteOf(o.key)}</title></circle>`;
        return `<svg class="scatter-svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">${g}</svg>`;
      },
    };
  },
});
