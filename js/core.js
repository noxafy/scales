'use strict';
// Shared settings, math, exact ratios and notes, the ratio library, the scale and note names.
(() => {
  const S = (window.S = { views: {}, parts: {}, state: {} });

  /* ---------- settings ---------- */

  // anchorMidi sounds at anchorHz (A4 = 440 by default); every other note is 12-TET from it
  const DEFAULTS = { anchorMidi: 69, anchorHz: 440, base: 60 };
  // the 1/1's range: octaves 0–7 for every note name, C0 … B7 (MIDI 12 … 107), so its octave dropdown is the same
  // whichever name
  S.BASE_MIN = 12; S.BASE_MAX = 107;
  S.settings = { ...DEFAULTS };
  try {
    // each value only if it can be one (a damaged entry would sound at NaN Hz)
    const o = JSON.parse(localStorage.getItem('scales.settings') || '{}') || {};
    const int = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
    if (int(o.anchorMidi, 0, 127)) S.settings.anchorMidi = o.anchorMidi;
    if (Number.isFinite(o.anchorHz) && o.anchorHz > 0) S.settings.anchorHz = o.anchorHz;
    if (int(o.base, S.BASE_MIN, S.BASE_MAX)) S.settings.base = o.base;
  } catch (e) {}
  // writes what the link also holds: the link's own values never reach localStorage (S.linkQuiet while it is read).
  // A save of the text last read or written (a view being drawn anew) is no change; any real change goes to both
  const last = {};
  S.linkQuiet = false;
  S.keep = (key, text) => {
    if (S.linkQuiet) { last[key] = text; return; }
    if (last[key] === text) return;
    last[key] = text;
    try { localStorage.setItem(key, text); } catch (e) {}
    if (S.link) S.link.dirty();
  };
  S.saveSettings = () => S.keep('scales.settings', JSON.stringify(S.settings));

  /* ---------- math ---------- */

  S.cents = (r) => 1200 * Math.log2(r);
  S.mod = (a, m) => ((a % m) + m) % m;
  // cents -> [0, 1200); within S.EXACT below the octave is the 1/1 (float error: 7 × 1\7 up and 7 down came to
  // −1.7e-13¢, which folded to 1199.9999999999998 and read as 2/1)
  S.fold = (c) => { const f = S.mod(c, 1200); return f > 1200 - S.EXACT ? 0 : f; };
  S.signed = (c) => S.mod(c + 600, 1200) - 600;   // cents -> [-600, 600)
  S.clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  S.gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
  const bgcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const blog2 = (n) => {   // log2 of a BigInt without overflow
    const s = n.toString(2);
    const head = Number.parseInt(s.slice(0, 52), 2);
    return Math.log2(head) + Math.max(0, s.length - 52);
  };

  // exact ratio n/d (BigInt-safe), reduced and folded into [1, 2)
  S.foldRatio = (n, d) => {
    n = BigInt(n); d = BigInt(d);
    let g = bgcd(n, d); n /= g; d /= g;
    while (n >= 2n * d) d *= 2n;
    while (n < d) n *= 2n;
    g = bgcd(n, d);
    return [n / g, d / g];
  };
  S.ratioCents = (n, d) => 1200 * (blog2(BigInt(n)) - blog2(BigInt(d)));

  /* ---------- exact ratios as prime exponents ---------- */
  // A ratio is held as its prime exponents, {3: 12, 2: -19} for 3¹² / 2¹⁹ (the user, 2026-11-05: 665 fifths without
  // 4000-digit links): a product adds them, nothing is reduced, and nothing needs the numbers written out. Cents come
  // from them exactly, in log space (each prime's log2 held to 128 bits as an integer, so a sum of 10⁶ of them is
  // still exact far below S.EXACT); n/d is made only while it is short (S.Q_DIGITS)
  S.Q_DIGITS = 15;      // n/d while both sides have at most this many digits (a double holds them exactly), else powers
  S.EXP_MAX = 999999;   // the largest exponent read (a 9999-step Spiral reaches about 200 000)
  const LG_F = 128n, LG_ONE = 1n << LG_F, LG_SCALE = 2 ** 128;
  const lgMemo = new Map();
  const lg = (p) => {   // log2 p · 2^128, by squaring, bit by bit
    let v = lgMemo.get(p);
    if (v === undefined) {
      const b = BigInt(p), k = BigInt(b.toString(2).length - 1);
      let x = (b << LG_F) >> k;
      v = k << LG_F;
      for (let i = LG_F - 1n; i >= 0n; i--) { x = (x * x) >> LG_F; if (x >= LG_ONE << 1n) { x >>= 1n; v += 1n << i; } }
      lgMemo.set(p, v);
    }
    return v;
  };
  const lgSum = (e, odd) => { let s = 0n; for (const p in e) if (!(odd && p === '2')) s += BigInt(e[p]) * lg(+p); return s; };
  // cents of exponents as they are (a step: not folded)
  S.qCents = (e) => (1200 * Number(lgSum(e))) / LG_SCALE;
  // into [1, 2): { e, c }, the 2s set from the exact log (never a hair off an octave), c its cents
  S.qFold = (e) => {
    const odd = lgSum(e, true), oct = odd >> LG_F, f = { ...e }, two = -Number(oct);
    if (two) f[2] = two; else delete f[2];
    for (const p in f) if (!f[p]) delete f[p];
    return { e: f, c: (1200 * Number(odd - (oct << LG_F))) / LG_SCALE };
  };
  // a · b^k
  S.qMul = (a, b, k = 1) => {
    const e = { ...a };
    for (const p in b) { const x = (e[p] || 0) + k * b[p]; if (x) e[p] = x; else delete e[p]; }
    return e;
  };
  // n/d as BigInts while both have at most `max` digits, else null
  S.qND = (e, max = Infinity) => {
    let ln = 0, ld = 0;
    for (const p in e) { const l = e[p] * Math.log10(+p); if (l > 0) ln += l; else ld -= l; }
    if (ln > max + 1e-6 || ld > max + 1e-6) return null;
    let n = 1n, d = 1n;
    for (const p in e) { const x = e[p]; if (x > 0) n *= BigInt(p) ** BigInt(x); else if (x < 0) d *= BigInt(p) ** BigInt(-x); }
    return max === Infinity || (String(n).length <= max && String(d).length <= max) ? [n, d] : null;
  };
  const qPow = (e) => {
    const ps = Object.keys(e).map(Number).sort((a, b) => a - b);
    const side = (s) => ps.filter((p) => Math.sign(e[p]) === s).map((p) => (Math.abs(e[p]) > 1 ? `${p}**${Math.abs(e[p])}` : `${p}`)).join('*');
    const n = side(1), d = side(-1);
    return (n || '1') + (d ? '/' + d : '');
  };
  // the one spelling of a ratio (note key, step text, link): n/d while short (S.Q_DIGITS), else powers, 3**665/2**1054
  S.qText = (e) => { const nd = S.qND(e, S.Q_DIGITS); return nd ? `${nd[0]}/${nd[1]}` : qPow(e); };
  const isTwo = (e) => { const k = Object.keys(e); return k.length === 1 && k[0] === '2' && e[2] === 1; };
  // a ratio's note key: folded into [1, 2), exactly 2 kept as 2/1 (as S.noteKey keeps it)
  S.qNote = (e) => (isTwo(e) ? '2/1' : S.qText(S.qFold(e).e));
  const SMALL_P = [];
  for (let i = 2; i < 1000; i++) if (SMALL_P.every((p) => i % p)) SMALL_P.push(i);
  const SAFE = 2n ** 53n;
  // the prime exponents of a whole number (BigInt or Number), or null where they can't be found: below 2⁵³ always (the
  // primes below 1000 by division, the rest by Miller–Rabin and Pollard's rho: a prime near 10¹² took 10⁶ divisions,
  // some 12 ms, and a link of a thousand of them froze the tab for seconds), past 2⁵³ (up to 4096 bits) only when the
  // primes below 1000 bring it under 2⁵³. Remembered: a step's text is read again at every redraw (the Spiral's
  // picker asks of each chip whether it is the run's interval); a copy goes out, so no caller changes what is kept
  const factorMemo = new Map();
  const factorInt = (b) => {
    const k = String(b);
    if (!factorMemo.has(k)) {
      if (factorMemo.size > 4000) factorMemo.clear();
      factorMemo.set(k, factorNew(BigInt(b)));
    }
    const e = factorMemo.get(k);
    return e && { ...e };
  };
  const powMod = (a, k, m) => { let r = 1n; a %= m; while (k) { if (k & 1n) r = (r * a) % m; a = (a * a) % m; k >>= 1n; } return r; };
  // Miller–Rabin with the first twelve primes as bases: exact for every n below 3·10²⁴
  const isPrimeB = (n) => {
    if (n < 2n) return false;
    for (const p of SMALL_P.slice(0, 12)) { const q = BigInt(p); if (n % q === 0n) return n === q; }
    let d = n - 1n, r = 0;
    while (!(d & 1n)) { d >>= 1n; r++; }
    for (const p of SMALL_P.slice(0, 12)) {
      let x = powMod(BigInt(p), d, n);
      if (x === 1n || x === n - 1n) continue;
      let i = 1;
      for (; i < r && x !== n - 1n; i++) x = (x * x) % n;
      if (x !== n - 1n) return false;
    }
    return true;
  };
  // a factor of a composite n (Pollard's rho, Brent's cycle, gcds taken a hundred steps at a time)
  const rho = (n) => {
    for (let c = 1n; ; c++) {
      const f = (x) => (x * x + c) % n;
      let y = 2n, x = y, g = 1n, q = 1n, ys = y, r = 1;
      while (g === 1n) {
        x = y;
        for (let i = 0; i < r; i++) y = f(y);
        for (let k = 0; k < r && g === 1n; k += 100) {
          ys = y;
          for (let i = 0; i < Math.min(100, r - k); i++) { y = f(y); q = (q * (x > y ? x - y : y - x)) % n; }
          g = bgcd(q, n);
        }
        r *= 2;
      }
      if (g === n) do { ys = f(ys); g = bgcd(x > ys ? x - ys : ys - x, n); } while (g === 1n);
      if (g !== n) return g;
    }
  };
  const factorNew = (b) => {
    if (b < 1n) return null;
    if (b >= 1n << 4096n) return null;
    const e = {}, add = (p, k = 1) => { e[p] = (e[p] || 0) + k; };
    for (const p of SMALL_P) {
      const bp = BigInt(p);
      if (bp * bp > b) break;
      while (b % bp === 0n) { b /= bp; add(p); }
      if (b >= SAFE && p === SMALL_P[SMALL_P.length - 1]) return null;
    }
    if (b >= SAFE) return null;
    // what is left has no factor below 1000: a prime, or split by rho until every part is one
    const split = (n) => {
      if (n === 1n) return;
      if (isPrimeB(n)) { add(Number(n)); return; }
      const d = rho(n);
      split(d); split(n / d);
    };
    split(b);
    return e;
  };
  // prime exponents of n/d, any primes; null if they can't be found (factorInt)
  S.monzoOf = (n, d) => { const a = factorInt(n), b = a && factorInt(d); return b ? S.qMul(a, b, -1) : null; };
  const SUP_IN = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9, '⁻': '-' };
  // a ratio as typed or pasted: 3/2, 3:2, 3, powers (3^12/2^19, 3**12/2**19, 3¹² / 2¹⁹ as the labels write them), products
  // (3*5/4, 3x5/4, 3·5 / 2⁴); its exponents as written (not folded), or null
  S.qParse = (txt) => {
    let t = String(txt).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => '^' + [...m].map((ch) => SUP_IN[ch]).join(''));
    t = t.replace(/\*\*/g, '^').replace(/[·x]/g, '*').replace(/−/g, '-').replace(/\s+/g, '');
    const sides = t.split(/[/:]/);
    if (sides.length > 2 || sides.some((s) => !s)) return null;
    let e = {};
    for (let i = 0; i < sides.length; i++) {
      for (const f of sides[i].split('*')) {
        const m = /^(\d+)(?:\^(-?\d+))?$/.exec(f), k = m && (m[2] == null ? 1 : +m[2]);
        if (!m || Math.abs(k) > S.EXP_MAX) return null;
        const b = factorInt(BigInt(m[1]));
        if (!b) return null;
        e = S.qMul(e, b, i ? -k : k);
      }
    }
    return Object.values(e).every((x) => Math.abs(x) <= S.EXP_MAX) ? e : null;
  };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
  S.sup = (k) => String(k).split('').map((c) => SUP[c]).join('');
  S.sub = (k) => String(k).split('').map((c) => '₀₁₂₃₄₅₆₇₈₉'[c]).join('');
  // a line of text's width in px in a CSS font, with tabular digits as every number here (a hidden span measures it; remembered)
  S.textWidth = (() => {
    let span = null;
    const memo = new Map();
    return (t, font) => {
      const key = font + '\u0000' + t;
      if (!memo.has(key)) {
        if (!span) { span = document.createElement('span'); span.setAttribute('aria-hidden', 'true'); span.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre'; document.body.append(span); }
        span.style.font = font; span.style.fontVariantNumeric = 'tabular-nums'; span.textContent = t;   // after font, which resets it
        memo.set(key, span.getBoundingClientRect().width);
        if (memo.size > 2000) memo.delete(memo.keys().next().value);
      }
      return memo.get(key);
    };
  })();
  // HTML: a ratio label with its exponents set tight against their base (in mono every superscript
  // digit took a full cell, so 3⁴⁷ / 2⁷⁴ read like 347/274)
  S.labelHTML = (str) => S.esc(str).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, '<span class="exp">$&</span>');
  // where a label may break when its box is narrower than it (a readout headline, a list's ratio): after an n/d's slash
  // (2048/<wbr>2025) and after each · of a power label (3³⁰⁰·7¹⁰⁰·… on a phone); 3¹² / 2¹⁹ only before its slash, which
  // keeps to the number after it (a break on both sides of it left a lone / on a line of its own)
  S.breakHTML = (h) => h.replace(/(\d)\/(\d)/, '$1/<wbr>$2').replace(/·/g, '·<wbr>').replace(/ \/ /g, ' /&nbsp;');
  S.fmtMonzo = (e) => {
    const part = (sign) => Object.keys(e).map(Number).sort((a, b) => a - b)
      .filter((p) => Math.sign(e[p]) === sign)
      .map((p) => p + (Math.abs(e[p]) > 1 ? S.sup(Math.abs(e[p])) : '')).join('·');
    const num = part(1), den = part(-1);
    return (num || '1') + (den ? ' / ' + den : '');
  };
  // the one rule for writing a ratio: "n/d" while both have at most `digits` digits (4: a Lattice node holds no
  // more, stacked), else prime powers (3¹² / 2¹⁹), any primes. Places with more room allow more digits (the list's
  // steps 5, the Lattice's tooltips 6). Only a ratio whose primes can't be found (S.monzoOf: none the app makes) is
  // n/d up to S.LONG_DIGITS, past that its cents
  S.LONG_DIGITS = 6;
  // a tooltip holds what isn't on display (the user, 2026-11-05): a ratio labelled in powers its n/d, while that is short
  // where there is room (readouts, chips, tooltips) a ratio reads as n/d up to 6 digits a side (below 10⁶), in tight places
  // (Lattice nodes, Diamond cells, the Cycle's arcs, the list) up to 4 (r.label): one rule, two budgets (the user, 2026-11-12;
  // no prime limit: it would write 19/16 as 19 / 2⁴)
  S.WIDE_DIGITS = 6;
  S.wideLabel = (r) => (r.mix ? r.wide : r.temp ? r.label : r.wide ?? (r.wide = S.fmtRatio(r.nd, S.WIDE_DIGITS, r.e)));
  S.ndTip = (r, shown = r && r.label) => { if (!r || r.temp || !r.nd) return ''; const s = `${r.nd[0]}/${r.nd[1]}`; return s === shown ? '' : s; };
  // a step's tooltip (S.parseStep's form): its ratio or k\N unless that is what it shows, then its exact cents
  S.stepTip = (s, shown) => {
    const t = !s.r ? (s.edo ? s.t : '') : s.t.includes('*') ? S.fmtMonzo(s.r) : s.t;
    return [t === shown ? '' : t, S.exactC(s.c)].filter(Boolean).join(' · ');
  };
  S.noteTitle = (r, c = r.cents) => [r.label, S.ndTip(r) || r.tip, S.exactC(c)].filter(Boolean).join(' · ');   // a dot's tooltip (a dot has no text)
  S.isPlainRatio = ([n, d], digits = 4) => String(n).length <= digits && String(d).length <= digits;
  // nd: [n, d] (null when only e is known); e: its prime exponents when already known, so they aren't found again
  S.fmtRatio = (nd, digits = 4, e) => {
    if (e === undefined) e = nd && S.monzoOf(nd[0], nd[1]);
    if (!nd && e) nd = S.qND(e, digits);
    if (nd && S.isPlainRatio(nd, digits)) return `${nd[0]}/${nd[1]}`;
    return e ? S.fmtMonzo(e) : S.isPlainRatio(nd, S.LONG_DIGITS) ? `${nd[0]}/${nd[1]}` : `${S.fmtC(S.ratioCents(nd[0], nd[1]))}¢`;
  };

  S.largestPrime = (n) => {
    let p = 1;
    for (let f = 2; f * f <= n; f++) while (n % f === 0) { p = f; n /= f; }
    return n > 1 ? Math.max(p, n) : p;
  };
  // a prime's colour class (17 and up share p17); S.primeClass when n may not be prime
  const clsOfPrime = (p) => (p <= 2 ? 'p2' : p <= 13 ? 'p' + p : 'p17');
  S.primeClass = (n) => clsOfPrime(S.largestPrime(n));
  S.ratioClass = (n, d, e = S.monzoOf(n, d)) => {
    if (!e) return 'p17';
    const ps = Object.keys(e).map(Number).filter((p) => e[p]);
    return clsOfPrime(ps.length ? Math.max(...ps) : 2);
  };

  // a ratio as S.qParse reads it -> [n, d] as BigInts, reduced, folded to [1, 2] (2/1 kept); for small ones only
  S.parseRatio = (str, fold = true) => {
    const e = S.qParse(str);
    return e && S.qND(!fold || isTwo(e) ? e : S.qFold(e).e);
  };

  // closest simple fraction to a cents value (for labels)
  S.nearestSimple = (cents, maxDen = 16, tol = 12) => {
    let best = null;
    for (let q = 1; q <= maxDen; q++) {
      for (let p = q; p <= 2 * q; p++) {
        if (S.gcd(p, q) !== 1) continue;
        const err = Math.abs(S.cents(p / q) - cents);
        if (err > tol) continue;
        if (!best || p + q < best.p + best.q || (p + q === best.p + best.q && err < best.err)) best = { p, q, err };
      }
    }
    return best;
  };

  /* ---------- ratio library & the scale ---------- */

  S.RATIO_GROUPS = [
    { id: '3', label: '3', list: ['256/243', '9/8', '32/27', '81/64', '4/3', '729/512', '3/2', '128/81', '27/16', '16/9', '243/128'] },   // 1/1 and 2/1 are no 3-limit notes, and the everyday chips hold them
    { id: '5', label: '5', list: ['16/15', '10/9', '6/5', '5/4', '45/32', '64/45', '8/5', '5/3', '9/5', '15/8', '25/24', '125/64'] },
    { id: '7', label: '7', list: ['21/20', '8/7', '7/6', '9/7', '7/5', '10/7', '14/9', '12/7', '7/4', '15/14'] },
    { id: '11', label: '11·13', list: ['12/11', '11/10', '13/11', '11/9', '13/10', '11/8', '16/11', '13/8', '18/11', '11/6', '13/7', '16/13'] },
  ];
  // Tempered notes sit in the scale next to the ratios, as strings of their own: "edo12:7" is step 7 of
  // 12-EDO (shown 7\12, reduced: 14\24 is 7\12), "c696.58" a pitch in cents (shown 696.58¢). They have
  // no n/d (n and d are null, temp is true) and their class is pt. The keys hold no backslash, so they
  // are safe in unescaped attribute selectors.
  S.edoKey = (k, N) => {
    k = S.mod(k, N);
    if (!k) return '1/1';
    const e = S.edoSpell(k, N);
    return e ? `edo${e[1]}:${e[0]}` : 'c' + S.roundC((1200 * k) / N);
  };
  // the one rule for how a step of an EDO is written (the user, 2026-11-23), k unfolded and signed: [k, N], or null when
  // it is written as cents. Reduced, except that 2-, 3-, 4- and 6-EDO are twelfths (400 is 4\12, 600 6\12); whole cents
  // only in EDOs up to S.EDO_WHOLE (240 is 1\5, 50 1\24, but 20 stays 20, not 1\60: whole cents are exact and read as
  // they are; k\N is for an EDO people name or cents that never end, 1\7, 1\72); past S.EDO_MAX cents while they are
  // exact in S.CENTS_DIGITS decimals (1\200 is 6), else k\N of that EDO (1607\2800 stays exact)
  S.EDO_WHOLE = 24;
  S.edoSpell = (k, N) => {
    if (!k) return [0, 1];
    const g = S.gcd(k, N);
    k /= g; N /= g;
    if (12 % N === 0) return [(k * 12) / N, 12];
    const cents = N <= S.EDO_MAX ? 1200 % N === 0 && N > S.EDO_WHOLE : (1200 * 10 ** S.CENTS_DIGITS) % N === 0;
    return cents ? null : [k, N];
  };
  // a pitch kept as cents (a key, a typed size, a shut lock) holds this many decimals: two more than
  // the app's precision (S.EXACT, 1e-6¢), so 100 of them added up still land within it (each is off by at
  // most 5e-9¢) and the sum still reads as its ratio. Float error sits near 1e-11¢ and below
  S.CENTS_DIGITS = 8;
  S.roundC = (c) => +c.toFixed(S.CENTS_DIGITS);
  S.EXACT = 1e-6;   // two pitches closer than this are the same
  // how many decimals cents are written with, everywhere (the user, 2026-11-05): five characters below 1000¢, six
  // from there (1199.2, 696.6, 23.46, 1.949, 0.0359); decided after rounding (99.996 is 100.0); exactly 0 is 0.0
  const centsBand = (a) => (a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4);
  S.centsDigits = (c) => {
    const a = Math.abs(c);
    if (a < S.EXACT) return 1;
    const k = centsBand(a);
    return Math.min(k, centsBand(+a.toFixed(k)));
  };
  // a pitch in Hz, everywhere: 2 decimals below 1000 Hz (0.01 Hz is 0.07¢ at middle C), 1 from there
  S.fmtHz = (f) => (+f.toFixed(2) < 1000 ? f.toFixed(2) : f.toFixed(1));
  // cents, no sign when positive, never −0.0
  S.fmtC = (c, k = S.centsDigits(c)) => (Math.abs(c) < 0.5 * 10 ** -k ? (0).toFixed(k) : (c < 0 ? '−' : '') + Math.abs(c).toFixed(k));
  // one spelling per pitch (the user, 2026-11-04: the app must be consistent): cents that are a step of an EDO, k\N
  // with N up to S.EDO_MAX (the Cycle's most steps), within S.EXACT, are that step, typed or computed: 700 is 7\12,
  // 171.42857143 1\7, a 19-step cycle's dots 19ths, written as S.edoSpell has it (400 is 4\12; 20 null: cents).
  // [k, N] or null; c unfolded, ≥ 0
  S.EDO_MAX = 120;
  // k\N is written as k\N while N has 4 digits at most, the budget of a ratio in tight places (15\122, 1607\2800); past
  // it as cents, the k\N in the tooltip and the copied text (only sums make one: 4\7 + 3.1234 is k\N of 840000000000)
  S.EDO_SHOWN = 9999;
  const edoMemo = new Map();
  S.edoOf = (c) => {
    const key = c.toFixed(9);
    if (!edoMemo.has(key)) {
      let e = null;
      for (let N = 1; N <= S.EDO_MAX && !e; N++) { const k = Math.round((c * N) / 1200); if (Math.abs(c - (1200 * k) / N) < S.EXACT) e = [k, N]; }
      edoMemo.set(key, e && S.edoSpell(e[0], e[1]));
    }
    return edoMemo.get(key);
  };
  S.centsKey = (c) => {
    const f = S.roundC(S.fold(c)), e = f > 0 && f < 1200 && S.edoOf(f);
    return f <= 0 || f >= 1200 ? '1/1' : e ? S.edoKey(e[0], e[1]) : 'c' + f;
  };
  const parseTemp = (str) => {
    let m = /^edo(\d+):(\d+)$/.exec(str);
    if (m) {
      const N = +m[1], k = +m[2];
      if (!N || !k || k >= N) return null;
      const key = S.edoKey(k, N);   // one key per note (S.edoSpell): edo3:1 is edo12:4, edo60:1 c20
      if (key !== str) return parseTemp(key);
      // past S.EDO_SHOWN written as cents; the key, the copied text (S.tempText) and the tooltip (tip) stay k\\N
      const big = N > S.EDO_SHOWN, c = (1200 * k) / N;
      return { str, n: null, d: null, temp: true, edo: [k, N], cents: c, cls: 'pt', label: big ? `${S.fmtC(c)}¢` : `${k}\\${N}`, tip: big ? `${k}\\${N}` : '' };
    }
    m = /^c(\d+(?:\.\d+)?)$/.exec(str);
    const c = m && S.roundC(+m[1]);
    if (m && c > 0 && c < 1200 && S.edoOf(c)) return parseTemp(S.centsKey(c));   // one key per note: c700 is 7\12, as S.centsKey spells it
    if (m && c > 0 && c < 1200) return { str: 'c' + c, n: null, d: null, temp: true, cents: c, cls: 'pt', label: `${S.fmtC(c)}¢` };
    return null;
  };
  // A note is a ratio and a tempered part, as a complex number (the user, 2026-11-21): "3/2+c42" is 42¢ above 3/2,
  // "3/2-edo12:1" 1\12 below it. One key per note, folded as a whole and written as its pitch (the user, 2026-11-23): the
  // ratio in the octave, the tempered part signed so the two add up to the pitch, 3/2 − 42¢ is "3/2-c42" (S.mixKey makes
  // it); the key, the label and the link say the same. Either part alone is the note as before (3/2, c42, edo12:7). Made
  // exactly where notes add up (Lattice points, Spiral paths, partials of tempered tones) or typed ("3/2+42", "3/2 - 1\12");
  // never guessed from cents. r.mix, r.rpart (the ratio), r.tshown (the tempered part as written, r.down its minus) and
  // r.tpart (the same part folded into 0–1200¢, what arithmetic takes: S.noteParts); temp, as it has no n/d; its cents
  // the whole pitch, folded
  const mixInfo = (str) => {
    const m = /^(.+?)([+-])(c\d+(?:\.\d+)?|edo\d+:\d+)$/.exec(str);
    if (!m) return null;
    const rk = S.noteKey(m[1]), t = parseTemp(m[3]), a = rk && S.ratio(rk);
    if (!a || a.temp || !t) return null;
    const down = m[2] === '-', b = down ? S.ratio(tempNeg(t)) : t;
    const key = S.mixKey(rk, b.str);
    if (key !== str) return S.ratio(key);
    const sg = down ? '−' : '+';
    return { str, n: null, d: null, temp: true, mix: true, rpart: a, tpart: b, down, tshown: t, cents: S.fold(a.cents + b.cents), cls: 'pt',
      label: `${a.label} ${sg} ${t.label}`, wide: `${S.wideLabel(a)} ${sg} ${t.label}`, tip: t.tip ? `${a.label} ${sg} ${t.tip}` : '' };
  };
  // a tempered note's key the other way round, folded: 1200¢ minus it (edo12:1 is edo12:11, c42 is c1158)
  const tempNeg = (t) => (t.edo ? S.edoKey(-t.edo[0], t.edo[1]) : S.centsKey(1200 - t.cents));
  // a tempered note as text that reads back exactly (S.parseStep): k\\N, else its cents as kept (no ¢)
  S.tempText = (t) => (t.edo ? `${t.edo[0]}\\${t.edo[1]}` : String(S.roundC(t.cents)));
  // a ratio with a tempered part as a step's text, as it is written (signed: 3/2-42), so it reads back as that pitch
  S.mixText = (r) => `${r.rpart.str}${r.down ? '-' : '+'}${S.tempText(r.tshown)}`;
  // a note from its two parts: ratio a key or prime exponents (folded here), temp a tempered key or cents; null past
  // what a ratio key may hold
  S.mixKey = (ratio, temp) => {
    const rk = typeof ratio === 'string' ? S.noteKey(ratio) : S.ratioOfMonzo(ratio);
    const tk = typeof temp === 'number' ? S.centsKey(temp) : S.noteKey(temp);   // in its one spelling (1\200 is 6¢)
    if (!rk || !tk) return null;
    if (rk === '1/1' || rk === '2/1') return tk;
    // a tempered part within S.EXACT of a simple ratio is that ratio, as typed cents are (S.parseStep): 3/2 + 498.04499913
    // is 3/2 · 4/3, the 1/1; 3/2 + 386.31371386 is 15/8
    const tr = S.ratio(tk), q = tr && tr.cents < 1200 * 64 && S.simpleRatio(tr.cents);
    if (q) return S.ratioOfMonzo(S.qMul(S.qParse(rk), q));
    if (tk === '1/1') return rk;
    // folded as a whole: the part down where up would pass the octave (3/2 + 1158¢ is 3/2-c42)
    return S.ratio(rk).cents + tr.cents >= 1200 - S.EXACT ? `${rk}-${tempNeg(tr)}` : `${rk}+${tk}`;
  };
  // [ratio key, tempered key] of a note ('1/1' for a part it hasn't)
  S.noteParts = (str) => {
    const r = S.ratio(str);
    if (!r) return null;
    return r.mix ? [r.rpart.str, r.tpart.str] : r.temp ? ['1/1', r.str] : [S.noteKey(str), '1/1'];
  };
  // a note shown by its cents alone: a tempered note that is no k\N
  S.isCents = (r) => !!r && r.temp && !r.edo && !r.mix;
  // a tempered part as an exact fraction of the octave, [n, d] BigInts in [0, 1): k\N is k/N, cents are kept with
  // S.CENTS_DIGITS decimals, so 42¢ is 42/1200 exactly; the 1/1 is 0/1; null for anything else
  const CENT_D = 1200n * 10n ** BigInt(S.CENTS_DIGITS);
  const gcdB = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
  S.tempFrac = (key) => {
    if (key === '1/1') return [0n, 1n];
    const r = S.ratio(key);
    if (!r || !r.temp || r.mix) return null;
    const n = r.edo ? BigInt(r.edo[0]) : BigInt(Math.round(r.cents * 10 ** S.CENTS_DIGITS)), d = r.edo ? BigInt(r.edo[1]) : CENT_D, g = gcdB(n, d);
    return [n / g, d / g];
  };
  // and back, folded, spelled by S.edoSpell (as typed cents are: 100 is 1\12, 20 stays 20; 1\133 stays exact)
  S.tempKey = ([n, d]) => {
    const g = gcdB(n, d), m = (((n / g) % (d / g)) + d / g) % (d / g);
    return S.edoKey(Number(m), Number(d / g));   // spelled by S.edoSpell
  };
  // one note string (a ratio or a tempered note) -> everything we display about it
  // the cache keeps only the latest LONG_KEPT of keys past LONG_KEY characters: a 999-step Spiral's keys run to
  // thousands of digits each
  const infoCache = new Map(), longKeys = [], LONG_KEY = 200, LONG_KEPT = 64;
  const cacheInfo = (str, r) => {
    infoCache.set(str, r);
    if (str.length > LONG_KEY && longKeys.push(str) > LONG_KEPT) infoCache.delete(longKeys.shift());
  };
  // e: folded; nd its n/d while short (S.Q_DIGITS), else null, and n, d made only if asked for (nothing here asks)
  const ratioInfo = (str, e, c) => {
    const nd = S.qND(e, S.Q_DIGITS);
    const r = { str, e, nd, cents: c, cls: S.ratioClass(null, null, e), label: S.fmtRatio(nd, 4, e), long: false };
    if (nd) { r.n = nd[0]; r.d = nd[1]; } else {
      let big = null;
      const part = (i) => ({ get: () => (big || (big = S.qND(e)))[i], enumerable: true });
      Object.defineProperties(r, { n: part(0), d: part(1) });
    }
    return r;
  };
  S.ratio = (str) => {
    let r = infoCache.get(str);
    if (!r) {
      const e = S.qParse(str), f = e && (isTwo(e) ? { e, c: 1200 } : S.qFold(e));
      r = f ? ratioInfo(String(str), f.e, f.c) : parseTemp(String(str)) || mixInfo(String(str));
      if (!r) return null;
      cacheInfo(str, r);
    }
    return r;
  };
  // a ratio note from its prime exponents ({prime: exponent}, not yet folded): its key, with S.ratio's entry made
  // from them, so a long product (a Spiral path) is never parsed again
  S.ratioOfMonzo = (o) => {
    const f = S.qFold(o), str = S.qText(f.e);
    if (!infoCache.has(str)) cacheInfo(str, ratioInfo(str, f.e, f.c));
    return str;
  };
  // [n, d] -> its text: n/d while short, else powers (S.qText)
  S.ratioKey = ([n, d]) => (S.isPlainRatio([n, d], S.Q_DIGITS) ? `${n}/${d}` : S.qText(S.monzoOf(n, d) || {}));
  const RATIO_TXT = /[/:*^x·⁰¹²³⁴⁵⁶⁷⁸⁹]/;
  // an interval as typed (Cycle steps, Spiral): a ratio (S.qParse), cents (700, 696.58¢, −5), or k\N; null if it reads
  // as none. A ratio's r is its exponents, not folded; t its one spelling (S.qText)
  S.parseStep = (txt) => {
    const t = String(txt).trim().replace(/¢$/, '').trim().replace('−', '-');
    if (RATIO_TXT.test(t)) {
      const e = S.qParse(t);   // and its note too: 3**999999 folds by 2**-1584960, past S.EXP_MAX, and has none
      return e && Math.abs(S.qFold(e).e[2] || 0) <= S.EXP_MAX ? { t: S.qText(e), c: S.qCents(e), r: e } : null;
    }
    const m = t.match(/^(\d+)\s*\\\s*(\d+)$/);
    if (m) return +m[2] && +m[1] / +m[2] <= S.EXP_MAX ? edoStep(+m[1], +m[2]) : null;
    // cents and k\N no further than 2**999999 (S.EXP_MAX octaves), as far as a ratio goes: 10¹²¢ was a billion Spiral turns
    // cents within S.EXACT of a simple ratio are it (the user, 2026-11-23: 701.95500087 is 3/2 as kept in cents, so
    // 3/2 − 701.95500087 is ratio arithmetic, the 1/1); near is not the same: 702 stays cents
    if (/^-?(\d+\.?\d*|\.\d+)$/.test(t) && Math.abs(+t) <= 1200 * S.EXP_MAX) {
      const c = S.roundC(+t), e = c >= 0 && S.edoOf(c);
      if (e) return edoStep(e[0], e[1]);
      const q = Math.abs(c) < 1200 * 64 && S.simpleRatio && S.simpleRatio(c);   // (defined further down)
      return q ? S.ratioStep(q) : { t: String(c), c };
    }
    return null;
  };
  // prime exponents as a step (S.parseStep's form): the one way a computed ratio becomes a step
  S.ratioStep = (e) => S.parseStep(S.qText(e));
  // k\N as a step (k signed), one spelling per interval (the user, 2026-11-04: 700 and 7\12 are one, as notes are):
  // whole octaves a ratio (12\12 is 2/1, 0\12 the 1/1), else as S.edoSpell writes it (1\3 is 4\12, 1\60 is 20)
  const edoStep = (k, N) => {
    const q = k / N, c = (1200 * k) / N;
    if (Number.isInteger(q) && q >= 0 && q <= 32) return S.parseStep(`${2 ** q}/1`);
    const e = S.edoSpell(k, N), v = S.roundC(c);
    return e ? { t: `${e[0]}\\${e[1]}`, c, edo: e } : v > 0 ? S.parseStep(String(v)) : { t: String(v), c: v };
  };
  // an interval as typed, taken as a note: what every note field and a link's notes read (p/q folded into the
  // octave, 2/1 kept as S.parseRatio keeps it; k\N; cents); null if it reads as none
  S.parseNote = (txt) => {
    const s = S.parseStep(txt);
    if (!s) return mixIn(txt);
    return s.r ? S.qNote(s.r) : s.edo ? S.edoKey(s.edo[0], s.edo[1]) : S.centsKey(s.c);
  };
  // a ratio, then + or - and cents or k\N: "3/2+42", "3/2 - 42", "3/2 + 1\12" (¢ and spaces as they come; the sign not
  // an exponent's, 3^-2). The tempered part folded as any note's: 3/2-42 is 3/2 + 1158¢
  const mixIn = (txt) => {
    const s = S.parseMixStep(txt);
    if (!s) return null;
    if (s.frac) return s.r ? S.qNote(s.r) : S.tempKey(s.frac);   // two tempered parts: their sum, folded (4\7+3; 700+500 is 2/1, as typed 2/1)
    return s.m ? S.mixKey(s.r, s.m.edo ? S.edoKey(s.m.edo[0], s.m.edo[1]) : S.centsKey(s.m.c)) : S.qNote(s.r);   // 3/2+0 is 3/2
  };
  // an exact fraction n/d of the octave ([BigInt, BigInt], unfolded, signed) as a step: whole octaves a ratio, else as
  // S.edoSpell writes it (4\7+3 is 1607\2800: exact, as S.tempKey keeps notes); frac kept. Down (n < 0) has no spelling that reads back (the Spiral
  // turns it, S.parts.spiral's upright)
  S.tempStep = ([n, d]) => {
    const g = gcdB(n, d) || 1n;
    n /= g; d /= g;
    if (d === 1n) { const o = S.ratioStep(octs(Number(n))); return o && { ...o, frac: [n, d] }; }
    // the same pitch as whole octaves or a simple ratio (S.EXACT) is it, decided before anything is written: no sum that
    // small is ever written as cents
    const c = (1200 * Number(n)) / Number(d), snap = octSnap(c);
    if (snap) return snap;
    const s = edoStep(Number(n), Number(d));
    return s && { ...s, frac: [n, d] };
  };
  // a step within S.EXACT of whole octaves or of a simple ratio (S.simpleRatio) is that ratio (the app's one rule for "the
  // same pitch": 700 + 500.0000001 is 2/1); else null
  const octSnap = (c) => {
    const q = Math.round(c / 1200);
    if (Math.abs(c - 1200 * q) < S.EXACT) return Math.abs(c - 1200 * q) > 0 ? S.ratioStep(octs(q)) : null;
    const r = Math.abs(c) < 1200 * 64 && S.simpleRatio(c);   // a sum that is a simple ratio within S.EXACT, as typed cents are
    return r ? S.ratioStep(r) : null;
  };
  const octs = (q) => (q ? { 2: q } : {});   // whole octaves as exponents
  // a step's tempered value as an exact fraction of the octave (k\N, or cents as kept), signed by k
  const tempFracOf = (x, k) => (x.edo ? [BigInt(k * x.edo[0]), BigInt(x.edo[1])] : [BigInt(k) * BigInt(Math.round(x.c * 10 ** S.CENTS_DIGITS)), CENT_D]);
  // a sum as typed, split into its terms: [{k: ±1, x: text}], a sign before the first term its own (−3/2 + 5/4 is 5/6);
  // + and − after ^ or * belong to an exponent (3^-2, 3**-2). lead: the first term was signed
  S.sumTerms = (txt) => {
    let t = String(txt).replace(/¢/g, '').replace(/−/g, '-').trim(), k = 1;
    const lead = /^[+-]/.test(t), out = [];
    if (lead) { k = t[0] === '-' ? -1 : 1; t = t.slice(1); }
    let i0 = 0;
    for (let i = 1; i < t.length; i++) {
      const ch = t[i];
      if ((ch !== '+' && ch !== '-') || /[\^*]\s*$/.test(t.slice(0, i))) continue;
      out.push({ k, x: t.slice(i0, i) }); k = ch === '-' ? -1 : 1; i0 = i + 1;
    }
    out.push({ k, x: t.slice(i0) });
    return { terms: out, lead };
  };
  S.SUM_TERMS = 64;   // the most terms a sum takes
  // a sum of intervals as one step (the user, 2026-11-23: any number of terms, any kinds; what a Spiral path does, typed
  // as one interval): the ratios multiply (3/2 + 5/4 is 15/8), the tempered parts add exactly (4\7 + 3 is 1607\2800),
  // whole octaves join whichever there is. The result is one spelling: a ratio, a tempered step, or a ratio with a
  // tempered part (S.parseStep's form with m {c, edo?}, signed: 3/2-42 is 42¢ below 3/2), in any order typed (3 + 3/2 is
  // 3/2+3). Null for a single term with no sign (S.parseStep's), a term that reads as none, more than S.SUM_TERMS terms,
  // or a tempered sum past what is kept exactly (2^53 in its fraction of the octave, S.EXP_MAX octaves)
  S.parseMixStep = (txt) => {
    const { terms, lead } = S.sumTerms(txt);
    if ((terms.length < 2 && !lead) || terms.length > S.SUM_TERMS) return null;
    let R = {}, n = 0n, d = 1n;
    for (const { k, x } of terms) {
      const s = S.parseStep(x);
      if (!s) return null;
      if (s.r) { R = S.qMul(R, s.r, k); continue; }
      const [a, b] = tempFracOf(s, k);
      n = n * b + a * d; d *= b;
      const g = gcdB(n, d) || 1n;
      n /= g; d /= g;
      if (d >= SAFE || n >= SAFE || -n >= SAFE || n / d > BigInt(S.EXP_MAX) || -n / d > BigInt(S.EXP_MAX)) return null;
    }
    if (!n) return S.ratioStep(R);
    // tempered with whole octaves: one tempered step (4\7 + 2/1 is 11\7)
    if (Object.keys(R).every((p) => p === '2')) return S.tempStep([n + BigInt(R[2] || 0) * d, d]);
    const t = S.tempStep([n, d]);   // the tempered part in its one spelling, a ratio when it is one (3/2 − 701.95500087)
    if (!t) return null;
    if (t.r) return S.ratioStep(S.qMul(R, t.r));
    return mixStep(R, t.edo ? { c: t.c, edo: t.edo } : { c: t.c });
  };
  // a ratio (exponents) and a signed tempered part {c, edo?} as one step, in its one spelling (3/2-42, 8/5+1\6); the ratio
  // alone when the part is 0, a simple ratio when the two make one (octSnap)
  const mixStep = (r, m) => {
    const a = S.ratioStep(r);
    if (!a || !m.c) return a;
    const snap = octSnap(a.c + m.c);
    if (snap) return snap;
    const mt = m.edo ? `${Math.abs(m.edo[0])}\\${m.edo[1]}` : String(S.roundC(Math.abs(m.c)));
    return { t: `${a.t}${m.c < 0 ? '-' : '+'}${mt}`, c: a.c + m.c, r: a.r, m };
  };
  // a step's inverse, the same interval the other way (S.parseStep's or S.parseMixStep's form): 3/2 is 2/3, 3/2-42 is
  // 2/3+42, 1607\2800 down (S.tempStep: a spelling that doesn't read back), −700 is 7\12
  S.invStep = (s) => (s.frac ? S.tempStep([-s.frac[0], s.frac[1]])
    : s.m ? mixStep(S.qMul({}, s.r, -1), s.m.edo ? { c: -s.m.c, edo: [-s.m.edo[0], s.m.edo[1]] } : { c: -s.m.c })
    : s.r ? S.ratioStep(S.qMul({}, s.r, -1))
    : s.edo ? S.tempStep([BigInt(-s.edo[0]), BigInt(s.edo[1])])
    : S.parseStep(String(S.roundC(-s.c))));
  // the canonical string of a note, or null: "3:2" -> "3/2", 3^12/2^19 -> 531441/524288; tempered keys as they are
  S.noteKey = (x) => { const e = S.qParse(x); if (e) return S.qNote(e); const t = parseTemp(String(x)) || mixInfo(String(x)); return t && t.str; };
  // the step from note a up to note b (+ an octave if wrap): a ratio between two ratios, k\N between
  // steps of one EDO (or of two where one divides the other: 12 and 24), else null (only its cents)
  S.stepLabel = (a, b, wrap = false) => {
    if (wrap && a.str === b.str) return '2/1';
    if (!a.temp && !b.temp) return S.fmtRatio(null, 5, S.qFold(S.qMul(b.e, a.e, -1)).e);
    const frac = (r) => (r.edo ? r.edo : r.temp ? null : r.str === '1/1' ? [0, 1] : null);
    const fa = frac(a), fb = frac(b);
    if (!fa || !fb) return null;
    const N = (fa[1] * fb[1]) / S.gcd(fa[1], fb[1]);
    if (N > Math.max(fa[1], fb[1])) return null;
    const e = S.edoSpell((fb[0] * N) / fb[1] - (fa[0] * N) / fa[1] + (wrap ? N : 0), N);
    return e && `${e[0]}\\${e[1]}`;   // null: cents (S.edoSpell)
  };
  // an interval as a step field takes it (S.parseStep): from note a up to note b (+ an octave if wrap);
  // a ratio, k\N, else cents, in S.parseStep's one spelling
  S.stepText = (a, b, wrap = false) => {
    if (wrap && a.str === b.str) return '2/1';
    if (!a.temp && !b.temp) return S.qText(S.qFold(S.qMul(b.e, a.e, -1)).e);
    return S.parseStep(S.stepLabel(a, b, wrap) || String(S.roundC((wrap ? 1200 : 0) + b.cents - a.cents))).t;
  };
  // the step fields (Cycle, Spiral): field -> put(text). While one has the focus, a press on a scale list
  // row or step puts that interval into it (a row: its note above the 1/1) instead of picking it
  S.stepFields = new Map();

  // The scale: one list of ratios for the whole app. Every tab adds to it ("Add to scale"), its
  // circle shows it on the rim, and the list under the circle plays and removes its notes.
  const loadList = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : null; } catch (e) { return null; } };
  // 2/1 is the 1/1, folded: one note, as its Add button says
  const clean = (list) => [...new Set(list.map(S.noteKey).filter(Boolean).map((x) => (x === '2/1' ? '1/1' : x)))];
  // a first visit: the 1/1 alone
  S.scale = clean(loadList('scales.scale') || ['1/1']);
  // silent notes stay in the scale (list, rim) but Scale, Chord and the keys leave them out
  S.silent = new Set(clean(loadList('scales.silent') || []).filter((x) => S.scale.includes(x)));
  // Undo: the states before each change of notes or mutes, for this page's life; Redo: those undone, until a fresh change
  const snap = () => ({ scale: [...S.scale], silent: [...S.silent] });
  const undos = [], redos = [];
  let stepping = false;   // an undo or redo is being saved: it is no fresh change
  let kept = snap();
  let linkMark = 0;   // how many undos there were when the link began: going further back ends it
  const saveScale = () => {
    S.scale.sort((a, b) => S.ratio(a).cents - S.ratio(b).cents);
    S.silent.forEach((x) => { if (!S.scale.includes(x)) S.silent.delete(x); });
    const now = snap();
    if (JSON.stringify(now) !== JSON.stringify(kept)) {
      if (!stepping) { undos.push(kept); redos.length = 0; if (undos.length > 200) { undos.shift(); linkMark = Math.max(0, linkMark - 1); } }
      kept = now;
    }
    S.keep('scales.scale', JSON.stringify(S.scale));
    S.keep('scales.silent', JSON.stringify([...S.silent]));
    document.querySelectorAll('[data-add]').forEach((b) => { const on = S.inScale(b.dataset.add); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.title = addTip(on); });
    if (S.latticeNotes && S.latticeNotes.linked) { const r = scaleRatios(); if (r.join() !== S.latticeNotes.notes.join()) { S.latticeNotes.notes = r; latticeSave(); } }
    S.emit('scale');
  };
  S.inScale = (str) => S.scale.includes(str);
  S.isSilent = (str) => S.silent.has(str);
  S.audible = () => S.scale.filter((x) => !S.silent.has(x));
  // setSilent, addToScale and removeFromScale take any spelling of a note (c700, 7:4): the scale holds canonical keys only
  S.setSilent = (str, on) => { str = S.noteKey(str); if (!S.inScale(str) || on === S.isSilent(str)) return; on ? S.silent.add(str) : S.silent.delete(str); saveScale(); };
  S.setScale = (list, silent) => { S.scale = clean(list); if (silent) S.silent = new Set(clean(silent)); saveScale(); };
  S.addToScale = (str) => { str = S.noteKey(str); if (!str || str === '2/1' || S.inScale(str)) return; S.scale.push(str); saveScale(); };
  S.addAllToScale = (list) => S.setScale([...S.scale, ...list.map(S.noteKey).filter((x) => x && x !== '2/1')]);   // one undo
  S.removeFromScale = (str) => { str = S.noteKey(str); const i = S.scale.indexOf(str); if (i < 0) return; S.scale.splice(i, 1); saveScale(); };
  S.canUndoScale = () => undos.length > 0;
  S.canRedoScale = () => redos.length > 0;
  const stepTo = (o) => {
    S.scale = [...o.scale]; S.silent = new Set(o.silent);
    stepping = true;
    try { saveScale(); } finally { stepping = false; }
  };
  S.undoScale = () => {
    const o = undos.pop();
    if (!o) return;
    redos.push(snap());
    if (S.latticeNotes.linked && undos.length < linkMark) S.latticeNotes.setLinked(false);
    stepTo(o);
  };
  S.redoScale = () => {
    const o = redos.pop();
    if (!o) return;
    undos.push(snap());
    stepTo(o);
  };
  // the Lattice tab's own notes, what its preset menu chooses and Edit changes, as the Cycle's are the Cycle tab's:
  // apart from the scale unless linked, then they are the scale. Any notes, tempered ones too (a Lattice of k\N steps
  // chooses them). A first visit: the 1/1 alone
  const scaleRatios = () => [...S.scale];
  const latticeClean = (list) => clean(list).sort((a, b) => S.ratio(a).cents - S.ratio(b).cents);
  const latticeSave = () => {
    S.keep('scales.latNotes', JSON.stringify(S.latticeNotes.notes));
    if (S.latticeNotes.linked && scaleRatios().join() !== S.latticeNotes.notes.join()) S.setScale(S.latticeNotes.notes);
    S.emit('latticeset');
  };
  S.latticeNotes = {
    notes: latticeClean(loadList('scales.latNotes') || ['1/1']),
    has: (str) => S.latticeNotes.notes.includes(str),
    set: (list) => { S.latticeNotes.notes = latticeClean(list); latticeSave(); },
    add: (str) => { if (str !== '2/1' && !S.latticeNotes.has(str)) S.latticeNotes.set([...S.latticeNotes.notes, str]); },
    remove: (str) => { if (S.latticeNotes.has(str)) S.latticeNotes.set(S.latticeNotes.notes.filter((x) => x !== str)); },
    setLinked: (on) => {
      if (on === S.latticeNotes.linked) return;
      S.latticeNotes.linked = on;
      if (on) linkMark = undos.length;
      S.keep('scales.latLink', JSON.stringify(on ? [1] : []));
      S.emit('latticelink');
    },
    // the source replaces the other as far as that can hold it: the scale all of it, these notes its ratios
    linkTo: () => { S.useAsScale(S.latticeNotes.notes); S.latticeNotes.setLinked(true); },
    linkFrom: () => { S.latticeNotes.set(scaleRatios()); S.emit('preset'); S.latticeNotes.setLinked(true); },
    // these notes join the scale, and the Lattice keeps its own (Add to scale: the user's idea, 2026-11-19): linked only
    // if the two are then the same, else left apart (the user, 2026-11-21: the scale's notes don't come in); the view
    // stays where it is
    linkAdd: () => { S.addAllToScale(S.latticeNotes.notes); if (S.latticeNotes.linkWay() === 'same') S.latticeNotes.setLinked(true); },
    // which way needs asking only when both hold something different
    linkWay: () => {
      if (scaleRatios().join() === S.latticeNotes.notes.join()) return 'same';
      if (!S.latticeNotes.notes.length) return 'from';
      return !S.scale.length || S.scale.join() === '1/1' ? 'to' : 'ask';
    },
  };
  // linked from the start
  const storedLink = loadList('scales.latLink');
  S.latticeNotes.linked = storedLink ? storedLink[0] === 1 : true;
  // "Add to scale" next to a ratio, an icon alone: a round icon button, a plus while the note is out; ticked, on as every
  // toggle, while it is in, and pressed again it takes it out. Drawn, not glyphs; its title says what a press does (addTip),
  // its name stays "In scale" with aria-pressed saying which.
  // 2/1 adds the 1/1: folded into the octave they are one note
  // A note the app can't read back (S.noteKey: an exponent over S.EXP_MAX, a long Spiral path) can't go in: disabled, as
  // Undo with nothing to undo
  S.addBtn = (str) => (str === '2/1' ? S.addBtn('1/1') :
    `<button class="icon-btn add-btn${S.inScale(str) ? ' on' : ''}" data-add="${str}" aria-pressed="${S.inScale(str)}" title="${addTip(S.inScale(str))}" aria-label="In scale"${S.noteKey(str) ? '' : ' disabled'}>` +
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="plus" d="M8 3.5v9M3.5 8h9"/><path class="tick" d="M3.6 8.4l2.8 2.8 6-6.4"/></svg></button>');
  function addTip(on) { return on ? 'Remove from scale' : 'Add to scale'; }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (b) { e.stopPropagation(); S.inScale(b.dataset.add) ? S.removeFromScale(b.dataset.add) : S.addToScale(b.dataset.add); return; }
    const m = e.target.closest('[data-mute]');
    if (m) { e.stopPropagation(); S.setSilent(m.dataset.mute, !S.isSilent(m.dataset.mute)); S.emit('pick', m.dataset.mute); }   // muting also picks the note
  });
  // these buttons sit inside pressable things (a list row, a partial): pressing them plays nothing
  document.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-add], [data-mute], [data-more], .srow-edit')) e.stopPropagation(); }, true);

  /* ---------- note names ---------- */

  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  S.NAMES = NAMES;   // the pitch clock's letters
  S.midiFreq = (m) => S.settings.anchorHz * 2 ** ((m - S.settings.anchorMidi) / 12);
  S.freqMidi = (f) => S.settings.anchorMidi + 12 * Math.log2(f / S.settings.anchorHz);
  S.baseFreq = () => S.midiFreq(S.settings.base);
  // a ratio's pitch above the 1/1, oct octaves up
  // a pitch c cents above the 1/1; every note's frequency comes from here
  S.centsFreq = (c) => S.baseFreq() * 2 ** (c / 1200);
  S.ratioFreq = (str, oct = 0) => S.centsFreq(S.ratio(str).cents + 1200 * oct);
  // a run that climbs (Chain, Path), cents above the 1/1 to frequencies at their real height: its lowest note is the
  // 1/1 or above (a run that goes down moves up by whole octaves), and it goes on past hearing, never back into it (the user's call)
  S.climb = (cs) => {
    const k = Math.max(0, Math.ceil(-Math.min(...cs) / 1200 - S.EXACT / 1200));
    return cs.map((c) => S.centsFreq(c + 1200 * k));
  };
  S.baseIdx = () => S.mod(S.settings.base, 12);
  S.noteOf = (f) => {
    const m = S.freqMidi(f);
    const r = Math.round(m);
    return { name: NAMES[S.mod(r, 12)], oct: Math.floor(r / 12) - 1, dev: (m - r) * 100 };
  };
  S.midiName = (m) => NAMES[S.mod(m, 12)] + (Math.floor(m / 12) - 1);
  // nearest 12-TET note to a pitch given in cents above 1/1
  S.nearestET = (cents) => {
    const s = Math.round(cents / 100);
    return { name: NAMES[S.mod(S.baseIdx() + s, 12)], dev: cents - s * 100 };
  };
  // spelling on the line of fifths (k fifths above C)
  S.fifthName = (k) => {
    const letter = 'FCGDAEB'[S.mod(k + 1, 7)];
    const acc = Math.floor((k + 1) / 7);
    const n = Math.abs(acc), sign = acc > 0 ? '♯' : '♭';
    return letter + (n > 3 ? S.sub(n) + sign : sign.repeat(n));   // from four on, how many: C₂₄♭ (lowered: a plain C24 reads as an octave, a raised C⁶ as a sixth chord)
  };
  S.baseFifths = () => { let k = S.mod(7 * S.baseIdx(), 12); if (k > 7) k -= 12; return k; };
  // a ratio's note name and its deviation from that 12-TET note: spelled on the line of fifths when
  // it is made of 3, 5 and 7 (as on the lattice: 5/4 is four fifths up, 7/4 two down), else nearest
  S.spell = (str) => {
    const r = S.ratio(str);
    if (r.temp) return S.nearestET(r.cents);   // tempered: the nearest note
    const e = r.e;
    if (Object.keys(e).some((p) => e[p] && p > 7)) return S.nearestET(r.cents);
    const k = (e[3] || 0) + 4 * (e[5] || 0) - 2 * (e[7] || 0);
    return { name: S.fifthName(S.baseFifths() + k), dev: S.signed(r.cents - S.mod(k * 700, 1200)) };
  };

  // a readout's cents and deviations show one decimal; the tooltip the cents and the deviation to
  // S.CENTS_DIGITS, as a cents note holds them (past that a double shows only float error: 3/2 is
  // 701.955000865386, Carlos β's step 63.832932570000004; 700.1423 − 700 is 0.14229999999997744)
  S.exactC = (c) => `${S.roundC(c)}¢`;
  // a frequency to 7 decimals (1e-7 Hz is under S.EXACT's 1e-6¢ at middle C), trailing zeros dropped: the readouts' Hz tooltip
  S.exactHz = (f) => `${+f.toFixed(7)} Hz`;
  S.exactDev = (c) => {
    const v = S.roundC(c);
    return (v < 0 ? '−' : v > 0 ? '+' : '±') + Math.abs(v) + '¢';
  };
  // c cents above the 1/1 against the nearest 12-TET step (the 1/1 is one), from the cents themselves:
  // S.noteOf's, from a frequency, carries float error
  S.etDev = (c) => c - 100 * Math.round(c / 100);
  // an interval (S.parseStep's form, or S.parseMixStep's) as written where there is room (a chip, the readout): n/d up to 6
  // digits a side, k\N, else cents; a ratio with a tempered part as both, 8/5 + 1\6
  S.ivText = (s) => {
    const r = (e) => S.fmtRatio(null, S.WIDE_DIGITS, e);
    // k\\N past S.EDO_SHOWN as cents, as notes are written (S.stepTip holds the k\\N)
    const kn = (e, c) => (e[1] > S.EDO_SHOWN ? `${S.fmtC(c)}¢` : `${Math.abs(e[0])}\\${e[1]}`);
    if (s.m) return `${r(s.r)} ${s.m.c < 0 ? '−' : '+'} ${s.m.edo ? kn(s.m.edo, Math.abs(s.m.c)) : `${S.fmtC(Math.abs(s.m.c))}¢`}`;
    return s.r ? r(s.r) : s.edo ? (s.edo[1] > S.EDO_SHOWN ? kn(s.edo, s.c) : s.t) : `${S.fmtC(s.c)}¢`;
  };
  // the readout: the selection (S.sel), one for every tab; each side panel has its box (S.sideTop), drawn whenever the
  // selection, the scale or the settings change, so no view draws it. A note: its ratio and "Add to scale", then cents ·
  // Hz · nearest 12-TET note and deviation; nothing selected: an empty placeholder of the same height. An interval
  // (S.sel.iv; the user, 2026-11-22): what sounds is two tones, so the headline is its size, unfolded, and the line below
  // its cents, its octaves and the note + adds (0 oct + 3/2); no Hz or note name, since neither tone that sounds
  // has them. The headline plays the selection (S.playSel)
  const readHTML = () => {
    const { note, iv } = S.sel, r = note && S.ratio(note);
    if (!r) return '<div class="big"><span class="mono hl none">–</span></div><div class="sub mono">&nbsp;</div>';
    if (iv) {
      // the line below: its cents, then its octaves and the note + adds (the user, 2026-11-22: 2421.5¢ · 2 oct + 81/80;
      // 2026-11-23: always, 0 oct + 3/2, and whole octaves + 1/1: 2/1 is 1 oct + 1/1, 1/1 is 0 oct + 1/1); one line, cut
      // with "…" (the folded note differs from the headline only in its power of 2, and the headline opens)
      const txt = S.ivText(iv.s), fc = S.fold(iv.s.c), oct = Math.round((iv.s.c - fc) / 1200), one = fc < S.EXACT;
      const nt = one ? '1/1' : S.isCents(r) ? `${S.fmtC(r.cents)}¢` : S.labelHTML(S.wideLabel(r));
      const parts = `${oct} oct + <span title="${S.exactC(one ? 0 : r.cents)}">${nt}</span>`;
      return `<div class="big"><span class="mono hl" data-ro title="${S.stepTip(iv.s, txt)}">${S.breakHTML(S.labelHTML(txt))}</span>${S.addBtn(r.str)}</div>
      <div class="sub mono iv"><b title="${S.exactC(iv.s.c)}">${S.fmtC(iv.s.c)}¢</b> · ${parts}</div>`;
    }
    const f = S.ratioFreq(r.str, S.noteOct(r.str)), n = S.noteOf(f);   // the octave a key played it in
    // a pitch in cents is its own headline; the cents open the line below all the same, where a tap on a touch
    // screen shows every digit (.tip-pop; the headline plays)
    const c = `<b title="${S.exactC(r.cents)}">${S.fmtC(r.cents)}¢</b>`, inC = S.isCents(r), nd = S.ndTip(r, S.wideLabel(r));
    return `<div class="big"><span class="mono hl" data-ro${inC ? ` title="${S.exactC(r.cents)}"` : nd ? ` title="${nd}"` : r.tip ? ` title="${r.tip}"` : ''}>${inC ? `${S.fmtC(r.cents)}¢` : S.breakHTML(S.labelHTML(S.wideLabel(r)))}</span>${S.addBtn(r.str)}</div>
      <div class="sub mono">${c} · <span title="${S.exactHz(f)}">${S.fmtHz(f)} Hz</span> · ${n.name}${n.oct} <span title="${S.exactDev(S.etDev(r.cents))}">${S.fmtDev(n.dev)}</span></div>`;
  };
  S.readBox = () => `<div class="readout">${readHTML()}</div>`;
  S.showRead = () => { const h = readHTML(); document.querySelectorAll('.readout').forEach((el) => { el.innerHTML = h; }); };
  // Ratios are stored wherever they are known. A computed size (the Cycle's free steps and notes, the
  // Spiral's notes past a tempered step) is read back as one only in good faith: the simplest ratio
  // within the app's precision (S.EXACT: a sum of values kept to S.CENTS_DIGITS still finds its ratio; about 1 in
  // 40 000 other values reads as one by chance) with a denominator up to
  // S.SIMPLE_D, what "simple" means here (every everyday or dip chip is far inside it, 16/15 the most).
  // its prime exponents, not folded (a step may span more than an octave), or null. Raise the cap if a
  // simple ratio is ever missed
  S.SIMPLE_D = 256;
  // also read back, at any octave, though their denominators are larger: the commas (the Cycle's comma
  // presets) and every ratio in the scale (so a dot that is a scale note carries its name)
  S.COMMAS = ['531441/524288', '81/80', '32805/32768', '2048/2025', '128/125', '648/625', '64/63', '15625/15552',
    // 7-limit
    '36/35', '49/48', '50/49', '875/864', '245/243', '126/125', '1029/1024', '225/224', '3136/3125', '5120/5103',
    '6144/6125', '2401/2400', '4375/4374',
    // 11-limit
    '33/32', '45/44', '55/54', '99/98', '100/99', '121/120', '176/175', '896/891', '243/242', '385/384',
    '441/440', '540/539', '3025/3024', '9801/9800'];
  // the commas' and the scale's ratios, read again only when the scale changes (kept: its latest snapshot)
  let knownOf = null, knownList = [];
  const known = (c) => {
    if (knownOf !== kept) { knownOf = kept; knownList = [...S.COMMAS, ...S.scale].map(S.ratio).filter((r) => r && !r.temp); }
    for (const r of knownList) {
      const k = Math.round((c - r.cents) / 1200);
      if (Math.abs(c - r.cents - 1200 * k) >= S.EXACT) continue;
      return S.qMul(r.e, { 2: k });
    }
    return null;
  };
  const simpleMemo = new Map();
  S.simpleRatio = (c) => {
    const kn = known(c);
    if (kn) return kn;
    const key = c.toFixed(9);
    if (!simpleMemo.has(key)) {
      let r = null;
      const x = 2 ** (c / 1200), tol = x * S.EXACT * (Math.LN2 / 1200) * 2;   // a loose first test, the exact one after
      for (let d = 1; d <= S.SIMPLE_D && !r; d++) {
        const n = Math.round(d * x);
        if (n >= 1 && Math.abs(n / d - x) < tol && Math.abs(1200 * Math.log2(n / d) - c) < S.EXACT && S.gcd(n, d) === 1) r = S.monzoOf(n, d);
      }
      simpleMemo.set(key, r);
    }
    return simpleMemo.get(key);
  };
  // the note a computed pitch is, folded into the octave: a simple ratio, else k\N when it lands on one (S.edoOf),
  // else cents (Cycle, Spiral)
  S.noteOfCents = (c) => {
    const f = S.fold(c), r = S.simpleRatio(f);
    return r ? S.qNote(r) : S.centsKey(f);   // else k\N (S.edoOf), else cents
  };
  // pitches (cents, unfolded) in pitch order, each once (S.EXACT), then the octave: [[folded cents, first index]…] (Scale in Cycle, Spiral)
  S.pitchOrder = (cs) => {
    const all = cs.map((c, i) => [S.fold(c), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), ord = [];
    for (const x of all) if (!ord.length || x[0] - ord[ord.length - 1][0] >= S.EXACT) ord.push(x);
    ord.push([1200, ord[0][1]]);
    return ord;
  };
  // a deviation, signed, decimals as S.fmtC: ±0.0¢ only when exact, +0.0000¢ when it only rounds to zero
  S.fmtDev = (c) => {
    if (Math.abs(c) < S.EXACT) return '±0.0¢';
    const k = S.centsDigits(c);
    return (c > 0 ? '+' : '−') + Math.abs(c).toFixed(k) + '¢';
  };
})();
