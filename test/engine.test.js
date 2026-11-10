import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, buildSeries, featuresAt, sigmaAt, splitSegments } from '../engine/series.js';
import { snapshot, buildBoard, indexAt } from '../engine/board.js';
import { rankUniverse, percentiles } from '../engine/rank.js';
import { eventsAt } from '../engine/detectors.js';
import config from '../pt.config.js';
import model from '../model/model.js';
import { makeMarket, seriesFrom } from './helpers.js';

const market = makeMarket();
const END = Date.UTC(2026, 10, 9);
const cfg = { ...config, universe: { ...config.universe, size: 30 } };

test('no look-ahead: features at day i are identical whether or not later days exist', () => {
  const full = seriesFrom(market);
  for (const back of [1, 30, 200]) {
    const t = END - back * DAY, cut = seriesFrom(market, t);
    for (let j = 0; j < full.length; j += 5) {
      const a = featuresAt(full[j], indexAt(full[j], t)), b = featuresAt(cut[j], indexAt(cut[j], t));
      assert.deepEqual(a, b, `${full[j].sym} features differ ${back} days back`);
    }
  }
});

test('no look-ahead: the whole snapshot (universe, rank, market, events) is unchanged by future data', () => {
  const t = END - 45 * DAY;
  const a = snapshot(seriesFrom(market), t, cfg), b = snapshot(seriesFrom(market, t), t, cfg);
  const view = s => ({ market: s.market, members: s.members.map(m => [m.S.sym, m.rank, m.quintile, m.tier, m.events.join('+')]) });
  assert.deepEqual(view(a), view(b));
  assert.ok(a.members.length === 30);
});

test('live/backtest parity: a 420-candle fetch (1000 for BTC and ETH) gives the same rank and market state as full history', () => {
  const t = END, full = snapshot(seriesFrom(market), t, cfg);
  const live = snapshot([...market].map(([sym, bars]) => buildSeries(sym, bars.slice(-(sym === 'BTC' || sym === 'ETH' ? 1000 : 420)))), t, cfg);
  assert.deepEqual(live.members.map(m => [m.S.sym, m.rank]), full.members.map(m => [m.S.sym, m.rank]));
  // RSI is the one input with an infinite memory (Wilder smoothing): it converges, it is not identical
  const strip = m => ({ ...m, medianRsi: null });
  assert.deepEqual(strip(live.market), strip(full.market));
  assert.ok(Math.abs(live.market.medianRsi - full.market.medianRsi) < 1e-3);
  for (let j = 0; j < full.members.length; j++) {
    assert.ok(Math.abs(live.members[j].f.sigma - full.members[j].f.sigma) < 1e-12);
    assert.ok(Math.abs(live.members[j].f.near250 - full.members[j].f.near250) < 1e-9);
  }
});

test('rank: percentiles are a permutation-stable ranking and quintiles are balanced', () => {
  assert.deepEqual(percentiles([3, null, 1, 2]), [5 / 6, null, 1 / 6, 0.5]);
  const feats = Array.from({ length: 100 }, (_, i) => ({ near250: -i, sd30: 0.01 + i * 0.001 }));
  const r = rankUniverse(feats, ['nearHigh', 'lowVol']);
  assert.equal(r[0].rank, 1); assert.equal(r[99].rank, 100);
  for (const q of [1, 2, 3, 4, 5]) assert.equal(r.filter(x => x.quintile === q).length, 20);
  assert.equal(r.filter(x => x.tier === 'leader').length, 33); assert.equal(r.filter(x => x.tier === 'laggard').length, 33);
  assert.throws(() => rankUniverse(feats, ['nope']), /unknown rank factor/);
});

test('series: segments split at gaps and price discontinuities; sigma needs 90 days', () => {
  const bars = market.get('C05').slice(0, 300).map(b => [...b]);
  const gap = bars.slice(0, 100).concat(bars.slice(103));
  assert.equal(splitSegments(gap).length, 2);
  const jump = bars.map((b, i) => (i >= 150 ? [b[0], b[1] * 1000, b[2] * 1000, b[3] * 1000, b[4] * 1000, b[5], b[6]] : b));
  assert.equal(splitSegments(jump).length, 2);
  const S = buildSeries('X', bars);
  assert.equal(sigmaAt(S, 60), null); assert.ok(sigmaAt(S, 120) > 0);
});

test('detectors: ignition fires on a volume breakout and not the day before', () => {
  const bars = market.get('C07').slice(0, 200).map(b => [...b]);
  const hi = Math.max(...bars.slice(170, 199).map(b => b[2])), last = bars[199];
  last[4] = hi * 1.05; last[2] = hi * 1.06; last[5] *= 10; last[6] *= 10;
  const S = buildSeries('C07', bars);
  assert.ok(eventsAt(S, 199, {}).includes('IGNITION'));
  assert.ok(!eventsAt(S, 150, {}).includes('IGNITION') || S.c[150] > S.hi20[149]);
});

test('board: builds from synthetic data, is deterministic, and never uses the live price for a signal', () => {
  const sl = seriesFrom(market), now = END + DAY + 3600e3;
  const a = buildBoard({ seriesList: sl, live: {}, now, model, config: cfg });
  const b = buildBoard({ seriesList: sl, live: { BTC: 1, ETH: 1e9, C03: 5 }, now, model, config: cfg });
  assert.equal(a.asOf, '2026-11-09'); assert.equal(a.rows.length, 30);
  assert.deepEqual(a.rows.map(r => [r.sym, r.rank, r.tier, r.close]), b.rows.map(r => [r.sym, r.rank, r.tier, r.close]));
  assert.deepEqual({ ...a.market, history: 0 }, { ...b.market, history: 0 });
  const r = a.rows[0];
  assert.ok(r.bands[7].p10 < r.bands[7].p50 && r.bands[7].p50 < r.bands[7].p90);
  assert.ok(r.bands[30].p90 - r.bands[30].p10 > r.bands[7].p90 - r.bands[7].p10);
  assert.throws(() => buildBoard({ seriesList: sl.filter(S => S.sym !== 'BTC'), now, model, config: cfg }), /BTC series missing/);
});
