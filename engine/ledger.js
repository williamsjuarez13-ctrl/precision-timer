// PrecisionTimer engine — the ledger: what the engine said, frozen, and how it turned out.
//
// Rules (the fix for v9's expectancy panel, where 48% of recorded "wins" came from the zone moving
// under price rather than price reaching the target):
//   • an entry is written once, at the daily close it refers to, with every level it needs — it is
//     never edited, re-anchored or deleted
//   • an entry is scored once, when it matures, from daily candles only, stop-first on same-day ties
//   • scores are separate append-only lines that point at the entry
// Pure functions — the scan script does the file and network work.
import { DAY } from './series.js';
import { bands } from './forecast.js';

const dayMs = d => Date.parse(d + 'T00:00:00Z');
const isoDay = t => new Date(t).toISOString().slice(0, 10);
const addDays = (d, k) => isoDay(dayMs(d) + k * DAY);
const sig = (x, d = 6) => +x.toPrecision(d);
export const BAND_HORIZONS = [7, 30];

// Entries for the daily close `board.asOf`. closeOf(sym) → that day's close; sigmaOf(sym) → daily σ.
export function entriesFor(board, model) {
  const day = board.asOf, out = [], bySym = new Map([...board.rows, ...(board.extra || [])].map(r => [r.sym, r]));
  out.push({ type: 'market', id: `market|${day}`, day, trend: board.market.trend, gate: board.market.gate,
    btc: bySym.get('BTC')?.close ?? null, eth: bySym.get('ETH')?.close ?? null });
  out.push({ type: 'rank', id: `rank|${day}`, day, members: board.rows.filter(r => r.quintile).map(r => [r.sym, r.close, r.quintile]) });
  for (const sym of board.track) {
    const r = bySym.get(sym); if (!r || !(r.sigma > 0)) continue;
    for (const k of BAND_HORIZONS) {
      const b = bands(model, r.close, r.sigma, k); if (!b) continue;
      out.push({ type: 'bands', id: `bands|${day}|${sym}|${k}`, day, due: addDays(day, k), sym, k, ref: r.close, sigma: r.sigma,
        q: Object.fromEntries(Object.entries(b).map(([p, v]) => [p, sig(v)])) });
    }
  }
  for (const e of board.events) {
    if (!e.plan) continue;
    out.push({ type: 'event', id: `event|${day}|${e.sym}|${e.event}`, day, due: addDays(day, e.plan.days), sym: e.sym, event: e.event, tier: e.tier, rank: e.rank, plan: e.plan });
  }
  return out;
}

// Score every matured, not-yet-scored entry.
//   lines        : all ledger lines so far (entries and scores)
//   lastClosed   : ISO day of the newest closed daily bar
//   closeOn(sym, day) → close of that day's bar or null;  barsBetween(sym, fromDay, toDay) → [[t,o,h,l,c],…] or null
export async function scoreDue(lines, lastClosed, closeOn, barsBetween) {
  const scored = new Set(lines.filter(l => l.type === 'score').map(l => l.ref + (l.k ? '|' + l.k : '')));
  const out = [];
  for (const e of lines) {
    if (e.type === 'bands') {
      if (scored.has(e.id) || e.due > lastClosed) continue;
      const c = await closeOn(e.sym, e.due); if (c === null) continue;
      out.push({ type: 'score', ref: e.id, kind: 'bands', day: e.due, sym: e.sym, horizon: e.k, close: c,
        in80: c >= e.q.p10 && c <= e.q.p90, in50: c >= e.q.p25 && c <= e.q.p75, below05: c < e.q.p05, above95: c > e.q.p95, ret: sig(c / e.ref - 1, 4) });
    } else if (e.type === 'rank') {
      for (const k of BAND_HORIZONS) {
        const due = addDays(e.day, k); if (scored.has(e.id + '|' + k) || due > lastClosed) continue;
        const acc = [0, 0, 0, 0, 0].map(() => ({ s: 0, n: 0 })); let us = 0, un = 0;
        for (const [sym, close, q] of e.members) { const c = await closeOn(sym, due); if (c === null) continue; const r = c / close - 1; acc[q - 1].s += r; acc[q - 1].n++; us += r; un++; }
        if (un < e.members.length * 0.8) continue;                      // too many prices missing to score fairly — try again next run
        const qm = acc.map(a => (a.n ? a.s / a.n : null)), uni = us / un;
        out.push({ type: 'score', ref: e.id, kind: 'rank', k, day: due, n: un, universe: sig(uni, 4), quintiles: qm.map(x => (x === null ? null : sig(x, 4))) });
      }
    } else if (e.type === 'event') {
      if (scored.has(e.id) || e.due > lastClosed) continue;
      const bars = await barsBetween(e.sym, addDays(e.day, 1), e.due); if (!bars || bars.length < e.plan.days) continue;
      let R = null, outcome = 'time';
      for (const b of bars) { if (b[3] <= e.plan.stop) { R = -1; outcome = 'stop'; break; } if (b[2] >= e.plan.target) { R = (e.plan.target - e.plan.entry) / (e.plan.entry - e.plan.stop); outcome = 'target'; break; } }
      if (R === null) R = (bars[bars.length - 1][4] - e.plan.entry) / (e.plan.entry - e.plan.stop);
      out.push({ type: 'score', ref: e.id, kind: 'event', day: e.due, sym: e.sym, event: e.event, tier: e.tier, outcome, R: sig(R, 4) });
    }
  }
  return out;
}

