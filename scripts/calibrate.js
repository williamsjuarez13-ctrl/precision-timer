#!/usr/bin/env node
// PrecisionTimer — calibrate.  Measures everything the board is allowed to say, and writes it to
// model/model.js.  This is also the backtest: it replays the engine's own snapshot() for every day
// since config.calibration.start, with a point-in-time universe (delisted coins included while they
// traded), and reports every rule separately for the period from config.calibration.split onward.
// The forecast tables are fitted before the split and scored after it (a true out-of-sample test);
// for rules you design, the later period is only a fair test if you had the idea before looking at it.
//
//   npm run calibrate                 download/refresh history into .cache/1d, then measure
//   npm run calibrate -- --offline    measure from the cache only
//   PT_DATA_DIR=/some/dir             use another cache directory
//   PT_UNTIL=2026-07-31 PT_MODEL_OUT=/tmp/m   measure as of a past date, write elsewhere
//
// To test an idea: change pt.config.js (or add a factor / detector in engine/), run this, and read
// model/REPORT.md. If the out-of-sample columns don't improve, the idea didn't work.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../pt.config.js';
import { DAY, buildSeries, splitSegments } from '../engine/series.js';
import { isExcludedName } from '../engine/universe.js';
import { snapshot, indexAt } from '../engine/board.js';
import { HORIZONS, PROBS, TOUCH_STEP, TOUCH_MAX, STOPS, TARGETS, bands, touchProb, planOdds } from '../engine/forecast.js';
import { DETECTORS, planFor } from '../engine/detectors.js';
import { makeClient, pooled } from '../engine/data.js';
import { gatePath, exposurePath } from '../engine/signal.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const CACHE = process.env.PT_DATA_DIR || path.join(ROOT, '.cache', '1d');
// PT_UNTIL=YYYY-MM-DD measures as if that were the last closed day (used by `npm run paper` for honest forward tests)
const NOW = process.env.PT_UNTIL ? Date.parse(process.env.PT_UNTIL + 'T00:00:00Z') + DAY : Date.now();
const OUT = process.env.PT_MODEL_OUT || path.join(ROOT, 'model');
const START = Date.parse(config.calibration.start), SPLIT = Date.parse(config.calibration.split);
if (!HORIZONS.includes(config.plan.maxDays)) throw new Error(`config.plan.maxDays must be one of ${HORIZONS} (the horizons the model measures)`);
const KMAX = Math.max(...HORIZONS);
const log = (...a) => console.error(...a);
const rd = (x, d = 4) => (x === null || x === undefined || Number.isNaN(x) ? null : +x.toFixed(d));
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const quant = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
const isoDay = t => new Date(t).toISOString().slice(0, 10);

/* ───────────────────────── 1. data ───────────────────────── */
async function refreshCache() {
  fs.mkdirSync(CACHE, { recursive: true });
  const client = makeClient(config.data);
  const syms = (await client.usdtSymbols()).map(s => s.sym).filter(s => !isExcludedName(s));
  log(`refreshing ${syms.length} USDT pairs into ${CACHE} (source ${client.source})`);
  let done = 0, failed = 0;
  await pooled(syms, 8, async sym => {
    const file = path.join(CACHE, sym + 'USDT.json');
    let have = []; try { have = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new symbol */ }
    // re-fetch the last two cached bars too: the newest one may have been stored while still forming
    have = have.slice(0, Math.max(0, have.length - 2));
    const from = have.length ? have[have.length - 1][0] + DAY : START;
    try { const { bars } = await client.dailySince(sym, from, NOW); fs.writeFileSync(file, JSON.stringify(have.concat(bars))); }
    catch (e) { failed++; if (failed <= 5) log(`  ${sym}: ${e.message}`); }
    if (++done % 100 === 0) log(`  ${done}/${syms.length}`);
  });
  if (failed > syms.length * 0.1) throw new Error(`${failed} of ${syms.length} symbols failed to download — refusing to calibrate on partial data`);
  log(`refresh done (${failed} failed)`);
}

function loadSeries() {
  const out = [];
  for (const f of fs.readdirSync(CACHE)) {
    if (!f.endsWith('USDT.json')) continue;
    const sym = f.slice(0, -9); if (isExcludedName(sym)) continue;
    let bars = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')).filter(b => b[0] + DAY <= NOW && b[4] > 0 && b[1] > 0);
    const segs = splitSegments(bars);
    segs.forEach((seg, q) => { if (seg.length >= 60) out.push(buildSeries(q === segs.length - 1 ? sym : `${sym}~${q}`, seg)); });
  }
  return out;
}

/* ───────────────────────── helpers ───────────────────────── */
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// 95% CI of a mean of per-observation values, resampling whole calendar blocks (observations on
// nearby days are not independent; this is what keeps the intervals honest).
function blockCI(byDaySum, byDayCnt, block, reps = 600, seed = 7) {
  const T = byDaySum.length; if (T < block * 3) return [null, null];
  const rnd = seeded(seed), nb = Math.ceil(T / block), ps = new Float64Array(T + 1), pc = new Float64Array(T + 1), ms = [];
  for (let i = 0; i < T; i++) { ps[i + 1] = ps[i] + byDaySum[i]; pc[i + 1] = pc[i] + byDayCnt[i]; }
  for (let r = 0; r < reps; r++) { let S = 0, C = 0; for (let b = 0; b < nb; b++) { const a = Math.floor(rnd() * (T - block + 1)); S += ps[a + block] - ps[a]; C += pc[a + block] - pc[a]; } if (C > 0) ms.push(S / C); }
  ms.sort((a, b) => a - b);
  return ms.length ? [ms[Math.floor(ms.length * 0.025)], ms[Math.floor(ms.length * 0.975)]] : [null, null];
}
function dist(values) {            // summary of a list of returns (fractions) → percentages
  const v = values.filter(x => x !== null && !Number.isNaN(x)); if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return { n: v.length, mean: rd(mean(v) * 100, 2), median: rd(quant(s, 0.5) * 100, 2), pUp: rd(v.filter(x => x > 0).length / v.length, 3),
    pDown10: rd(v.filter(x => x < -0.10).length / v.length, 3), p10: rd(quant(s, 0.1) * 100, 1), p90: rd(quant(s, 0.9) * 100, 1) };
}

