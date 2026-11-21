'use strict';
// Table (a sub-view of the Numbers tab; what it shares with Hasse and Scatter is in numbers.js): one band per octave of
// m = n·d, 12 columns by pitch, each m with its family. Its own primes (scales.table).
S.parts.table = S.numbers.part({
  id: 'table',
  title: 'Table',
  tools: S.numbers.primeTools,
  kind: (st) => {
    const N = S.numbers, P = N.primeTools;
    const table = {
      want: 7, min: 3,   // octaves asked for: m up to 2^K − 1
      budget: 4000, floor: 500,
      ps: () => [2, ...P.odd(st)],
      top: (K) => 2 ** K - 1,
      size: (n, w) => (n % 2 ? 2 ** w : 1),
      up: (K) => K + 1,
      down: (K) => K - 1,
      last: 20,   // the user's call
      // a typed prime gets the octaves it needs to show
      reach(p) { table.want = Math.max(table.want, Math.ceil(Math.log2(p + 1))); },
      draw(fig, K) {
        const list = N.smooth(table.ps(), table.top(K));
        let at = 0;
        const names = Array.from({ length: 12 }, (_, i) => S.midiName(S.settings.base + i).replace(/-?\d+$/, ''));
        let rows = '', longest = '1';
        for (let k = 0; k < K; k++) {
          const cols = Array.from({ length: 12 }, () => []);
          for (; at < list.length && list[at] < 2 ** (k + 1); at++) {
            const m = list[at];
            // an even m: only its plain octave; its ratios are the odd part's, in the same note
            for (const key of m % 2 ? N.family(m) : [String(m)]) {
              cols[S.mod(Math.round(S.ratio(N.noteOf(key)).cents / 100), 12)].push(key);
              if (m % 2 && key.length > longest.length) longest = key;
            }
          }
          rows += `<div class="nrow nband">${cols.map((c) => `<span class="ncell">${c.map(N.cell).join('')}</span>`).join('')}</div>`;
        }
        // wide enough for the longest ratio in every column (measured in the numbers' font, tabular digits; 6 px room); past that the panel scrolls sideways
        const cs = getComputedStyle(fig), colW = S.textWidth(longest, `600 ${cs.getPropertyValue('--fs-m').trim() || '14px'} ${cs.getPropertyValue('--sans')}`) + 6;
        return `<div class="ntable" style="min-width:${Math.max(300, 12 * colW + 22)}px"><div class="nrow nhead">${names.map((x) => `<span>${x}</span>`).join('')}</div>${rows}</div>`;
      },
    };
    return table;
  },
});
