// PrecisionTimer engine — the daily signal: what to hold, coin by coin, as a target exposure.
//
// Two layers, both read at the daily close (closed bars only):
//
//   1. MARKET GATE. ON when at least regime.gateOnAt of the three trend facts are true, OFF when at most
//      regime.gateOffAt are; anything in between keeps the previous state (hysteresis). The default 2/1
//      has no in-between: ON at 2+, OFF at 0-1. Hysteresis variants (3/1, 3/0, 2/0) flipped less but
//      returned less since 2020 with this universe (docs/EVIDENCE.md, section 7), so they are not used.
//      Gate ON → 100% of the coin's allocation. Gate OFF → 0%, except:
//
//   2. CAPITULATION TRANCHE (only while the gate is OFF, only for capitulation.coins). After a coin's daily RSI has been at or below
//      signal.capitulation.rsi and crosses back above it, with a close above the prior day's high, while
//      the coin is at least `below200` under its 200-day EMA → buy `size` (half). Sell it all when the
//      rally reaches the 200-day zone (RSI ≥ exitRsi and within exitWithin200 of the EMA), on a close
//      below the 20-day low at entry, or after maxDays. If the gate turns ON meanwhile, it becomes 100%.
//
// The same functions drive the backtest (scripts/calibrate.js) and the live board, so the record shown
// next to a signal is the record of exactly this rule.

// readings: [{ trend, full }] oldest → newest; full = number of trend facts available that day (3, or 2
// before breadth existed). Returns true / false per reading, or null until the first decisive reading.
export function gatePath(readings, R) {
  const out = []; let on = null;
  for (const x of readings) {
    if (!x || x.trend === null || x.trend === undefined) { out.push(on); continue; }
    const shift = 3 - (x.full ?? 3);
    if (x.trend >= R.gateOnAt - shift) on = true;
    else if (x.trend <= R.gateOffAt - shift) on = false;
    out.push(on);
  }
  return out;
}

// Exposure path for one coin. S = buildSeries() result; gateOf(t) → true / false / null for the daily bar
// opening at t; from = first index to evaluate. Returns an array aligned to S: null before `from`, else
// { x, mode: 'trend' | 'capitulation' | 'cash', exit?, cap? }.
export function exposurePath(S, gateOf, from, C) {
  const path = new Array(S.n).fill(null); let cap = null;
  const capOn = C.size > 0 && (!C.coins || C.coins.includes(S.sym));
  for (let i = Math.max(1, from); i < S.n; i++) {
    const g = gateOf(S.t[i]);
    if (g === true) { cap = null; path[i] = { x: 1, mode: 'trend' }; continue; }
    const r = S.rsi[i], rp = S.rsi[i - 1], e = S.e200[i];
    const d = e > 0 ? S.c[i] / e - 1 : null;
    if (!cap) {
      if (capOn && r !== null && rp !== null && d !== null && rp <= C.rsi && r > C.rsi && d <= -C.below200 && S.c[i] > S.h[i - 1]) {
        let lo = Infinity; for (let j = Math.max(0, i - C.stopLookback + 1); j <= i; j++) lo = Math.min(lo, S.l[j]);
        cap = { i, t: S.t[i], entry: S.c[i], stop: lo };
        path[i] = { x: C.size, mode: 'capitulation', cap: { ...cap } }; continue;
      }
      path[i] = { x: 0, mode: 'cash' }; continue;
    }
    let exit = null;
    if (S.c[i] < cap.stop) exit = 'stop';
    else if (r !== null && d !== null && r >= C.exitRsi && d >= -C.exitWithin200) exit = 'target';
    else if (i - cap.i > C.maxDays) exit = 'time';
    if (exit) { cap = null; path[i] = { x: 0, mode: 'cash', exit }; continue; }
    path[i] = { x: C.size, mode: 'capitulation', cap: { ...cap } };
  }
  return path;
}

// The word for moving from exposure a to exposure b.
export function actionOf(a, b) {
  if (b > a + 1e-9) return a <= 1e-9 ? 'BUY' : 'ADD';
  if (b < a - 1e-9) return b <= 1e-9 ? 'SELL' : 'TRIM';
  return b <= 1e-9 ? 'STAY OUT' : b >= 1 - 1e-9 ? 'HOLD' : 'HOLD HALF';
}

// Today's briefing for one coin, from its exposure path. Plain facts the page and alerts print as is.
export function briefingFor(S, path, i, gate, trend, C, R) {
  const p = path[i]; if (!p) return null;
  const prev = path[i - 1] || { x: 0 };
  let k = i; while (k > 0 && path[k - 1] && Math.abs(path[k - 1].x - p.x) < 1e-9) k--;
  const e = S.e200[i], d = e > 0 ? S.c[i] / e - 1 : null, r = S.rsi[i];
  const next = [];
  if (p.mode === 'trend') {
    next.push({ to: 0, when: `the market trend falls to ${R.gateOffAt}/3 or lower (now ${trend}/3)` });
  } else if (p.mode === 'capitulation') {
    next.push({ to: 0, when: `RSI reaches ${C.exitRsi} within ${Math.round(C.exitWithin200 * 100)}% of the 200-day EMA (≈ ${round(e * (1 - C.exitWithin200))} or higher)`, level: e * (1 - C.exitWithin200) });
    next.push({ to: 0, when: `a close below ${round(p.cap.stop)} (stop: the 20-day low at entry)`, level: p.cap.stop });
    const held = Math.round((S.t[i] - p.cap.t) / 864e5);
    next.push({ to: 0, when: `${Math.max(0, C.maxDays - held)} more days pass without either (time limit)` });
    next.push({ to: 1, when: `the market trend reaches ${R.gateOnAt}/3 (now ${trend}/3)` });
  } else {
    next.push({ to: 1, when: `the market trend reaches ${R.gateOnAt}/3 (now ${trend}/3)` });
    const capOn = C.size > 0 && (!C.coins || C.coins.includes(S.sym));
    if (!capOn) { /* no capitulation tranche for this coin */ }
    else if (d !== null && d <= -C.below200) next.push({ to: C.size, when: `RSI crosses back above ${C.rsi} with a close above the prior day's high (RSI now ${r === null ? '—' : r.toFixed(1)}; ${Math.round(-d * 100)}% under the 200-day EMA)` });
    else if (d !== null) next.push({ to: C.size, when: `the coin falls at least ${Math.round(C.below200 * 100)}% under its 200-day EMA (≈ ${round(e * (1 - C.below200))}; now ${d >= 0 ? '+' : ''}${Math.round(d * 100)}%), then RSI crosses back above ${C.rsi}` });
  }
  return {
    exposure: p.x, mode: p.mode, action: actionOf(prev.x, p.x), changedToday: Math.abs(prev.x - p.x) > 1e-9, exit: p.exit || null,
    since: k, sinceDays: i - k, sincePrice: S.c[k], cap: p.cap || null, gate, trend,
    rsi: r, vs200: d, next,
  };
}
const round = x => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x >= 1 ? +x.toFixed(2) : +x.toPrecision(3));