// Aggregate the ledger into the scorecard the page shows next to the backtest's expectations.
export function scorecard(lines) {
  const entries = new Map(lines.filter(l => l.type !== 'score').map(l => [l.id, l]));
  const sc = lines.filter(l => l.type === 'score');
  const out = { firstDay: null, lastDay: null, daysLogged: 0, bands: {}, rank: {}, events: {}, gate: null, recentEvents: [], pending: { bands: 0, events: 0 } };
  const mk = lines.filter(l => l.type === 'market').sort((a, b) => (a.day < b.day ? -1 : 1));
  if (mk.length) { out.firstDay = mk[0].day; out.lastDay = mk[mk.length - 1].day; out.daysLogged = mk.length; }
  for (const k of BAND_HORIZONS) {
    const b = sc.filter(s => s.kind === 'bands' && s.horizon === k);
    // `days` = distinct maturity dates. Forecasts made on neighbouring days for correlated coins are
    // not independent: treat days / k as the number of separate periods actually observed.
    out.bands[k] = { n: b.length, days: new Set(b.map(s => s.day)).size, in80: frac(b, 'in80'), in50: frac(b, 'in50'), below05: frac(b, 'below05'), above95: frac(b, 'above95') };
    const rk = sc.filter(s => s.kind === 'rank' && s.k === k && s.quintiles[4] !== null && s.quintiles[0] !== null);
    out.rank[k] = { n: rk.length, topExcess: avg(rk.map(s => s.quintiles[4] - s.universe)), bottomExcess: avg(rk.map(s => s.quintiles[0] - s.universe)), spread: avg(rk.map(s => s.quintiles[4] - s.quintiles[0])), universe: avg(rk.map(s => s.universe)) };
  }
  const ev = sc.filter(s => s.kind === 'event');
  for (const s of ev) { const key = `${s.event}|${s.tier}`; const a = (out.events[key] = out.events[key] || { n: 0, sumR: 0, wins: 0, targets: 0, stops: 0 }); a.n++; a.sumR += s.R; if (s.R > 0) a.wins++; if (s.outcome === 'target') a.targets++; if (s.outcome === 'stop') a.stops++; }
  for (const a of Object.values(out.events)) { a.meanR = +(a.sumR / a.n).toFixed(3); a.win = +(a.wins / a.n).toFixed(3); delete a.sumR; }
  const scoredRefs = new Map(ev.map(s => [s.ref, s]));
  const evEntries = [...entries.values()].filter(e => e.type === 'event').sort((a, b) => (a.day < b.day ? 1 : -1));
  out.recentEvents = evEntries.slice(0, 40).map(e => ({ day: e.day, sym: e.sym, event: e.event, tier: e.tier, rank: e.rank, plan: e.plan, outcome: scoredRefs.get(e.id)?.outcome ?? 'open', R: scoredRefs.get(e.id)?.R ?? null }));
  out.pending.events = evEntries.filter(e => !scoredRefs.has(e.id)).length;
  out.pending.bands = [...entries.values()].filter(e => e.type === 'bands').length - sc.filter(s => s.kind === 'bands').length;
  // exposure gate, lived: hold from one logged close to the next only when the gate was ON at the first
  if (mk.length >= 2) {
    const g = { days: 0, onDays: 0, eth: { hold: 1, gated: 1 }, btc: { hold: 1, gated: 1 }, switches: 0 };
    for (let j = 0; j + 1 < mk.length; j++) {
      const a = mk[j], b = mk[j + 1]; if (dayMs(b.day) - dayMs(a.day) !== DAY) continue;      // only consecutive days count
      g.days++; const on = a.gate === 'ON'; if (on) g.onDays++; if (j > 0 && mk[j - 1].gate !== a.gate) g.switches++;
      for (const [key, f] of [['eth', 'eth'], ['btc', 'btc']]) { if (!(a[f] > 0) || !(b[f] > 0)) continue; const r = b[f] / a[f]; g[key].hold *= r; if (on) g[key].gated *= r; }
    }
    for (const key of ['eth', 'btc']) { g[key].hold = +((g[key].hold - 1) * 100).toFixed(2); g[key].gated = +((g[key].gated - 1) * 100).toFixed(2); }
    out.gate = g;
  }
  return out;
}
const frac = (a, key) => (a.length ? +(a.filter(x => x[key]).length / a.length).toFixed(3) : null);
const avg = a => (a.length ? +((a.reduce((x, y) => x + y, 0) / a.length) * 100).toFixed(3) : null);
