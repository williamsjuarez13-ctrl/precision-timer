// Vercel Serverless Function - /api/etf
// Spot-ETF daily net flows for the v9 FLOW module (the orthogonal, non-price input).
//
// SOURCE: farside.co.uk daily flow tables (ETH + BTC). Farside serves 403 to bot-like
// requests, so we send full browser headers. Verified working 2026-07-31.
// If Farside ever blocks the serverless IP range, this returns a LOUD 502 — the client
// renders "FLOW SOURCE DOWN" rather than silently reusing stale numbers.
//
// SHAPE (normalized, oldest-first, $ millions, negatives already signed):
//   { symbol, updated, days: [ { date: "2026-07-13", total: -15.4 }, ... ] }
// The proxy is MECHANISM only — all classification thresholds live client-side in params.

const SOURCES = {
  ETH: 'https://farside.co.uk/eth/',
  BTC: 'https://farside.co.uk/btc/',
};

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://farside.co.uk/',
};

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

// Farside prints negatives as "(15.4)" and thousands with commas.
function parseFlowNumber(s) {
  const neg = /^\(.*\)$/.test(s);
  const n = parseFloat(s.replace(/[(),]/g, ''));
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

// "13 Jul 2026" → "2026-07-13"; anything else → null
function parseRowDate(s) {
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}`;
}

function parseFarside(html) {
  const days = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (const row of rows) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(stripTags);
    if (cells.length < 3) continue;
    const date = parseRowDate(cells[0]);
    if (!date) continue; // header / Seed / Total / Average / footer rows
    const total = parseFlowNumber(cells[cells.length - 1]);
    if (total === null) continue;
    days.push({ date, total });
  }
  // oldest-first, dedupe on date (some pages repeat the current day while it settles)
  const seen = new Set();
  return days
    .filter((d) => (seen.has(d.date) ? false : seen.add(d.date)))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!SOURCES[symbol]) {
    return res.status(400).json({ error: 'Invalid symbol. Use: ETH | BTC' });
  }

  try {
    const response = await fetch(SOURCES[symbol], { headers: BROWSER_HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status} from farside.co.uk`);
    const html = await response.text();
    const days = parseFarside(html);
    if (days.length < 5) throw new Error(`Parsed only ${days.length} daily rows — table format may have changed`);

    // ETF flows update once per trading day → cache 30 min at the edge
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ symbol, updated: new Date().toISOString(), days });
  } catch (err) {
    // LOUD failure — the client must show SOURCE DOWN, never stale-as-fresh
    return res.status(502).json({ error: 'ETF flow source failed', detail: err.message || 'fetch failed' });
  }
}
