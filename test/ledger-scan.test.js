import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAY } from '../engine/series.js';
import { scoreDue, scorecard } from '../engine/ledger.js';
import { runScan } from '../scripts/scan.js';
import config from '../pt.config.js';
import model from '../model/model.js';
import { makeMarket, fakeClient } from './helpers.js';

test('ledger: a range forecast is scored once, at maturity, against the frozen levels', async () => {
  const e = { type: 'bands', id: 'bands|2026-01-01|X|7', day: '2026-01-01', due: '2026-01-08', sym: 'X', k: 7, ref: 100, sigma: 0.03, q: { p05: 80, p10: 85, p25: 93, p50: 100, p75: 107, p90: 116, p95: 122 } };
  const closeOn = async () => 118;
  assert.equal((await scoreDue([e], '2026-01-07', closeOn, null)).length, 0);            // not matured yet
  const [s] = await scoreDue([e], '2026-01-08', closeOn, null);
  assert.deepEqual([s.in80, s.in50, s.below05, s.above95], [false, false, false, false]);
  assert.equal((await scoreDue([e, s], '2026-01-09', closeOn, null)).length, 0);         // never twice
  assert.equal((await scoreDue([e], '2026-01-08', async () => null, null)).length, 0);   // no price → stays pending
});

test('ledger: plans are frozen — stop wins a same-day tie, otherwise first touch, otherwise mark at the time limit', async () => {
  const plan = { entry: 100, stop: 95, target: 110, days: 3 }, mk = (id) => ({ type: 'event', id, day: '2026-01-01', due: '2026-01-04', sym: 'X', event: 'IGNITION', tier: 'leader', rank: 3, plan });
  const run = async bars => (await scoreDue([mk('e')], '2026-01-04', null, async () => bars))[0];
  assert.deepEqual([(await run([[0, 100, 111, 94, 100], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]])).outcome, (await run([[0, 100, 111, 94, 100], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]])).R], ['stop', -1]);
  const t = await run([[0, 100, 104, 99, 103], [0, 103, 111, 102, 109], [0, 109, 109, 90, 91]]); assert.equal(t.outcome, 'target'); assert.equal(t.R, 2);
  const o = await run([[0, 100, 104, 99, 103], [0, 103, 105, 102, 104], [0, 104, 106, 101, 102.5]]); assert.equal(o.outcome, 'time'); assert.equal(o.R, 0.5);
  assert.equal(await run([[0, 100, 104, 99, 103]]), undefined);                           // candles missing → not scored
});

test('scan: forty simulated daily runs build a ledger with no duplicates, score what matures, and keep state', async () => {
  const market = makeMarket({ coins: 45, days: 500 }), END = Date.UTC(2026, 10, 9);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-test-')), client = fakeClient(market), sent = [];
  const cfg = { ...config, universe: { ...config.universe, size: 30, candidates: 45 }, holdings: ['ETH', 'C03'], track: ['BTC', 'ETH', 'C03', 'C04'], watch: [{ sym: 'ETH', level: 1e-6, label: 'far below' }],
    alerts: { ...config.alerts, heartbeatHourUTC: 0 } };
  let out;
  for (let d = 40; d >= 0; d--) { const now = END - d * DAY + DAY + 600e3; client.now = now; out = await runScan({ client, now, dataDir: dir, config: cfg, model, notify: async t => sent.push(t) }); }
  const lines = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const ids = lines.filter(l => l.id).map(l => l.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ledger ids');
  assert.equal(lines.filter(l => l.type === 'market').length, 41);
  const card = JSON.parse(fs.readFileSync(path.join(dir, 'scorecard.json'), 'utf8'));
  assert.equal(card.bands[7].n, 4 * 34);                       // 4 tracked coins × the 34 closes whose 7-day forecasts have matured
  assert.equal(card.bands[30].n, 4 * 11); assert.equal(card.rank[7].n, 34); assert.equal(card.gate.days, 40);
  assert.equal(sent.filter(t => t.startsWith('PrecisionTimer daily')).length, 41);   // one heartbeat a day
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(state.lastLedgerDay, '2026-11-09'); assert.equal(state.runs, 41); assert.equal(out.asOf, '2026-11-09');
  // a second run in the same hour adds nothing and sends nothing
  const before = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').length, n = sent.length;
  await runScan({ client, now: client.now + 60e3, dataDir: dir, config: cfg, model, notify: async t => sent.push(t) });
  assert.equal(fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').length, before); assert.equal(sent.length, n);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8')).levels.some(l => l.kind === 'watch' && l.touch30 < 0.01));
});

test('scan: when the exchange is unreachable from this host it uses the deployed board endpoint and still logs and scores', async () => {
  const market = makeMarket({ coins: 45, days: 500 }), END = Date.UTC(2026, 10, 9), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-test-'));
  const cfg = { ...config, universe: { ...config.universe, size: 30, candidates: 45 }, holdings: ['ETH'], track: ['BTC', 'ETH'], watch: [], alerts: { ...config.alerts, heartbeatHourUTC: undefined } };
  const good = fakeClient(market), { fetchBoard } = await import('../engine/live.js');
  // a client that cannot list tickers (direct access blocked) but can still fetch single candle series (the proxy path)
  const blocked = { ...good, tickers: async () => { throw new Error('HTTP 451'); }, daily: good.daily.bind(good) };
  let out;
  for (let d = 8; d >= 0; d--) { const now = END - d * DAY + DAY + 600e3; good.now = now;
    out = await runScan({ client: blocked, now, dataDir: dir, config: cfg, model, fallbackBoard: async () => (await fetchBoard({ client: good, now, config: cfg, model })).board }); }
  const card = JSON.parse(fs.readFileSync(path.join(dir, 'scorecard.json'), 'utf8')), board = JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8'));
  assert.equal(card.daysLogged, 9); assert.equal(card.bands[7].n, 2 * 2); assert.equal(card.rank[7].n, 2);
  assert.match(board.source, /board endpoint/); assert.equal(out.asOf, '2026-11-09');
  await assert.rejects(runScan({ client: blocked, now: END + DAY + 600e3, dataDir: dir, config: cfg, model }), /451/);                       // no fallback configured → loud
  await assert.rejects(runScan({ client: blocked, now: END + DAY + 600e3, dataDir: dir, config: cfg, model, fallbackBoard: async () => ({}) }), /nothing usable/);
});

test('scan: fails loudly when data is incomplete or stale, and leaves the previous board untouched', async () => {
  const market = makeMarket({ coins: 45, days: 500 }), END = Date.UTC(2026, 10, 9), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-test-'));
  const cfg = { ...config, universe: { ...config.universe, size: 30, candidates: 45 }, holdings: [], track: ['BTC'], watch: [] };
  const bad = fakeClient(market, { failing: new Set([...market.keys()].filter((_, i) => i % 2 === 1 && i > 1)) }); bad.now = END + DAY + 600e3;
  await assert.rejects(runScan({ client: bad, now: bad.now, dataDir: dir, config: cfg, model }), /data incomplete/);
  const stale = fakeClient(market); stale.now = END + DAY + 600e3;
  await assert.rejects(runScan({ client: { ...stale, tickers: stale.tickers.bind(stale), daily: (s, l) => stale.daily(s, l, END - 3 * DAY) }, now: END + 2 * DAY, dataDir: dir, config: cfg, model }), /stale data/);
  assert.ok(!fs.existsSync(path.join(dir, 'board.json')));
});
