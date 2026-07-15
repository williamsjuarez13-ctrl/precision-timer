// Vercel Serverless Function - /api/futures
// Funding rate + open interest for the crowded-leverage detector.
//
// SOURCES (tried in order, responses normalized to one shape):
//   1. Binance Futures (fapi.binance.com) — geo-blocked from US IPs (HTTP 451).
//      Works when the function region is pinned outside the US (vercel.json "regions").
//   2. OKX public API (www.okx.com) — verified working from US IPs. Universal fallback,
//      so this proxy returns data no matter which region Vercel runs it in.
//
// TYPES (whitelisted — nothing else is reachable through this proxy):
//   type=premium → current funding rate        → { lastFundingRate, markPrice, source }
//   type=oi      → open interest history       → [ { timestamp, sumOpenInterest }, ... ] oldest-first
//
// The client only computes % change on OI, so mixed units (Binance=coins, OKX=USD) are fine.

const VALID_PERIODS = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'];
const OKX_PERIODS = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '1H', '4h': '4H', '6h': '4H', '12h': '1D', '1d': '1D' };

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'PrecisionTimer/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

// ---- Binance source ----
async function binancePremium(symbol) {
  const d = await fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
  return { lastFundingRate: d.lastFundingRate, markPrice: d.markPrice, source: 'binance' };
}
async function binanceOI(symbol, period, limit) {
  const d = await fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`);
  if (!Array.isArray(d)) throw new Error('Non-array OI response');
  return d.map(r => ({ timestamp: r.timestamp, sumOpenInterest: r.sumOpenInterest }));
}

// ---- OKX fallback (symbol ETHUSDT → instId ETH-USDT-SWAP, ccy ETH) ----
function okxIds(symbol) {
  const base = symbol.replace(/USDT$/, '');
  return { instId: `${base}-USDT-SWAP`, ccy: base };
}
async function okxPremium(symbol) {
  const { instId } = okxIds(symbol);
  const d = await fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`);
  if (d.code !== '0' || !d.data || !d.data[0]) throw new Error('OKX funding: bad payload');
  return { lastFundingRate: d.data[0].fundingRate, markPrice: null, source: 'okx' };
}
async function okxOI(symbol, period, limit) {
  const { ccy } = okxIds(symbol);
  const p = OKX_PERIODS[period] || '1H';
  const d = await fetchJson(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=${p}`);
  if (d.code !== '0' || !Array.isArray(d.data)) throw new Error('OKX OI: bad payload');
  // OKX rows are [ts, oiUsd, volUsd], newest first → normalize to oldest-first, clamp to limit
  return d.data
    .slice(0, limit)
    .reverse()
    .map(r => ({ timestamp: +r[0], sumOpenInterest: r[1] }));
}

export default async function handler(req, res) {
  // CORS headers - allow any origin to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { type, symbol, period = '1h', limit = 24 } = req.query;

  if (type !== 'premium' && type !== 'oi') {
    return res.status(400).json({ error: 'Invalid type. Use: premium | oi' });
  }
  // Uppercase alphanumerics ending in USDT (all tracked pairs are USDT-quoted)
  if (!symbol || !/^[A-Z0-9]{2,15}USDT$/.test(symbol)) {
    return res.status(400).json({ error: 'Missing or invalid symbol (expected e.g. ETHUSDT)' });
  }
  if (!VALID_PERIODS.includes(period)) {
    return res.status(400).json({ error: 'Invalid period' });
  }
  const lim = Math.min(Math.max(parseInt(limit) || 24, 2), 200);

  const chain = type === 'premium'
    ? [() => binancePremium(symbol), () => okxPremium(symbol)]
    : [() => binanceOI(symbol, period, lim), () => okxOI(symbol, period, lim)];

  let lastError = 'No sources tried';
  for (const attempt of chain) {
    try {
      const data = await attempt();
      // Cache briefly (60s) at the edge — funding/OI move slowly relative to price
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
      return res.status(200).json(data);
    } catch (err) {
      lastError = err.message || 'fetch failed';
      continue;
    }
  }
  return res.status(502).json({ error: 'All futures data sources failed', detail: lastError });
}
