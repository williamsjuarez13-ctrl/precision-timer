// Vercel Serverless Function - /api/klines
// Proxies Binance klines API to bypass browser CORS restrictions.
// Deploy: push to Vercel, this file becomes https://your-app.vercel.app/api/klines

export default async function handler(req, res) {
  // CORS headers - allow any origin to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { symbol, interval, limit = 100 } = req.query;

  // Validate inputs
  if (!symbol || !interval) {
    return res.status(400).json({ error: 'Missing symbol or interval' });
  }

  // Whitelist intervals to prevent abuse
  const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
  if (!validIntervals.includes(interval)) {
    return res.status(400).json({ error: 'Invalid interval' });
  }

  // Limit guard
  const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500);

  // Try multiple Binance endpoints for redundancy
  const endpoints = [
    'https://api.binance.com/api/v3/klines',
    'https://api1.binance.com/api/v3/klines',
    'https://api2.binance.com/api/v3/klines',
    'https://api3.binance.com/api/v3/klines',
    'https://data-api.binance.vision/api/v3/klines',
    'https://api.binance.us/api/v3/klines',
  ];

  let lastError = 'No endpoints tried';

  for (const base of endpoints) {
    try {
      const url = `${base}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${lim}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'PrecisionTimer/1.0' },
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status} from ${new URL(base).hostname}`;
        continue;
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        lastError = 'Non-array response';
        continue;
      }

      // Cache briefly (30s) at the edge
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(data);
    } catch (err) {
      lastError = err.message || 'fetch failed';
      continue;
    }
  }

  return res.status(502).json({ error: 'All Binance endpoints failed', detail: lastError });
}