/* ───────────────────────── 2. replay ───────────────────────── */
async function main() {
  if (!args.has('--offline')) await refreshCache();
  const t00 = Date.now();
  const seriesList = loadSeries();
  const btc = seriesList.find(S => S.sym === 'BTC'), eth = seriesList.find(S => S.sym === 'ETH');
  if (!btc || !eth) throw new Error('BTC/ETH history missing from the cache');
  const lastT = btc.t[btc.n - 1];
  const days = []; for (let t = Math.max(START, btc.t[0]); t <= lastT; t += DAY) days.push(t);
  const T = days.length, dayIdx = t => Math.round((t - days[0]) / DAY);
  log(`${seriesList.length} series · ${T} days ${isoDay(days[0])} → ${isoDay(lastT)} · replaying snapshot() for each day…`);

  // one record per (member, day)
  const R = { D: [], S: [], i: [], q: [], tier: [], rp: [], sg: [], ev: [] };
  const mkt = new Array(T).fill(null);
  for (let D = 0; D < T; D++) {
    const snap = snapshot(seriesList, days[D], config);
    if (!snap.btc || snap.members.length < 30) continue;
    mkt[D] = { ...snap.market, n: snap.members.length };
    for (const m of snap.members) { if (m.rankPct === null) continue; R.D.push(D); R.S.push(m.S); R.i.push(m.i); R.q.push(m.quintile); R.tier.push(m.tier); R.rp.push(m.rankPct); R.sg.push(m.f.sigma); R.ev.push(m.events); }
  }
  // the gate has hysteresis: replay it day by day over the whole history
  { const gp = gatePath(mkt.map(m => (m ? { trend: m.trend, full: 3 } : null)), config.regime);
    for (let D = 0; D < T; D++) if (mkt[D]) mkt[D].gate = gp[D] === true ? 'ON' : 'OFF'; }
  const N = R.D.length;
  log(`replay done in ${((Date.now() - t00) / 1000).toFixed(1)}s — ${N} member-days, ${mkt.filter(Boolean).length} days with a universe`);

  // forward close-to-close returns (reference = the signal bar's close), winsorised, minus the same-day universe mean
  const fwd = {}, exc = {}, uniMean = {};
  for (const k of HORIZONS) {
    const raw = new Float64Array(N).fill(NaN);
    for (let r = 0; r < N; r++) { const S = R.S[r], i = R.i[r]; if (i + k < S.n) raw[r] = S.c[i + k] / S.c[i] - 1; }
    const srt = Array.from(raw).filter(x => !Number.isNaN(x)).sort((a, b) => a - b), lo = quant(srt, 0.005), hi = quant(srt, 0.995);
    const w = raw.map(x => (Number.isNaN(x) ? NaN : Math.min(hi, Math.max(lo, x))));
    const sum = new Float64Array(T), cnt = new Float64Array(T);
    for (let r = 0; r < N; r++) if (!Number.isNaN(w[r])) { sum[R.D[r]] += w[r]; cnt[R.D[r]]++; }
    fwd[k] = w; uniMean[k] = Array.from(sum, (s, D) => (cnt[D] ? s / cnt[D] : null));
    exc[k] = w.map((x, r) => (Number.isNaN(x) ? NaN : x - uniMean[k][R.D[r]]));
  }
  const splitD = dayIdx(SPLIT);
  const ERAS = { all: [0, T], train: [0, splitD], test: [splitD, T] };
  const inEra = (r, e) => R.D[r] >= ERAS[e][0] && R.D[r] < ERAS[e][1];

  /* ───────── 3. RANK ───────── */
  const rank = { factors: config.rank.factors, horizons: {} };
  for (const k of HORIZONS) {
    const o = {};
    for (const e of Object.keys(ERAS)) {
      const q = Array.from({ length: 5 }, () => ({ x: 0, raw: 0, n: 0, beat: 0 }));
      const topS = new Float64Array(T), topC = new Float64Array(T), botS = new Float64Array(T), botC = new Float64Array(T);
      for (let r = 0; r < N; r++) { if (!inEra(r, e) || Number.isNaN(exc[k][r])) continue; const a = q[R.q[r] - 1]; a.x += exc[k][r]; a.raw += fwd[k][r]; a.n++; if (exc[k][r] > 0) a.beat++;
        if (R.q[r] === 5) { topS[R.D[r]] += exc[k][r]; topC[R.D[r]]++; } if (R.q[r] === 1) { botS[R.D[r]] += exc[k][r]; botC[R.D[r]]++; } }
      // spread series by day (top − bottom), bootstrapped
      const [lo, hi] = ERAS[e]; const spS = [], spC = [];
      for (let D = lo; D < hi; D++) { if (topC[D] && botC[D]) { spS.push(topS[D] / topC[D] - botS[D] / botC[D]); spC.push(1); } else { spS.push(0); spC.push(0); } }
      const ciS = blockCI(Float64Array.from(spS), Float64Array.from(spC), Math.max(k, 5));
      const ciT = blockCI(topS.subarray(lo, hi), topC.subarray(lo, hi), Math.max(k, 5)), ciB = blockCI(botS.subarray(lo, hi), botC.subarray(lo, hi), Math.max(k, 5));
      const nDays = spC.reduce((a, b) => a + b, 0);
      o[e] = {
        quintileExcess: q.map(a => rd(a.n ? a.x / a.n * 100 : null, 2)), quintileRaw: q.map(a => rd(a.n ? a.raw / a.n * 100 : null, 2)), quintileBeat: q.map(a => rd(a.n ? a.beat / a.n : null, 3)),
        topCI: ciT.map(x => rd(x === null ? null : x * 100, 2)), bottomCI: ciB.map(x => rd(x === null ? null : x * 100, 2)),
        spread: rd(nDays ? spS.reduce((a, b) => a + b, 0) / nDays * 100 : null, 2), spreadCI: ciS.map(x => rd(x === null ? null : x * 100, 2)), days: nDays, n: q.reduce((a, b) => a + b.n, 0),
      };
    }
    rank.horizons[k] = o;
  }

  /* ───────── 4. MARKET ───────── */
  const assetFwd = (S, k) => days.map(t => { const i = indexAt(S, t); return i >= 0 && i + k < S.n ? S.c[i + k] / S.c[i] - 1 : null; });
  const F = { universe: uniMean, BTC: {}, ETH: {} };
  for (const k of HORIZONS) { F.BTC[k] = assetFwd(btc, k); F.ETH[k] = assetFwd(eth, k); }
  const stateStats = (pred, era = 'all') => {
    const out = { days: 0 };
    for (const a of ['universe', 'BTC', 'ETH']) { out[a] = {}; for (const k of HORIZONS) { const v = []; for (let D = ERAS[era][0]; D < ERAS[era][1]; D++) if (mkt[D] && pred(mkt[D]) && F[a][k][D] !== null) v.push(F[a][k][D]); out[a][k] = dist(v); } }
    for (let D = ERAS[era][0]; D < ERAS[era][1]; D++) if (mkt[D] && pred(mkt[D])) out.days++;
    return out;
  };
  const market = { byTrend: {}, gate: {}, washout: stateStats(m => m.washout), allDays: stateStats(() => true) };
  for (const s of [0, 1, 2, 3]) market.byTrend[s] = stateStats(m => m.trend === s);
  for (const g of ['ON', 'OFF']) market.gate[g] = { all: stateStats(m => m.gate === g), test: stateStats(m => m.gate === g, 'test') };
  // gate as an exposure rule: hold when ON at the close, cash when OFF; 0.10% per switch
  const dailyRet = S => days.map(t => { const i = indexAt(S, t); return i >= 0 && i + 1 < S.n ? S.c[i + 1] / S.c[i] - 1 : null; });
  const ewRet = (() => { const s = new Float64Array(T), c = new Float64Array(T); for (let r = 0; r < N; r++) { const S = R.S[r], i = R.i[r]; if (i + 1 >= S.n) continue; const x = S.c[i + 1] / S.c[i] - 1; if (x > 1.5 || x < -0.6) continue; s[R.D[r]] += x; c[R.D[r]]++; } return Array.from(s, (v, D) => (c[D] >= 30 ? v / c[D] : null)); })();
  function curve(ret, gated, [lo, hi], cost = 0.001) {
    let eq = 1, peak = 1, dd = 0, n = 0, on = 0, sw = 0, prev = null;
    for (let D = lo; D < hi; D++) { if (ret[D] === null || !mkt[D]) continue; const p = gated ? (mkt[D].gate === 'ON' ? 1 : 0) : 1;
      if (prev !== null && p !== prev) { eq *= 1 - cost; sw++; } prev = p; eq *= 1 + (p ? ret[D] : 0); if (eq > peak) peak = eq; dd = Math.min(dd, eq / peak - 1); n++; on += p; }
    const yrs = n / 365;
    return { totalPct: rd((eq - 1) * 100, 1), cagrPct: rd((Math.pow(eq, 1 / yrs) - 1) * 100, 1), maxDrawdownPct: rd(dd * 100, 1), inMarket: rd(on / n, 3), switchesPerYear: rd(sw / yrs, 1), years: rd(yrs, 2) };
  }
  market.gateCurves = {};
  for (const [name, ret] of [['BTC', dailyRet(btc)], ['ETH', dailyRet(eth)], ['universe', ewRet]]) {
    market.gateCurves[name] = {};
    for (const e of ['train', 'test']) market.gateCurves[name][e] = { hold: curve(ret, false, ERAS[e]), gated: curve(ret, true, ERAS[e]) };
  }

  /* ───────── 4b. DAILY SIGNAL (engine/signal.js) — the record printed next to every briefing ───────── */
  const signal = { coins: {}, note: 'decision at the daily close, held to the next close; 0.10% cost per unit of exposure changed' };
  { const gp = gatePath(mkt.map(m => (m ? { trend: m.trend, full: 3 } : null)), config.regime);
    const gateOf = tt => { const D = dayIdx(tt); return D >= 0 && D < T && mkt[D] ? gp[D] : null; };
    const v11Of = tt => { const D = dayIdx(tt); return D >= 0 && D < T && mkt[D] ? mkt[D].trend >= 2 : null; };
    const firstD = mkt.findIndex(Boolean);
    const sim = (S, xs, lo, hi) => {            // xs[i] = exposure decided at close i
      let eq = 1, hold = 1, pk = 1, hpk = 1, dd = 0, hdd = 0, n = 0, ex = 0, sw = 0, prev = 0;
      const trades = []; let open = null;
      for (let i = lo; i < hi; i++) { const x = xs[i] ?? 0, rt = S.c[i + 1] / S.c[i] - 1;
        if (Math.abs(x - prev) > 1e-9) { eq *= 1 - 0.001 * Math.abs(x - prev); sw++;
          if (prev === 0) open = { i, eq }; else if (x === 0 && open) { trades.push(eq / open.eq - 1); open = null; } }
        prev = x; eq *= 1 + x * rt; hold *= 1 + rt; n++; ex += x;
        pk = Math.max(pk, eq); dd = Math.min(dd, eq / pk - 1); hpk = Math.max(hpk, hold); hdd = Math.min(hdd, hold / hpk - 1); }
      const yrs = n / 365, w = trades.filter(x => x > 0);
      return { from: isoDay(S.t[lo]), to: isoDay(S.t[hi]), years: rd(yrs, 2), totalPct: rd((eq - 1) * 100, 1), cagrPct: rd((Math.pow(eq, 1 / yrs) - 1) * 100, 1), maxDrawdownPct: rd(dd * 100, 1),
        holdTotalPct: rd((hold - 1) * 100, 1), holdCagrPct: rd((Math.pow(hold, 1 / yrs) - 1) * 100, 1), holdMaxDrawdownPct: rd(hdd * 100, 1),
        exposure: rd(ex / n, 3), changesPerYear: rd(sw / yrs, 1), trades: trades.length, hit: trades.length ? rd(w.length / trades.length, 3) : null,
        avgWinPct: w.length ? rd(mean(w) * 100, 1) : null, avgLossPct: trades.length > w.length ? rd(mean(trades.filter(x => x <= 0)) * 100, 1) : null };
    };
    const coins = [...new Set([...(config.signal.coins || []), ...(config.holdings || []), ...(config.track || [])])];
    for (const sym of coins) {
      const S = seriesList.find(x => x.sym === sym); if (!S) continue;
      const lo0 = Math.max(201, S.t.findIndex(tt => tt >= days[firstD])); if (lo0 < 0 || lo0 >= S.n - 30) continue;
      const path = exposurePath(S, gateOf, lo0, config.signal.capitulation), xs = path.map(p => (p ? p.x : 0));
      const old = S.t.map(tt => (v11Of(tt) ? 1 : 0));
      const splitI = S.t.findIndex(tt => tt >= SPLIT), hi = S.n - 1;
      // capitulation trades on their own, and what the coin did after every BUY / SELL
      const capTrades = []; let ci = null;
      for (let i = lo0; i < S.n; i++) { const p = path[i]; if (!p) continue;
        if (p.mode === 'capitulation' && ci === null) ci = i;
        if (ci !== null && p.mode !== 'capitulation') { capTrades.push({ day: isoDay(S.t[ci]), entry: S.c[ci], exit: S.c[i], exitDay: isoDay(S.t[i]), how: p.mode === 'trend' ? 'gate ON (kept, now 100%)' : p.exit, retPct: rd((S.c[i] / S.c[ci] - 1) * 100, 1) }); ci = null; } }
      const after = { buy: [], sell: [] };
      for (let i = lo0 + 1; i + 30 < S.n; i++) { const a = xs[i - 1], b = xs[i]; if (a === 0 && b > 0) after.buy.push(S.c[i + 30] / S.c[i] - 1); if (a > 0 && b === 0) after.sell.push(S.c[i + 30] / S.c[i] - 1); }
      signal.coins[sym] = {
        all: sim(S, xs, lo0, hi), test: splitI > lo0 ? sim(S, xs, splitI, hi) : null,
        v11: { all: sim(S, old, lo0, hi), test: splitI > lo0 ? sim(S, old, splitI, hi) : null },
        capitulation: { n: capTrades.length, hit: capTrades.length ? rd(capTrades.filter(x => x.retPct > 0).length / capTrades.length, 3) : null, medianPct: capTrades.length ? rd(quant(capTrades.map(x => x.retPct).sort((a, b) => a - b), 0.5), 1) : null, recent: capTrades.slice(-6) },
        after30: { buy: dist(after.buy), sell: dist(after.sell) },
      };
    }
  }

  /* ───────── 5. EVENTS ───────── */
  const P = config.plan, planK = P.maxDays;
  function planR(S, i) {         // frozen plan from the signal close; stop first if both trade on the same day
    const pl = planFor(S.c[i], S.atr[i], P); if (!pl || i + planK >= S.n) return null;
    for (let j = i + 1; j <= i + planK; j++) { if (S.l[j] <= pl.stop) return -1; if (S.h[j] >= pl.target) return P.targetAtr / P.stopAtr; }
    return (S.c[i + planK] - pl.entry) / (pl.entry - pl.stop);
  }
  const planAll = new Float64Array(N).fill(NaN); for (let r = 0; r < N; r++) { const x = planR(R.S[r], R.i[r]); if (x !== null) planAll[r] = x; }
  const planBase = e => { const v = []; for (let r = 0; r < N; r++) if (inEra(r, e) && !Number.isNaN(planAll[r])) v.push(planAll[r]); return { n: v.length, meanR: rd(mean(v), 3), win: rd(v.filter(x => x > 0).length / v.length, 3) }; };
  function eventStats(idx) {
    const o = { n: idx.length };
    for (const k of [7, 30]) {
      const xs = idx.map(r => exc[k][r]).filter(x => !Number.isNaN(x)).sort((a, b) => a - b), rw = idx.map(r => fwd[k][r]).filter(x => !Number.isNaN(x));
      const sum = new Float64Array(T), cnt = new Float64Array(T); for (const r of idx) if (!Number.isNaN(exc[k][r])) { sum[R.D[r]] += exc[k][r]; cnt[R.D[r]]++; }
      const ci = xs.length >= 30 ? blockCI(sum, cnt, Math.max(k, 5)) : [null, null];
      o[k] = xs.length ? { n: xs.length, excessMean: rd(mean(xs) * 100, 2), excessCI: ci.map(x => rd(x === null ? null : x * 100, 2)), excessMedian: rd(quant(xs, 0.5) * 100, 2), beat: rd(xs.filter(x => x > 0).length / xs.length, 3),
        p10: rd(quant(xs, 0.1) * 100, 1), p90: rd(quant(xs, 0.9) * 100, 1), rawMean: rd(mean(rw) * 100, 2), rawUp: rd(rw.filter(x => x > 0).length / rw.length, 3) } : null;
    }
    const pr = idx.map(r => planAll[r]).filter(x => !Number.isNaN(x));
    o.plan = pr.length ? { n: pr.length, meanR: rd(mean(pr), 3), win: rd(pr.filter(x => x > 0).length / pr.length, 3), targetHit: rd(pr.filter(x => x >= P.targetAtr / P.stopAtr - 1e-9).length / pr.length, 3), stopHit: rd(pr.filter(x => x <= -1 + 1e-9).length / pr.length, 3) } : null;
    return o;
  }
  const events = { plan: { ...P, baseline: { all: planBase('all'), test: planBase('test') } }, byEvent: {} };
  for (const id of Object.keys(DETECTORS)) {
    events.byEvent[id] = { label: DETECTORS[id].label, describe: DETECTORS[id].describe, tiers: {} };
    for (const tier of ['all', 'leader', 'middle', 'laggard']) {
      const pick = e => { const a = []; for (let r = 0; r < N; r++) if (inEra(r, e) && R.ev[r].includes(id) && (tier === 'all' || R.tier[r] === tier)) a.push(r); return a; };
      events.byEvent[id].tiers[tier] = { all: eventStats(pick('all')), test: eventStats(pick('test')) };
    }
  }
  // rank-tier baselines, so an event can be read against "just being a leader"
  events.tierBaseline = {};
  for (const tier of ['leader', 'middle', 'laggard']) { const pick = e => { const a = []; for (let r = 0; r < N; r++) if (inEra(r, e) && R.tier[r] === tier) a.push(r); return a; }; events.tierBaseline[tier] = { all: eventStats(pick('all')), test: eventStats(pick('test')) }; }

  /* ───────── 6. FORECAST TABLES ───────── */
  log('building forecast tables…');
  const NS = STOPS.length, NT = TARGETS.length, NG = Math.round(TOUCH_MAX / TOUCH_STEP) + 1, NH = HORIZONS.length;
  // per-sample path summaries
  const ok = new Uint8Array(N), Z = HORIZONS.map(() => new Float32Array(N)), MN = HORIZONS.map(() => new Float32Array(N)), MX = HORIZONS.map(() => new Float32Array(N));
  const dnDay = new Uint8Array(N * NS).fill(255), upDay = new Uint8Array(N * NT).fill(255);
  for (let r = 0; r < N; r++) {
    const S = R.S[r], i = R.i[r], sg = R.sg[r]; if (!(sg > 0) || i + KMAX >= S.n) continue;
    ok[r] = 1; const p = S.c[i]; let mn = 0, mx = 0, a = 0, b = 0;
    for (let j = 1; j <= KMAX; j++) {
      const lo = Math.log(S.l[i + j] / p) / sg, hi = Math.log(S.h[i + j] / p) / sg;
      if (lo < mn) mn = lo; if (hi > mx) mx = hi;
      while (a < NS && -mn >= STOPS[a]) dnDay[r * NS + a++] = j;
      while (b < NT && mx >= TARGETS[b]) upDay[r * NT + b++] = j;
      const h = HORIZONS.indexOf(j); if (h >= 0) { Z[h][r] = Math.log(S.c[i + j] / p) / sg; MN[h][r] = mn; MX[h][r] = mx; }
    }
  }
  function fit(idx) {
    const out = { n: idx.length, q: {}, dn: {}, up: {}, plan: {} };
    HORIZONS.forEach((k, h) => {
      const zs = Float32Array.from(idx, r => Z[h][r]).sort();
      out.q[k] = PROBS.map(p => rd(quant(zs, p), 3));
      const hd = new Float64Array(NG), hu = new Float64Array(NG);
      for (const r of idx) { hd[Math.min(NG - 1, Math.floor(-MN[h][r] / TOUCH_STEP))]++; hu[Math.min(NG - 1, Math.floor(MX[h][r] / TOUCH_STEP))]++; }
      const surv = hist => { const o = new Array(NG); let c = 0; for (let g = NG - 1; g >= 0; g--) { c += hist[g]; o[g] = rd(c / idx.length, 4); } return o; };
      out.dn[k] = surv(hd); out.up[k] = surv(hu);
      const pT = new Float64Array(NS * NT), pS = new Float64Array(NS * NT), mz = new Float64Array(NS * NT), op = new Float64Array(NS * NT);
      for (const r of idx) { const z = Z[h][r];
        for (let s = 0; s < NS; s++) { const ds = dnDay[r * NS + s];
          for (let t = 0; t < NT; t++) { const du = upDay[r * NT + t], c = s * NT + t;
            if (ds <= k && ds <= du) pS[c]++; else if (du <= k) pT[c]++; else { op[c]++; mz[c] += z; } } } }
      const grid = (arr, f) => Array.from({ length: NS }, (_, s) => Array.from({ length: NT }, (_, t) => f(arr, s * NT + t)));
      out.plan[k] = { pT: grid(pT, (a, c) => rd(a[c] / idx.length, 4)), pS: grid(pS, (a, c) => rd(a[c] / idx.length, 4)), mz: grid(mz, (a, c) => rd(op[c] ? a[c] / op[c] : 0, 3)) };
    });
    return out;
  }
  function fitModel(idx) {      // pooled + three volatility buckets (cuts = terciles of σ in the fitting set)
    const sg = idx.map(r => R.sg[r]).sort((a, b) => a - b), cuts = [rd(quant(sg, 1 / 3), 5), rd(quant(sg, 2 / 3), 5)];
    const b = [[], [], []]; for (const r of idx) b[R.sg[r] < cuts[0] ? 0 : R.sg[r] < cuts[1] ? 1 : 2].push(r);
    return { sigmaCuts: cuts, pooled: fit(idx), buckets: b.map(fit) };
  }
  const allIdx = [], trainIdx = [], testIdx = [];
  for (let r = 0; r < N; r++) { if (!ok[r]) continue; allIdx.push(r); (R.D[r] < splitD ? trainIdx : testIdx).push(r); }
  const fTrain = fitModel(trainIdx);
  // out-of-sample validation: tables fitted on TRAIN, scored on TEST, through the engine's own lookup functions
  function validate(mode) {
    const M = { forecast: { ...fTrain, mode } }, v = { bands: {}, touch: {}, byCoin: {} };
    for (const k of [7, 30]) {
      const h = HORIZONS.indexOf(k); let loss = 0, n = 0, in80 = 0, in50 = 0, lo5 = 0, hi95 = 0;
      for (const r of testIdx) { const b = bands(M, 1, R.sg[r], k), y = Math.exp(Z[h][r] * R.sg[r]); const qs = [b.p05, b.p10, b.p25, b.p50, b.p75, b.p90, b.p95];
        PROBS.forEach((p, j) => { const d = Math.log(y) - Math.log(qs[j]); loss += d * (p - (d < 0 ? 1 : 0)); }); n++;
        if (y >= b.p10 && y <= b.p90) in80++; if (y >= b.p25 && y <= b.p75) in50++; if (y < b.p05) lo5++; if (y > b.p95) hi95++; }
      v.bands[k] = { n, pinball: rd(loss / n / PROBS.length * 100, 4), in80: rd(in80 / n, 3), in50: rd(in50 / n, 3), below05: rd(lo5 / n, 3), above95: rd(hi95 / n, 3) };
      const edges = [0, 0.02, 0.05, 0.10, 0.20, 0.35, 0.50, 0.70, 0.90, 1.0001];
      for (const [side, dists] of [['down', [-0.05, -0.10, -0.15, -0.20, -0.30, -0.40]], ['up', [0.05, 0.10, 0.20, 0.30, 0.50]]]) {
        const acc = edges.slice(1).map(() => ({ p: 0, y: 0, n: 0 }));
        for (const r of testIdx) for (const d of dists) { const pr = touchProb(M, 1, 1 + d, R.sg[r], k), x = Math.abs(Math.log(1 + d)) / R.sg[r], hit = side === 'down' ? (-MN[h][r] >= x ? 1 : 0) : (MX[h][r] >= x ? 1 : 0);
          const bi = edges.findIndex((e, j) => j > 0 && pr < e) - 1; acc[bi].p += pr; acc[bi].y += hit; acc[bi].n++; }
        v.touch[`${side}${k}`] = acc.map((a, j) => ({ bin: `${Math.round(edges[j] * 100)}–${Math.round(Math.min(1, edges[j + 1]) * 100)}%`, predicted: rd(a.n ? a.p / a.n : null, 3), realised: rd(a.n ? a.y / a.n : null, 3), n: a.n }));
      }
    }
    for (const sym of ['BTC', 'ETH', ...config.holdings.filter(s => s !== 'ETH' && s !== 'BTC')]) {
      const idx = testIdx.filter(r => R.S[r].sym === sym); if (idx.length < 100) continue; v.byCoin[sym] = {};
      for (const k of [7, 30]) { const h = HORIZONS.indexOf(k); let in80 = 0; const tp = {};
        for (const r of idx) { const b = bands(M, 1, R.sg[r], k), y = Math.exp(Z[h][r] * R.sg[r]); if (y >= b.p10 && y <= b.p90) in80++; }
        for (const d of [-0.10, -0.20, -0.30, 0.10, 0.20]) { let ps = 0, ys = 0; for (const r of idx) { const x = Math.abs(Math.log(1 + d)) / R.sg[r]; ps += touchProb(M, 1, 1 + d, R.sg[r], k); ys += d < 0 ? (-MN[h][r] >= x ? 1 : 0) : (MX[h][r] >= x ? 1 : 0); } tp[`${d > 0 ? '+' : ''}${d * 100}%`] = { predicted: rd(ps / idx.length, 3), realised: rd(ys / idx.length, 3) }; }
        v.byCoin[sym][k] = { n: idx.length, in80: rd(in80 / idx.length, 3), touch: tp }; }
    }
    // plan reliability: predicted P(target first) for the config plan vs what happened, TEST
    { let pp = 0, ps = 0, yt = 0, ys = 0, n = 0; const h = HORIZONS.indexOf(planK);
      for (const r of testIdx) { const S = R.S[r], i = R.i[r], pl = planFor(S.c[i], S.atr[i], P); if (!pl || Number.isNaN(planAll[r])) continue; const o = planOdds(M, { entry: pl.entry, stop: pl.stop, target: pl.target, sigma: R.sg[r], k: planK }); if (!o) continue;
        pp += o.pTarget; ps += o.pStop; if (planAll[r] >= P.targetAtr / P.stopAtr - 1e-9) yt++; if (planAll[r] <= -1 + 1e-9) ys++; n++; }
      v.plan = { n, predictedTarget: rd(pp / n, 3), realisedTarget: rd(yt / n, 3), predictedStop: rd(ps / n, 3), realisedStop: rd(ys / n, 3) }; void h; }
    return v;
  }
  const vPooled = validate('pooled'), vBucket = validate('bucketed');
  const score = v => v.bands[7].pinball + v.bands[30].pinball;
  const mode = score(vBucket) < score(vPooled) ? 'bucketed' : 'pooled';
  log(`forecast validation (TRAIN → TEST): pooled pinball ${score(vPooled).toFixed(4)} vs volatility-bucketed ${score(vBucket).toFixed(4)} → using ${mode}`);
  const fAll = fitModel(allIdx);
  const forecast = { mode, probs: PROBS, horizons: HORIZONS, sigmaCuts: fAll.sigmaCuts, pooled: fAll.pooled, buckets: fAll.buckets,
    validation: { note: 'tables fitted on data before the split, scored on data after it', split: config.calibration.split, chosen: mode, pooled: vPooled, bucketed: vBucket } };

  /* ───────── 7. write ───────── */
  const sizeByYear = {}; for (let D = 0; D < T; D++) if (mkt[D]) sizeByYear[new Date(days[D]).getUTCFullYear()] = mkt[D].n;
  const model = {
    generatedAt: new Date(NOW).toISOString(), engineVersion: config.version, fittedFrom: isoDay(days.find((_, D) => mkt[D])), fittedThrough: isoDay(lastT), split: config.calibration.split,
    sample: { memberDays: N, days: mkt.filter(Boolean).length, series: seriesList.length, universeSizeAtYearEnd: sizeByYear, forecastSamples: allIdx.length },
    config: { universe: config.universe, rank: config.rank, regime: config.regime, plan: config.plan, signal: config.signal },
    rank, market, events, forecast, signal,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'model.js'), '// GENERATED by scripts/calibrate.js — measurements, not settings. Do not edit by hand; re-run `npm run calibrate`.\nexport default ' + JSON.stringify(model) + ';\n');
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), report(model));
  log(`wrote ${path.join(OUT, 'model.js')} (${(fs.statSync(path.join(OUT, 'model.js')).size / 1024).toFixed(0)} KB) and REPORT.md in ${((Date.now() - t00) / 1000).toFixed(1)}s`);
  console.log(report(model));
}

