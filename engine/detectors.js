// PrecisionTimer engine — event detectors.
//
// A detector answers "did X happen on the bar that just closed?" from the series alone. It carries no
// opinion about whether X is good: every (event, rank-tier) pair is MEASURED by `npm run calibrate`
// and the measurement — not the name — is what the board and the alerts show. To add a detector,
// add it here; calibrate picks it up automatically, and it can only alert once config.alerts lists it.

const pct = (a, b) => (b > 0 ? (a / b - 1) * 100 : null);

export const DETECTORS = {
  // Breakout with participation: close above the prior 20-day high on at least 1.8x the 30-day
  // average volume. What followed, by rank tier, is in model.events — never quoted here.
  IGNITION: {
    label: 'Ignition', describe: 'closed above the 20-day high on ≥1.8× average volume',
    test(S, i) {
      if (i < 31 || S.hi20[i - 1] === null || !S.vAvg30[i - 1]) return false;
      return S.c[i] > S.hi20[i - 1] && S.v[i] >= 1.8 * S.vAvg30[i - 1];
    },
    firstDayOnly: false,
  },
  // Tight coil just under resistance while outperforming BTC: within 1.2 ATR below (or 0.3 above)
  // the prior 60-day high, last week's range under 85% of the month's, 30-day return above BTC's.
  COIL: {
    label: 'Coil under the high', describe: 'tight range within 1.2 ATR of the 60-day high, outperforming BTC over 30 days',
    test(S, i, ctx) {
      if (i < 61 || S.hi60[i - 1] === null || !S.atr[i] || !S.r30[i]) return false;
      const d = (S.hi60[i - 1] - S.c[i]) / S.atr[i];
      if (!(d <= 1.2 && d >= -0.3)) return false;
      if (!(S.r7[i] / S.r30[i] < 0.85)) return false;
      const own30 = pct(S.c[i], S.c[i - 30]), btc30 = ctx && ctx.btc30At ? ctx.btc30At(S.t[i]) : null;
      return btc30 === null || btc30 === undefined || own30 - btc30 > 0;
    },
    firstDayOnly: true,   // fires on the first day the condition appears, not every day it persists
  },
};

// Events on bar i of series S. ctx.btc30At(t) → BTC's 30-day % return at the bar opening at t (or null).
export function eventsAt(S, i, ctx) {
  const out = [];
  for (const [id, D] of Object.entries(DETECTORS)) {
    if (!D.test(S, i, ctx)) continue;
    if (D.firstDayOnly && i > 0 && D.test(S, i - 1, ctx)) continue;
    out.push(id);
  }
  return out;
}

// The frozen plan attached to an event when it is logged: entry at the signal close, stop and target
// a fixed number of daily ATRs away, and a time limit. Geometry is policy (config.plan).
export function planFor(close, atr, P) {
  if (!(atr > 0)) return null;
  return { entry: close, stop: close - P.stopAtr * atr, target: close + P.targetAtr * atr, days: P.maxDays };
}
