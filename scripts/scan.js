#!/usr/bin/env node
// PrecisionTimer — the hourly scan.
//
//   node scripts/scan.js --data-dir data      (what the GitHub Action runs; `data` is the pt-data branch)
//
// Each run: fetch daily candles for today's most-traded coins → engine.buildBoard() → on a new daily
// close, freeze today's forecasts into the ledger → score every forecast that has matured → work out
// which alerts are due → write board.json / scorecard.json / alerts.json / state.json / ledger.jsonl.
// Telegram is optional (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID); without it alerts still land in
// alerts.json and show on the page.
//
// Failure is loud by design: incomplete data, a stale candle or any exception exits non-zero (the
// Action run goes red), sends a Telegram message if configured, and leaves the previous board in
// place — where the page shows its age.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DAY, buildSeries, splitSegments } from '../engine/series.js';
import { indexAt } from '../engine/board.js';
import { fetchBoard } from '../engine/live.js';
import { entriesFor, scoreDue, scorecard } from '../engine/ledger.js';
import { DETECTORS } from '../engine/detectors.js';
import { makeClient } from '../engine/data.js';

const isoDay = t => new Date(t).toISOString().slice(0, 10);
const pc = (x, d = 0) => (x === null || x === undefined ? '—' : (x * 100).toFixed(d) + '%');
const sg = (x, d = 1) => (x === null || x === undefined ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d) + '%');
export function fmtPrice(p) {
  if (p === null || p === undefined) return '—';
  const a = Math.abs(p);
  return a >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 100 ? p.toFixed(1) : a >= 1 ? p.toFixed(2) : a >= 0.01 ? p.toFixed(4) : p.toPrecision(3);
}
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
const readLines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };

