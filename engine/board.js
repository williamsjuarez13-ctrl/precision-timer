// PrecisionTimer engine — snapshot() and buildBoard().
//
// snapshot(seriesList, t, config) is THE definition of "what the engine says at the close of the
// daily bar that opened at t": universe → rank → market state → events. The backtest calls it for
// every historical day and the live scan calls it for today. There is no second implementation, so
// a number on the board is by construction the same number the backtest measured.
import { DAY, featuresAt, weekendRatio } from './series.js';
import { ineligibleReason, isExcludedName } from './universe.js';
import { rankUniverse } from './rank.js';
import { marketState } from './regime.js';
import { eventsAt, planFor } from './detectors.js';
import { bands, touchProb, isExtrapolated } from './forecast.js';

const pct = (a, b) => (b > 0 ? (a / b - 1) * 100 : null);

// Index of the bar that opened at time t (series are gap-free by construction), or -1.
export function indexAt(S, t) {
  const i = Math.round((t - S.t[0]) / DAY);
  return i >= 0 && i < S.n && S.t[i] === t ? i : -1;
}

export function snapshot(seriesList, t, config, { withEvents = true } = {}) {
  const U = config.universe;
  const btcS = seriesList.find(S => S.sym === 'BTC');
  const bi = btcS ? indexAt(btcS, t) : -1;
  const btcF = bi >= 1 ? featuresAt(btcS, bi) : null;

  // 1. eligibility (cheap tests first, the weekend test only for coins that could make the cut)
  const pool = [];
  for (const S of seriesList) {
    const i = indexAt(S, t); if (i < 1) continue;
    if (isExcludedName(S.sym) || i + 1 < U.minHistoryDays) continue;
    const f = featuresAt(S, i);
    if (ineligibleReason(S.sym, f, i + 1, null, U)) continue;
    pool.push({ S, i, f });
  }
  pool.sort((a, b) => b.f.med30 - a.f.med30 || (a.S.sym < b.S.sym ? -1 : 1));
  const members = [];
  for (const m of pool) {
    if (members.length >= U.size) break;
    const w = weekendRatio(m.S, m.i);
    if (w !== null && w < U.minWeekendRatio) continue;
    members.push(m);
  }

  // 2. rank and market state
  const feats = members.map(m => m.f);
  const ranks = rankUniverse(feats, config.rank.factors);
  members.forEach((m, j) => Object.assign(m, ranks[j]));
  const market = marketState(btcF, feats, config.regime);

  // 3. events on the bar that just closed
  if (withEvents) {
    const ctx = { btc30At: tt => { const j = btcS ? indexAt(btcS, tt) : -1; return j >= 30 ? pct(btcS.c[j], btcS.c[j - 30]) : null; } };
    for (const m of members) m.events = eventsAt(m.S, m.i, ctx);
  }
  members.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  return { t, members, market, btc: btcF };
}

const iso = t => new Date(t).toISOString().slice(0, 10);
const r = (x, d = 4) => (x === null || x === undefined || Number.isNaN(x) ? null : +x.toFixed(d));
const sig = (x, d = 6) => (x === null || x === undefined || Number.isNaN(x) ? null : +x.toPrecision(d));

// Structural levels worth a touch-probability, derived from the series (no hand-typed numbers).
function autoLevels(S, i) {
  const lo = (n) => Math.min(...S.l.slice(Math.max(0, i - n + 1), i + 1)), hi = (n) => Math.max(...S.h.slice(Math.max(0, i - n + 1), i + 1));
  return [
    { label: '60-day low', level: lo(60) }, { label: '250-day low', level: lo(250) },
    { label: '60-day high', level: hi(60) }, { label: '250-day high', level: hi(250) },
    { label: '200-day EMA', level: S.e200[i] }, { label: '50-day EMA', level: S.e50[i] },
  ];
}

