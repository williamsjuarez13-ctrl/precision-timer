import test from 'node:test';
import assert from 'node:assert/strict';
import { HORIZONS, PROBS, STOPS, TARGETS, TOUCH_STEP, TOUCH_MAX, bands, touchProb, planOdds, tablesFor } from '../engine/forecast.js';
import { FACTORS } from '../engine/rank.js';
import { DETECTORS } from '../engine/detectors.js';
import config from '../pt.config.js';
import model from '../model/model.js';

test('model: has every table the engine reads, for every horizon', () => {
  for (const key of ['rank', 'market', 'events', 'forecast', 'fittedThrough', 'split', 'config']) assert.ok(model[key] !== undefined, key);
  for (const T of [model.forecast.pooled, ...model.forecast.buckets]) for (const k of HORIZONS) {
    assert.equal(T.q[k].length, PROBS.length); assert.equal(T.dn[k].length, TOUCH_MAX / TOUCH_STEP + 1); assert.equal(T.up[k].length, TOUCH_MAX / TOUCH_STEP + 1);
    assert.equal(T.plan[k].pT.length, STOPS.length); assert.equal(T.plan[k].pT[0].length, TARGETS.length);
  }
  for (const id of Object.keys(DETECTORS)) assert.ok(model.events.byEvent[id], id);
  for (const s of [0, 1, 2, 3]) assert.ok(model.market.byTrend[s]);
});

test('model matches the config it was measured with (otherwise: run `npm run calibrate`)', () => {
  assert.deepEqual(model.config, { universe: config.universe, rank: config.rank, regime: config.regime, plan: config.plan });
  for (const f of config.rank.factors) assert.ok(FACTORS[f], f);
  assert.ok(HORIZONS.includes(config.plan.maxDays));
});

test('bands: ordered, centred near spot, wider with volatility and with time', () => {
  for (const sigma of [0.015, 0.03, 0.07]) for (const k of HORIZONS) {
    const b = bands(model, 100, sigma, k), v = Object.values(b);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1]);
    assert.ok(b.p10 < 100 && b.p90 > 100);
  }
  const w = (s, k) => { const b = bands(model, 100, s, k); return b.p90 - b.p10; };
  assert.ok(w(0.03, 30) > w(0.03, 7)); assert.ok(w(0.06, 7) > w(0.03, 7));
  assert.equal(bands(model, 100, 0, 7), null);
});

test('touch probability: 1 at spot, falls with distance, rises with time and volatility', () => {
  for (const k of HORIZONS) {
    assert.ok(touchProb(model, 100, 99.99, 0.03, k) > 0.95);
    let prev = 1; for (const lvl of [95, 90, 80, 70, 50]) { const p = touchProb(model, 100, lvl, 0.03, k); assert.ok(p >= 0 && p <= prev + 1e-9, `${k}d ${lvl}`); prev = p; }
    prev = 1; for (const lvl of [105, 110, 125, 150, 200]) { const p = touchProb(model, 100, lvl, 0.03, k); assert.ok(p >= 0 && p <= prev + 1e-9); prev = p; }
  }
  assert.ok(touchProb(model, 100, 80, 0.03, 30) > touchProb(model, 100, 80, 0.03, 7));
  // (compared within one volatility bucket: tables can differ between buckets)
  const [lo, hi] = model.forecast.sigmaCuts; const s1 = hi * 1.1, s2 = hi * 1.6;
  assert.ok(touchProb(model, 100, 80, s2, 7) > touchProb(model, 100, 80, s1, 7));
  assert.ok(lo < hi);
  // far beyond anything that has happened in 30 days → effectively zero, not a clamped tail value
  assert.ok(touchProb(model, 100, 5, 0.03, 30) < 0.005);
});

test('plan odds: probabilities are coherent and the break-even maths is right', () => {
  const o = planOdds(model, { entry: 100, stop: 94, target: 112, sigma: 0.035, k: 14 });
  assert.ok(o.pTarget > 0 && o.pStop > 0 && o.pTarget + o.pStop <= 1 + 1e-9);
  assert.ok(Math.abs(o.rr - 2) < 1e-9); assert.ok(Math.abs(o.breakeven - 1 / 3) < 1e-9);
  const far = planOdds(model, { entry: 100, stop: 94, target: 130, sigma: 0.035, k: 14 });
  assert.ok(far.pTarget < o.pTarget);
  const tight = planOdds(model, { entry: 100, stop: 98, target: 112, sigma: 0.035, k: 14 });
  assert.ok(tight.pStop > o.pStop);
  assert.equal(planOdds(model, { entry: 100, stop: 101, target: 112, sigma: 0.035, k: 14 }), null);
  assert.equal(planOdds(model, { entry: 100, stop: -5, target: 112, sigma: 0.035, k: 14 }), null);
  assert.ok(planOdds(model, { entry: 100, stop: 99.9, target: 100.1, sigma: 0.035, k: 14 }).clamped);
  assert.ok(tablesFor(model, 0.03).q[7]);
});