/* ───────────────────────── report ───────────────────────── */
function report(m) {
  const f = (x, d = 2) => (x === null || x === undefined ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d)), pc = x => (x === null || x === undefined ? '—' : (x * 100).toFixed(0) + '%');
  const L = [];
  L.push(`# PrecisionTimer model — measured ${m.generatedAt.slice(0, 10)}`, '',
    `History ${m.fittedFrom} → ${m.fittedThrough} · ${m.sample.memberDays.toLocaleString('en-US')} coin-days · ${m.sample.days} days · universe = top ${m.config.universe.size} by 30-day median $ volume, re-selected every day.`,
    `"Since ${m.split.slice(0, 4)}" = from ${m.split} on. For the range, touch and plan tables (section 4) that is a true out-of-sample test: they were fitted on the earlier data and scored on the later.`,
    `For the rules themselves (which rank factors, the trend facts, the event definitions) it is weaker — they were picked with the whole history in view, so read those columns as "it also held in the later period". The only fully independent test is the live scorecard.`, '',
    `## 1. Rank (${m.rank.factors.join(' + ')}) — average return over the same-day universe, %`, '',
    '| horizon | period | worst fifth | 2nd | 3rd | 4th | best fifth | best − worst [95% CI] |', '|---|---|---|---|---|---|---|---|');
  for (const k of m.forecast.horizons) for (const e of ['train', 'test']) { const o = m.rank.horizons[k][e]; L.push(`| ${k}d | ${e === 'test' ? 'since ' + m.split.slice(0, 4) : 'before ' + m.split.slice(0, 4)} | ${o.quintileExcess.map(x => f(x)).join(' | ')} | ${f(o.spread)} [${f(o.spreadCI[0], 1)}, ${f(o.spreadCI[1], 1)}] |`); }
  L.push('', '## 2. Market trend state — what followed, all history (median %, share of periods that were up, chance of a 10%+ drop)', '',
    '| state | days | BTC 30d | ETH 30d | top-100 avg 30d |', '|---|---|---|---|---|');
  const cell = d => (d ? `${f(d.median, 1)}% · up ${pc(d.pUp)} · −10% ${pc(d.pDown10)}` : '—');
  for (const s of [3, 2, 1, 0]) { const o = m.market.byTrend[s]; L.push(`| ${s}/3 | ${o.days} | ${cell(o.BTC[30])} | ${cell(o.ETH[30])} | ${cell(o.universe[30])} |`); }
  { const o = m.market.washout; L.push(`| washout (median RSI < ${m.config.regime.washoutMedianRsi}) | ${o.days} | ${cell(o.BTC[30])} | ${cell(o.ETH[30])} | ${cell(o.universe[30])} |`); }
  L.push('', '### Exposure gate (turns ON at ' + m.config.regime.gateOnAt + '/3, OFF at ' + m.config.regime.gateOffAt + '/3; 0.10% per switch)', '', '| asset | period | buy & hold | gated | max drawdown hold → gated | switches / yr |', '|---|---|---|---|---|---|');
  for (const a of ['BTC', 'ETH', 'universe']) for (const e of ['train', 'test']) { const c = m.market.gateCurves[a][e]; L.push(`| ${a} | ${e === 'test' ? 'since ' + m.split.slice(0, 4) : 'before ' + m.split.slice(0, 4)} | ${f(c.hold.totalPct, 0)}% | ${f(c.gated.totalPct, 0)}% | ${f(c.hold.maxDrawdownPct, 0)}% → ${f(c.gated.maxDrawdownPct, 0)}% | ${c.gated.switchesPerYear} |`); }
  L.push('', `## 3. Events — return over the same-day universe, and the frozen plan (stop ${m.events.plan.stopAtr} ATR, target ${m.events.plan.targetAtr} ATR, ${m.events.plan.maxDays} days)`, '',
    `Any coin on any day, same plan: ${f(m.events.plan.baseline.all.meanR, 3)}R (since ${m.split.slice(0, 4)}: ${f(m.events.plan.baseline.test.meanR, 3)}R).`, '',
    '| event | rank tier | period | n | 7d excess [CI] | beat market | 30d excess | plan mean R | plan win |', '|---|---|---|---|---|---|---|---|---|');
  for (const [id, E] of Object.entries(m.events.byEvent)) for (const tier of ['leader', 'middle', 'laggard', 'all']) for (const e of ['all', 'test']) { const o = E.tiers[tier][e]; if (!o.n) continue;
    L.push(`| ${E.label} | ${tier} | ${e === 'test' ? 'since ' + m.split.slice(0, 4) : 'all'} | ${o.n} | ${o[7] ? `${f(o[7].excessMean)}% [${f(o[7].excessCI[0], 1)}, ${f(o[7].excessCI[1], 1)}]` : '—'} | ${o[7] ? pc(o[7].beat) : '—'} | ${o[30] ? f(o[30].excessMean) + '%' : '—'} | ${o.plan ? f(o.plan.meanR, 3) : '—'} | ${o.plan ? pc(o.plan.win) : '—'} |`); }
  L.push('', '| just being in the tier (no event) | period | n | 7d excess | 30d excess | plan mean R |', '|---|---|---|---|---|---|');
  for (const tier of ['leader', 'middle', 'laggard']) for (const e of ['all', 'test']) { const o = m.events.tierBaseline[tier][e]; L.push(`| ${tier} | ${e === 'test' ? 'since ' + m.split.slice(0, 4) : 'all'} | ${o.n} | ${o[7] ? f(o[7].excessMean) + '%' : '—'} | ${o[30] ? f(o[30].excessMean) + '%' : '—'} | ${o.plan ? f(o.plan.meanR, 3) : '—'} |`); }
  const V = m.forecast.validation[m.forecast.validation.chosen];
  L.push('', `## 3b. Daily signal — market gate (ON at ${m.config.regime.gateOnAt}/3, OFF at ${m.config.regime.gateOffAt}/3) + half-size capitulation tranche`, '',
    '| coin | period | signal CAGR / max DD | buy & hold CAGR / max DD | v11 gate CAGR / max DD | in market | changes / yr | capitulation trades (hit) |', '|---|---|---|---|---|---|---|---|');
  for (const [sym, c] of Object.entries(m.signal.coins)) for (const e of ['all', 'test']) { const s = c[e], v = c.v11[e]; if (!s) continue;
    L.push(`| ${sym} | ${e === 'test' ? 'since ' + m.split.slice(0, 4) : s.from.slice(0, 4) + '→'} | ${f(s.cagrPct, 0)}% / ${f(s.maxDrawdownPct, 0)}% | ${f(s.holdCagrPct, 0)}% / ${f(s.holdMaxDrawdownPct, 0)}% | ${f(v.cagrPct, 0)}% / ${f(v.maxDrawdownPct, 0)}% | ${pc(s.exposure)} | ${s.changesPerYear} | ${e === 'all' ? `${c.capitulation.n} (${pc(c.capitulation.hit)})` : ''} |`); }
  L.push('', `## 4. Ranges and touch probabilities — out-of-sample check: fitted before ${m.split}, scored after (tables: ${m.forecast.mode})`, '',
    '| horizon | 80% band held | 50% band held | closed below the 5% line | closed above the 95% line |', '|---|---|---|---|---|');
  for (const k of [7, 30]) L.push(`| ${k}d | ${pc(V.bands[k].in80)} | ${pc(V.bands[k].in50)} | ${pc(V.bands[k].below05)} | ${pc(V.bands[k].above95)} |`);
  L.push('', 'Touch probability — predicted vs realised (levels 5–50% away from spot):', '');
  for (const key of ['down7', 'down30', 'up7', 'up30']) L.push(`- ${key}: ` + V.touch[key].filter(b => b.n > 200).map(b => `${Math.round(b.predicted * 100)}→${Math.round(b.realised * 100)}`).join(' · '));
  L.push('', 'By coin (80% band held; touch predicted → realised):', '');
  for (const [sym, o] of Object.entries(V.byCoin)) L.push(`- ${sym}: 7d ${pc(o[7].in80)}, 30d ${pc(o[30].in80)}; 30d touch ` + Object.entries(o[30].touch).map(([d, t]) => `${d} ${Math.round(t.predicted * 100)}→${Math.round(t.realised * 100)}`).join(', '));
  L.push('', `Plan odds (config plan, ${m.events.plan.maxDays}d): target first predicted ${pc(V.plan.predictedTarget)} vs realised ${pc(V.plan.realisedTarget)}; stop first ${pc(V.plan.predictedStop)} vs ${pc(V.plan.realisedStop)}.`, '');
  return L.join('\n');
}

main().catch(e => { console.error('CALIBRATION FAILED:', e.stack || e.message); process.exit(1); });