/* ───────── alert texts: every number in them comes from the board or from model.js ───────── */
function gateText(board, model) {
  const m = board.market, st = model.market.byTrend[m.trend], g = model.market.gateCurves, c = m.components;
  return [
    `EXPOSURE GATE ${m.gate} — market trend ${m.trend}/3 at the ${board.asOf} close`,
    `BTC vs 200d EMA ${sg(m.btcVs200)} (${c.btcAbove200 ? 'above' : 'below'}) · BTC 30d ${sg(m.btc30d)} · ${pc(m.breadth50)} of the top ${m.members} above their 50d EMA`,
    st ? `After ${st.days} days like this since ${model.fittedFrom.slice(0, 4)}: next 30d ETH median ${sg(st.ETH[30]?.median)}, up ${pc(st.ETH[30]?.pUp)}, 10%+ drop ${pc(st.ETH[30]?.pDown10)} · BTC median ${sg(st.BTC[30]?.median)}, 10%+ drop ${pc(st.BTC[30]?.pDown10)}` : '',
    `Since ${model.split}: holding ETH only while the gate is ON ${sg(g.ETH.test.gated.totalPct, 0)} vs ${sg(g.ETH.test.hold.totalPct, 0)} buy-and-hold, max drawdown ${sg(g.ETH.test.gated.maxDrawdownPct, 0)} vs ${sg(g.ETH.test.hold.maxDrawdownPct, 0)}. It flips about ${g.ETH.test.gated.switchesPerYear}× a year.`,
  ].filter(Boolean).join('\n');
}
// One message per daily close, however many coins fired: each (event, tier) class is described once
// with what it has historically been worth, then the coins are listed with their frozen plans.
function eventsDigest(evs, board, model) {
  const groups = new Map(); for (const e of evs) { const k = `${e.event}|${e.tier}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const L = [`EVENTS at the ${board.asOf} close — gate ${board.market.gate} (trend ${board.market.trend}/3)`];
  for (const [k, list] of groups) {
    const [id, tier] = k.split('|'), D = DETECTORS[id], st = model.events.byEvent[id]?.tiers[tier], a = st?.all, t = st?.test;
    L.push('', `${D.label.toUpperCase()} · ${tier}s — ${D.describe}`);
    if (a && a[7]) L.push(`Measured (n=${a.n}, ${t?.n ?? 0} of them since ${model.split.slice(0, 4)}): beat the market over 7d ${pc(a[7].beat)} of the time, average ${sg(a[7].excessMean)} vs market (since ${model.split.slice(0, 4)}: ${sg(t?.[7]?.excessMean)}). Plan below: ${a.plan ? (a.plan.meanR >= 0 ? '+' : '') + a.plan.meanR + 'R per trade, ' + pc(a.plan.win) + ' winners' : '—'}; any coin on any day ${model.events.plan.baseline.all.meanR}R.`);
    list.sort((x, y) => x.rank - y.rank);
    for (const e of list.slice(0, 12)) L.push(`• ${e.sym} #${e.rank} — ${fmtPrice(e.close)} → target ${fmtPrice(e.plan?.target)} / stop ${fmtPrice(e.plan?.stop)} (${e.plan?.days}d)`);
    if (list.length > 12) L.push(`• +${list.length - 12} more on the board`);
  }
  if (board.market.gate === 'OFF') L.push('', 'The exposure gate is OFF: these are relative-strength facts, not a reason to add risk.');
  return L.join('\n');
}
function heartbeatText(board, card, model, state) {
  const m = board.market, rows = new Map([...board.rows, ...(board.extra || [])].map(r => [r.sym, r]));
  const L = [`PrecisionTimer daily — close of ${board.asOf}`, `Market: trend ${m.trend}/3, exposure gate ${m.gate} for ${m.gateDays}d · breadth ${pc(m.breadth50)} · median RSI ${m.medianRsi}${m.washout ? ' (washout)' : ''}`];
  for (const s of board.holdings) { const r = rows.get(s); if (!r) continue; const b = r.bands[7];
    L.push(`${s} ${fmtPrice(r.price)} (7d ${sg(r.chg7)}) · ${r.rank ? `rank #${r.rank}/${board.rows.length} ${r.tier}` : 'outside the universe'} · 7d 80% range ${b ? fmtPrice(b.p10) + '–' + fmtPrice(b.p90) : '—'}`); }
  for (const lv of board.levels.filter(l => l.kind === 'watch')) L.push(`${lv.sym} ${lv.label} ${fmtPrice(lv.level)} (${sg(lv.distPct)}): touch 7d ${pc(lv.touch7)} · 30d ${pc(lv.touch30)}`);
  if (board.events.length) L.push(`Events today: ${board.events.map(e => `${e.sym} ${e.event}/${e.tier}`).join(', ')}`);
  const b7 = card.bands[7];
  if (b7 && b7.n >= 20) L.push(`Live record: 80% ranges held ${pc(b7.in80)} of ${b7.n} (target 80%)${card.rank[7].n ? ` · best-fifth vs market ${sg(card.rank[7].topExcess, 2)}/7d over ${card.rank[7].n} days` : ''}`);
  if (board.notInUniverse.length) L.push(`Outside today's universe (no rank): ${board.notInUniverse.join(', ')}`);
  if (board.noData.length) L.push(`NO DATA for: ${board.noData.join(', ')} — check the ticker in pt.config.js`);
  L.push(`Scan #${state.runs} · if this message stops arriving, the scan is broken.`);
  return L.join('\n');
}

/* ───────── the run ───────── */
export async function runScan({ client, now = Date.now(), dataDir, config, model, notify = null, log = () => {}, fallbackBoard = null }) {
  // 1–3. candles → board (engine/live.js; the on-demand endpoint runs the very same function).
  // If this host cannot reach the exchange at all, take the board from the deployed endpoint instead
  // (same engine, same model) and fetch only the few candle series that scoring needs, via the proxy.
  let board, seriesList, live, failed, must;
  try { ({ board, seriesList, live, failed, must } = await fetchBoard({ client, now, config, model })); }
  catch (e) {
    if (!fallbackBoard) throw e;
    log(`direct fetch failed (${e.message}) — using the deployed board endpoint`);
    board = await fallbackBoard();
    if (!board || !Array.isArray(board.rows) || !board.rows.length || !board.asOf) throw new Error(`direct fetch failed (${e.message}) and the board endpoint returned nothing usable`);
    if ((now - Date.parse(board.asOfCloseTime)) / 3600e3 > 30) throw new Error(`stale data from the board endpoint: newest closed daily candle is ${board.asOf}`);
    board.source = 'board endpoint (direct fetch failed: ' + e.message.slice(0, 80) + ')';
    seriesList = []; failed = []; live = Object.fromEntries([...board.rows, ...(board.extra || [])].map(r => [r.sym, r.price]));
    must = new Set(['BTC', 'ETH', ...(config.holdings || []), ...(config.track || []), ...(config.watch || []).map(w => w.sym)]);
  }

  // 4. ledger: freeze today's forecasts once, then score whatever has matured
  fs.mkdirSync(dataDir, { recursive: true });
  const F = n => path.join(dataDir, n);
  const state = readJson(F('state.json'), { runs: 0, sent: [], tiers: {}, touchAlerted: {}, lastPrice: {} });
  const lines = readLines(F('ledger.jsonl')), have = new Set(lines.map(l => l.id).filter(Boolean)), append = [];
  const newDay = !state.lastLedgerDay || board.asOf > state.lastLedgerDay;
  if (newDay) for (const e of entriesFor(board, model)) if (!have.has(e.id)) append.push(e);
  const extra = new Map(), seriesOf = async sym => {
    let S = seriesList.find(x => x.sym === sym) || extra.get(sym);
    if (S === undefined) { try { const { bars } = await client.daily(sym, 120, now); const segs = splitSegments(bars); S = buildSeries(sym, segs[segs.length - 1]); } catch { S = null; } extra.set(sym, S); }
    return S;
  };
  const closeOn = async (sym, day) => { const S = await seriesOf(sym); if (!S) return null; const i = indexAt(S, Date.parse(day + 'T00:00:00Z')); return i >= 0 ? S.c[i] : null; };
  const barsBetween = async (sym, a, b) => { const S = await seriesOf(sym); if (!S) return null; const i = indexAt(S, Date.parse(a + 'T00:00:00Z')), j = indexAt(S, Date.parse(b + 'T00:00:00Z')); if (i < 0 || j < 0) return null; const out = []; for (let q = i; q <= j; q++) out.push([S.t[q], S.o[q], S.h[q], S.l[q], S.c[q]]); return out; };
  const scores = await scoreDue(lines.concat(append), board.asOf, closeOn, barsBetween);
  append.push(...scores);
  const all = lines.concat(append), card = scorecard(all);

  // 5. alerts
  state.runs = (state.runs || 0) + 1;
  const A = config.alerts || {}, alerts = [], rows = new Map([...board.rows, ...(board.extra || [])].map(r => [r.sym, r]));
  const push = (id, kind, title, text) => { if (!state.sent.includes(id)) { alerts.push({ id, at: new Date(now).toISOString(), kind, title, text }); state.sent.push(id); } };
  if (newDay) {
    if (A.gateFlip && state.gate && state.gate !== board.market.gate) push(`gate|${board.asOf}`, 'gate', `Exposure gate ${board.market.gate}`, gateText(board, model));
    const evs = board.events.filter(e => (A.events?.[e.event] || []).includes(e.tier));
    if (evs.length) push(`events|${board.asOf}`, 'event', `${evs.length} event${evs.length > 1 ? 's' : ''}: ${evs.slice(0, 4).map(e => e.sym).join(', ')}${evs.length > 4 ? '…' : ''}`, eventsDigest(evs, board, model));
    // a holding's tier change is only reported once it has held for two closes (ranks near a boundary flap)
    state.tierPending = state.tierPending || {};
    for (const s of board.holdings) { const r = rows.get(s); if (!r) continue; const was = state.tiers[s];
      if (!was) { state.tiers[s] = r.tier; continue; }
      if (r.tier === was) { delete state.tierPending[s]; continue; }
      const p = state.tierPending[s]; state.tierPending[s] = p && p.tier === r.tier ? { tier: r.tier, days: p.days + 1 } : { tier: r.tier, days: 1 };
      if (state.tierPending[s].days < 2) continue;
      delete state.tierPending[s]; state.tiers[s] = r.tier;
      if (A.holdingsTier) { const q = model.rank.horizons[30].test.quintileExcess;
        push(`tier|${board.asOf}|${s}`, 'tier', `${s}: ${was} → ${r.tier}`, `${s} moved from ${was} to ${r.tier} (rank #${r.rank}/${board.rows.length}) and held there for two closes.\nSince ${model.split}, 30 days later the best fifth of the rank averaged ${sg(q[4])} vs the market and the worst fifth ${sg(q[0])}.`); } }
    state.gate = board.market.gate;
    state.lastLedgerDay = board.asOf;
  }
  for (const lv of board.levels.filter(l => l.kind === 'watch')) {
    const key = `${lv.sym}|${lv.level}`, price = rows.get(lv.sym)?.price ?? live[lv.sym], prev = state.lastPrice[lv.sym];
    if (prev > 0 && price > 0 && (prev - lv.level) * (price - lv.level) <= 0 && prev !== price)
      push(`cross|${key}|${new Date(now).toISOString().slice(0, 13)}`, 'level', `${lv.sym} crossed ${fmtPrice(lv.level)}`, `${lv.sym} traded through ${lv.label} ${fmtPrice(lv.level)} — now ${fmtPrice(price)} (was ${fmtPrice(prev)} at the last scan).`);
    if (A.touchProb30 && lv.touch30 !== null) {
      if (lv.touch30 >= A.touchProb30 && !state.touchAlerted[key]) { state.touchAlerted[key] = true;
        push(`touch|${key}|${board.asOf}`, 'level', `${lv.sym} ${lv.label}: 30-day touch risk ${pc(lv.touch30)}`, `${lv.sym} ${fmtPrice(price)} is ${sg(-lv.distPct)} above ${lv.label} ${fmtPrice(lv.level)}.\nLevels this far away (in units of the coin's own volatility) were reached within 30 days ${pc(lv.touch30)} of the time, within 7 days ${pc(lv.touch7)}. Alert threshold ${pc(A.touchProb30)}.`); }
      else if (lv.touch30 < A.touchProb30 * 0.7) delete state.touchAlerted[key];
    }
  }
  for (const s of must) { const p = rows.get(s)?.price ?? live[s]; if (p > 0) state.lastPrice[s] = p; }
  const today = isoDay(now), hour = new Date(now).getUTCHours();
  if (A.heartbeatHourUTC !== undefined && hour >= A.heartbeatHourUTC && state.lastHeartbeatDay !== today) { state.lastHeartbeatDay = today; push(`heartbeat|${today}`, 'heartbeat', 'Daily summary', heartbeatText(board, card, model, state)); }
  state.sent = state.sent.slice(-600); state.lastRunAt = new Date(now).toISOString(); state.lastError = null;

  // 6. deliver, then write (state last, so a crash before this point re-sends rather than loses)
  let delivered = 0;
  if (notify) for (const a of alerts) { try { await notify(a.text); a.delivered = true; delivered++; } catch (e) { a.delivered = false; a.deliveryError = e.message; log('telegram failed: ' + e.message); } }
  const feed = readJson(F('alerts.json'), []).concat(alerts).slice(-200);
  if (append.length) fs.appendFileSync(F('ledger.jsonl'), append.map(l => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(F('board.json'), JSON.stringify(board));
  fs.writeFileSync(F('scorecard.json'), JSON.stringify({ updatedAt: new Date(now).toISOString(), modelFittedThrough: model.fittedThrough, ...card }));
  fs.writeFileSync(F('alerts.json'), JSON.stringify(feed));
  fs.writeFileSync(F('state.json'), JSON.stringify(state));
  fs.writeFileSync(F('vercel.json'), JSON.stringify({ git: { deploymentEnabled: false } }));     // this branch is data, not a site
  fs.writeFileSync(F('README.md'), `PrecisionTimer data branch — written by the hourly scan (scripts/scan.js). Do not edit by hand.\n\n- board.json — latest board\n- ledger.jsonl — every frozen forecast and its score (append-only)\n- scorecard.json — the ledger, aggregated\n- alerts.json — last 200 alerts\n- state.json — scan bookkeeping\n`);
  return { asOf: board.asOf, members: board.rows.length, gate: board.market.gate, trend: board.market.trend, newDay, ledgerAdded: append.length - scores.length, scored: scores.length, alerts: alerts.length, delivered, failed: failed.length, source: client.source };
}

export function telegramNotifier(token, chatId) {
  return async text => {
    for (let i = 0; i < text.length; i += 3900) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 3900), disable_web_page_preview: true }) });
      if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  };
}

