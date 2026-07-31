// Vercel Serverless Function - /api/etf
// Spot-ETF daily net flows for the v9 FLOW module (the orthogonal, non-price input).
//
// SOURCES (tried in order, both parse to the same shape):
//   1. farside.co.uk direct with browser headers — works from residential IPs; their
//      Cloudflare 403/502-blocks datacenter ranges (observed blocking Vercel fra1).
//   2. r.jina.ai mirror of the same page — returns the table as markdown rows
//      ("| 13 Jul 2026 | ... | (15.4) |"), reachable from datacenter IPs (verified).
// If BOTH fail this returns a LOUD 502 — the client renders "FLOW SOURCE DOWN"
// rather than silently reusing stale numbers.
//
// SHAPE (normalized, oldest-first, $ millions, negatives already signed):
//   { symbol, updated, source: "farside"|"jina", days: [ { date, total }, ... ] }
// The proxy is MECHANISM only — all classification thresholds live client-side in params.

const PAGES = {
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
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/&amp;/g, '&').trim();
}
// Farside prints negatives as "(15.4)" and thousands with commas.
function parseFlowNumber(s) {
  const neg = /^\(.*\)$/.test(s.trim());
  const n = parseFloat(s.replace(/[(),]/g, ''));
  if (isNaN(n)) return null;
  return neg ? -n : n;
}
// "13 Jul 2026" → "2026-07-13"; anything else → null
function parseRowDate(s) {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}`;
}
function normalize(days) {
  const seen = new Set();
  return days
    .filter((d) => (seen.has(d.date) ? false : seen.add(d.date)))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- Source 1: direct HTML ----
function parseHtml(html) {
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
  return normalize(days);
}
async function fromFarside(symbol) {
  const response = await fetch(PAGES[symbol], { headers: BROWSER_HEADERS });
  if (!response.ok) throw new Error(`farside HTTP ${response.status}`);
  const days = parseHtml(await response.text());
  if (days.length < 5) throw new Error(`farside parsed only ${days.length} rows`);
  return { source: 'farside', days };
}

// ---- Source 2: Jina mirror (markdown table rows: "| 13 Jul 2026 | ... | (15.4) |") ----
function parseMarkdown(text) {
  const days = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length);
    if (cells.length < 3) continue;
    const date = parseRowDate(cells[0]);
    if (!date) continue;
    const total = parseFlowNumber(cells[cells.length - 1]);
    if (total === null) continue;
    days.push({ date, total });
  }
  return normalize(days);
}
async function fromJina(symbol) {
  const response = await fetch(`https://r.jina.ai/${PAGES[symbol]}`, {
    headers: { 'User-Agent': 'PrecisionTimer/1.0', Accept: 'text/plain' },
  });
  if (!response.ok) throw new Error(`jina HTTP ${response.status}`);
  const days = parseMarkdown(await response.text());
  if (days.length < 5) throw new Error(`jina parsed only ${days.length} rows`);
  return { source: 'jina', days };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!PAGES[symbol]) {
    return res.status(400).json({ error: 'Invalid symbol. Use: ETH | BTC' });
  }

  const errors = [];
  for (const attempt of [fromFarside, fromJina]) {
    try {
      const { source, days } = await attempt(symbol);
      // ETF flows update once per trading day → cache 30 min at the edge
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json({ symbol, updated: new Date().toISOString(), source, days });
    } catch (err) {
      errors.push(err.message || 'fetch failed');
    }
  }
  // LOUD failure — the client must show SOURCE DOWN, never stale-as-fresh
  return res.status(502).json({ error: 'ETF flow source failed', detail: errors.join(' · ') });
}
