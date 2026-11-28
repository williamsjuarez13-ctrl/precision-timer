import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, buildSeries } from '../engine/series.js';
import { gatePath, exposurePath, actionOf, briefingFor } from '../engine/signal.js';
import config from '../pt.config.js';
import { makeMarket } from './helpers.js';

const C = { ...config.signal.capitulation, coins: null };

test('gate: 2/1 switches at 2 and 1; hysteresis keeps state in between; null until decisive', () => {
  const rd = a => a.map(t => ({ trend: t, full: 3 }));
  assert.deepEqual(gatePath(rd([0, 2, 1, 3, 2, 0]), { gateOnAt: 2, gateOffAt: 1 }), [false, true, false, true, true, false]);
  assert.deepEqual(gatePath(rd([2, 3, 2, 1, 2, 3]), { gateOnAt: 3, gateOffAt: 1 }), [null, true, true, false, false, true]);
  // before breadth existed only two facts: thresholds shift down by one
  assert.deepEqual(gatePath([{ trend: 1, full: 2 }, { trend: 0, full: 2 }], { gateOnAt: 2, gateOffAt: 1 }), [true, false]);
  assert.deepEqual(gatePath([null, { trend: 2, full: 3 }, null], { gateOnAt: 2, gateOffAt: 1 }), [null, true, true]);
});

test('actions: the word for every exposure move', () => {
  assert.equal(actionOf(0, 1), 'BUY'); assert.equal(actionOf(0.5, 1), 'ADD'); assert.equal(actionOf(1, 0), 'SELL');
  assert.equal(actionOf(1, 0.5), 'TRIM'); assert.equal(actionOf(1, 1), 'HOLD'); assert.equal(actionOf(0, 0), 'STAY OUT'); assert.equal(actionOf(0.5, 0.5), 'HOLD HALF');
});

// a coin that falls hard (RSI pinned low, far under the 200d EMA), then bounces
function crashThenBounce() {
  const bars = [], t0 = Date.UTC(2024, 0, 1); let p = 100;
  for (let d = 0; d < 400; d++) {
    const drift = d < 300 ? 0.001 : d < 340 ? -0.02 : d === 340 ? 0.06 : 0.01;
    const o = p; p = p * (1 + drift); bars.push([t0 + d * DAY, o, Math.max(o, p) * 1.003, Math.min(o, p) * 0.997, p, 1000, 1000 * p]);
  }
  return buildSeries('X', bars);
}

test('capitulation: buys half after RSI crosses back up while far under the 200d, only when the gate is OFF', () => {
  const S = crashThenBounce();
  const off = exposurePath(S, () => false, 210, C), on = exposurePath(S, () => true, 210, C);
  const firstBuy = off.findIndex(p => p && p.x > 0);
  assert.ok(firstBuy > 300, 'bought during the crash, not before it');
  assert.equal(off[firstBuy].x, C.size); assert.equal(off[firstBuy].mode, 'capitulation');
  assert.ok(S.rsi[firstBuy - 1] <= C.rsi && S.rsi[firstBuy] > C.rsi && S.c[firstBuy] > S.h[firstBuy - 1]);
  assert.ok(S.c[firstBuy] / S.e200[firstBuy] - 1 <= -C.below200);
  assert.ok(on.slice(210).every(p => p.x === 1 && p.mode === 'trend'));
  // a coin not in capitulation.coins never gets the tranche
  const only = exposurePath(S, () => false, 210, { ...C, coins: ['BTC'] });
  assert.ok(only.slice(210).every(p => p.x === 0));
});

test('capitulation: stop at the 20-day low, and never looks ahead', () => {
  const S = crashThenBounce();
  const full = exposurePath(S, () => false, 210, C), i = full.findIndex(p => p && p.x > 0);
  // re-run on history truncated at every day after entry: decisions up to that day must be identical
  for (const cut of [i, i + 3, i + 20]) {
    const bars = S.t.slice(0, cut + 1).map((t, j) => [t, S.o[j], S.h[j], S.l[j], S.c[j], S.v[j], S.qv[j]]);
    const short = exposurePath(buildSeries('X', bars), () => false, 210, C);
    for (let j = 210; j <= cut; j++) assert.equal(short[j].x, full[j].x, `day ${j}`);
  }
  // force a stop: a close under the stop after entry
  const bars = S.t.map((t, j) => [t, S.o[j], S.h[j], S.l[j], S.c[j], S.v[j], S.qv[j]]);
  const stop = full[i].cap.stop; bars[i + 2][4] = stop * 0.95; bars[i + 2][3] = stop * 0.94;
  const p2 = exposurePath(buildSeries('X', bars), () => false, 210, C);
  assert.equal(p2[i + 2].x, 0); assert.equal(p2[i + 2].exit, 'stop');
});

test('briefing: names the action, since when, and what would change it', () => {
  const S = crashThenBounce(), path = exposurePath(S, () => false, 210, C), i = path.findIndex(p => p && p.x > 0);
  const b = briefingFor(S, path, i, 'OFF', 0, C, config.regime);
  assert.equal(b.action, 'BUY'); assert.equal(b.changedToday, true); assert.equal(b.since, i);
  assert.ok(b.next.some(n => n.to === 0 && /stop/.test(n.when)) && b.next.some(n => n.to === 1));
  const b2 = briefingFor(S, path, 250, 'OFF', 0, C, config.regime);
  assert.equal(b2.action, 'STAY OUT'); assert.ok(b2.next[0].to === 1);
});

test('board: every briefed coin gets a signal, consistent with the gate', async () => {
  const { buildBoard } = await import('../engine/board.js');
  const model = (await import('../model/model.js')).default;
  const market = makeMarket(), END = Date.UTC(2026, 10, 9);
  const sl = [...market].map(([sym, bars]) => buildSeries(sym, bars));
  const cfg = { ...config, universe: { ...config.universe, size: 30 }, signal: { ...config.signal, coins: ['BTC', 'ETH', 'C03'] } };
  const b = buildBoard({ seriesList: sl, live: {}, now: END + DAY + 3600e3, model, config: cfg });
  assert.deepEqual(Object.keys(b.signals).sort(), ['BTC', 'C03', 'ETH']);
  for (const s of Object.values(b.signals)) {
    assert.ok(['BUY', 'ADD', 'HOLD', 'HOLD HALF', 'TRIM', 'SELL', 'STAY OUT'].includes(s.action));
    if (b.market.gate === 'ON') assert.equal(s.exposure, 1);
    assert.equal(s.history.close.length, s.history.x.length);
  }
  assert.equal(b.market.history.at(-1).gate, b.market.gate);
});
