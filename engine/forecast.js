// PrecisionTimer engine — probability statements, read from measured tables (model/model.js).
//
// Everything is expressed in units of the coin's own daily volatility σ (series.js → sigmaAt):
//   z = ln(future price / price today) / σ
// The model stores, per horizon, the historical distribution of z (for ranges), of the lowest and
// highest z reached on the way (for "will it touch this level?"), and which of a stop / target was
// reached first (for plans). These functions only look numbers up and interpolate — no opinions.
//
// Runs unchanged in Node and in the browser (the board page imports it), so the screen and the
// backtest can never disagree about the math.

export const HORIZONS = [7, 14, 30];
export const PROBS = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95];
export const TOUCH_STEP = 0.25, TOUCH_MAX = 30;                       // σ grid for touch tables (30σ ≈ a 60% drop for a 3%-a-day coin)
export const STOPS = Array.from({ length: 12 }, (_, i) => 0.5 + i * 0.5);    // 0.5 … 6.0 σ
export const TARGETS = Array.from({ length: 24 }, (_, i) => 0.5 + i * 0.5);  // 0.5 … 12.0 σ

// Which table set applies to a coin with daily volatility `sigma`. If calibration found that
// splitting by volatility level predicts better out of sample, the model says mode = 'bucketed'.
export function tablesFor(model, sigma) {
  const F = model.forecast;
  if (F.mode !== 'bucketed') return F.pooled;
  const b = sigma < F.sigmaCuts[0] ? 0 : sigma < F.sigmaCuts[1] ? 1 : 2;
  return F.buckets[b];
}

// Price levels the close has historically stayed under with probability p, k days out.
// Returns { p05, p10, p25, p50, p75, p90, p95 } in price units.
export function bands(model, price, sigma, k) {
  const q = tablesFor(model, sigma).q[k];
  if (!q || !(price > 0) || !(sigma > 0)) return null;
  const out = {};
  PROBS.forEach((p, j) => { out['p' + String(Math.round(p * 100)).padStart(2, '0')] = price * Math.exp(sigma * q[j]); });
  return out;
}

function lerpGrid(arr, x) {
  if (x <= 0) return arr[0];
  const pos = x / TOUCH_STEP, j = Math.floor(pos), n = arr.length - 1;
  if (j < n) return arr[j] + (arr[j + 1] - arr[j]) * (pos - j);
  // Beyond the measured grid: continue the tail's own exponential decay (fitted on its last 5σ).
  // This is an extrapolation, not a measurement — isExtrapolated() lets the caller say so.
  const a = arr[n], b = arr[n - Math.round(5 / TOUCH_STEP)];
  if (!(a > 0) || !(b > a)) return a;
  return a * Math.exp(-(Math.log(b / a) / 5) * (x - TOUCH_MAX));
}
export const isExtrapolated = (price, level, sigma) => Math.abs(Math.log(level / price)) / sigma > TOUCH_MAX;

// Probability that price TRADES AT OR THROUGH `level` at any time in the next k days
// (intraday lows for a level below spot, highs for a level above).
export function touchProb(model, price, level, sigma, k) {
  if (!(price > 0) || !(level > 0) || !(sigma > 0)) return null;
  const T = tablesFor(model, sigma), x = Math.abs(Math.log(level / price)) / sigma;
  const arr = (level < price ? T.dn : T.up)[k];
  return arr ? lerpGrid(arr, x) : null;
}

function bilinear(grid, xs, xt) {
  const cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const fs = cl((xs - STOPS[0]) / 0.5, 0, STOPS.length - 1), ft = cl((xt - TARGETS[0]) / 0.5, 0, TARGETS.length - 1);
  const i0 = Math.min(STOPS.length - 2, Math.floor(fs)), j0 = Math.min(TARGETS.length - 2, Math.floor(ft));
  const a = fs - i0, b = ft - j0;
  return grid[i0][j0] * (1 - a) * (1 - b) + grid[i0 + 1][j0] * a * (1 - b) + grid[i0][j0 + 1] * (1 - a) * b + grid[i0 + 1][j0 + 1] * a * b;
}

// A long plan — buy at `entry`, sell at `target` or `stop`, whichever trades first, give up after k
// days. Returns measured probabilities and the expectancy in R (1R = entry − stop).
//   pTarget / pStop / pOpen : what happened to every historical coin-day with the same geometry in σ
//   rr        : reward-to-risk of the plan as drawn
//   breakeven : win rate needed for rr to break even = 1 / (1 + rr)
//   expR      : pTarget·rr − pStop·1 + pOpen·(average R of plans still open at the time limit)
//   clamped   : true when the stop or target lies outside the measured grid (answer is the edge value)
export function planOdds(model, { entry, stop, target, sigma, k }) {
  if (!(stop > 0) || !(entry > stop) || !(target > entry) || !(sigma > 0)) return null;
  const P = tablesFor(model, sigma).plan[k]; if (!P) return null;
  const xs = Math.log(entry / stop) / sigma, xt = Math.log(target / entry) / sigma;
  const pTarget = bilinear(P.pT, xs, xt), pStop = bilinear(P.pS, xs, xt), pOpen = Math.max(0, 1 - pTarget - pStop);
  const rr = (target - entry) / (entry - stop);
  const openR = bilinear(P.mz, xs, xt) / xs;          // mean z of still-open plans, in units of the stop distance
  return {
    pTarget, pStop, pOpen, rr, breakeven: 1 / (1 + rr),
    expR: pTarget * rr - pStop + pOpen * openR,
    xs, xt, clamped: xs < STOPS[0] || xs > STOPS[STOPS.length - 1] || xt < TARGETS[0] || xt > TARGETS[TARGETS.length - 1],
  };
}