/* ───────── CLI ───────── */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const dataDir = path.resolve(opt('--data-dir') || path.join(ROOT, 'data'));
  const { TELEGRAM_BOT_TOKEN: tok, TELEGRAM_CHAT_ID: chat } = process.env;
  const notify = tok && chat ? telegramNotifier(tok, chat) : null;
  try {
    const [{ default: config }, { default: model }] = await Promise.all([import('../pt.config.js'), import('../model/model.js')]);
    const fallbackBoard = config.data.boardEndpoint ? async () => { const r = await fetch(config.data.boardEndpoint); if (!r.ok) throw new Error('board endpoint HTTP ' + r.status); return r.json(); } : null;
    const out = await runScan({ client: makeClient(config.data), dataDir, config, model, notify, fallbackBoard, log: m => console.error(m) });
    console.log(JSON.stringify({ ok: true, telegram: !!notify, ...out }));
  } catch (e) {
    console.error('SCAN FAILED:', e.stack || e.message);
    try { fs.mkdirSync(dataDir, { recursive: true }); const f = path.join(dataDir, 'state.json'), st = readJson(f, {}); st.lastError = { at: new Date().toISOString(), message: e.message }; fs.writeFileSync(f, JSON.stringify(st)); } catch { /* nothing more we can do */ }
    if (notify) { try { await notify(`PrecisionTimer scan FAILED: ${e.message}\nThe board is not updating until this is fixed (GitHub → Actions → PrecisionTimer scan).`); } catch { /* already failing */ } }
    process.exit(1);
  }
}
