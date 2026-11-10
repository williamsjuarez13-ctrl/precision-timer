#!/usr/bin/env node
// PrecisionTimer — paper run.  Replays the REAL scan (scripts/scan.js → runScan) once per day over a
// past window, from the candle cache, exactly as the GitHub Action would have run it: same engine,
// same ledger, same alerts.  The honest way to see what a version would have done — provided the
// model it uses was measured only on data from BEFORE the window:
//
//   PT_UNTIL=2026-07-31 PT_MODEL_OUT=.cache/model-0731 npm run calibrate -- --offline
//   npm run paper -- --from 2026-08-01 --to 2026-11-09 --model .cache/model-0731/model.js
//
// Prints the resulting scorecard and every alert that would have been sent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DAY } from '../engine/series.js';
import { isExcludedName } from '../engine/universe.js';
import { runScan } from './scan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const CACHE = process.env.PT_DATA_DIR || path.join(ROOT, '.cache', '1d');
const from = Date.parse(opt('--from') + 'T00:00:00Z'), to = Date.parse(opt('--to', new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
const modelPath = path.resolve(opt('--model', path.join(ROOT, 'model', 'model.js')));
const outDir = path.resolve(opt('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'pt-paper-'))));
if (Number.isNaN(from)) { console.error('usage: npm run paper -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--model path] [--out dir]'); process.exit(2); }

const { default: config } = await import('../pt.config.js');
const { default: model } = await import(pathToFileURL(modelPath).href);
if (model.fittedThrough >= new Date(from).toISOString().slice(0, 10)) console.error(`WARNING: the model was measured through ${model.fittedThrough}, which overlaps the window — results flatter the engine. See the header of this file.`);

const hist = new Map();
for (const f of fs.readdirSync(CACHE)) { if (!f.endsWith('USDT.json')) continue; const sym = f.slice(0, -9); if (!isExcludedName(sym)) hist.set(sym, JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'))); }
// a data client that only knows what was knowable at `now`
const client = {
  source: 'cache-replay', errors: [],
  async tickers() { const out = []; for (const [sym, bars] of hist) { let j = bars.length - 1; while (j >= 0 && bars[j][0] + DAY > this.now) j--; if (j < 0 || this.now - (bars[j][0] + DAY) > DAY) continue; out.push({ sym, last: bars[j][4], quoteVolume: bars[j][6] }); } return out; },
  async daily(sym, limit, now) { const bars = hist.get(sym); if (!bars) { const e = new Error('unknown symbol'); e.status = 400; throw e; } const closed = bars.filter(b => b[0] + DAY <= now); return { bars: closed.slice(-limit), forming: null }; },
};
fs.rmSync(outDir, { recursive: true, force: true });
const sent = []; let last;
for (let day = from; day <= to; day += DAY) {
  const now = day + DAY + 10 * 60e3;            // 00:10 UTC, ten minutes after that day's candle closed
  client.now = now;
  last = await runScan({ client, now, dataDir: outDir, config: { ...config, alerts: { ...config.alerts, heartbeatHourUTC: undefined } }, model, notify: async t => { sent.push([new Date(day).toISOString().slice(0, 10), t]); } });
}
const card = JSON.parse(fs.readFileSync(path.join(outDir, 'scorecard.json'), 'utf8'));
const pc = x => (x === null || x === undefined ? '—' : (x * 100).toFixed(0) + '%'), sg = (x, d = 2) => (x === null || x === undefined ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d) + '%');
console.log(`\nPAPER RUN ${opt('--from')} → ${new Date(to).toISOString().slice(0, 10)} · model measured through ${model.fittedThrough} · ${card.daysLogged} daily closes logged · last: ${JSON.stringify(last)}`);
for (const k of [7, 30]) console.log(`ranges ${k}d: ${card.bands[k].n} scored — 80% band held ${pc(card.bands[k].in80)} (target 80%), 50% band ${pc(card.bands[k].in50)} (target 50%), below 5% line ${pc(card.bands[k].below05)}, above 95% line ${pc(card.bands[k].above95)}`);
for (const k of [7, 30]) console.log(`rank ${k}d: ${card.rank[k].n} days scored — best fifth vs market ${sg(card.rank[k].topExcess)}, worst fifth ${sg(card.rank[k].bottomExcess)}, best − worst ${sg(card.rank[k].spread)}; market itself ${sg(card.rank[k].universe)} per ${k}d`);
for (const [key, e] of Object.entries(card.events)) console.log(`event ${key}: ${e.n} plans closed — mean ${e.meanR}R, ${pc(e.win)} winners (${e.targets} targets, ${e.stops} stops)`);
if (card.gate) console.log(`gate: ${card.gate.days} days, ON ${card.gate.onDays} — ETH hold ${sg(card.gate.eth.hold, 1)} vs gated ${sg(card.gate.eth.gated, 1)} · BTC hold ${sg(card.gate.btc.hold, 1)} vs gated ${sg(card.gate.btc.gated, 1)} · ${card.gate.switches} switches`);
console.log(`\n${sent.length} alerts would have been sent:`);
for (const [d, t] of sent) console.log(`\n[${d}] ${t}`);
console.log(`\noutput in ${outDir}`);
