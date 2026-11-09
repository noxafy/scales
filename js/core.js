'use strict';
// Shared math, audio engine, pitch-clock renderer, ratio library, the scale and interaction helpers.
(() => {
  const S = (window.S = { views: {}, parts: {}, state: {} });

  /* ---------- settings ---------- */

  // anchorMidi sounds at anchorHz (A4 = 440 by default); every other note is 12-TET from it
  const DEFAULTS = { anchorMidi: 69, anchorHz: 440, base: 60 };
  S.settings = { ...DEFAULTS };
  try {
    Object.assign(S.settings, JSON.parse(localStorage.getItem('scales.settings') || '{}'));
    if (S.settings.a4) { S.settings.anchorMidi = 69; S.settings.anchorHz = S.settings.a4; delete S.settings.a4; }
    delete S.settings.volume;   // the volume slider is gone: sound is always at its old full level
  } catch (e) {}
  // the 1/1's range: octaves 0–7 for every note name, C0 … B7 (MIDI 12 … 107), so its octave dropdown is the same
  // whichever name
  S.BASE_MIN = 12; S.BASE_MAX = 107;
  // writes what the link also holds: the link's own values never reach localStorage (S.linkQuiet while it is read;
  // a later save of the same text, a view being drawn, is no change). Any real change goes to both
  const heard = {};
  S.linkQuiet = false;
  S.keep = (key, text) => {
    if (S.linkQuiet) { heard[key] = text; return; }
    if (heard[key] === text) return;
    delete heard[key];
    try { localStorage.setItem(key, text); } catch (e) {}
    if (S.link) S.link.dirty();
  };
  S.saveSettings = () => S.keep('scales.settings', JSON.stringify(S.settings));

  /* ---------- math ---------- */

  S.cents = (r) => 1200 * Math.log2(r);
  S.mod = (a, m) => ((a % m) + m) % m;
  // cents -> [0, 1200); within S.EXACT below the octave is the 1/1 (float error: 7 × 1\7 up and 7 down came to
  // −1.7e-13¢, which folded to 1199.9999999999998 and read as 2/1)
  S.fold = (c) => { const f = S.mod(c, 1200); return f > 1200 - 1e-6 ? 0 : f; };
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
  // product of prime powers {3: b, 5: c, ...} as exact folded ratio
  S.monzoRatio = (exps) => {
    let n = 1n, d = 1n;
    for (const [p, e] of Object.entries(exps)) {
      if (e > 0) n *= BigInt(p) ** BigInt(e);
      if (e < 0) d *= BigInt(p) ** BigInt(-e);
    }
    return S.foldRatio(n, d);
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
  // the prime exponents of a whole number (BigInt or Number), or null where they can't be found quickly: every
  // factor past 10⁶ but one below 10¹², and past 2⁵³ (up to 4096 bits) the primes below 1000 must bring it under 2⁵³
  // remembered: a prime near 10¹² takes 10⁶ divisions, and a step's text is read again at every redraw (the Spiral's
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
  const factorNew = (b) => {
    if (b < 1n) return null;
    const e = {};
    if (b >= SAFE) {
      if (b >= 1n << 4096n) return null;
      for (const p of SMALL_P) {
        const bp = BigInt(p);
        while (b % bp === 0n) { b /= bp; e[p] = (e[p] || 0) + 1; }
        if (b < SAFE) break;
      }
      if (b >= SAFE) return null;
    }
    let n = Number(b), f = 5;
    for (const p of [2, 3]) while (n % p === 0) { n /= p; e[p] = (e[p] || 0) + 1; }
    for (; f * f <= n && f <= 1e6; f += 6) for (const q of [f, f + 2]) while (n % q === 0) { n /= q; e[q] = (e[q] || 0) + 1; }
    if (n > 1) { if (f * f <= n && n >= 1e12) return null; e[n] = (e[n] || 0) + 1; }
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
  S.ndTip = (r) => { if (!r || r.temp || !r.nd) return ''; const s = `${r.nd[0]}/${r.nd[1]}`; return s === r.label ? '' : s; };
  // a step's tooltip (S.parseStep's form): its ratio or k\N unless that is what it shows, then its exact cents
  S.stepTip = (s, shown) => {
    const t = !s.r ? (s.edo ? s.t : '') : s.t.includes('*') ? S.fmtMonzo(s.r) : s.t;
    return [t === shown ? '' : t, S.exactC(s.c)].filter(Boolean).join(' · ');
  };
  S.noteTitle = (r, c = r.cents) => [r.label, S.ndTip(r), S.exactC(c)].filter(Boolean).join(' · ');   // a dot's tooltip (a dot has no text)
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
    const g = S.gcd(k, N);
    return `edo${N / g}:${k / g}`;
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
  // 400 1\3 (the smallest N, so reduced), 171.42857143 1\7, a 19-step cycle's dots 19ths. [k, N] or null; c unfolded, ≥ 0
  S.EDO_MAX = 120;
  const edoMemo = new Map();
  S.edoOf = (c) => {
    const key = c.toFixed(9);
    if (!edoMemo.has(key)) {
      let e = null;
      for (let N = 1; N <= S.EDO_MAX && !e; N++) { const k = Math.round((c * N) / 1200); if (Math.abs(c - (1200 * k) / N) < S.EXACT) e = [k, N]; }
      edoMemo.set(key, e);
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
      const g = S.gcd(k, N);
      if (g > 1) return parseTemp(S.edoKey(k, N));
      return { str, n: null, d: null, temp: true, edo: [k, N], cents: (1200 * k) / N, cls: 'pt', label: `${k}\\${N}` };
    }
    m = /^c(\d+(?:\.\d+)?)$/.exec(str);
    const c = m && S.roundC(+m[1]);
    if (m && c > 0 && c < 1200 && S.edoOf(c)) return parseTemp(S.centsKey(c));   // one key per note: c700 is 7\12, as S.centsKey spells it
    if (m && c > 0 && c < 1200) return { str: 'c' + c, n: null, d: null, temp: true, cents: c, cls: 'pt', label: `${S.fmtC(c)}¢` };
    return null;
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
      r = f ? ratioInfo(String(str), f.e, f.c) : parseTemp(String(str));
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
      const e = S.qParse(t);
      return e ? { t: S.qText(e), c: S.qCents(e), r: e } : null;
    }
    const m = t.match(/^(\d+)\s*\\\s*(\d+)$/);
    if (m) return +m[2] ? edoStep(+m[1], +m[2]) : null;
    if (/^-?(\d+\.?\d*|\.\d+)$/.test(t)) { const c = S.roundC(+t), e = c >= 0 && S.edoOf(c); return e ? edoStep(e[0], e[1]) : { t: String(c), c }; }
    return null;
  };
  // k\N as a step, one spelling per interval (the user, 2026-11-04: 700 and 7\12 are one, as notes are): reduced (4\12 is
  // 1\3), whole octaves a ratio (12\12 is 2/1, 0\12 the 1/1), cents that are k\N (S.edoOf) that k\N
  const edoStep = (k, N) => {
    const g = S.gcd(k, N) || N, q = k / N;
    if (Number.isInteger(q) && q <= 32) return S.parseStep(`${2 ** q}/1`);
    return { t: `${k / g}\\${N / g}`, c: (1200 * k) / N, edo: [k / g, N / g] };
  };
  // an interval as typed, taken as a note: what every note field and a link's notes read (p/q folded into the
  // octave, 2/1 kept as S.parseRatio keeps it; k\N; cents); null if it reads as none
  S.parseNote = (txt) => {
    const s = S.parseStep(txt);
    if (!s) return null;
    return s.r ? S.qNote(s.r) : s.edo ? S.edoKey(s.edo[0], s.edo[1]) : S.centsKey(s.c);
  };
  // the canonical string of a note, or null: "3:2" -> "3/2", 3^12/2^19 -> 531441/524288; tempered keys as they are
  S.noteKey = (x) => { const e = S.qParse(x); if (e) return S.qNote(e); const t = parseTemp(String(x)); return t && t.str; };
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
    let k = (fb[0] * N) / fb[1] - (fa[0] * N) / fa[1] + (wrap ? N : 0);
    const g = S.gcd(k, N) || 1;
    return `${k / g}\\${N / g}`;
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
  // first visit after the stars: the starred ratios become the scale (none starred: the 1/1 alone)
  const pins = loadList('scales.pins');
  const storedScale = loadList('scales.scale') || (pins && pins.length ? pins : null);
  S.scale = clean(storedScale || ['1/1']);
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
    if (S.ji && S.ji.linked) { const r = scaleRatios(); if (r.join() !== S.ji.notes.join()) { S.ji.notes = r; jiSave(); } }
    S.emit('scale');
  };
  S.inScale = (str) => S.scale.includes(str);
  S.isSilent = (str) => S.silent.has(str);
  S.audible = () => S.scale.filter((x) => !S.silent.has(x));
  // setSilent, addToScale and removeFromScale take any spelling of a note (c700, 7:4): the scale holds canonical keys only
  S.setSilent = (str, on) => { str = S.noteKey(str); if (!S.inScale(str) || on === S.isSilent(str)) return; on ? S.silent.add(str) : S.silent.delete(str); saveScale(); };
  S.setScale = (list, silent) => { S.scale = clean(list); if (silent) S.silent = new Set(clean(silent)); saveScale(); };
  S.addToScale = (str) => { str = S.noteKey(str); if (!str || str === '2/1' || S.inScale(str)) return; S.scale.push(str); saveScale(); };
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
    if (S.ji.linked && undos.length < linkMark) S.ji.setLinked(false);
    stepTo(o);
  };
  S.redoScale = () => {
    const o = redos.pop();
    if (!o) return;
    undos.push(snap());
    stepTo(o);
  };
  // Just intonation's own notes, what its menu chooses and Edit changes, as the Cycle's are in Temperament:
  // apart from the scale unless linked, then they are the scale. Any notes, tempered ones too (a Lattice of k\N steps
  // chooses them). Starts as a stored scale, else the 1/1 alone
  const scaleRatios = () => [...S.scale];
  const jiClean = (list) => clean(list).sort((a, b) => S.ratio(a).cents - S.ratio(b).cents);
  const jiSave = () => {
    S.keep('scales.jiSet', JSON.stringify(S.ji.notes));
    if (S.ji.linked && scaleRatios().join() !== S.ji.notes.join()) S.setScale(S.ji.notes);
    S.emit('jiset');
  };
  S.ji = {
    notes: jiClean(loadList('scales.jiSet') || storedScale || ['1/1']),
    has: (str) => S.ji.notes.includes(str),
    set: (list) => { S.ji.notes = jiClean(list); jiSave(); },
    add: (str) => { if (str !== '2/1' && !S.ji.has(str)) S.ji.set([...S.ji.notes, str]); },
    remove: (str) => { if (S.ji.has(str)) S.ji.set(S.ji.notes.filter((x) => x !== str)); },
    setLinked: (on) => {
      if (on === S.ji.linked) return;
      S.ji.linked = on;
      if (on) linkMark = undos.length;
      S.keep('scales.jiLink', JSON.stringify(on ? [1] : []));
      S.emit('jilink');
    },
    // the source replaces the other as far as that can hold it: the scale all of it, these notes its ratios
    linkTo: () => { S.useAsScale(S.ji.notes); S.ji.setLinked(true); },
    linkFrom: () => { S.ji.set(scaleRatios()); S.emit('preset'); S.ji.setLinked(true); },
    // which way needs asking only when both hold something different
    linkWay: () => {
      if (scaleRatios().join() === S.ji.notes.join()) return 'same';
      if (!S.ji.notes.length) return 'from';
      return !S.scale.length || S.scale.join() === '1/1' ? 'to' : 'ask';
    },
  };
  // linked from the start; a browser from before the link only if its two lists already agree
  const storedLink = loadList('scales.jiLink');
  S.ji.linked = storedLink ? storedLink[0] === 1 : scaleRatios().join() === S.ji.notes.join();
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
    const x = e.target.closest('[data-rm]');
    if (x) { e.stopPropagation(); S.removeFromScale(x.dataset.rm); return; }
    const m = e.target.closest('[data-mute]');
    if (m) { e.stopPropagation(); S.setSilent(m.dataset.mute, !S.isSilent(m.dataset.mute)); S.emit('pick', m.dataset.mute); }   // muting also picks the note
  });
  // these buttons sit inside pressable things (a list row, a partial): pressing them plays nothing
  document.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-add], [data-rm], [data-mute], [data-more], .srow-edit')) e.stopPropagation(); }, true);

  /* ---------- note names ---------- */

  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  S.midiFreq = (m) => S.settings.anchorHz * 2 ** ((m - S.settings.anchorMidi) / 12);
  S.freqMidi = (f) => S.settings.anchorMidi + 12 * Math.log2(f / S.settings.anchorHz);
  S.baseFreq = () => S.midiFreq(S.settings.base);
  // a ratio's pitch above the 1/1, oct octaves up
  S.ratioFreq = (str, oct = 0) => S.baseFreq() * 2 ** ((S.ratio(str).cents + 1200 * oct) / 1200);
  // a run that climbs (Chain, Path), cents above the 1/1 to frequencies at their real height: its lowest note is the
  // 1/1 or above (a run that goes down moves up by whole octaves), and it goes on past hearing, never back into it (the user's call)
  S.climb = (cs) => {
    const k = Math.max(0, Math.ceil(-Math.min(...cs) / 1200 - S.EXACT / 1200));
    return cs.map((c) => S.baseFreq() * 2 ** ((c + 1200 * k) / 1200));
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
  // the one ratio readout: ratio and "Add to scale", then cents · Hz · nearest 12-TET note and
  // deviation. str = null shows an empty placeholder of the same height.
  S.readout = (str) => {
    const r = str && S.ratio(str);
    if (!r) return '<div class="big"><span class="mono hl none">–</span></div><div class="sub mono">&nbsp;</div>';
    const f = S.ratioFreq(r.str, S.noteOct(r.str)), n = S.noteOf(f);   // the octave a key played it in
    // a pitch in cents is its own headline; the cents open the line below all the same, where a tap on a touch
    // screen shows every digit (.tip-pop; the headline plays)
    const c = `<b title="${S.exactC(r.cents)}">${S.fmtC(r.cents)}¢</b>`, inC = r.temp && !r.edo, nd = S.ndTip(r);
    return `<div class="big"><span class="mono hl" data-ro="${r.str}"${inC ? ` title="${S.exactC(r.cents)}"` : nd ? ` title="${nd}"` : ''}>${inC ? `${S.fmtC(r.cents)}¢` : S.breakHTML(S.labelHTML(r.label))}</span>${S.addBtn(r.str)}</div>
      <div class="sub mono">${c} · <span title="${S.exactHz(f)}">${S.fmtHz(f)} Hz</span> · ${n.name}${n.oct} <span title="${S.exactDev(S.etDev(r.cents))}">${S.fmtDev(n.dev)}</span></div>`;
  };
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

  /* ---------- timbres ---------- */

  const series = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
  // the spectrum shapes, one list for the header's Tone and the Harmonics menu: same names, same
  // sound (64 partials, as many as Harmonics can show)
  // Sine heads the menu (the simplest); the default tone is still the sawtooth (customAmps below)
  S.SHAPES = {
    pure: ['Sine', (n) => (n === 1 ? 1 : 0)],
    saw: ['Sawtooth · 1/n', (n) => 1 / n],
    square: ['Square · odd 1/n', (n) => (n % 2 ? 1 / n : 0)],
    // a pulse wave a third of each period high: |sin(πn/3)|/n, so every third partial is silent
    pulse3: ['Pulse ⅓ · 1/n', (n) => (n % 3 ? 1 / n : 0)],
    triangle: ['Triangle · odd 1/n²', (n) => (n % 2 ? 1 / (n * n) : 0)],
    soft: ['Soft · 1/n²', (n) => 1 / (n * n)],
    flat: ['Flat', () => 0.7],
  };
  // One tone for the whole app: the Harmonics spectrum (64 amplitudes, the first N of them shown and
  // heard). The header's Tone and the Harmonics menu are two views of it: a shape's name when it
  // matches one, else Custom.
  const NAMPS = 64;
  S.state.customAmps = series(NAMPS, (n) => 1 / n);
  // a stored spectrum from before 64 partials had 32: a shape goes on as that shape, a painting with silence
  const stored = (key) => {
    const a = JSON.parse(localStorage.getItem(key) || 'null');
    if (!Array.isArray(a) || (a.length !== 32 && a.length !== NAMPS)) return null;
    if (a.length === NAMPS) return a;
    const sh = Object.values(S.SHAPES).find(([, f]) => a.every((x, i) => Math.abs(x - f(i + 1)) < 1e-6));
    return series(NAMPS, (n) => (n <= 32 ? a[n - 1] : sh ? sh[1](n) : 0));
  };
  try { S.state.customAmps = stored('scales.customAmps') || S.state.customAmps; } catch (e) {}
  S.saveCustomAmps = () => S.keep('scales.customAmps', JSON.stringify(S.state.customAmps));
  S.amps = () => {
    const a = S.state.customAmps.slice(0, S.state.customN || 16);
    return a.some((x) => x > 0) ? a : [1];
  };
  // which shape the spectrum is (tol: how near counts), or 'custom'
  S.shapeOf = (tol = 1e-6) => {
    for (const [k, [, f]] of Object.entries(S.SHAPES)) {
      if (S.state.customAmps.every((a, i) => Math.abs(a - f(i + 1)) < tol)) return k;
    }
    return 'custom';
  };
  // set the spectrum to a shape; src says who did it, so that menu needn't redraw itself
  S.setShape = (k, src) => {
    const f = S.SHAPES[k] && S.SHAPES[k][1];
    if (!f) return;
    for (let n = 1; n <= NAMPS; n++) S.state.customAmps[n - 1] = f(n);
    S.state.toneCustom = false;
    S.saveCustomAmps();
    S.emit('spectrum', src);
  };
  // Custom keeps the last painted spectrum apart from the shapes, so choosing a shape doesn't lose it.
  // Empty until something is painted (or, on load, the stored tone is already a painted one).
  S.state.customSlot = null;
  try { S.state.customSlot = stored('scales.customSlot'); } catch (e) {}
  if (!S.state.customSlot && S.shapeOf() === 'custom') S.state.customSlot = S.state.customAmps.slice();
  S.state.toneCustom = S.shapeOf() === 'custom';   // the Tone menu reads Custom
  // painting fills Custom with what is painted
  S.saveCustomSlot = () => S.keep('scales.customSlot', JSON.stringify(S.state.customSlot));
  S.keepCustom = () => {
    S.state.customSlot = S.state.customAmps.slice();
    S.state.toneCustom = true;
    S.saveCustomSlot();
  };
  // choosing Custom brings back the painted spectrum; while it is empty the tone stays as it is
  S.useCustom = (src) => {
    S.state.toneCustom = true;
    if (S.state.customSlot) {
      S.state.customSlot.forEach((a, i) => { S.state.customAmps[i] = a; });
      S.saveCustomAmps();
    }
    S.emit('spectrum', src);
  };
  S.toneName = () => (S.state.toneCustom ? 'custom' : S.shapeOf());

  /* ---------- audio ---------- */

  // one loudness everywhere: a voice alone, or one of n sounding together (Chord's rule, its sum grows as √n)
  S.gainOf = (n) => (n > 1 ? 0.3 / Math.sqrt(n) : 0.26);

  S.audio = (() => {
    let ctx = null, out = null, immediate = false, pressing = 0, live = false;
    const waves = new Map();
    const voices = new Set();     // every voice still producing samples (incl. release tails)
    const sounding = new Set();   // voices not yet told to stop: what the Stop button reflects
    const seqs = new Set();
    const solos = new Map();

    // a running context costs battery even in silence: it sleeps once nothing has sounded for a minute, or as
    // soon as the page is hidden, and ac() wakes it on the next press or key. With MIDI on only hiding does: waking
    // can take long on a phone, and a piano's next note can't wait
    const IDLE_MS = 60000;
    let idle = null;
    const sleepCtx = () => { if (ctx && ctx.state === 'running' && !voices.size && !seqs.size) ctx.suspend(); };
    const sleepSoon = () => {
      clearTimeout(idle);
      idle = setTimeout(() => { if (voices.size || seqs.size || S.midi?.on) sleepSoon(); else sleepCtx(); }, IDLE_MS);
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) sleepCtx(); });

    const activity = () => {
      const now = sounding.size > 0 || seqs.size > 0;
      if (now !== live) { live = now; S.emit('activity', now); }
    };

    function ac() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 8;
        out = ctx.createGain();
        out.gain.value = 1;   // no volume control: the device's own buttons, or the tab's mute
        // the compressor reacts in 3 ms, so a big chord's onset passes 1 and would clip, which cracks: a soft ceiling
        // above 0.75, untouched below (a curve reads −1…1, hence the halving)
        const half = ctx.createGain();
        half.gain.value = 0.5;
        const ceil = ctx.createWaveShaper();
        ceil.curve = Float32Array.from({ length: 8193 }, (_, i) => {
          const x = 2 * (i / 4096 - 1), a = Math.abs(x);
          return a <= 0.75 ? x : Math.sign(x) * (0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25));
        });
        out.connect(comp).connect(half).connect(ceil).connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      sleepSoon();
      return ctx;
    }

    function wave(amps) {
      const key = amps.map((a) => a.toFixed(3)).join(',');
      let w = waves.get(key);
      if (!w) {
        const real = new Float32Array(amps.length + 1);
        const imag = new Float32Array(amps.length + 1);
        amps.forEach((a, i) => (imag[i + 1] = a));
        if (!amps.some((a) => a > 0)) imag[1] = 1e-6;
        w = ac().createPeriodicWave(real, imag);
        if (waves.size > 200) waves.clear();
        waves.set(key, w);
      }
      return w;
    }

    // a linear rise 0 → 1 over `attack` seconds, then 128 samples of 1 for the loop that holds it
    const rises = new Map();
    function rise(c, attack) {
      const key = c.sampleRate + ':' + attack;
      let b = rises.get(key);
      if (!b) {
        const n = Math.round(attack * c.sampleRate);
        b = c.createBuffer(1, n + 128, c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = i < n ? i / n : 1;
        rises.set(key, b);
      }
      return b;
    }

    // Notes started by a press (click, tap, key) last at least 50 ms, so a quick click
    // still has a clear pitch; scheduled notes end exactly when asked.
    function tone(freq, opt = {}) {
      const c = ac();
      const t = c.currentTime;
      const amps = opt.amps || S.amps();
      const peak = opt.gain ?? S.gainOf(1);
      const release = opt.release ?? 0.25;
      const minEnd = t + (opt.min ?? pressing);
      const osc = c.createOscillator();
      osc.setPeriodicWave(wave(amps));
      osc.frequency.setValueAtTime(freq, t);
      // the attack is a clip of its own (rise), not a ramp on g: currentTime lags the audio, at times by more than
      // the attack (heard 2026-11-04, Bluetooth), and a ramp planned from a time already past starts at full level,
      // which clicks; a source started late plays from its beginning, so the rise always begins with the sound
      const g = c.createGain(), shape = c.createGain(), attack = opt.attack ?? 0.012;
      const env = c.createBufferSource();
      env.buffer = rise(c, attack);
      env.loop = true;   // its last samples (all 1) hold the level after the rise
      env.loopStart = Math.round(attack * c.sampleRate) / c.sampleRate;
      env.loopEnd = env.buffer.duration;
      shape.gain.value = 0;
      env.connect(shape.gain);
      g.gain.setValueAtTime(peak, t);
      if (opt.decay) g.gain.setTargetAtTime(peak * 0.55, t + 0.02, opt.decay);
      osc.connect(shape).connect(g).connect(out);
      osc.start(t);
      env.start(t);
      let stopped = false, level = peak;   // level: the peak, or what setGain last asked for
      // g's level at time tt, as scheduled (gain.value only knows the present: a fade planned
      // for later, as a key click's at its 50 ms, would hold 0 and cut off hard)
      const at = (tt) => {
        if (opt.decay && tt > t + 0.02) return level * (0.55 + 0.45 * Math.exp(-(tt - t - 0.02) / opt.decay));
        return level;
      };
      const fade = (tt, rel) => {
        if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(tt);   // Chrome, Safari
        else { g.gain.cancelScheduledValues(tt); g.gain.setValueAtTime(tt > c.currentTime + 0.005 ? at(tt) : g.gain.value, tt); }   // Firefox
        g.gain.setTargetAtTime(0, tt, rel / 4);
        const end = tt + rel * 1.6 + 0.05;
        try { osc.stop(end); env.stop(end); } catch (e) {}
      };
      const v = {
        t0: t,   // when it started, in the context's time (a sine starts at phase 0)
        stop(delay = 0) {
          if (immediate) { if (voices.has(v)) v.kill(); return; }   // also cuts a release tail
          if (stopped) return;
          stopped = true;
          const tt = Math.max(c.currentTime + delay, minEnd);
          fade(tt, release);
          // a scheduled stop (dur) keeps the voice "sounding" until it actually ends
          if (tt - c.currentTime < 0.02) { sounding.delete(v); activity(); }
          else setTimeout(() => { sounding.delete(v); activity(); }, (tt - c.currentTime) * 1000);
        },
        // cut at once, even if already releasing
        kill() {
          stopped = true;
          fade(c.currentTime, 0.03);
          sounding.delete(v); activity();
        },
        setFreq(f, glide = 0.015) { osc.frequency.setTargetAtTime(f, c.currentTime, glide); },
        // a new peak level, reached smoothly (painting a Harmonics bar while it sounds)
        setGain(x) {
          if (stopped) return;
          const now = c.currentTime;
          if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(now);
          else { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); }
          g.gain.setTargetAtTime(x, now, 0.015);
          level = x;
        },
        setAmps(a) { osc.setPeriodicWave(wave(a.some((x) => x > 0) ? a : [1e-6])); },
      };
      osc.onended = () => { voices.delete(v); sounding.delete(v); osc.disconnect(); env.disconnect(); shape.disconnect(); g.disconnect(); activity(); };
      voices.add(v);
      sounding.add(v);
      activity();
      if (opt.dur) v.stop(opt.dur);
      return v;
    }

    // several voices, one stop(); vel scales them (MIDI)
    function chord(freqs, { vel = 1, ...opt } = {}) {
      const gain = S.gainOf(freqs.length) * vel;
      const vs = freqs.map((f) => tone(f, { ...opt, gain }));
      return { stop: (d) => vs.forEach((v) => v.stop(d)) };
    }

    // schedule a melodic sequence; returns cancel(). freqs[i] may be a number, an array, or {f, gain},
    // or a function giving one of those when its turn comes (null: skipped, taking no time).
    // Notes never ring into the next one: each ends after 80% of a step with a short release.
    function sequence(freqs, { step = 0.22, len = 0.5, onStep, ...opt } = {}) {
      len = Math.min(len, step * 0.8);
      opt = { release: Math.min(0.2, step * 0.45), attack: 0.008, ...opt };
      [...seqs].forEach((c) => c());   // one sequence at a time
      let i = 0, cancelled = false, timer = null;
      const done = () => { seqs.delete(cancel); activity(); onStep && onStep(-1); };
      const next = () => {
        if (cancelled) return;
        if (i >= freqs.length) { done(); return; }
        const item = typeof freqs[i] === 'function' ? freqs[i]() : freqs[i];
        if (item == null) { i++; next(); return; }
        [].concat(item).forEach((x) => {
          if (!x) return;
          const o = typeof x === 'object' ? x : { f: x };
          tone(o.f, { dur: len, decay: 0.15, min: 0, ...opt, ...(o.gain != null ? { gain: o.gain } : {}) });
        });
        onStep && onStep(i);
        i++;
        timer = setTimeout(next, step * 1000);
      };
      const cancel = () => { if (cancelled) return; cancelled = true; clearTimeout(timer); done(); };
      seqs.add(cancel);
      next();
      return cancel;
    }

    // Browsers let sound start only after a gesture that counts as the user's: a key, a mouse press, or
    // on touch screens a finger lifting (not touching down). Every press here starts on touch-down, so the
    // first one on a phone found the sound asleep, and only Play or a chip (click, after the lift) woke it.
    // Wake it on every such gesture, anywhere: from the first lift on, every touch-down sounds.
    ['pointerup', 'touchend', 'click', 'keydown'].forEach((t) => document.addEventListener(t, () => ac(), true));

    // the context time whose samples reach the ears right now (output latency included)
    function heard() {
      const c = ac();
      if (c.getOutputTimestamp) {
        const o = c.getOutputTimestamp();
        if (o.contextTime) return o.contextTime + (performance.now() - o.performanceTime) / 1000;
      }
      return c.currentTime - (c.outputLatency || c.baseLatency || 0);
    }

    return {
      tone, chord, sequence, heard,
      now: () => ac().currentTime,   // the context's time now (heard() is when it reaches the ears)
      // run fn with stops taking effect at once (used when gliding between notes)
      immediately(fn) { immediate = true; try { fn(); } finally { immediate = false; } },
      // run fn as a press: notes it starts get the 50 ms minimum (or min seconds)
      press(fn, min = 0.05) { pressing = min; try { return fn(); } finally { pressing = 0; } },
      // keep one sound per key: a new one cuts the previous at once
      solo(key, sound) {
        const prev = solos.get(key);
        if (prev && prev !== sound) S.audio.immediately(() => prev.stop());
        solos.set(key, sound);
        return sound;
      },
      panic() {
        immediate = true;
        try {
          [...seqs].forEach((c) => c());
          S.emit('panic');
          voices.forEach((v) => v.kill());
        } finally { immediate = false; }
        sounding.clear();
        activity();
      },
    };
  })();

  /* ---------- tiny event bus ---------- */

  const handlers = {};
  S.on = (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn);
  S.off = (ev, fn) => { const h = handlers[ev]; if (h && h.includes(fn)) h.splice(h.indexOf(fn), 1); };
  // each listener on its own: one that throws (a view's bug) is reported and the others still run, so a link is still read whole
  S.emit = (ev, ...a) => [...(handlers[ev] || [])].forEach((fn) => { try { fn(...a); } catch (e) { setTimeout(() => { throw e; }); } });

  // Sound comes first. MIDI and keys arrive on the page's one thread, so a note waits for whatever is being drawn:
  // what a note makes the page draw goes through S.later, one piece a task. Each piece has a pace [quiet, max]: it runs
  // once no note has come for quiet ms, at most max ms after it was asked for. Asking again under the same key replaces
  // what was waiting and keeps its place, so a burst of notes draws once and no piece starves
  S.LATER = { HOT: [8, 16], SOON: [30, 100], REST: [120, 800] };
  // on phones the picture and the side panel take turns: what can't be seen needn't move
  const narrowW = matchMedia('(max-width: 960px)'), phoneW = matchMedia('(max-width: 450px)');
  S.sideClosed = () => narrowW.matches && !document.body.classList.contains('drawer-open') && !document.body.classList.contains('drawer-drag');
  S.mainCovered = () => phoneW.matches && document.body.classList.contains('drawer-open');
  // first line of what draws only into the side panel: true (so return) while the drawer is shut; it runs when the drawer opens
  const sideDue = new Set();
  S.sideWait = (fn) => { if (!S.sideClosed()) { sideDue.delete(fn); return false; } sideDue.add(fn); return true; };
  S.on('shown', () => { if (!S.sideClosed()) { const fns = [...sideDue]; sideDue.clear(); fns.forEach((f) => f()); } });
  const later = new Map();
  let laterTimer = null, lastNote = 0;
  const laterAt = (p) => Math.min(lastNote + p.pace[0], p.since + p.pace[1]);
  const laterArm = () => {
    clearTimeout(laterTimer);
    laterTimer = null;
    if (!later.size) return;
    let at = Infinity;
    later.forEach((p) => { at = Math.min(at, laterAt(p)); });
    laterTimer = setTimeout(laterTick, Math.max(0, at - performance.now()));
  };
  const laterTick = () => {
    const now = performance.now();
    const due = [...later].find(([, p]) => laterAt(p) <= now);
    if (due) later.delete(due[0]);
    try { if (due) due[1].fn(); } finally { laterArm(); }
  };
  S.later = (key, fn, pace = S.LATER.SOON) => {
    const p = later.get(key);
    if (p) p.fn = fn; else later.set(key, { fn, pace, since: performance.now() });
    laterArm();
  };
  S.noteIn = () => { lastNote = performance.now(); };
  // a view's listeners to what's selected elsewhere (S.on('pick', shown(fn))): a hidden view draws nothing and
  // catches up on the latest when it next shows
  S.whenShown = (el) => {
    let wait = null;
    S.on('shown', () => { if (wait && !el.closest('[hidden]')) { const w = wait; wait = null; w(); } });
    return (fn) => (...a) => { if (el.closest('[hidden]')) wait = () => fn(...a); else { wait = null; fn(...a); } };
  };
  // an event through S.later: each listener in a task of its own
  S.emitLater = (ev, ...a) => (handlers[ev] || []).forEach((fn, i) => S.later(`${ev}:${i}`, () => fn(...a)));

  // The selected note, one for Lattice, Diamond, Spiral and EDO (Beats keeps its own tones): a press in
  // one picture selects it in the others ('note', with the view that did it), each showing it its own way;
  // a rim dot, list row or piano key picks it as itself ('pick', rim). A view mounted later starts on it.
  // Kept across reloads (scales.note), as the scale and Beats' tones are.
  S.note = { str: '1/1', rim: false };
  try { const v = JSON.parse(localStorage.getItem('scales.note')); const k = v && typeof v.str === 'string' && S.noteKey(v.str); if (k && S.ratio(k)) S.note = { str: k, rim: !!v.rim }; } catch (e) {}
  const keepNote = () => { try { localStorage.setItem('scales.note', JSON.stringify(S.note)); } catch (e) {} };
  S.setNote = (str, src) => { S.note = { str, rim: false }; keepNote(); S.emit('note', str, src); };
  S.on('pick', (str, key, oct = 0) => { S.note = { str, rim: true, oct }; keepNote(); });
  // the octave the selected note sounded in, from a key, MIDI or a partial number (0 otherwise): readouts show that pitch, and pressing or Enter plays it.
  // A press that selects it sounds folded, so S.setNote comes before the readout is drawn
  S.noteOct = (str) => (S.note.str === str && S.note.oct) || 0;
  S.playNote = (str) => S.playScaleNotes([str], { octs: [S.noteOct(str)] });
  // the scale replaced by choice (Use as scale): the note on the selected one's key now, as a held key takes it; none: nothing selected
  S.useAsScale = (list) => {
    S.ji.setLinked(false);   // the Cycle's would otherwise overwrite Just intonation's notes
    S.setScale(list);
    if (!S.note.str) return;
    const b = S.pianoNote(Math.round(S.ratio(S.note.str).cents / 100));
    S.emit('pick', b ? b.str : null);
  };

  /* ---------- DOM helpers ---------- */

  S.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // A Play button (Chord, Harmonics' Play): it sounds while held, as every note does: from touch-down to letting go, at
  // least a press's minimum (start runs its notes in S.audio.press). Enter or Space on the focused button: the same
  // minimum. btn: the button, or a selector for buttons anywhere in the page (Chord, one in every side panel)
  S.playHold = (btn, start, stop) => {
    const root = typeof btn === 'string' ? document : btn;
    const hit = (e) => (typeof btn === 'string' ? e.target.closest(btn) : btn);
    let down = null;
    root.addEventListener('pointerdown', (e) => {
      const b = hit(e);
      if (!b || e.button) return;
      stop();
      start();
      down = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
    });
    // let go: the focus goes too, so the piano keys pressed next don't ring the button as the keyboard's
    const up = (e) => { if (down !== e.pointerId) return; down = null; stop(); const b = hit(e); if (b) b.blur(); };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('contextmenu', (e) => { if (hit(e)) e.preventDefault(); });   // a long press on touch screens
    root.addEventListener('click', (e) => { if (!e.detail && hit(e)) { stop(); start(); stop(); } });
  };

  // Brings root's children to the markup in html without replacing what stays: what is still there keeps being
  // the element it was (the keyboard's focus, the :hover a tap left, a press in S.holdOn), with only its changed
  // attributes and text written. Children match by their note (data-r), a step by its two (data-a, data-b), the
  // rest by tag, first class and place among those alike. 'hot' and 'held' are kept: lit from outside (S.markScale,
  // S.holdOn), not in the markup. The nodes in `keep` (the keyboard under the list's head) stay where they are.
  const LIVE = ['hot', 'held'];
  const keyOf = (x, seen) => {
    if (x.nodeType === 1 && x.dataset.r) return 'r:' + x.dataset.r;
    if (x.nodeType === 1 && x.dataset.a) return `s:${x.dataset.a}>${x.dataset.b}`;
    const k = x.nodeType === 1 ? `${x.nodeName}.${x.classList[0] || ''}` : '#' + x.nodeType;
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return `${k}:${n}`;
  };
  const patchNode = (to, from) => {
    if (to.nodeType !== 1) { if (to.data !== from.data) to.data = from.data; return; }
    const cls = [from.getAttribute('class') || '', ...LIVE.filter((c) => to.classList.contains(c))].join(' ').trim();
    if ((to.getAttribute('class') || '') !== cls) cls ? to.setAttribute('class', cls) : to.removeAttribute('class');
    for (const { name, value } of from.attributes) if (name !== 'class' && to.getAttribute(name) !== value) to.setAttribute(name, value);
    for (const { name } of [...to.attributes]) if (name !== 'class' && !from.hasAttribute(name)) to.removeAttribute(name);
    patchKids(to, from);
  };
  const patchKids = (to, from, keep = []) => {
    const have = new Map(), seen = new Map();
    for (const x of to.childNodes) if (!keep.includes(x)) have.set(keyOf(x, seen), x);
    seen.clear();
    const want = [...from.childNodes].map((w) => {
      const k = keyOf(w, seen), old = have.get(k);
      if (!old || old.nodeName !== w.nodeName) return [w, null];
      have.delete(k);
      return [w, old];
    });
    // the gone first: then what stays is already in its place, never moved (a moved node loses the focus)
    have.forEach((x) => x.remove());
    let at = to.firstChild;
    for (const [w, old] of want) {
      while (at && keep.includes(at)) at = at.nextSibling;
      if (old) patchNode(old, w);
      const node = old || w;
      if (node === at) at = at.nextSibling;
      else to.insertBefore(node, at);
    }
  };
  S.patch = (root, html, keep) => {
    const t = document.createElement('template');
    t.innerHTML = html;
    patchKids(root, t.content, keep);
  };

  // A part drawn anew (innerHTML) gives the focus back to its new copy of the control that had it, the one with the
  // same data-* attributes: Enter or Space on a chip whose row redraws (Beats' 1/1, Diamond's numbers, Spiral's
  // directions) left the focus on the page, and a second Enter did nothing
  S.keepFocus = (root, draw) => {
    const a = document.activeElement, data = a && a !== root && root.contains(a) ? Object.entries(a.dataset) : [];
    draw();
    if (!data.length || root.contains(a)) return;
    const sel = data.map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${CSS.escape(v)}"]`).join('');
    root.querySelector(sel)?.focus({ preventScroll: true });   // it had the focus already: showing it again would scroll the page from under the pointer (a Spiral arc pressed far below its run)
  };

  // Press-and-hold on any element matching `sel` inside root (survives re-renders).
  // start(el, event, glided) returns a stop function (or nothing). While held, moving
  // onto another matching element stops the first and starts the other at once.
  let lastScroll = -1e9;
  document.addEventListener('scroll', () => { lastScroll = performance.now(); }, { capture: true, passive: true });
  S.holdOn = (root, sel, start, opt) => {
    const live = new Map();
    const tails = [];   // released presses whose notes may still be ringing out
    // what counts as the same element for gliding (opt.id: the keyboard's keys are their step, whatever note they show)
    const ident = (opt && opt.id) || ((el) => Object.entries(el.dataset).filter(([k]) => k !== 'state').join('|') || el);
    const begin = (el, e, glided) => {
      // a fresh press cuts what earlier presses here left ringing
      if (!glided) S.audio.immediately(() => tails.splice(0).forEach((f) => f()));
      let cut = null;
      const stop = S.audio.press(() => start(el, e, glided));
      if (typeof stop !== 'function') return null;
      el.classList.add('held');
      return {
        id: ident(el),
        stop: () => {
          stop(); el.classList.remove('held');
          // remember a hard cut for this press: calling stop() again inside immediately() kills the tail
          cut = () => S.audio.immediately(() => stop());
          tails.push(cut);
          if (tails.length > 8) tails.shift();
        },
      };
    };
    // round things that overlap (circle dots, Scatter's numbers): the press goes to the one whose centre is nearest,
    // not the one drawn on top, so a dot half under its neighbour still plays from its own half
    const at = (x, y, top) => {
      if (!top || top.tagName !== 'circle') return top;
      let best = top, bd = Infinity;
      for (const u of document.elementsFromPoint(x, y)) {
        const el = u.closest(sel);
        if (!el || el.tagName !== 'circle' || !root.contains(el)) continue;
        const b = el.getBoundingClientRect(), d = (b.x + b.width / 2 - x) ** 2 + (b.y + b.height / 2 - y) ** 2;
        if (d < bd - 0.01) { bd = d; best = el; }   // a tie keeps the one on top
      }
      return best;
    };
    // no scrolling from these, in browsers that ignore touch-action on what is inside an SVG; suppresses their click
    if (opt && opt.takeTouch) root.addEventListener('touchstart', (e) => { if (e.target.closest(sel)) e.preventDefault(); }, { passive: false });
    root.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      // opt.list: a touch that stops a scroll still coasting only stops it
      if (opt && opt.list && e.pointerType === 'touch' && performance.now() - lastScroll < 150) return;
      const el = at(e.clientX, e.clientY, e.target.closest(sel));
      if (!el || !root.contains(el)) return;
      e.preventDefault();
      // on the shape itself too: a press may redraw the picture (Cycle, Spiral), and touchstart, which comes after this, then never reaches root
      if (opt && opt.takeTouch && e.pointerType === 'touch') e.target.addEventListener('touchstart', (t) => t.preventDefault(), { passive: false, once: true });
      if (e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId);
      end(e);   // a press whose release never came (let go outside the window) ends here, not with Stop
      const h = begin(el, e, false);
      if (h) live.set(e.pointerId, h);
    });
    window.addEventListener('pointermove', (e) => {
      const h = live.get(e.pointerId);
      if (!h || (opt && opt.list && e.pointerType === 'touch')) return;   // a list: a finger moving on scrolls, it doesn't glide
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const el = under && at(e.clientX, e.clientY, under.closest(sel));
      if (!el || !root.contains(el) || ident(el) === h.id) return;
      S.audio.immediately(() => h.stop());
      const n = begin(el, e, true);
      n ? live.set(e.pointerId, n) : live.delete(e.pointerId);
    });
    const end = (e) => { const h = live.get(e.pointerId); if (h) { live.delete(e.pointerId); h.stop(); } };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // Stop ends the press itself: its drawing goes with the sound, and a glide brings no note back; so does the window
    // losing focus ('release', as held keys): its pointerup may never come
    const endAll = () => { live.forEach((h) => h.stop()); live.clear(); };
    S.on('panic', endAll);
    S.on('release', endAll);
  };

  // segmented control: <div class="seg" data-seg="name"><button data-v="..">
  S.seg = (root, name, value, onChange) => {
    const el = root.querySelector(`[data-seg="${name}"]`);
    const mark = (v) => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    mark(value);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      mark(b.dataset.v);
      onChange(b.dataset.v);
    });
    return mark;
  };

  // a count field (Cycle's Outer and Inner, the Spiral's run): applied on change (Enter, leaving it, its arrows), not
  // per keystroke: typing 12 went through 1. Past its limits it turns red and stays so until left, then shows the
  // present value again. max: a number or a function; set(v): false refuses; show(): puts the present value back
  S.numIn = (inp, max, set, show) => {
    const fits = (v) => v >= 1 && v <= (typeof max === 'function' ? max() : max);
    inp.addEventListener('input', () => inp.classList.toggle('bad', !fits(Math.round(+inp.value))));
    inp.addEventListener('change', () => {
      const v = Math.round(+inp.value);
      if (fits(v) && set(v) !== false) inp.classList.remove('bad');
      if (!inp.classList.contains('bad')) show();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', () => { inp.classList.remove('bad'); show(); });
  };
  // a count field also drags (Spiral's runs, Cycle's Outer and Inner): up or right adds, down or left takes away, a step
  // per 16 px (8 was too sensitive, the user: ±5–10 is the range that matters); a press that doesn't move types (onTap
  // first, if given). set(n) returning false refuses n (the field turns red until let go); get() is the count now
  S.numDrag = (inp, { get, set, max, min = 1, onStart, onEnd, onTap }) => {
    inp.classList.add('drag-n');
    inp.addEventListener('pointerdown', (e) => {
      if (e.button || document.activeElement === inp) return;   // while typing, a press is the field's own
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, n0 = get(), hi = typeof max === 'function' ? max() : max;
      let moved = false, last = n0;
      const move = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!moved) { moved = true; if (onStart) onStart(); }
        const n = S.clamp(n0 + Math.round((dx - dy) / 16), min, hi);
        if (n === last) return;
        last = n;
        inp.classList.toggle('bad', n !== get() && set(n) === false);
        if (!inp.classList.contains('bad')) inp.value = get();
      };
      const end = (ev) => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
        inp.classList.remove('bad');
        inp.value = get();
        if (moved) { if (onEnd) onEnd(); return; }
        if (ev.type !== 'pointerup') return;
        const f = (onTap && onTap()) || inp;
        f.focus(); f.select();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
    });
  };

  S.typed = [];
  try { const t = JSON.parse(localStorage.getItem('scales.typed')); if (Array.isArray(t)) S.typed = t.filter((x) => S.ratio(x)); } catch (e) {}
  // the everyday intervals, always visible in pickers
  S.CORE_RATIOS = ['1/1', '16/15', '9/8', '6/5', '5/4', '4/3', '7/5', '3/2', '8/5', '5/3', '7/4', '15/8', '2/1'];

  // Ratio picker: the everyday chips and "+ more", whose library (grouped by prime limit, or the given groups) opens right
  // below them; then, under a rule, this browser's own chips (the scale's other notes, tempered ones too, and typed ones)
  // and the free p/q field that makes them
  // grouped by prime limit (or the given groups). isOn(str) marks chips; onPick(str) on click.
  // With et: true, dashed 12-TET chips (labelled by cents) pick the tempered notes k\12 (1200: the 2/1).
  // isAlso (Beats): notes also chosen besides the one that is on, ringed instead of filled
  // parse (Spiral: unfolded): typed text → the string picked, or null (default: S.parseNote); onField(input): after each render (the field is drawn anew; a focused one keeps focus and text)
  // steps (Spiral): () => more chips among this browser's own, {key, c, cls, on, html, title}, intervals no note chip shows (9/4, 700¢);
  // onTyped(str): what Enter in the field picks, before onPick; core: the first row (Lattice: the primes' first steps)
  // The own row (under the rule) shows OWN_MAX chips, the lowest, and every chosen one, until "+ n more": a scale of 500
  // notes hid the field under screens of them
  const OWN_MAX = 12;
  S.ratioPicker = (root, { isOn, onPick, et = false, isAlso = () => false, exclude = [], groups = S.RATIO_GROUPS,
    parse = S.parseNote, placeholder = 'p/q, ¢ or k\\N ⏎', onField, steps, onTyped, core = S.CORE_RATIOS }) => {
    let open = false, ownAll = false;
    root.classList.add('picker');
    const chip = (s, extra = '') => {
      if (exclude.includes(s)) return '';
      const r = S.ratio(s);
      return r ? `<button class="chip ${r.cls}${isOn(s) ? ' on' : isAlso(s) ? ' also' : ''}${extra}" data-r="${s}" title="${[S.ndTip(r), S.exactC(r.cents)].filter(Boolean).join(' · ')}">${S.breakHTML(S.labelHTML(r.label))}</button>` : '';
    };
    const byCents = (list) => [...list].sort((a, b) => S.ratio(a).cents - S.ratio(b).cents);
    // simplest first: smaller n·d (Tenney height), ties by pitch
    const bySimplicity = (list) => [...list].sort((a, b) => {
      const x = S.ratio(a), y = S.ratio(b);
      const h = (r) => (r.nd ? Number(r.n * r.d) : Infinity);   // a long one last, its n/d never made
      return h(x) - h(y) || x.cents - y.cents;
    });
    const input = `<input type="search" enterkeyhint="done" class="ratio-in" placeholder="${placeholder}" spellcheck="false" aria-label="${placeholder.replace(' ⏎', '')}, Enter to use">`;
    // this browser's own chips, by pitch: the scale's notes, typed ratios and the view's own steps; keep: chosen (on or also)
    const own = () => [...new Set([...S.scale, ...S.typed])].filter((s) => S.ratio(s) && !core.includes(s) && !exclude.includes(s))
      .map((s) => ({ key: s, c: S.ratio(s).cents, keep: isOn(s) || isAlso(s), html: () => chip(s) }))
      .concat((steps ? steps() : []).map((x) => ({ key: x.key, step: true, c: x.c, keep: x.on, html: () => `<button class="chip own-step ${x.cls}${x.on ? ' on' : ''}" data-r="${x.key}" title="${x.title}">${x.html}</button>` })))
      .sort((a, b) => a.c - b.c);
    const ownShown = (items) => (ownAll || items.length <= OWN_MAX ? items : items.filter((x, i) => i < OWN_MAX || x.keep));
    const render = () => {
      const old = root.querySelector('.ratio-in'), kept = old && document.activeElement === old ? old.value : null;
      const items = own(), shown = ownShown(items);
      const extras = shown.map((x) => x.html());
      if (items.length > OWN_MAX) extras.push(`<button class="chip more" data-ownmore>${ownAll ? '− less' : `+ ${items.length - shown.length} more`}</button>`);
      root.innerHTML = `
        <div class="chips">${core.map((s) => chip(s)).join('')}
          <button class="chip more${open ? ' open' : ''}" data-more><span>+ more</span><span>− less</span></button>
        </div>
        ${open ? `<div class="library">${groups.map((g) => `
          <div class="lib-row"><span class="lib-label">${g.label}</span><div class="chips">${bySimplicity(g.list).map((s) => chip(s)).join('')}</div></div>`).join('')}
          ${et ? `<div class="lib-row"><span class="lib-label">EDO</span><div class="chips">${Array.from({ length: 12 }, (_, i) => {
            const s = i === 11 ? '2/1' : S.edoKey(i + 1, 12);
            if (exclude.includes(s)) return '';
            return `<button class="chip et${isOn(s) ? ' on' : isAlso(s) ? ' also' : ''}" data-r="${s}" title="${(i + 1) * 100}¢">${S.labelHTML(S.ratio(s).label)}</button>`;   // the note it gives, as the tone chips name it (4\12 reads 1\3)
          }).join('')}</div></div>` : ''}
        </div>` : ''}
        <div class="chips picker-own">${extras.join('')}${input}</div>`;
      const inp = root.querySelector('.ratio-in');
      if (kept != null && inp) { inp.value = kept; inp.focus({ preventScroll: true }); }
      if (onField && inp) onField(inp, kept != null);
    };
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { open = !open; render(); return; }
      if (e.target.closest('[data-ownmore]')) { ownAll = !ownAll; render(); return; }
      const c = e.target.closest('[data-r]');
      if (c) { onPick(c.dataset.r); render(); }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('.ratio-in')) return;
      const str = parse(e.target.value);
      if (!str) { e.target.classList.add('bad'); return; }
      // typed ratios stay at hand as chips (a ratio in the octave; the Spiral's 9/4 or 700¢ don't)
      const r = S.ratio(str);
      if (r && !r.temp && S.noteKey(str) === str && !S.typed.includes(str) && !S.CORE_RATIOS.includes(str)) { S.typed.push(str); try { localStorage.setItem('scales.typed', JSON.stringify(S.typed)); } catch (e) {} }
      e.target.value = '';
      if (onTyped) onTyped(str);
      onPick(str);
      render();
      root.querySelector('.ratio-in').focus();
    });
    root.addEventListener('input', (e) => e.target.classList && e.target.classList.remove('bad'));
    S.on('scale', render);
    render();
    // only what is chosen moved (a Spiral arc pressed): the chips' marks, not a hundred chips drawn anew
    const mark = () => {
      // a chosen chip that the short row leaves out: the row anew, with it
      if (!ownAll) {
        const there = new Set([...root.querySelectorAll('.picker-own .chip[data-r]')].map((c) => (c.classList.contains('own-step') ? 's' : 'n') + c.dataset.r));
        if (own().some((x) => x.keep && !there.has((x.step ? 's' : 'n') + x.key))) { render(); return; }
      }
      const stepOn = new Set((steps ? steps() : []).filter((x) => x.on).map((x) => x.key));
      root.querySelectorAll('.chip[data-r]').forEach((c) => {
        const s = c.dataset.r, on = c.classList.contains('own-step') ? stepOn.has(s) : isOn(s);
        c.classList.toggle('on', on);
        if (!c.classList.contains('own-step')) c.classList.toggle('also', !on && isAlso(s));
      });
    };
    return { render, mark };
  };

  // Text centred on a point (a dot, a cell): baseline shift so the digits' and capitals' ink sits
  // on the centre, measured with canvas font metrics (dominant-baseline centres the em box instead)
  S.DY_SANS = '.352em';

  /* ---------- pitch clock ---------- */

  // One octave as a circle: 0¢ at top, clockwise.
  S.clockPos = (size, cents, rf = 1) => {
    const c = size / 2, R = c - 30;
    const a = (cents / 1200) * 2 * Math.PI;
    return [c + R * rf * Math.sin(a), c - R * rf * Math.cos(a)];
  };

  // S.clock(el, {…}) describes the whole circle; only what differs from the last description reaches the page, so what
  // stays keeps running (ripples, sparks, the Chord's rim). Every piece has a key and its markup.
  // Its classes are changed one by one: what others set on a dot (hot, lit) stays until they take it off.
  const clocks = new WeakMap();
  const svgOf = (html) => { const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); t.innerHTML = html; return t; };
  const clockUpdate = (d, html, was) => {
    const to = svgOf(html).firstElementChild, words = (s) => (s || '').split(' ').filter(Boolean);
    const cls0 = words(svgOf(was).firstElementChild.getAttribute('class')), cls1 = words(to.getAttribute('class'));
    for (const { name, value } of [...to.attributes]) if (name !== 'class' && d.getAttribute(name) !== value) d.setAttribute(name, value);
    if (d.getAttribute('cx') !== null) sparks.get(d)?.setAttribute('transform', `translate(${d.getAttribute('cx')},${d.getAttribute('cy')})`);
    if (to.textContent !== d.textContent) d.textContent = to.textContent;
    cls0.filter((c) => !cls1.includes(c)).forEach((c) => d.classList.remove(c));
    cls1.filter((c) => !cls0.includes(c)).forEach((c) => d.classList.add(c));
    if (cls0.includes('hot') && !cls1.includes('hot') && hotCount.has(d.dataset.r || d.dataset.sr)) d.classList.add('hot');   // the scale's sound still marks it
    if (!cls0.includes('sel') && cls1.includes('sel') && d.matches('.clock-dot')) raise(d);   // no neighbour covers the selected dot
  };
  S.clock = (el, { size = 320, ticks = 12, points = [], rim = true, rimSel = null }) => {
    let box = clocks.get(el);
    if (!box || box.svg.parentNode !== el) {
      el.innerHTML = `<svg class="clock" viewBox="0 0 ${size} ${size}" role="img" aria-label="pitch clock"></svg>`;
      box = { svg: el.firstChild, now: new Map() };
      clocks.set(el, box);
    }
    const c = size / 2, R = c - 30, root = S.baseIdx();
    const P = (cents, rf) => S.clockPos(size, cents, rf);
    // under: below every dot, so a hit ring never covers a neighbouring dot
    const under = [], over = [];
    under.push(['face', `<circle class="clock-face" cx="${c}" cy="${c}" r="${R}"/>`]);
    const labelEvery = ticks <= 24 ? 1 : ticks <= 48 ? 2 : ticks <= 72 ? 4 : 8;
    for (let i = 0; i < ticks; i++) {
      const cents = (i * 1200) / ticks;
      const [x1, y1] = P(cents, 0.94), [x2, y2] = P(cents, 1.0);
      under.push(['t' + i, `<line class="clock-tick${i === 0 ? ' zero' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`]);
      if (i % labelEvery === 0) {
        const [lx, ly] = P(cents, 1.13);
        const label = ticks === 12 ? NAMES[S.mod(root + i, 12)] : i;
        // 12 note names: each plays its tempered note (hold, glide)
        const et = ticks === 12 ? ` data-et="${i}"` : '';
        if (et) under.push(['eh' + i, `<circle class="clock-hit et" cx="${lx}" cy="${ly}" r="12"${et}/>`]);
        under.push(['l' + i, `<text class="clock-label${et ? ' et' : ''}" x="${lx}" y="${ly}" dy="${S.DY_SANS}"${et}>${label}</text>`]);
      }
    }
    for (const p of points) {
      if (!p.attrs) continue;
      const [x, y] = P(p.cents, p.rf ?? 0.82);
      under.push(['h ' + p.attrs, `<circle class="clock-hit" cx="${x}" cy="${y}" r="${Math.max(12, (p.r ?? 7) + 6)}" ${p.attrs}/>`]);
    }
    // the scale on the rim, in every circle
    if (rim) {
      for (const str of S.scale) {
        const r = S.ratio(str), [x, y] = P(r.cents, 1);
        under.push(['rh ' + str, `<circle class="clock-hit rim" cx="${x}" cy="${y}" r="11" data-sr="${str}"/>`]);
        over.push(['r ' + str, `<circle class="clock-dot rim ${r.cls}${S.isSilent(str) ? ' mute' : ''}${str === rimSel ? ' sel' : ''}" cx="${x}" cy="${y}" r="7" data-sr="${str}"/>`]);
      }
    }
    // the selected dot last, so no neighbour covers it
    const isSel = (p) => / sel\b|^sel\b/.test(p.cls || '');
    [...points.filter((q) => !isSel(q)), ...points.filter(isSel)].forEach((p, i) => {
      const [x, y] = P(p.cents, p.rf ?? 0.82), id = p.attrs || i;
      if (p.spoke) {
        const [x0, y0] = P(p.cents, 0.08);
        under.push(['s ' + id, `<line class="clock-spoke ${p.cls || ''}" x1="${x0}" y1="${y0}" x2="${x}" y2="${y}"/>`]);
      }
      over.push(['d ' + id, `<circle class="clock-dot ${p.cls || ''}" cx="${x}" cy="${y}" r="${p.r ?? 7}" ${p.attrs || ''}/>`]);
    });
    const { svg, now } = box, next = new Map(), fresh = [[], []];
    [under, over].forEach((list, top) => list.forEach(([key, html]) => {
      const had = now.get(key);
      if (!had) { fresh[top].push([key, html]); return; }
      if (had.html !== html) { clockUpdate(had.el, html, had.html); had.html = html; }
      next.set(key, had);
      now.delete(key);
    }));
    now.forEach(({ el: gone }) => { unsparkle(gone); gone.remove(); });
    // new pieces: those below the dots go under the first dot; a sounding one lights up once it is in, so it gets its sparks
    const first = svg.querySelector('.clock-dot'), lit = [];
    fresh.forEach((list, top) => {
      if (!list.length) return;
      const made = svgOf(list.map((x) => x[1]).join('')), frag = document.createDocumentFragment();
      [...made.children].forEach((d, i) => {
        next.set(list[i][0], { el: d, html: list[i][1] });
        if (d.classList.contains('hot')) { d.classList.remove('hot'); lit.push(d); }
        frag.appendChild(d);
      });
      svg.insertBefore(frag, top ? null : first);
    });
    box.now = next;
    if (fresh[1].length) { const sel = svg.querySelector(':scope > .clock-dot.sel'); if (sel) raise(sel); }
    lit.forEach((d) => d.classList.add('hot'));
    S.emit('rimsel');   // the scale list marks the row of the selected rim dot
  };

  // A dot that starts sounding moves to the top of its circle, so a
  // neighbour it overlaps never hides it (SVG has no z-index: later siblings paint on top).
  // Sounding dots and nodes also send out a ripple and little sparks until they stop.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sparks = new WeakMap();
  // ripple: its markup; spot(i, a): where spark i leaves from, [x, y, angle, start radius] (a round dot:
  // its centre, r + 2). The group goes into `inside`, before `before` (an interval: under its band)
  const sparkle = (host, inside, cx, cy, ripple, spot, before = null, count = 10) => {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'sparks');
    g.setAttribute('transform', `translate(${cx},${cy})`);
    let h = ripple;
    for (let i = 0; i < count; i++) {
      const [x, y, a, r0] = spot(i, ((i * 360) + (i % 2 ? 140 : 0)) / count);
      const c = `<circle class="spark" r="${i % 3 ? 1.3 : 1.9}" style="--a:${a}deg;--r0:${r0}px;--r1:${r0 + 11 + (i % 3) * 5}px;animation-delay:${(i * 0.137) % 0.9}s"/>`;
      h += x || y ? `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${c}</g>` : c;
    }
    g.innerHTML = h;
    inside.insertBefore(g, before);
    sparks.set(host, g);
  };
  const round = (r) => [`<circle class="ripple" r="${r}" style="--s:${(r + 16) / r}"/>`, (i, a) => [0, 0, a, r + 2]];
  // a pill or button, w × h: the ripple grows 16 every way, sparks leave from its edge
  const boxy = (w, h, rx) => [
    `<rect class="ripple" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${rx}" style="--s:${(w + 32) / w};--sy:${(h + 32) / h}"/>`,
    (i, a) => {
      const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180), t = Math.min(w / 2 / Math.abs(c), h / 2 / Math.abs(s));
      return [c * t, s * t, a, 2];
    },
  ];
  // an interval (Cycle and Spiral arcs): a glow along its band, sparks off both sides of it
  const along = (band) => {
    const w = parseFloat(getComputedStyle(band).strokeWidth) || 4, L = band.getTotalLength();
    return [
      `<path class="ripple line" d="${band.getAttribute('d')}" style="--w0:${w}px;--w1:${w + 18}px"/>`,
      (i, a) => {
        const l = L * (((i * 3) % 10) + 0.5) / 10, p = band.getPointAtLength(l);
        const q0 = band.getPointAtLength(Math.max(0, l - 1)), q1 = band.getPointAtLength(Math.min(L, l + 1));
        const t = Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180 / Math.PI;
        return [p.x, p.y, t + (i % 2 ? 90 : -90) + (a % 36) - 7, w / 2 + 1];
      },
    ];
  };
  // a dot's sparks, so a dot that moves while it sounds (Beats) can take them along
  S.sparksOf = (d) => sparks.get(d);
  const unsparkle = (host) => {
    const g = sparks.get(host);
    if (!g) return;
    sparks.delete(host);
    // a Table number's sparks sit in a little SVG of their own
    const box = g.parentNode && g.parentNode.classList.contains('spark-box') ? g.parentNode : g;
    box.classList.add('out');
    setTimeout(() => box.remove(), 250);
  };
  // a dot to the top of its circle
  const raise = (d) => { if (d.parentNode && d.parentNode.lastElementChild !== d) d.parentNode.appendChild(d); };
  const DOTS = '.clock-dot, .cycle-svg .cdot, .sp-dot, .sdot';
  new MutationObserver((records) => {
    for (const { target: d } of records) {
      if (!d.classList || !d.matches(`${DOTS}, .node, .dcell, .carc, .iarc, .sp-seg, .hnode, .nnum, .kb-key`)) continue;
      const on = d.matches('.hot, .held');
      if (!on) {
        unsparkle(d);
        // once nothing sounds over it, the selected dot is back on top
        const sel = d.classList.contains('clock-dot') && d.parentNode && d.parentNode.querySelector(':scope > .clock-dot.sel');
        if (sel && !sel.matches('.hot, .held')) raise(sel);
        continue;
      }
      // sparks nobody can see cost and show nothing
      if (d.closest('[hidden]') || (d.closest('.panel.side') ? S.sideClosed() : S.mainCovered())) continue;
      if (sparks.has(d)) {
        // a sounding dot that becomes the selected one comes on top at once (Beats while Play sounds)
        if (d.classList.contains('clock-dot') && d.classList.contains('sel')) raise(d);
        continue;
      }
      if (d.matches(DOTS)) {
        const svg = d.parentNode;
        if (!svg) continue;
        raise(d);
        sparkle(d, svg, +d.getAttribute('cx'), +d.getAttribute('cy'), ...round(+d.getAttribute('r')));
      } else if (d.classList.contains('dcell')) {
        // a Diamond cell: on top of its neighbours (before the edge numbers), ripple from its own diamond
        const t = d.querySelector('text'), p = d.querySelector('polygon');
        const head = d.parentNode && d.parentNode.querySelector(':scope > .dlabels, :scope > .dhead');   // under the labels
        if (head) d.parentNode.insertBefore(d, head);
        const cx = +t.getAttribute('x'), cy = +t.getAttribute('y');
        const r = cy - +p.getAttribute('points').split(' ')[0].split(',')[1];
        sparkle(d, d, cx, cy, `<polygon class="ripple" points="0,${-r} ${r},0 0,${r} ${-r},0" style="--s:${(r + 16) / r}"/>`, round(r)[1]);
      } else if (d.matches('.carc, .iarc, .sp-seg')) {
        const band = d.querySelector('.a-band, .sp-band');
        if (!band || !d.parentNode || !band.getTotalLength()) continue;
        sparkle(d, d.parentNode, 0, 0, ...along(band), d);
      } else if (d.classList.contains('hnode')) {
        // a Hasse number: a pill
        const rc = d.querySelector('rect');
        raise(d);
        sparkle(d, d, 0, 0, ...boxy(+rc.getAttribute('width'), +rc.getAttribute('height'), +rc.getAttribute('rx')));
      } else if (d.matches('.nnum, .kb-key')) {
        // a Table number or a key is a button: its sparks in a little SVG at its centre
        const box = document.createElementNS(SVGNS, 'svg');
        box.setAttribute('class', 'spark-box');
        d.appendChild(box);
        sparkle(d, box, 0, 0, ...boxy(d.offsetWidth, d.offsetHeight, 8));
      } else {
        raise(d);
        sparkle(d, d, 0, 0, ...round(+(d.querySelector('.base')?.getAttribute('r') || 22)));
      }
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Text sized with calc(var(--fs-…) * var(--kx)) has one on-screen size in every picture, however
  // large the picture is drawn: each SVG gets --kx/--ky = SVG units per screen pixel (two, because
  // the Spiral chart stretches).
  const kSvgs = new WeakSet();
  const fitK = (svg) => {
    const vb = svg.viewBox && svg.viewBox.baseVal, box = svg.getBoundingClientRect();
    if (!vb || !vb.width || !box.width) return;
    const kx = vb.width / box.width;
    // preserveAspectRatio="none" scales each axis on its own; otherwise both by the same factor
    const ky = svg.getAttribute('preserveAspectRatio') === 'none' ? vb.height / box.height : kx;
    svg.style.setProperty('--kx', kx.toFixed(4));
    svg.style.setProperty('--ky', ky.toFixed(4));
  };
  const kRO = new ResizeObserver((es) => es.forEach((e) => fitK(e.target)));
  const hasSvg = (n) => n.nodeType === 1 && (n.tagName === 'svg' || n.firstElementChild && n.querySelector('svg'));
  new MutationObserver((records) => {
    // most batches are dots and sparks inside an existing picture: no new SVG, no page-wide search
    if (!records.some((r) => [...r.addedNodes].some(hasSvg))) return;
    document.querySelectorAll('svg.clock, svg.lattice-svg, svg.diamond-svg, svg.curve-svg, svg.cycle-svg, svg.spiral-svg').forEach((svg) => {
      if (kSvgs.has(svg)) return;   // its size changing is kRO's: measuring all of them forced a layout on every redraw
      kSvgs.add(svg); kRO.observe(svg);
      fitK(svg);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- the scale list ---------- */

  // a scale note sounding: everything showing that ratio lights up with it, in every tab: list rows,
  // rim dots, the dots inside the circles, lattice nodes, diamond cells, numbers
  // rendering a picture again (a key or row picking its note redraws the circle) keeps the marks:
  // hotCount holds how many sounds mark each ratio, and redrawn elements get them back
  const hotCount = new Map();
  const hotSel = (q) => `.srow[data-r="${q}"], .clock-dot.rim[data-sr="${q}"], :is(.clock-dot, .node, .dcell, .dbar, .cdot, .sp-dot, .nnum, .hnode, .sdot)[data-r="${q}"]`;
  // one search for all of them: it walks the whole page, thousands of dots in a full Scatter
  const hotAll = (strs, within = document) => within.querySelectorAll([...strs].map((s) => hotSel(CSS.escape(s))).join(','));
  S.markScale = (strs, on) => {
    const changed = new Set();
    for (const str of strs) {
      if (!on && !hotCount.has(str)) continue;
      const n = (hotCount.get(str) || 0) + (on ? 1 : -1);
      if (n > 0) hotCount.set(str, n); else hotCount.delete(str);
      if (on || n <= 0) changed.add(str);
    }
    if (changed.size) hotAll(changed).forEach((x) => x.classList.toggle('hot', on));
  };
  // only for something new that shows a note, not for a sounding dot's own sparks or its coming to the top
  const showsNote = (x) => x.nodeType === 1 && !x.classList.contains('hot') && !x.matches('.sparks, .spark-box') && (x.matches('[data-r], [data-sr]') || x.querySelector('[data-r], [data-sr]'));
  new MutationObserver((records) => {
    if (!hotCount.size) return;
    // only inside what was added: a redrawn circle needn't search a full Scatter
    const fresh = new Set(records.flatMap((r) => [...r.addedNodes].filter(showsNote)).map((x) => x.parentNode));
    fresh.forEach((box) => { if (box) hotAll(hotCount.keys(), box).forEach((y) => { if (!y.classList.contains('hot')) y.classList.add('hot'); }); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  // the same from a key or MIDI note: a frame drawn between two notes of a chord holds up the next one, so all
  // that came within a few ms light up at once
  const hotWait = new Map();
  const markLater = (strs, on) => {
    strs.forEach((str) => hotWait.set(str, (hotWait.get(str) || 0) + (on ? 1 : -1)));
    S.later('hot', () => {
      const all = [...hotWait];
      hotWait.clear();
      [true, false].forEach((on) => S.markScale(all.flatMap(([str, n]) => (n > 0 === on ? Array(Math.abs(n)).fill(str) : [])), on));
    }, S.LATER.HOT);
  };
  S.on('panic', () => hotWait.clear());
  // notes held on into a view or drawer that just showed: their sparks, which hidden dots didn't get
  S.on('shown', () => { if (hotCount.size) hotAll(hotCount.keys()).forEach((x) => { x.classList.remove('hot'); x.classList.add('hot'); }); });
  S.on('panic', () => { const strs = [...hotCount.keys()]; hotCount.clear(); strs.forEach((str) => document.querySelectorAll(hotSel(CSS.escape(str))).forEach((x) => x.classList.remove('hot'))); });
  // any tab playing ratios: those in the scale light up on the rim and in the list too
  // (turning off skips the filter, so a note taken out of the scale while sounding still goes dark)
  S.scaleHot = (strs, on) => { const rs = on ? strs.filter(S.inScale) : strs; if (rs.length) S.markScale(rs, on); };
  S.playScaleNotes = (strs, opt = {}) => {
    const ch = S.audio.chord(strs.map((s, i) => S.ratioFreq(s, opt.octs ? opt.octs[i] : 0)), { vel: opt.vel ?? 1 });
    const mark = opt.later ? markLater : S.markScale;
    mark(strs, true);
    // a stop may come twice (S.holdOn calls a released press's stop again to cut its tail): the mark goes once, or
    // a key's second 'off' cancels the next press's 'on' waiting with it in markLater (the row lit only the first time)
    let marked = true;
    return () => { ch.stop(); if (marked) { marked = false; mark(strs, false); } };
  };
  // Arrow keys: → ↑ one step on, ← ↓ one back. A selection reached by arrow sounds as a click: the
  // press minimum, 50 ms, as a quick mouse click. On a note picked on the rim (or in the list), every view walks the rim: the scale.
  S.ARROWS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
  // a fresh click cuts what the last one left ringing, as a fresh press does in S.holdOn
  let clickTail = null;
  S.click = (fn) => {
    if (clickTail) S.audio.immediately(clickTail);
    const stop = S.audio.press(fn);
    clickTail = typeof stop === 'function' ? stop : null;
    if (clickTail) clickTail();
  };
  S.rimStep = (str, d) => {
    const ns = S.scale;
    if (!ns.length) return false;
    const r = str && S.ratio(str);
    let i = r ? ns.indexOf(S.noteKey(str)) : d > 0 ? -1 : 0;   // nothing picked: from the scale's ends
    if (i < 0 && r) {   // a picked note no longer in the scale: the next one above or below it
      const c = r.cents, j = ns.findIndex((s) => S.ratio(s).cents > c);
      i = d > 0 ? (j < 0 ? ns.length : j) - 1 : (j < 0 ? ns.length : j);
    }
    const next = ns[S.mod(i + d, ns.length)];
    S.emit('pick', next);
    S.click(() => S.playScaleNotes([next]));
    return true;
  };
  // the element nearest from one in an arrow's direction, by where they are on screen (Numbers)
  S.spatialStep = (from, els, code) => {
    const [ux, uy] = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[code];
    const mid = (e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    const [x0, y0] = mid(from);
    // ahead, within a cone of about ±63°; with nothing there, anywhere ahead
    let best = null, bs = Infinity, wide = null, ws = Infinity;
    for (const e of els) {
      if (e === from) continue;
      const [x, y] = mid(e), a = (x - x0) * ux + (y - y0) * uy, p = Math.abs((x - x0) * uy - (y - y0) * ux);
      if (a < 1) continue;
      const s = a + 2 * p;
      if (p <= 2 * a) { if (s < bs) { bs = s; best = e; } }
      else if (s < ws) { ws = s; wide = e; }
    }
    return best || wide;
  };
  // "Scale" in every tab plays the scale, the notes on the rim, up to the octave; pressed again it stops
  // Edit (Lattice, Diamond): on, tapping or dragging over notes adds them to Just intonation's notes or removes them;
  // one state for both, so every switch shows it and every view hears it ('edit')
  S.EDIT_BTN = '<button class="btn quiet" data-act="edit" aria-pressed="false">Edit</button>';
  S.editing = false;
  const editShow = (b) => { b.classList.toggle('on', S.editing); b.setAttribute('aria-pressed', S.editing); };
  S.editSwitch = (root, onChange) => {
    const b = root.querySelector('[data-act="edit"]');
    editShow(b); onChange(S.editing);
    S.on('edit', onChange);
    b.addEventListener('click', (e) => {
      S.editing = !S.editing;
      if (e.detail) b.blur();   // clicked: from the keyboard the focus stays to go on from
      document.querySelectorAll('[data-act="edit"]').forEach(editShow);
      S.emit('edit', S.editing);
    });
  };
  // one pace for every run of notes (Scale, Spiral's Stack and Scale): faster when there are many
  S.seqPace = (n) => ({ step: n > 17 ? 0.16 : 0.26, len: 0.45 });
  // every button that plays a run of notes (Scale, Just intonation's Scale, the Cycle's Chain and Scale, the Spiral's Path
  // and Scale) starts on the press, as Chord does (a click waits for the release), Enter and Space too; a press while
  // it runs stops it. Each looks held while its run sounds (its view toggles 'held')
  S.seqBtn = (btn, play) => {
    btn.addEventListener('pointerdown', (e) => { if (e.button === 0) play(); });
    btn.addEventListener('click', (e) => { if (e.detail === 0) play(); });
  };
  S.SCALE_BTN = '<button class="btn quiet" data-play-scale><span class="ico seq"></span>Scale</button>';
  let scaleRun = null;
  // while it runs every Scale button looks held, as Chord does while held
  const scaleLit = (on) => document.querySelectorAll('[data-play-scale]').forEach((b) => b.classList.toggle('held', on));
  // restart: start over even if it is running (a preset just changed the scale)
  S.playScale = (restart = false) => {
    if (scaleRun) { scaleRun(); scaleRun = null; scaleLit(false); if (!restart) return; }
    const ns = [...S.scale];
    if (!S.audible().length) return;
    // each note looks at the mutes when its turn comes, so muting while it runs takes effect at once;
    // it ends on the lowest note sounding by then, an octave up
    let last = null, cur = null;
    const at = (str, oct) => () => {
      cur = str && S.inScale(str) && !S.isSilent(str) ? str : null;
      return cur && S.ratioFreq(cur, oct);
    };
    scaleRun = S.audio.sequence([...ns.map((r) => at(r, 0)), () => at(S.audible()[0], 1)()], {
      ...S.seqPace(ns.length + 1),
      onStep: (i) => {
        if (last) S.markScale([last], false);
        if (i < 0) { scaleRun = null; last = null; scaleLit(false); return; }
        last = cur; if (last) S.markScale([last], true);
      },
    });
    scaleLit(true);
  };
  S.stopScale = () => { if (scaleRun) { scaleRun(); scaleRun = null; scaleLit(false); } };
  // over Just intonation's pictures, as over the Cycle's: Scale for the notes chosen on the left
  // the link with the scale: in the gap beside the side panel, beside the preset menu (discover.js) where that panel is a drawer
  const linkBtn = (cls) => `<button class="icon-btn link-btn ${cls}" data-jilink title="Link with scale" aria-label="Link with scale" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><g class="linked"><path d="M10 14a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.2-1.2"/></g>` +
    // unlinked: the chain broken, its two ends apart, a crack between them
    `<g class="broken"><path d="M18.8 12.3l1.8-1.8a5 5 0 0 0-7.1-7.1l-1.8 1.8"/><path d="M5.2 11.7l-1.8 1.8a5 5 0 0 0 7.1 7.1l1.8-1.8"/><path d="M8 2v3M2 8h3M16 19v3M19 16h3"/></g></svg></button>`;
  S.jiHead = (lead = '') => `<div class="toolbar chart-head">${lead}<span class="head-btns"><button class="btn quiet" data-act="jscale"><span class="ico seq"></span>Scale</button></span></div>`;
  S.JI_LINK = linkBtn('in-menu');
  S.jiFig = (inner) => `<div class="ji-fig">${inner}${linkBtn('in-gap')}</div>`;
  let jiRun = null;
  const jiLit = (on) => document.querySelectorAll('[data-act="jscale"]').forEach((b) => b.classList.toggle('held', on));
  S.stopJi = () => { if (jiRun) { jiRun(); jiRun = null; jiLit(false); } };
  const playJi = () => {
    if (jiRun) { S.stopJi(); return; }
    const ns = [...S.ji.notes];
    if (!ns.length) return;
    let last = null;
    jiRun = S.audio.sequence([...ns.map((r) => S.ratioFreq(r, 0)), S.ratioFreq(ns[0], 1)], {
      ...S.seqPace(ns.length + 1),
      onStep: (i) => {
        if (last) S.markScale([last], false);
        if (i < 0 || i > ns.length) { last = null; if (i < 0) { jiRun = null; jiLit(false); } return; }
        last = ns[i % ns.length]; S.markScale([last], true);
      },
    });
    jiLit(true);
  };
  S.jiWire = (root) => {
    S.seqBtn(root.querySelector('[data-act="jscale"]'), playJi);
    S.markLink();
  };
  S.markLink = () => document.querySelectorAll('[data-jilink]').forEach((b) => { b.classList.toggle('on', S.ji.linked); b.setAttribute('aria-pressed', S.ji.linked); b.title = S.ji.linked ? 'Unlink from scale' : 'Link with scale'; });
  S.on('jilink', S.markLink);
  // a note as text to copy, each in a form the note fields read back: a ratio as its numbers (12009693184/11717731181)
  // while they have at most S.COPY_DIGITS digits, factored (2¹³·67·21881 / 13·211·877·4871) and its exact cents; k\N and
  // its cents; cents. Forms that read alike once spaces go are one (3/2 and 3 / 2), and the 1/1 has nothing to factor.
  // Longer numbers only factored: 3¹⁰⁰⁰⁰⁰ written out is 48 000 digits, and making them took seconds
  S.COPY_DIGITS = 100;
  S.noteCopies = (str) => {
    const r = S.ratio(str), out = [];
    if (!r) return out;
    const add = (t) => { if (!out.some((x) => x.replace(/\s/g, '') === t.replace(/\s/g, ''))) out.push(t); };
    if (r.e) {
      const nd = S.qND(r.e, S.COPY_DIGITS);
      if (nd) add(`${nd[0]}/${nd[1]}`);
      if (Object.keys(r.e).length) add(S.fmtMonzo(r.e));
    } else if (r.edo) add(r.label);
    add(`${S.roundC(r.cents)}¢`);
    return out;
  };
  // the one form Ctrl+C copies, and an edited note starts from: the numbers while short (S.Q_DIGITS), else factored
  S.noteText = (str) => {
    const r = S.ratio(str);
    if (!r) return '';
    if (r.e) return S.qND(r.e, S.Q_DIGITS) ? S.noteCopies(str)[0] : S.fmtMonzo(r.e);
    return r.edo ? r.label : `${S.roundC(r.cents)}¢`;
  };
  // a short word at the foot of the screen that something happened out of sight (a copy), gone after a moment
  let toastEl = null, toastT = 0;
  S.toast = (msg) => {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 1600);
  };
  // onto the clipboard; outside https (a phone on the LAN) the clipboard API is missing, a hidden field copies instead
  S.copyText = (text) => {
    const done = () => S.toast(`Copied ${text}`);
    const old = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0;';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      ok ? done() : S.toast('Couldn’t copy');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, old);
    else old();
  };
  // Ctrl+C / ⌘C with nothing selected and no field focused (app.js): the selected note (S.note), as S.noteText writes it.
  // From the keydown, not the copy event: Safari fires none while nothing is selected
  S.copyNote = () => {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return false;
    const text = S.note && S.noteText(S.note.str);
    if (!text) return false;
    S.copyText(text);
    return true;
  };
  // a small menu under a button, in the look of the dropdowns' list: items [{ label, value?, cls?, act }], null a rule
  // between them. Shut by a choice, a press elsewhere, Esc, a scroll or a resize; opened from the keyboard, its first
  // item has the focus, and shutting gives it back to the button
  let notePop = null;
  const shutNotePop = (refocus) => {
    if (!notePop) return;
    const { pop, btn } = notePop;
    notePop = null;
    pop.remove();
    btn.setAttribute('aria-expanded', 'false');
    if (refocus && document.contains(btn)) btn.focus();
  };
  S.openMenu = (btn, items, byKey) => {
    const again = notePop && notePop.btn === btn;
    shutNotePop(false);
    if (again) return;
    const pop = document.createElement('div');
    pop.className = 'sel-pop note-pop';
    pop.setAttribute('role', 'menu');
    pop.innerHTML = items.map((it, i) => (it ? `<button class="sel-opt${it.cls ? ' ' + it.cls : ''}" role="menuitem" data-i="${i}"><span>${S.esc(it.label)}</span>${it.value ? `<span class="mi-v">${S.labelHTML(it.value)}</span>` : ''}</button>` : '<div class="mi-sep" role="separator"></div>')).join('');
    document.body.append(pop);
    const box = btn.getBoundingClientRect(), edge = 8, w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${S.clamp(box.right - w, edge, Math.max(edge, innerWidth - w - edge))}px`;
    pop.style.top = `${box.bottom + 4 + h <= innerHeight - edge || box.top - 4 - h < edge ? box.bottom + 4 : box.top - 4 - h}px`;
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    pop.addEventListener('click', (e) => {
      const o = e.target.closest('[data-i]');
      if (!o) return;
      shutNotePop(e.detail === 0);
      items[+o.dataset.i].act(e.detail === 0);   // chosen from the keyboard (Enter, Space)
    });
    notePop = { pop, btn, at: box.top + ',' + box.left };
    btn.setAttribute('aria-expanded', 'true');
    if (byKey) pop.querySelector('button').focus();
  };
  // on the window, first: the list's buttons keep their presses from the document (M, ⋮), and a press on M shuts it too
  window.addEventListener('pointerdown', (e) => { if (notePop && !notePop.btn.contains(e.target) && !notePop.pop.contains(e.target)) shutNotePop(false); }, true);
  // a scroll that moved its button away (one landing just after it opened, from a scroll that brought the button into view, left it where it was)
  window.addEventListener('scroll', (e) => {
    if (!notePop || notePop.pop.contains(e.target)) return;
    const b = notePop.btn.getBoundingClientRect();
    if (b.top + ',' + b.left !== notePop.at) shutNotePop(false);
  }, true);
  window.addEventListener('resize', () => shutNotePop(false));
  S.on('panic', () => shutNotePop(true));   // Esc
  // ↑ ↓ (Home, End) move through its items, stopping at the ends as the dropdowns' list does; from its button (opened
  // with a mouse) ↓ goes to the first, ↑ to the last. Enter or Space chooses. The views never see these arrows
  window.addEventListener('keydown', (e) => {
    if (!notePop || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const opts = [...notePop.pop.querySelectorAll('.sel-opt')], i = opts.indexOf(document.activeElement);
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1
      : i < 0 ? (e.key === 'ArrowDown' ? 0 : opts.length - 1) : S.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, opts.length - 1);
    opts[to].focus();
  }, true);

  // the link's direction, in the look of the dropdowns' list
  let wayPop = null;
  const shutWay = () => { if (wayPop) { wayPop.remove(); wayPop = null; } };
  const askWay = (b) => {
    wayPop = document.createElement('div');
    wayPop.className = 'sel-pop way-pop';
    const arr = '<svg class="arr" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6H10.5M6.5 2L10.5 6L6.5 10"/></svg>';
    wayPop.innerHTML = `<button class="sel-opt" data-way="to">${arr}Use as scale</button><button class="sel-opt" data-way="from">${arr}From scale</button>`;
    document.body.append(wayPop);
    const box = b.getBoundingClientRect(), edge = 8;
    wayPop.style.left = `${S.clamp(box.left, edge, Math.max(edge, innerWidth - wayPop.offsetWidth - edge))}px`;
    wayPop.style.top = `${box.bottom + 4}px`;
    wayPop.addEventListener('pointerdown', (e) => e.stopPropagation());
    wayPop.addEventListener('click', (e) => {
      const o = e.target.closest('[data-way]');
      if (!o) return;
      shutWay();
      o.dataset.way === 'to' ? S.ji.linkTo() : S.ji.linkFrom();
    });
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-jilink]');
    if (!b) return;
    const open = wayPop;
    shutWay();
    if (open) return;
    if (S.ji.linked) { S.ji.setLinked(false); return; }
    const way = S.ji.linkWay();
    if (way === 'same') S.ji.setLinked(true);
    else if (way === 'to') S.ji.linkTo();
    else if (way === 'from') S.ji.linkFrom();
    else askWay(b);
  });
  document.addEventListener('pointerdown', (e) => { if (wayPop && !e.target.closest('[data-jilink]')) shutWay(); });
  window.addEventListener('scroll', shutWay, true);
  window.addEventListener('resize', shutWay);
  S.on('panic', shutWay);
  // starts on press, like Chord (a click waits for the release); Enter on the focused button still works
  document.addEventListener('pointerdown', (e) => { if (e.button === 0 && e.target.closest('[data-play-scale]')) S.playScale(); });
  document.addEventListener('click', (e) => { if (e.detail === 0 && e.target.closest('[data-play-scale]')) S.playScale(); });
  // Chord: the whole scale at once (every tab with a scale list, next to Scale), while held; it follows mutes and scale edits
  S.CHORD_BTN = '<button class="btn quiet" data-chord><span class="ico chord"></span>Chord</button>';
  // the top of every side panel: the readout (pinned to the window's bottom on narrow windows) and Chord and Scale.
  // reads: the readout box's content (the sub-tabs add one readout per sub-view later)
  S.sideTop = (reads = '') => `<div class="side-top"><div data-reads data-pin>${reads}</div><div class="toolbar side-head">${S.CHORD_BTN}${S.SCALE_BTN}</div></div>`;
  // while held it follows the mutes (and removals): a muted note's voice stops, an unmuted one starts
  S.playChord = () => {
    const ns = S.audible();
    if (!ns.length) return null;
    const on = new Map();
    let gain = null;
    const sync = () => {
      const want = new Set(S.audible()), g = S.gainOf(want.size);
      on.forEach((v, str) => { if (!want.has(str)) { v.stop(); on.delete(str); S.markScale([str], false); } });
      // one loudness for the whole chord, however many notes it has by now
      if (g !== gain) { gain = g; on.forEach((v) => v.setGain(g)); }
      want.forEach((str) => { if (!on.has(str)) { on.set(str, S.audio.tone(S.ratioFreq(str), { gain })); S.markScale([str], true); } });
    };
    const quit = () => { S.off('scale', sync); S.off('panic', quit); };   // Stop: no note comes back
    sync();
    S.on('scale', sync); S.on('panic', quit);
    return () => { quit(); on.forEach((v) => v.stop()); S.markScale([...on.keys()], false); on.clear(); };
  };
  let chordOn = null;
  const chordLit = (on) => document.querySelectorAll('[data-chord]').forEach((b) => b.classList.toggle('held', on));   // playing, as Scale
  S.stopChord = () => { if (chordOn) { chordOn(); chordOn = null; chordLit(false); } };
  // Chord on a scale gathered from the harmonics (five of the first 16's eight tones or more, at most one note besides; a preset as it stands doesn't count):
  // while it sounds, the rim itself sends out a sounding dot's ripple and sparks, also on a circle drawn anew meanwhile
  const SERIES = ['1/1', '9/8', '5/4', '11/8', '3/2', '13/8', '7/4', '15/8'];
  const isSeries = () => {
    const ns = S.audible();
    return ns.length >= 5 && ns.every((x) => SERIES.includes(x)) && !S.views.discover.isPreset(ns);
  };
  // each stretch of the ring has the colour of the sounding notes beside it, blending from one dot to the next
  const RIM_ARCS = 120;
  const rimNotes = () => S.audible().map((str) => {
    const r = S.ratio(str);
    return { a: (r.cents * .3 + 270) % 360, c: `var(--${r.temp ? 'ink-2' : r.cls})` };   // 0¢ at the top
  }).sort((x, y) => x.a - y.a);
  const rimColour = (ns, a) => {
    if (!ns.length) return 'var(--ink-2)';
    const k = ns.findIndex((n) => n.a > a), to = ns[k < 0 ? 0 : k], from = ns[((k < 0 ? 0 : k) + ns.length - 1) % ns.length];
    const gap = (to.a - from.a + 360) % 360 || 360;
    return `color-mix(in oklab, ${to.c} ${((a - from.a + 360) % 360 / gap * 100).toFixed(1)}%, ${from.c})`;
  };
  const rimPaint = (g) => {
    const key = S.audible().join();
    if (g.dataset.notes === key) return;
    g.dataset.notes = key;
    const ns = rimNotes();
    g.querySelectorAll('.ripple.rim path').forEach((arc, i) => { arc.style.stroke = rimColour(ns, (i + .5) * 360 / RIM_ARCS); });
    g.querySelectorAll('.spark').forEach((sp) => { sp.style.fill = rimColour(ns, (parseFloat(sp.style.getPropertyValue('--a')) + 360) % 360); });
  };
  const rimArcs = (r) => Array.from({ length: RIM_ARCS }, (_, i) => {
    const pt = (a) => `${(r * Math.cos(a * Math.PI / 180)).toFixed(2)} ${(r * Math.sin(a * Math.PI / 180)).toFixed(2)}`, w = 360 / RIM_ARCS;
    return `<path d="M${pt(i * w)}A${r} ${r} 0 0 1 ${pt((i + 1) * w + .3)}"/>`;   // a little over, so no seams
  }).join('');
  // the rule and the colours follow the notes while the chord sounds; a circle drawn anew gets its ring back
  let rimOn = false;
  const rimDraw = () => {
    if (rimOn) document.querySelectorAll('.clock').forEach((svg) => {
      const face = svg.querySelector('.clock-face');
      if (!face) return;
      const c = +face.getAttribute('cx'), r = +face.getAttribute('r');
      if (!sparks.has(svg)) sparkle(svg, svg, c, c, `<g class="ripple rim" style="--s:${(r + 16) / r}">${rimArcs(r)}</g>`, round(r)[1], null, 72);
      rimPaint(sparks.get(svg));
    });
  };
  const rimSync = () => {
    rimOn = isSeries();
    if (!rimOn) document.querySelectorAll('.clock').forEach(unsparkle);
    rimDraw();
  };
  const rimWatch = new MutationObserver(rimDraw);
  const rimStop = () => { S.off('scale', rimSync); rimWatch.disconnect(); rimOn = false; document.querySelectorAll('.clock').forEach(unsparkle); };
  const chordRim = () => {
    const stop = S.playChord();
    if (!stop) return stop;
    rimSync();
    S.on('scale', rimSync);
    rimWatch.observe(document.body, { childList: true, subtree: true });
    return () => { stop(); rimStop(); };
  };
  S.on('panic', rimStop);
  S.playHold('[data-chord]', () => { chordOn = S.audio.press(chordRim); if (chordOn) chordLit(true); }, S.stopChord);
  S.on('panic', S.stopChord);
  // the scale's sounds go on across tabs: a view opened for the first time shows them too
  S.on('shown', () => { scaleLit(!!scaleRun); chordLit(!!chordOn); });

  // rim dots play their note; the note names around the circle play the 12-TET notes above the 1/1
  const rimPlay = (d) => S.playScaleNotes([d.dataset.sr]);
  const etPlay = (d) => {
    const i = +d.dataset.et, lab = d.closest('svg').querySelector(`.clock-label[data-et="${i}"]`);
    const ch = S.audio.chord([S.baseFreq() * 2 ** (i / 12)]);
    lab.classList.add('hot');
    return () => { ch.stop(); lab.classList.remove('hot'); };
  };
  // a circle's own dots (sel) plus its rim and note names, in one holdOn, so a held press glides
  // across all of them; such a circle is marked .own-rim (EDO handles its rim itself). pick (given: the view
  // selects rim notes): a pressed rim note or note name (its 12-TET note, k\12) is picked, 'pick', as a list row is, so
  // the shared note follows too (only the view's own callback ran: its readout moved, S.note stayed); the view's
  // 'pick' listener selects it
  S.clockHold = (el, sel, start, pick = null) => {
    el.classList.add('own-rim');
    // while held, what is above the circle keeps its height, so the circle stays under the pointer: a long
    // ratio's headline wraps to more lines (a Spiral of 600 steps moved it 118 px mid-glide); it settles on release.
    // The headline keeps the lines it had (.hold: cut with an ellipsis), the box its height (whatever else wraps)
    const top = () => el.closest('.panel')?.querySelector('.side-top');
    const unlock = () => { const t = top(); if (t) { t.classList.remove('hold'); t.style.height = ''; t.style.removeProperty('--hl-lines'); } };
    el.addEventListener('pointerdown', () => {
      const t = top();
      if (!t || t.classList.contains('hold')) return;
      const hl = t.querySelector('.readout .hl');
      t.style.setProperty('--hl-lines', Math.max(1, Math.round((hl?.offsetHeight || 36) / 36)));
      t.style.height = `${t.offsetHeight}px`;
      t.classList.add('hold');
    }, true);
    window.addEventListener('pointerup', unlock);
    window.addEventListener('pointercancel', unlock);
    S.on('release', unlock);
    S.holdOn(el, `${sel}, .rim, [data-et]`, (d, e, glided) => {
      S.note.oct = 0;   // whatever it is, it sounds folded
      if (d.matches('[data-et]')) { if (pick) S.emit('pick', S.edoKey(+d.dataset.et, 12)); return etPlay(d); }
      if (d.matches('.rim')) { if (pick) S.emit('pick', d.dataset.sr); return rimPlay(d); }
      return start(d, e, glided);
    });
  };
  S.holdOn(document.documentElement, '.clockwrap:not(.own-rim) .rim', rimPlay);
  // the readout's headline ratio plays its note
  S.holdOn(document.documentElement, '[data-ro]', (d) => S.playNote(d.dataset.ro));
  // touch screens show no tooltips: a tap on a readout's cents or deviation (or a .has-tip, the Spiral's length) shows its title (every digit) in a box
  // above it, until the next touch anywhere but on it (a long press on it selects its value, to copy); a mouse keeps the
  // tooltip (the user: only on touch, so the tooltips stay one kind)
  let tip = null, tipOf = null, tipAgain = false;
  const untip = () => { tip?.remove(); tip = tipOf = null; };
  document.addEventListener('pointerdown', (e) => {
    if (tip && tip.contains(e.target)) return;
    tipAgain = !!tipOf && tipOf.contains(e.target);
    if (tip) untip();
  }, true);
  document.addEventListener('pointerup', (e) => {
    const t = e.pointerType === 'touch' && e.target.closest('.readout .sub [title], .has-tip[title]');
    if (!t || tipAgain) return;   // a second tap on it closes it
    tip = document.createElement('div');
    tip.className = 'tip-pop';
    tip.textContent = t.title;
    document.body.appendChild(tip);
    tipOf = t;
    const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${S.clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
    tip.style.top = `${r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6}px`;
  });
  window.addEventListener('scroll', untip, true);

  // The list under each circle: one row per note (name ± deviation, ratio, cents) and the step to
  // the next between rows; hold a row or a step to hear it, glide along; ⋮ opens the note's menu: edit it
  // in place, copy it (S.noteCopies), delete it.
  // M mutes a note, as on a mixer channel (Scale, Chord and the keys skip it; the steps join the
  // sounding notes), and brings it back.
  // the scale as a Scala file (.scl): the notes that sound, the 1/1 implicit as degree 0, 2/1 the last; a ratio stays
  // a ratio while both sides fit 32 bits (what Scala and most synths read), else cents, which need a point
  const SCL_INT = 2 ** 31 - 1;
  S.sclText = (name) => {
    const ns = S.audible().filter((x) => x !== '1/1');
    const pitch = (str) => {
      const r = S.ratio(str);
      if (!r.temp && r.nd && r.nd[0] <= SCL_INT && r.nd[1] <= SCL_INT) return `${r.nd[0]}/${r.nd[1]}`;
      return r.cents.toFixed(6);
    };
    const hz = S.fmtHz(S.baseFreq()), lines = [
      `! ${name}.scl`,
      `! 1/1 = ${S.midiName(S.settings.base)} = ${hz} Hz`,
      '!',
      location.href.length <= 2000 ? location.href : name,
      ` ${ns.length + 1}`,
      '!',
      ...ns.map((x) => ` ${pitch(x)}`),
      ' 2/1',
    ];
    return lines.join('\r\n') + '\r\n';
  };
  S.saveScl = () => {
    if (S.link) S.link.write();   // the address the file names: an edit's write may still be waiting
    const J = S.views.discover, name = (J && J.presetOf && J.presetOf(S.audible())) || 'scale';
    const file = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'scale';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([S.sclText(name)], { type: 'text/plain' }));
    a.download = `${file}.scl`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  S.scaleList = (el) => {
    el.classList.add('scale-list');
    // the row marked (.sel) is the selected rim dot's, in the shown circle of this panel: a note selected inside the
    // circle (an inner dot, a lattice node) marks no row
    let side = null;
    const rimSel = () => {
      if (!side || !side.contains(el)) { side = el.parentElement; while (side && !side.querySelector('.clock')) side = side.parentElement; }
      const clock = side && [...side.querySelectorAll('.clock')].find((c) => !c.closest('[hidden]'));
      const dot = clock && clock.querySelector('.clock-dot.rim.sel');
      return dot ? dot.dataset.sr : null;
    };
    const kb = document.createElement('div');
    S.keyboard(kb);
    // a note typed straight into the scale (5/4, 700, 7\12, 3^5/2^7): Enter adds it, picks it and plays it, and the
    // field stays for the next; drawn once, as the keyboard, so a re-render keeps its focus and text
    const add = document.createElement('div');
    add.className = 'sadd';
    add.innerHTML = '<input type="search" enterkeyhint="done" class="ratio-in sadd-in" placeholder="+ p/q, ¢ or k\\N ⏎" spellcheck="false" autocomplete="off" aria-label="Add a note to the scale: p/q, cents or k\\N, Enter to add">';
    const addIn = add.firstChild;
    addIn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return;   // Stop, and the field lets go (app.js)
      e.stopPropagation();   // letters are text here, not piano keys
      if (e.key !== 'Enter' || e.repeat) return;
      e.preventDefault();
      const str = S.noteKey(S.parseNote(addIn.value) || '');
      if (!str) { addIn.classList.add('bad'); return; }
      const note = str === '2/1' ? '1/1' : str;
      addIn.value = '';
      S.addToScale(note);
      S.emit('pick', note);
      S.click(() => S.playScaleNotes([note]));
    });
    addIn.addEventListener('keyup', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    addIn.addEventListener('input', () => addIn.classList.remove('bad'));
    // a note changed in place (its menu's Edit): its ratio becomes a field holding it as Ctrl+C copies it. Enter puts what
    // it reads as in the note's place (muted if it was, one undo), picks it and plays it, as the add field does; Esc or
    // leaving the field keeps the note
    // Chosen from the keyboard, Enter gives the focus to the new note's ⋮, to go on from there; chosen with a mouse or a
    // finger, the focus just leaves (no ring on the ⋮, and a phone's keyboard goes)
    let editing = null, editByKey = false;
    const edit = (str, byKey) => {
      editing = str;
      editByKey = byKey;
      render();
      const inp = el.querySelector('.srow-edit');
      if (inp) { inp.focus(); inp.select(); }
    };
    const endEdit = () => { if (editing === null) return; editing = null; render(); };
    const commit = (inp) => {
      const old = editing, key = S.parseNote(inp.value), str = key === '2/1' ? '1/1' : key;
      if (!str) { inp.classList.add('bad'); return; }
      editing = null;
      if (str === old) render();
      else S.setScale(S.scale.map((x) => (x === old ? str : x)), [...S.silent].map((x) => (x === old ? str : x)));
      S.emit('pick', str);
      S.click(() => S.playScaleNotes([str]));   // heard, as a note typed into the add field is
      if (editByKey) el.querySelector(`[data-more="${CSS.escape(str)}"]`)?.focus();
      else inp.blur();
    };
    el.addEventListener('keydown', (e) => {
      const inp = e.target.closest('.srow-edit');
      if (!inp || e.key === 'Escape') return;   // Esc: Stop, and the field lets go (app.js), which ends the edit
      e.stopPropagation();   // letters are text here, not piano keys
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); commit(inp); }
    });
    el.addEventListener('keyup', (e) => { if (e.key !== 'Escape' && e.target.closest('.srow-edit')) e.stopPropagation(); });
    el.addEventListener('input', (e) => e.target.classList.contains('srow-edit') && e.target.classList.remove('bad'));
    el.addEventListener('focusout', (e) => { if (e.target.classList.contains('srow-edit')) setTimeout(endEdit); });
    // ⋮: the note's menu
    const menu = (btn, byKey) => {
      const str = btn.dataset.more;
      S.openMenu(btn, [
        { label: 'Edit', act: (byKey) => edit(str, byKey) },
        null,
        ...S.noteCopies(str).map((t) => ({ label: 'Copy', value: t, act: () => S.copyText(t) })),
        null,
        { label: 'Remove', cls: 'danger', act: () => S.removeFromScale(str) },
      ], byKey);
    };
    // patched, not rebuilt: a button pressed with Enter or tapped stays the one it was (its focus, its on edge at once)
    const render = () => {
      S.patch(el, html(), [kb, add]);
      const head = el.firstElementChild;
      if (head.nextSibling !== kb || kb.nextSibling !== add) head.after(kb, add);   // the keyboard under the head, then the field, kept as they are (a held key stays held)
      fit();
    };
    // tight only when the list's own columns would make it wider than its panel (style.css, .scale-list.tight): a
    // number too long for the ratio column; measured untight each time, on each change and each change of width
    const fit = () => {
      el.classList.remove('tight');
      if (el.scrollWidth > el.clientWidth + 0.5) el.classList.add('tight');
    };
    let fitW = -1;
    new ResizeObserver(() => { if (el.clientWidth !== fitW) { fitW = el.clientWidth; fit(); } }).observe(el);
    const html = () => {
      const ns = S.scale, au = S.audible(), sel = rimSel();
      // empty: the head stays, its Clear greyed out
      const head = `<div class="list-head"><h3>Scale</h3><span class="list-btns">${KB_BTN()}<button class="icon-btn undo-btn" data-undo title="Undo" aria-label="Undo"${S.canUndoScale() ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button><button class="icon-btn undo-btn redo-btn" data-redo title="Redo" aria-label="Redo"${S.canRedoScale() ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></button><button class="btn quiet clear-btn" data-clear${ns.length ? '' : ' disabled'}>Clear</button></span></div>`;
      if (!ns.length) return head;
      let rows = '';
      ns.forEach((str) => {
        const r = S.ratio(str), sp = S.spell(str), i = au.indexOf(str), mute = i < 0;
        rows += `<div class="srow ${r.cls}${mute ? ' mute' : ''}${str === sel ? ' sel' : ''}" data-r="${str}">
          <button class="smute" data-mute="${str}" aria-pressed="${mute}" aria-label="mute ${str}" title="Mute">M</button>
          <b>${S.labelHTML(sp.name)}</b><span></span>
          ${str === editing ? `<input type="text" class="ratio-in srow-edit" value="${S.esc(S.noteText(str))}" enterkeyhint="done" spellcheck="false" autocomplete="off" aria-label="Change ${str}: p/q, cents or k\\N, Enter to change, Esc to keep">`
            : `<span class="mono"${S.ndTip(r) ? ` title="${S.ndTip(r)}"` : ''}>${S.breakHTML(S.labelHTML(r.label))}</span>`}
          <span class="mono num" title="${S.exactC(r.cents)}">${S.fmtC(r.cents)}</span>
          <span class="mono num dev ${Math.abs(sp.dev) > 10 ? 'far' : ''}" title="${S.exactDev(sp.dev)}">${S.fmtDev(sp.dev)}</span>
          <button class="srm" data-more="${str}" aria-label="${str}: edit, copy, remove" title="Edit, copy, remove" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 4 16" aria-hidden="true"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/></svg></button>
        </div>`;
        if (mute) return;
        const next = au[i + 1] ?? au[0], wrap = i === au.length - 1;
        const a = S.ratio(str), b = S.ratio(next), step = S.stepLabel(a, b, wrap);
        const c = au.length > 1 ? (wrap ? 1200 : 0) + b.cents - a.cents : 1200;
        rows += `<div class="sstep" data-a="${str}" data-b="${next}"${wrap ? ' data-wrap="1"' : ''}>
          <span>↕</span><span class="mono">${step ? S.breakHTML(S.labelHTML(step)) : ''}</span><span class="mono num" title="${S.roundC(c)}¢${step || a.temp || b.temp || au.length < 2 ? '' : ' · ' + S.stepText(a, b, wrap)}">${S.fmtC(c)}</span></div>`;   // a difference: to the app's precision, as a deviation
      });
      return `${head}<div class="shead"><span></span><span>note</span><span></span><span>ratio</span><span>¢</span><span>vs 12</span><span></span></div>${rows}`;
    };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-kbd]')) S.showKeyboard(!kbOpen);
      const more = e.target.closest('[data-more]');
      if (more) menu(more, e.detail === 0);
      if (e.target.closest('[data-clear]')) S.setScale([]);
      if (e.target.closest('[data-undo]')) S.undoScale();
      if (e.target.closest('[data-redo]')) S.redoScale();
    });
    // a row also picks its note, as its rim dot and piano key do ('pick': Lattice, Diamond and Spiral select it)
    // A touch may turn into a scroll (pan-y): the browser then cancels the pointer (or the finger glides on
    // first), so a touch picks its row only when it is let go there
    // a press that puts its interval into a step field keeps that field's focus
    const into = (e) => !(e && e.target.closest && e.target.closest('button')) && S.stepFields.get(document.activeElement);
    el.addEventListener('mousedown', (e) => { if (into(e) && e.target.closest('.srow, .sstep')) e.preventDefault(); });
    S.holdOn(el, '.srow, .sstep', (t, e) => {
      const put = into(e);
      if (put) {
        const row = t.classList.contains('srow');
        put(row ? S.stepText(S.ratio('1/1'), S.ratio(t.dataset.r)) : S.stepText(S.ratio(t.dataset.a), S.ratio(t.dataset.b), !!t.dataset.wrap));
        return row ? S.playScaleNotes([t.dataset.r]) : S.playScaleNotes([t.dataset.a, t.dataset.b], { octs: [0, t.dataset.wrap ? 1 : 0] });
      }
      if (!t.classList.contains('srow')) return S.playScaleNotes([t.dataset.a, t.dataset.b], { octs: [0, t.dataset.wrap ? 1 : 0] });
      const pick = !(e && e.target.closest && e.target.closest('button'));
      if (pick && !(e && e.pointerType === 'touch')) S.emit('pick', t.dataset.r);
      const stop = S.playScaleNotes([t.dataset.r]);
      if (!pick || !e || e.pointerType !== 'touch') return stop;
      let up = false;
      // capture: runs before holdOn's own pointerup handler stops this press
      const lift = (ev) => { if (ev.pointerId === e.pointerId) up = true; };
      window.addEventListener('pointerup', lift, true);
      return () => {
        window.removeEventListener('pointerup', lift, true);
        if (stop) stop();
        if (up) S.emit('pick', t.dataset.r);
      };
    }, { list: true });
    S.on('scale', render);
    S.on('settings', render);
    S.on('kbd', render);
    // the selected rim dot's row is marked (.sel) whenever a circle is drawn or shown; nothing scrolls to it. Only the
    // mark moves: patching the list and measuring its width (fit) forced a layout of the whole page in the middle of a
    // press (30 ms beside a Spiral of 9999 steps)
    const markSel = () => {
      const sel = rimSel(), was = el.querySelector('.srow.sel');
      if ((was ? was.dataset.r : null) === sel) return;
      el.querySelectorAll('.srow').forEach((r) => r.classList.toggle('sel', r.dataset.r === sel));
    };
    S.on('rimsel', markSel);
    S.on('shown', markSel);
    render();
  };

  /* ---------- the keyboard under the circle ---------- */

  // the letter keys drawn as a piano (the head's keyboard button opens it; open or shut in every list at once, kept in
  // this browser, scales.keys): each key in the colour of the note it plays and with its letter as a key glyph (no note
  // names: the place says the step, the user's call), Shift (held, or its glyph pressed) their second notes; pressed, a
  // key plays as its letter does, gliding across keys
  let kbOpen = false;
  try { kbOpen = localStorage.getItem('scales.keys') === '1'; } catch (e) {}
  S.showKeyboard = (on) => {
    kbOpen = on;
    try { on ? localStorage.setItem('scales.keys', '1') : localStorage.removeItem('scales.keys'); } catch (e) {}
    S.emit('kbd');
  };
  const KB_BTN = () => `<button class="icon-btn kbd-btn${kbOpen ? ' on' : ''}" data-kbd title="Keyboard" aria-label="Keyboard" aria-pressed="${kbOpen}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12.5h.01M10 12.5h.01M14 12.5h.01M18 12.5h.01M7 16h10"/></svg></button>`;
  // the steps of the white and the black keys (A S D F G H J K L ; and W E T Y U O P), as S.PIANO lays them out
  const WHITE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16], BLACK = [1, 3, 6, 8, 10, 13, 15];
  // the letters as this keyboard's layout prints them, where the browser tells (AZERTY's Q on A's place)
  let letters = (code) => (code === 'Semicolon' ? ';' : code.replace('Key', ''));
  try {
    navigator.keyboard?.getLayoutMap?.().then((m) => {
      if (!m || !m.size) return;
      letters = (code) => (m.get(code) || '').toUpperCase() || (code === 'Semicolon' ? ';' : code.replace('Key', ''));
      S.emit('kbd');
    }).catch(() => {});
  } catch (e) {}
  // a drawn key lights only while it or its letter is pressed, never for its note sounding elsewhere (a dot, MIDI, the
  // other key of its note an octave away): the keyboard isn't folded into the octave (the user's call). Pressed on
  // screen it is 'held' (S.holdOn); its letter held, 'hot' (kbDown: the steps whose letter is down)
  const kbDown = new Set();
  const kbLit = (k, on) => {
    on ? kbDown.add(k) : kbDown.delete(k);
    document.querySelectorAll(`.kb-key[data-k="${k}"]`).forEach((x) => x.classList.toggle('hot', on));
  };
  S.keyboard = (kb) => {
    kb.className = 'kb';
    // drawn once, then each key's note changes in place: a held key stays the element it was (its 'held', its glide)
    const draw = () => {
      const key = (k, black, i) => `<button class="kb-key${black ? ' blk' : ''}" data-k="${k}"${black ? ` style="--i: ${i}"` : ''}><kbd class="kb-letter"></kbd></button>`;
      // a black key stands on the line between the two white keys around it
      kb.innerHTML = `<div class="kb-keys">${WHITE.map((k) => key(k, false)).join('')}${BLACK.map((k) => key(k, true, WHITE.indexOf(k - 1) + 1)).join('')}</div>`
        + `<div class="kb-foot">Press <button class="kb-shift" data-shift aria-label="Shift"><kbd>Shift</kbd></button> to play secondary notes</div>`;
    };
    const render = () => {
      kb.hidden = !kbOpen;
      if (!kbOpen) return;
      if (!kb.firstChild) draw();
      kb.querySelectorAll('.kb-key').forEach((x) => {
        const k = +x.dataset.k, b = (shift && S.pianoSecond(k)) || S.pianoNote(k), r = b && S.ratio(b.str), l = letters(S.PIANO[k]);
        const cls = `kb-key${x.classList.contains('blk') ? ' blk' : ''} ${b ? r.cls : 'none'}${x.classList.contains('held') ? ' held' : ''}${kbDown.has(k) ? ' hot' : ''}`;
        if (x.className !== cls) x.className = cls;
        if (b) x.dataset.r = b.str; else delete x.dataset.r;
        x.title = b ? r.label : '';
        x.setAttribute('aria-label', b ? `${l} ${r.label}` : l);
        x.firstChild.textContent = l;
      });
      const sh = kb.querySelector('[data-shift]');
      sh.classList.toggle('on', shiftLatch); sh.classList.toggle('down', shift && !shiftLatch);
      sh.setAttribute('aria-pressed', shiftLatch);
    };
    kb.addEventListener('click', (e) => { if (e.target.closest('[data-shift]')) S.latchShift(!shiftLatch); });
    S.holdOn(kb, '.kb-key', (t) => keyNote(+t.dataset.k), { takeTouch: true, id: (x) => x.dataset.k });
    ['scale', 'settings', 'kbd', 'shift'].forEach((ev) => S.on(ev, render));
    render();
  };

  /* ---------- keyboard as instrument ---------- */

  // a piano on the letter rows: A is the 1/1, W S E D F T G Y H U J K O L P ; the 12-TET steps above it
  S.PIANO = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];

  // returns { down(code) -> bool, up(code) } that keeps one voice per key
  S.keyVoices = (startFor) => {
    const held = new Map();
    return {
      down(code) {
        if (held.has(code)) return true;
        const stop = S.audio.press(() => startFor(code));
        if (!stop) return false;
        held.set(code, stop);
        return true;
      },
      up(code) { const s = held.get(code); if (s) { held.delete(code); s(); } },
      any: () => held.size > 0,
      releaseAll() { held.forEach((s) => s()); held.clear(); },
    };
  };
  // In the tabs with a scale list (views with scaleKeys: true) the piano keys play the sounding
  // scale note nearest to their 12-TET step, if one is within ±50¢ (else the key is silent); C holds the Chord
  // (k may lie in any octave: MIDI keys reach far below and above the 1/1)
  // Up to 12 sounding notes: each gets a key of its own, in pitch order, the keys chosen so that the notes stand as near
  // their keys as they can (the least sum of distances). Where every note's nearest key is its own (most scales) that is
  // the nearest key; where two notes want one key, or one stands over 50¢ from any, a neighbour key takes it instead of
  // Shift or silence (the Well-Tuned Piano: 4 keys were silent, 4 notes on Shift). More than 12: the nearest within ±50¢,
  // the rest on Shift (S.pianoSecond)
  let fitId = null, fit = null;
  const keyFit = () => {
    const au = S.audible(), id = au.join();
    if (id === fitId) return fit;
    fitId = id; fit = null;
    const n = au.length;
    if (!n || n > 12) return fit;
    const cs = au.map((x) => S.ratio(x).cents);
    let best = Infinity;
    // the first note on key f, the others on rising keys within f … f + 11 (one octave of keys: each step once)
    for (let f = -11; f <= 12; f++) {
      const cost = [[]], from = [[]];
      cost[0][0] = Math.abs(cs[0] - 100 * f);
      for (let i = 1; i < n; i++) {
        cost[i] = []; from[i] = [];
        for (let q = i; q <= 11; q++) {
          let m = Infinity, a = -1;
          for (let p = i - 1; p < q; p++) if (cost[i - 1][p] < m) { m = cost[i - 1][p]; a = p; }
          cost[i][q] = m + Math.abs(cs[i] - 100 * (f + q)); from[i][q] = a;
        }
      }
      let q = -1, m = Infinity;
      for (let x = n - 1; x <= 11; x++) if (cost[n - 1][x] < m) { m = cost[n - 1][x]; q = x; }
      if (m >= best - 1e-9) continue;
      best = m; fit = new Map();
      for (let i = n - 1; i >= 0; i--) { fit.set(S.mod(f + q, 12), { str: au[i], q: f + q, c: cs[i] }); q = i ? from[i][q] : q; }
    }
    return fit;
  };
  S.pianoNote = (k) => {
    const kf = keyFit();
    if (kf) { const x = kf.get(S.mod(k, 12)); return x ? { str: x.str, oct: (k - x.q) / 12, d: Math.abs(x.c - 100 * x.q) } : null; }
    let best = null;
    const o = Math.floor(k / 12);
    for (const str of S.audible()) for (const oct of [o - 1, o, o + 1]) {
      const d = Math.abs(S.ratio(str).cents + 1200 * oct - 100 * k);
      if (d <= 50 && (!best || d < best.d)) best = { str, oct, d };
    }
    return best;
  };
  // Shift + key: the closest note that is no key's own, within ±100¢. The notes left over go to the keys
  // closest first, each key and each note once, so a key that loses a note to a closer one takes its next
  S.pianoSecond = (k) => {
    const own = new Set();
    for (let p = 0; p < 12; p++) { const b = S.pianoNote(p); if (b) own.add(b.str); }
    const pairs = [];
    for (const str of S.audible()) if (!own.has(str)) for (let p = 0; p < 12; p++) for (const oct of [-1, 0, 1]) {
      const d = Math.abs(S.ratio(str).cents + 1200 * oct - 100 * p);
      if (d <= 100) pairs.push({ str, p, oct, d });
    }
    pairs.sort((a, b) => a.d - b.d);   // stable: ties go to the note listed first, then the lower key
    const o = Math.floor(k / 12), key = k - 12 * o, keys = new Set(), notes = new Set();
    for (const x of pairs) {
      if (keys.has(x.p) || notes.has(x.str)) continue;
      if (x.p === key) return { str: x.str, oct: x.oct + o, d: x.d };
      keys.add(x.p); notes.add(x.str);
    }
    return null;
  };
  // Shift, down or up, moves the held letter keys between their notes
  // Shift is the key held, or the on-screen keyboard's Shift chip latched (S.latchShift); 'shift' tells the keyboards
  let shift = false, shiftKey = false, shiftLatch = false, keysHeld = [];
  S.keysNow = () => keysHeld;
  S.shiftOn = () => shift;
  const shiftFollowers = new Set();
  const setShift = () => { const on = shiftKey || shiftLatch; if (on !== shift) { shift = on; shiftFollowers.forEach((f) => f()); S.emit('shift', on); } };
  S.latchShift = (on) => { shiftLatch = on; const was = shift; setShift(); if (shift === was) S.emit('shift', shift); };
  // Shift pressed while latched hands the latch to the key: held now, it lets go with the key
  ['keydown', 'keyup'].forEach((t) => window.addEventListener(t, (e) => {
    if (t === 'keydown' && e.key === 'Shift' && !e.repeat && shiftLatch) { shiftLatch = false; S.emit('shift', true); }
    shiftKey = e.shiftKey; setShift();
  }, true));
  window.addEventListener('blur', () => { shiftKey = false; setShift(); });
  // one held key on step k, at loudness vel (0…1); returns its stop. With Shift held (a letter, an on-screen or a MIDI key)
  // it plays its second note if it has one, else its own
  const keyNote = (k, vel = 1) => {
    S.noteIn();
    const find = () => (shift && S.pianoSecond(k)) || S.pianoNote(k);
    let b = find();
    // the notes the keys sound right now, oldest first, in their octaves; a pedalled one counts until the pedal lifts
    const show = () => {
      keysHeld = keysHeld.filter((x) => x.key !== show);
      if (b) keysHeld.push({ key: show, str: b.str, oct: b.oct });
      S.emit('keys', keysHeld, !!b);
    };
    // while held it follows the mutes (and changes to the scale): its note may go silent, come back or
    // change, and a key held with no note starts one once a note is unmuted or added near its step
    const play = () => b && S.playScaleNotes([b.str], { octs: [b.oct], vel, later: true });
    let stop = play();   // the sound first; what the page shows of it follows
    if (b) { S.emitLater('pick', b.str, true, b.oct); show(); }   // a key also picks its note, as its list row does (true: from a key)
    const sync = () => {
      const n = find();
      if (n && b && n.str === b.str && n.oct === b.oct) return;
      if (stop) stop();
      b = n;
      stop = play();
      show();
    };
    const onShift = () => { const was = b; sync(); if (b && b !== was) S.emit('pick', b.str, true, b.oct); };
    S.on('scale', sync);
    shiftFollowers.add(onShift);
    return () => { S.off('scale', sync); shiftFollowers.delete(onShift); if (stop) stop(); b = null; show(); };
  };
  S.scaleKeys = S.keyVoices((code) => {
    // Z and X, by position as every key here: the 1/1's octave, as far as its field goes; a held key stays where it was pressed
    if (code === 'KeyZ' || code === 'KeyX') {
      const m = S.settings.base + (code === 'KeyX' ? 12 : -12);
      if (m >= S.BASE_MIN && m <= S.BASE_MAX) { S.settings.base = m; S.saveSettings(); S.emit('settings'); }
      return null;
    }
    const k = S.PIANO.indexOf(code);
    if (k < 0) return null;
    const stop = keyNote(k);
    kbLit(k, true);
    return () => { stop(); kbLit(k, false); };
  });
  S.on('panic', () => S.scaleKeys.releaseAll());
  S.on('release', () => S.scaleKeys.releaseAll());

  /* ---------- MIDI input ---------- */
  // a MIDI keyboard plays like the piano keys, in every tab: key m is the 12-TET step m − the 1/1's key,
  // so it plays the nearest sounding scale note within ±50¢ in its own octave. Velocity sets the loudness
  // ((v/127)², the usual DLS curve); the sustain pedal (CC 64) holds released keys. Off until switched on
  // in the settings menu (the browser asks first); kept on across reloads (scales.midi)
  S.midi = (() => {
    const held = new Map(), sustained = new Set();
    let access = null, pedal = false;
    const off = (m) => { const s = held.get(m); if (s) { held.delete(m); s(); } };
    const releaseAll = () => { held.forEach((s) => s()); held.clear(); sustained.clear(); };
    // every tab of this page receives every note: the one last looked at plays them, also once it is in the background.
    // A held note still gets its note-off wherever it started
    let mine = true;
    const channel = window.BroadcastChannel ? new BroadcastChannel('scales.midi') : null;
    if (channel) channel.onmessage = () => { mine = false; };
    const claim = () => { if (access) { mine = true; channel?.postMessage(1); } };
    window.addEventListener('focus', claim);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) claim(); });
    const onMessage = ({ data }) => {
      S.noteIn();
      const [status, a, b] = data, type = status & 0xf0;
      if (type === 0x90 && b > 0) {
        if (!mine) return;
        off(a); sustained.delete(a);
        held.set(a, S.audio.press(() => keyNote(a - S.settings.base, (b / 127) ** 2)));
      } else if (type === 0x80 || type === 0x90) {
        if (pedal) sustained.add(a); else off(a);
      } else if (type === 0xb0 && a === 64) {
        pedal = b >= 64;
        if (!pedal) { sustained.forEach(off); sustained.clear(); }
      } else if (type === 0xb0 && (a === 120 || a === 123)) releaseAll();   // all sound off, all notes off
    };
    const attach = () => access && access.inputs.forEach((i) => (i.onmidimessage = onMessage));
    // the connected inputs' names, for the switch's tooltip
    const inputs = () => (access ? [...access.inputs.values()].map((i) => i.name).join(', ') || 'No MIDI device found' : '');
    S.on('panic', releaseAll);
    return {
      supported: !!navigator.requestMIDIAccess,
      get on() { return !!access; },
      // resolves to {on, why}: whether MIDI is now on, and the devices or the browser's reason for refusing
      async set(on) {
        try { on ? localStorage.setItem('scales.midi', '1') : localStorage.removeItem('scales.midi'); } catch (e) {}
        if (!on) {
          if (access) { access.inputs.forEach((i) => (i.onmidimessage = null)); access.onstatechange = null; }
          access = null; releaseAll(); pedal = false;
          return { on: false };
        }
        if (access) return { on: true, why: inputs() };
        try {
          access = await navigator.requestMIDIAccess();
          access.onstatechange = attach;   // a keyboard plugged in later
          attach();
          if (!document.hidden) claim();
          return { on: true, why: inputs() };
        } catch (e) {
          console.warn('MIDI refused:', e);
          try { localStorage.removeItem('scales.midi'); } catch (err) {}
          return { on: false, why: `MIDI refused: ${e.name}${e.message ? ' · ' + e.message : ''}` };
        }
      },
      stored() { try { return localStorage.getItem('scales.midi') === '1'; } catch (e) { return false; } },
      onMessage,   // for testing without a keyboard
    };
  })();
})();
