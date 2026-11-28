// PrecisionTimer v11 — POLICY. Every tunable rule lives here and nowhere else.
// Edit this file in GitHub (pencil icon) → commit → Vercel redeploys and the hourly scan picks it up.
// Anything under `universe`, `rank`, `regime` or `plan` changes what the engine measures, so after
// changing those run the "PrecisionTimer calibrate" workflow (Actions tab) to re-measure the model.

export default {
  version: '12.0.0',

  // Where the hourly scan stores its output (board, ledger, scorecard). The page reads it from here.
  repo: 'williamsjuarez13-ctrl/precision-timer',
  dataBranch: 'pt-data',          // if you rename it, rename it in vercel.json too (git.deploymentEnabled)

  // ── What counts as "the market" ────────────────────────────────────────────────────────────────
  universe: {
    size: 100,                     // top N by 30-day median dollar volume
    candidates: 180,               // live: how many of today's most-traded USDT pairs to examine
    minHistoryDays: 250,           // needs a full 250-day high before it can be ranked
    minMedianDollarVolume: 2e6,    // 30-day median daily volume floor, USD
    minDailyVol: 0.006,            // 30-day σ floor (drops stablecoin-like tickers)
    minWeekendRatio: 0.35,         // weekend range / weekday range — drops tokenised gold & equities
  },

  // ── Which coins are preferred (cross-sectional rank) ───────────────────────────────────────────
  // Factors are defined in engine/rank.js. These two are the only ones that kept working out of
  // sample (2024-2026): closeness to the 250-day high and low 30-day volatility.
  rank: { factors: ['nearHigh', 'lowVol'] },

  // ── Market layer ───────────────────────────────────────────────────────────────────────────────
  regime: {
    breadthThreshold: 0.5,         // "breadth OK" = at least this share of the universe above its 50-day EMA
    gateOnAt: 2,                   // exposure gate turns ON when at least this many of the 3 trend facts are true…
    gateOffAt: 1,                  // …and OFF when this many or fewer are. 2/1 = no hysteresis (tested 3/1, 3/0, 2/0:
                                   // fewer flips, but lower returns since 2020 — docs/EVIDENCE.md, section 7)
    washoutMedianRsi: 35,          // whole-market oversold flag
  },

  // ── Daily signal (engine/signal.js): extra half-size tranche bought on capitulation while the gate is OFF ──
  signal: {
    // coins: where the tranche is used. Measured since 2020 it added to BTC and ETH and was neutral across
    // ten large coins on average, so it is on for those two only (model/REPORT.md, section 3b).
    capitulation: { coins: ['BTC', 'ETH'], rsi: 30, below200: 0.15, size: 0.5, exitRsi: 65, exitWithin200: 0.10, maxDays: 90, stopLookback: 20 },
    coins: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'LINK', 'AVAX'],   // briefed on the board (holdings are always added)
  },

  // ── Frozen plan attached to every logged event (and the default in the plan calculator) ────────
  plan: { stopAtr: 1.5, targetAtr: 3, maxDays: 14 },

  // ── Yours ──────────────────────────────────────────────────────────────────────────────────────
  holdings: ['ETH', 'LINK', 'AVAX'],          // shown first; tier changes on these are alerted
  track: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'SUI', 'NEAR', 'AAVE', 'LTC', 'UNI'],
                                              // coins whose range forecasts are logged and scored every day
  // Price levels you care about. Add your own lines, e.g. a liquidation price:
  //   { sym: 'ETH', level: 1450, label: 'Aave liquidation' },
  // The board shows how often a level that far away has been touched within 7 / 30 days, and the
  // scan alerts when the 30-day probability rises above alerts.touchProb30 or the level is crossed.
  watch: [],

  // ── Alerts (Telegram, optional — see README) ───────────────────────────────────────────────────
  alerts: {
    events: { IGNITION: ['leader'], COIL: ['leader'] },   // which (event, rank tier) pairs are worth a message
    gateFlip: true,                 // exposure gate turned ON or OFF at the daily close
    signalChange: true,             // a briefed coin's action changed (BUY / ADD / TRIM / SELL)
    holdingsTier: true,             // one of `holdings` moved between leader / middle / laggard
    touchProb30: 0.20,              // a watch level's 30-day touch probability crossed above this
    heartbeatHourUTC: 14,           // one summary a day at this hour, so silence always means "broken"
  },

  // ── Measurement ────────────────────────────────────────────────────────────────────────────────
  calibration: {
    start: '2018-01-01',            // history used
    split: '2024-01-01',            // forecast tables are fitted before this date and scored after it;
                                    // every other statistic is reported separately for the period since
  },

  // ── Data sources (tried in order; all are public market data, no keys) ─────────────────────────
  data: {
    bases: ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'],
    proxy: 'https://precision-timer-three.vercel.app/api/klines',   // your own Frankfurt proxy as last resort (candles)
    boardEndpoint: 'https://precision-timer-three.vercel.app/api/board',   // …and for the whole board, if the scan's host cannot reach the exchange at all
  },
};
