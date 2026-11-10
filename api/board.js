// Vercel Serverless Function — /api/board
// Builds the measured board on demand with the same engine the hourly scan uses. The page falls
// back to this when the scan's data branch is missing or stale, so the board works the moment the
// files are deployed — before (or without) the GitHub Action. It keeps no state: the ledger,
// scorecard and alerts exist only where the scan writes them.
import config from '../pt.config.js';
import model from '../model/model.js';
import { makeClient } from '../engine/data.js';
import { fetchBoard } from '../engine/live.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    // this function runs in Frankfurt (vercel.json regions), where api.binance.com is reachable;
    // the proxy fallback would call this same deployment, so it is switched off here
    const { board } = await fetchBoard({ client: makeClient({ ...config.data, proxy: null }), config, model });
    board.mode = 'on-demand';
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json(board);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'board unavailable', detail: String(e && e.message || e) });
  }
}
