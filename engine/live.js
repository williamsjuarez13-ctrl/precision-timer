// PrecisionTimer engine — fetch today's candles and build the board. Shared by the hourly scan
// (scripts/scan.js) and the on-demand endpoint (api/board.js), so both serve the same board.
import { buildSeries, splitSegments } from './series.js';
import { isExcludedName } from './universe.js';
import { buildBoard } from './board.js';
import { pooled } from './data.js';

export async function fetchBoard({ client, now = Date.now(), config, model }) {
  const U = config.universe;
  // candidates: today's most-traded USDT pairs, plus anything you hold / track / watch
  const tick = (await client.tickers()).filter(x => !isExcludedName(x.sym) && x.quoteVolume > 0);
  tick.sort((a, b) => b.quoteVolume - a.quoteVolume);
  const must = new Set(['BTC', 'ETH', ...(config.holdings || []), ...(config.track || []), ...(config.watch || []).map(w => w.sym)]);
  const cand = [...new Set([...tick.slice(0, U.candidates).map(x => x.sym), ...must])];
  const lastOf = new Map(tick.map(x => [x.sym, x.last]));

  // daily candles (BTC and ETH get the longest history: BTC's 200-day EMA drives the market state)
  const live = {}, seriesList = [], failed = [];
  const res = await pooled(cand, 10, sym => client.daily(sym, sym === 'BTC' || sym === 'ETH' ? 1000 : 420, now));
  for (const x of res) {
    if (x.error) { failed.push(`${x.item}: ${x.error.message}`); continue; }
    const segs = splitSegments(x.value.bars.filter(b => b[4] > 0 && b[1] > 0)), seg = segs[segs.length - 1];
    if (!seg || seg.length < 60) continue;
    seriesList.push(buildSeries(x.item, seg));
    live[x.item] = x.value.forming ? x.value.forming[4] : lastOf.get(x.item);
  }
  if (failed.length > cand.length * 0.2) throw new Error(`data incomplete: ${failed.length}/${cand.length} symbols failed (${failed.slice(0, 3).join('; ')})`);

  const board = buildBoard({ seriesList, live, now, model, config });
  const ageH = (now - Date.parse(board.asOfCloseTime)) / 3600e3;
  if (ageH > 30) throw new Error(`stale data: newest closed daily candle is ${board.asOf} (${ageH.toFixed(0)}h old)`);
  board.source = client.source; board.fetched = { candidates: cand.length, failed: failed.length, viaProxy: client.viaProxy || 0 };
  return { board, seriesList, live, failed, must };
}
