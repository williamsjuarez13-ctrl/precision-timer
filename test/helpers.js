// Synthetic market for tests: seeded geometric random walks with a shared market factor, so the
// suite needs no network and no candle cache. Coins differ in volatility and drift.
import { DAY, buildSeries } from '../engine/series.js';

export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const gauss = r => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// → Map sym → raw bars [[t,o,h,l,c,v,qv], …] for `days` days ending at `endT` (bar open time).
export function makeMarket({ coins = 40, days = 700, endT = Date.UTC(2026, 10, 9), seed = 42 } = {}) {
  const r = rng(seed), start = endT - (days - 1) * DAY, mkt = Array.from({ length: days }, () => gauss(r) * 0.02);
  const out = new Map();
  for (let cidx = 0; cidx < coins; cidx++) {
    const sym = cidx === 0 ? 'BTC' : cidx === 1 ? 'ETH' : 'C' + String(cidx).padStart(2, '0');
    const vol = cidx === 0 ? 0.012 : 0.015 + r() * 0.05, beta = cidx === 0 ? 1 : 0.6 + r() * 0.9, drift = (r() - 0.5) * 0.002;
    const liq = (5 + r() * 500) * 1e6; let p = 1 + r() * 1000; const bars = [];
    for (let d = 0; d < days; d++) {
      const ret = drift + beta * mkt[d] + gauss(r) * vol, o = p, c = p * Math.exp(ret);
      const wig = Math.abs(gauss(r)) * vol * 0.6, h = Math.max(o, c) * (1 + wig), l = Math.min(o, c) * (1 - wig);
      const qv = liq * (0.5 + r()) * (1 + 3 * Math.abs(ret) / (vol + 0.01));
      bars.push([start + d * DAY, o, h, l, c, qv / c, qv]); p = c;
    }
    out.set(sym, bars);
  }
  return out;
}
export const seriesFrom = (market, cut = Infinity, last = Infinity) =>
  [...market].map(([sym, bars]) => buildSeries(sym, bars.filter(b => b[0] <= cut).slice(-last)));

// A data client over the synthetic market that only reveals candles closed before `now`.
export function fakeClient(market, { failing = new Set() } = {}) {
  return {
    source: 'synthetic', errors: [],
    async tickers() { return [...market].map(([sym, bars]) => { const b = bars.filter(x => x[0] + DAY <= this.now).at(-1); return b ? { sym, last: b[4], quoteVolume: b[6] } : null; }).filter(Boolean); },
    async daily(sym, limit, now) { if (failing.has(sym)) throw new Error('HTTP 451'); const bars = market.get(sym); if (!bars) { const e = new Error('HTTP 400'); e.status = 400; throw e; } return { bars: bars.filter(b => b[0] + DAY <= now).slice(-limit), forming: null }; },
  };
}
