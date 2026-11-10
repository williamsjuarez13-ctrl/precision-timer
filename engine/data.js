// PrecisionTimer engine — market data (public Binance spot endpoints; no keys).
//
// Guarantees:
//   • bars come back as numbers, oldest first: [openTime, o, h, l, c, baseVol, quoteVol]
//   • the forming candle is NEVER in the returned bars (it comes back separately as `forming`)
//   • every base URL in config.data.bases is tried in order; the Vercel proxy is the last resort
//   • failures are reported, never swallowed — callers decide whether coverage is good enough
import { DAY } from './series.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, { timeoutMs = 15000 } = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'PrecisionTimer/11' } });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    return await res.json();
  } finally { clearTimeout(timer); }
}

// Try each base; remember the one that works so later calls go straight to it.
export function makeClient(dataCfg) {
  const bases = [...dataCfg.bases]; let good = null, viaProxy = 0; const errors = [];
  async function api(pathAndQuery) {
    const order = good ? [good, ...bases.filter(b => b !== good)] : bases;
    let last;
    for (const base of order) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { const j = await getJson(base + pathAndQuery); good = base; return j; }
        catch (e) {
          last = e;
          if (e.status === 429 || e.status === 418) { await sleep(1500 * (attempt + 1)); continue; }   // rate limited: wait, retry same base
          if (e.status === 400) throw e;                                                                 // bad symbol — no point trying others
          break;                                                                                         // 451 / 403 / network → next base
        }
      }
    }
    errors.push(`${pathAndQuery.slice(0, 60)}: ${last && last.message}`);
    throw last || new Error('all data sources failed');
  }
  const toBars = rows => rows.map(k => [+k[0], +k[1], +k[2], +k[3], +k[4], +k[5], +k[7]]);
  function splitForming(rows, now) {
    const bars = toBars(rows); let forming = null;
    while (bars.length && bars[bars.length - 1][0] + DAY > now) forming = bars.pop();
    return { bars, forming };
  }
  return {
    get source() { return good || (viaProxy ? dataCfg.proxy : null); }, get viaProxy() { return viaProxy; }, errors,

    // Most recent `limit` daily candles (max 1000). → { bars (closed), forming (or null) }
    async daily(sym, limit, now = Date.now()) {
      let rows;
      try { rows = await api(`/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=${Math.min(1000, limit)}`); }
      catch (e) {
        if (!dataCfg.proxy || e.status === 400) throw e;
        rows = await getJson(`${dataCfg.proxy}?symbol=${sym}USDT&interval=1d&limit=${Math.min(500, limit)}`);   // proxy caps at 500
        viaProxy++;
      }
      if (!Array.isArray(rows) || !rows.length) throw new Error('empty kline response for ' + sym);
      return splitForming(rows, now);
    },

    // Full history from startMs, paging forward 1000 at a time (calibration only).
    async dailySince(sym, startMs, now = Date.now()) {
      const all = []; let from = startMs;
      for (;;) {
        const rows = await api(`/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=1000&startTime=${from}`);
        if (!Array.isArray(rows) || !rows.length) break;
        all.push(...rows);
        if (rows.length < 1000) break;
        from = +rows[rows.length - 1][0] + DAY;
      }
      return splitForming(all, now);
    },

    // 24h statistics for every pair → [{ sym, last, quoteVolume }] for USDT pairs only.
    async tickers() {
      const rows = await api('/api/v3/ticker/24hr');
      return rows.filter(x => x.symbol.endsWith('USDT')).map(x => ({ sym: x.symbol.slice(0, -4), last: +x.lastPrice, quoteVolume: +x.quoteVolume }));
    },

    // Every USDT spot pair the exchange still lists, trading or halted (calibration wants the dead ones too).
    async usdtSymbols() {
      const info = await api('/api/v3/exchangeInfo');
      return info.symbols.filter(s => s.quoteAsset === 'USDT').map(s => ({ sym: s.baseAsset, status: s.status }));
    },
  };
}

// Run `fn` over `items` with bounded concurrency; returns [{ item, value } | { item, error }].
export async function pooled(items, concurrency, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const j = next++; if (j >= items.length) return; try { out[j] = { item: items[j], value: await fn(items[j]) }; } catch (error) { out[j] = { item: items[j], error }; } }
  }));
  return out;
}
