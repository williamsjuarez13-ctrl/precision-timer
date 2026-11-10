// PrecisionTimer engine — per-symbol daily series and the features read off them.
//
// Contract (enforced by test/no-lookahead.test.js):
//   • input bars are CLOSED daily candles only, oldest first: [openTime, o, h, l, c, baseVol, quoteVol]
//   • every array on the returned series is aligned to the bars; the value at index i uses bars <= i
//   • featuresAt(S, i) is therefore "what was knowable at the close of bar i" — the backtest and the
//     live board call this same function, which is why their numbers can be compared.
import { ema, rsi, atr, rollMax, rollMean, rollStd } from './indicators.js';

export const DAY = 86400e3;

// Split a raw history at discontinuities (trading halts, redenominations, a ticker being reused for
// a new coin — LUNA 2022). Each segment is a separate instrument with its own indicator warm-up.
export function splitSegments(bars) {
  const segs = []; let cur = [];
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      const gap = (bars[i][0] - bars[i - 1][0]) / DAY, jump = bars[i][1] / bars[i - 1][4];
      if (gap > 1.5 || !(jump < 2.5 && jump > 0.4)) { segs.push(cur); cur = []; }
    }
    cur.push(bars[i]);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

function rollMedian(v, n) {
  const out = new Array(v.length).fill(null);
  for (let i = n - 1; i < v.length; i++) {
    const w = v.slice(i - n + 1, i + 1).sort((a, b) => a - b);
    out[i] = n % 2 ? w[(n - 1) / 2] : (w[n / 2 - 1] + w[n / 2]) / 2;
  }
  return out;
}

export function buildSeries(sym, bars) {
  const n = bars.length;
  const S = { sym, n, t: new Array(n), o: new Array(n), h: new Array(n), l: new Array(n), c: new Array(n), v: new Array(n), qv: new Array(n) };
  for (let i = 0; i < n; i++) { const b = bars[i]; S.t[i] = b[0]; S.o[i] = b[1]; S.h[i] = b[2]; S.l[i] = b[3]; S.c[i] = b[4]; S.v[i] = b[5]; S.qv[i] = b[6]; }
  const { h, l, c, v, qv } = S;
  S.lr = c.map((x, i) => (i ? Math.log(x / c[i - 1]) : 0));
  S.e20 = ema(c, 20); S.e50 = ema(c, 50); S.e200 = ema(c, 200);
  S.rsi = rsi(c, 14);
  S.atr = atr(h, l, c, 14);
  S.hi20 = rollMax(h, 20); S.hi60 = rollMax(h, 60); S.hi250 = rollMax(h, 250);
  S.sd10 = rollStd(S.lr, 10); S.sd30 = rollStd(S.lr, 30); S.sd90 = rollStd(S.lr, 90);
  S.vAvg30 = rollMean(v, 30);
  const rng = h.map((x, i) => x - l[i]);
  S.r7 = rollMean(rng, 7); S.r30 = rollMean(rng, 30);
  S.med30 = rollMedian(qv, 30);
  return S;
}

// Daily volatility used for every range / touch-probability statement: the root-mean-square of the
// 10-, 30- and 90-day standard deviations of daily log returns. (Chosen on the training period; the
// 90-day term keeps it from collapsing after a quiet fortnight, the 10-day term lets it react.)
export function sigmaAt(S, i) {
  const a = S.sd10[i], b = S.sd30[i], d = S.sd90[i];
  if (a === null || b === null || d === null) return null;
  const s = Math.sqrt((a * a + b * b + d * d) / 3);
  return s > 0 ? s : null;
}

// The same σ from a bare list of daily closes (oldest first) — for callers that have no series
// object (the classic dashboard). Needs at least 91 closes.
export function sigmaFromCloses(closes) {
  const lr = closes.map((x, i) => (i ? Math.log(x / closes[i - 1]) : 0)), i = closes.length - 1;
  return sigmaAt({ sd10: rollStd(lr, 10), sd30: rollStd(lr, 30), sd90: rollStd(lr, 90) }, i);
}

const pct = (a, b) => (b > 0 ? (a / b - 1) * 100 : null);

// Share of the last 90 days' average daily range that happens on weekends, relative to weekdays.
// Crypto trades 7 days; tokenised gold/equities go quiet on Sat/Sun (ratio ≈ 0.2). BTC is ≈ 0.46.
export function weekendRatio(S, i) {
  let wr = 0, wn = 0, dr = 0, dn = 0;
  for (let j = Math.max(0, i - 89); j <= i; j++) {
    const dow = new Date(S.t[j]).getUTCDay(), r = (S.h[j] - S.l[j]) / S.c[j];
    if (dow === 0 || dow === 6) { wr += r; wn++; } else { dr += r; dn++; }
  }
  return wn && dn && dr > 0 ? (wr / wn) / (dr / dn) : null;
}

// Everything the engine reads about one coin at the close of bar i. Nulls mean "not enough history".
export function featuresAt(S, i) {
  if (i < 1 || i >= S.n) return null;
  const p = S.c[i], A = S.atr[i];
  const back = k => (i - k >= 0 ? pct(p, S.c[i - k]) : null);
  return {
    sym: S.sym, t: S.t[i], close: p,
    sigma: sigmaAt(S, i),                 // daily σ of log returns (blend)
    sd30: S.sd30[i],                      // 30-day σ — the "low volatility" rank factor
    near250: S.hi250[i] === null ? null : pct(p, S.hi250[i]),   // % below the 250-day high (0 = at the high)
    med30: S.med30[i],                    // 30-day median daily $ volume — liquidity yardstick
    atr: A, atrPct: A ? A / p * 100 : null,
    rsi: S.rsi[i],
    e20: S.e20[i], e50: S.e50[i], e200: S.e200[i],
    above50: p > S.e50[i], above200: p > S.e200[i],
    v50: pct(p, S.e50[i]), v200: pct(p, S.e200[i]),
    ext20: A ? (p - S.e20[i]) / A : null,
    chg1: back(1), chg7: back(7), chg30: back(30),
    hi20Prior: i >= 1 ? S.hi20[i - 1] : null,
    hi60Prior: i >= 1 ? S.hi60[i - 1] : null,
    volRatio: i >= 1 && S.vAvg30[i - 1] ? S.v[i] / S.vAvg30[i - 1] : null,
    comp: S.r30[i] ? S.r7[i] / S.r30[i] : null,   // 7d / 30d average range: < 1 = coiling
  };
}