// seriesList: buildSeries() results for every candidate (closed bars only).
// live: { SYM: last traded price } — display and level distance only; never used for a signal.
export function buildBoard({ seriesList, live = {}, now, model, config }) {
  const btcS = seriesList.find(S => S.sym === 'BTC');
  if (!btcS) throw new Error('BTC series missing — cannot establish the as-of bar or the market state');
  const t = btcS.t[btcS.n - 1];
  const snap = snapshot(seriesList, t, config);
  if (snap.members.length < Math.min(30, config.universe.size * 0.3)) throw new Error(`universe has only ${snap.members.length} members — data is incomplete`);

  // market history (≈120 days, using today's candidate set → approximate; display only)
  const hist = [];
  for (let d = 119; d >= 1; d--) {
    const s = snapshot(seriesList, t - d * DAY, config, { withEvents: false });
    if (s.btc && s.members.length >= 20) hist.push({ day: iso(t - d * DAY), trend: s.market.trend, gate: s.market.gate, breadth50: r(s.market.breadth50, 3) });
  }
  hist.push({ day: iso(t), trend: snap.market.trend, gate: snap.market.gate, breadth50: r(snap.market.breadth50, 3) });
  let gateDays = 1; for (let j = hist.length - 2; j >= 0 && hist[j].gate === snap.market.gate; j--) gateDays++;
  let trendDays = 1; for (let j = hist.length - 2; j >= 0 && hist[j].trend === snap.market.trend; j--) trendDays++;

  const priceOf = m => (live[m.S.sym] > 0 ? live[m.S.sym] : m.f.close);
  const rows = snap.members.map(m => {
    const price = priceOf(m), s = m.f.sigma, out = {
      sym: m.S.sym, price: sig(price), close: sig(m.f.close),
      chg1: r(m.f.chg1, 2), chg7: r(m.f.chg7, 2), chg30: r(m.f.chg30, 2),
      sigma: r(s, 5), near250: r(m.f.near250, 2), rsi: r(m.f.rsi, 1), v200: r(m.f.v200, 2), v50: r(m.f.v50, 2),
      atr: sig(m.f.atr), med30: Math.round(m.f.med30),
      rank: m.rank, rankPct: r(m.rankPct, 4), quintile: m.quintile, tier: m.tier, events: m.events || [],
      bands: {},
    };
    for (const k of [7, 30]) { const b = bands(model, price, s, k); if (b) out.bands[k] = Object.fromEntries(Object.entries(b).map(([q, v]) => [q, sig(v)])); }
    return out;
  });
  const bySym = new Map(snap.members.map(m => [m.S.sym, m]));
  // coins you hold or track that are NOT in today's universe still get a price and a range (no rank)
  const wanted = [...new Set([...(config.holdings || []), ...(config.track || [])])];
  const extra = [];
  for (const sym of wanted) {
    if (bySym.has(sym)) continue;
    const S = seriesList.find(x => x.sym === sym), i = S ? indexAt(S, t) : -1, f = i >= 1 ? featuresAt(S, i) : null;
    if (!f || !(f.sigma > 0)) continue;
    const price = live[sym] > 0 ? live[sym] : f.close, out = { sym, price: sig(price), close: sig(f.close), chg1: r(f.chg1, 2), chg7: r(f.chg7, 2), chg30: r(f.chg30, 2),
      sigma: r(f.sigma, 5), near250: r(f.near250, 2), rsi: r(f.rsi, 1), v200: r(f.v200, 2), v50: r(f.v50, 2), atr: sig(f.atr), med30: f.med30 === null ? null : Math.round(f.med30),
      rank: null, rankPct: null, quintile: null, tier: null, events: [], bands: {} };
    for (const k of [7, 30]) { const b = bands(model, price, f.sigma, k); if (b) out.bands[k] = Object.fromEntries(Object.entries(b).map(([q, v]) => [q, sig(v)])); }
    extra.push(out);
  }

  // levels: automatic structure levels for holdings + whatever the config lists under `watch`
  const levels = [];
  const addLevel = (sym, label, level, kind) => {
    const m = bySym.get(sym) || (() => { const S = seriesList.find(x => x.sym === sym); if (!S) return null; const i = indexAt(S, t); return i < 1 ? null : { S, i, f: featuresAt(S, i) }; })();
    if (!m || !(level > 0) || !(m.f.sigma > 0)) return;
    const price = priceOf(m);
    levels.push({ sym, label, kind, level: sig(level), distPct: r((level / price - 1) * 100, 2),
      touch7: r(touchProb(model, price, level, m.f.sigma, 7), 4), touch30: r(touchProb(model, price, level, m.f.sigma, 30), 4),
      extrapolated: isExtrapolated(price, level, m.f.sigma) });
  };
  for (const w of config.watch || []) addLevel(w.sym, w.label || 'watch level', w.level, 'watch');
  for (const sym of config.holdings || []) { const m = bySym.get(sym); if (m) for (const L of autoLevels(m.S, m.i)) addLevel(sym, L.label, L.level, 'auto'); }

  const events = [];
  for (const m of snap.members) for (const e of m.events || []) {
    const plan = planFor(m.f.close, m.f.atr, config.plan);
    events.push({ day: iso(t), sym: m.S.sym, event: e, tier: m.tier, rank: m.rank, close: sig(m.f.close), plan: plan && { entry: sig(plan.entry), stop: sig(plan.stop), target: sig(plan.target), days: plan.days } });
  }

  return {
    version: config.version, generatedAt: new Date(now).toISOString(), asOf: iso(t), asOfCloseTime: new Date(t + DAY).toISOString(),
    modelFittedThrough: model.fittedThrough,
    // true when pt.config.js was changed after the model was measured — the statistics shown then
    // describe the OLD rules. Fix: run the calibrate workflow.
    configDrift: JSON.stringify(model.config) !== JSON.stringify({ universe: config.universe, rank: config.rank, regime: config.regime, plan: config.plan }),
    market: { ...snap.market, breadth50: r(snap.market.breadth50, 3), breadth200: r(snap.market.breadth200, 3), medianRsi: r(snap.market.medianRsi, 1),
      btcVs200: r(snap.market.btcVs200, 2), btc30d: r(snap.market.btc30d, 2), gateDays, trendDays, history: hist },
    holdings: (config.holdings || []).filter(s => bySym.has(s) || extra.some(x => x.sym === s)),
    track: (config.track || []).filter(s => bySym.has(s) || extra.some(x => x.sym === s)),
    notInUniverse: wanted.filter(s => !bySym.has(s)),      // held / tracked but outside today's universe (shown without a rank)
    noData: wanted.filter(s => !bySym.has(s) && !extra.some(x => x.sym === s)),   // no usable candles at all — check the ticker
    rows, extra, levels, events,
  };
}
