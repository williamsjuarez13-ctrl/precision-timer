// PrecisionTimer engine — indicator primitives.
// Contract: every function returns an array aligned with its input, and the value at index i
// depends ONLY on inputs at indices <= i. That property is what makes replay == live
// (test/no-lookahead.test.mjs enforces it by recomputing on truncated inputs).

export function ema(v, n) {
  const out = new Array(v.length), m = 2 / (n + 1);
  for (let i = 0; i < v.length; i++) out[i] = i ? v[i] * m + out[i - 1] * (1 - m) : v[i];
  return out;
}

export function sma(v, n) {
  const out = new Array(v.length).fill(null); let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}

// Wilder RSI. null until index n.
export function rsi(v, n = 14) {
  const out = new Array(v.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const ch = v[i] - v[i - 1], up = ch > 0 ? ch : 0, dn = ch < 0 ? -ch : 0;
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}

// Stochastic RSI (rsiP, stochP, kSmooth, dSmooth) — same construction the dashboard uses.
export function stochRsi(v, rsiP = 14, stochP = 14, kS = 3, dS = 3) {
  const r = rsi(v, rsiP), n = v.length, raw = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < rsiP + stochP - 1 || r[i] === null) continue;
    let mn = Infinity, mx = -Infinity;
    for (let j = i - stochP + 1; j <= i; j++) { if (r[j] < mn) mn = r[j]; if (r[j] > mx) mx = r[j]; }
    raw[i] = mx > mn ? 100 * (r[i] - mn) / (mx - mn) : 50;
  }
  const roll = (a, w) => { const o = new Array(n).fill(null); for (let i = w - 1; i < n; i++) { let s = 0, ok = true; for (let j = i - w + 1; j <= i; j++) { if (a[j] === null) { ok = false; break; } s += a[j]; } if (ok) o[i] = s / w; } return o; };
  const k = roll(raw, kS), d = roll(k, dS);
  return { k, d, rsi: r };
}

export function macd(v, fast = 12, slow = 26, sig = 9) {
  const f = ema(v, fast), s = ema(v, slow), line = f.map((x, i) => x - s[i]), signal = ema(line, sig);
  return { line, signal, hist: line.map((x, i) => x - signal[i]) };
}

// Wilder ATR. null until index n.
export function atr(h, l, c, n = 14) {
  const out = new Array(c.length).fill(null); let a = 0;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    if (i <= n) { a += tr; if (i === n) { a /= n; out[i] = a; } }
    else { a = (a * (n - 1) + tr) / n; out[i] = a; }
  }
  return out;
}

// Rolling extreme over the window ENDING at i (inclusive), length n. Monotonic deque, O(n).
function rollExt(v, n, cmp) {
  const out = new Array(v.length).fill(null), dq = [];
  for (let i = 0; i < v.length; i++) {
    while (dq.length && dq[0] <= i - n) dq.shift();
    while (dq.length && cmp(v[i], v[dq[dq.length - 1]])) dq.pop();
    dq.push(i);
    if (i >= n - 1) out[i] = v[dq[0]];
  }
  return out;
}
export const rollMax = (v, n) => rollExt(v, n, (a, b) => a >= b);
export const rollMin = (v, n) => rollExt(v, n, (a, b) => a <= b);

// Rolling mean over the window ending at i (inclusive). null until n-1.
export function rollMean(v, n) { return sma(v, n); }

// Rolling standard deviation of a series (population), window ending at i.
export function rollStd(v, n) {
  const out = new Array(v.length).fill(null); let s = 0, q = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] ?? 0; s += x; q += x * x;
    if (i >= n) { const y = v[i - n] ?? 0; s -= y; q -= y * y; }
    if (i >= n - 1) { const m = s / n; out[i] = Math.sqrt(Math.max(0, q / n - m * m)); }
  }
  return out;
}

// Swing pivots with L bars each side. A pivot at index p is only KNOWN at index p + L
// (confirmedAt) — detectors must never act on a pivot before that bar.
export function pivots(h, l, L = 3) {
  const ph = [], pl = [];
  for (let i = L; i < h.length - L; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= L; j++) {
      if (h[i] <= h[i - j] || h[i] < h[i + j]) isH = false;
      if (l[i] >= l[i - j] || l[i] > l[i + j]) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) ph.push({ i, v: h[i], confirmedAt: i + L });
    if (isL) pl.push({ i, v: l[i], confirmedAt: i + L });
  }
  return { ph, pl };
}
