// PrecisionTimer engine — the market layer (the piece v9/v10 never had).
//
// Three yes/no facts read at the daily close:
//   1. BTC closed above its 200-day EMA
//   2. BTC is higher than 30 days ago
//   3. at least half of the universe closed above its own 50-day EMA  (breadth)
// trend = how many are true (0..3).  gate = ON when trend >= config.regime.gateOnAt (default 2).
// The gate is an EXPOSURE rule (when adding risk has paid historically), not a price forecast —
// model/model.js carries what actually followed each state, and the board prints that next to it.

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// btc: featuresAt(BTC series, i) plus chg30; feats: universe features on the same day.
export function marketState(btc, feats, R) {
  const n = feats.length;
  const breadth50 = n ? feats.filter(f => f.above50).length / n : null;
  const breadth200 = n ? feats.filter(f => f.above200).length / n : null;
  const rsis = feats.map(f => f.rsi).filter(x => x !== null);
  const medianRsi = median(rsis);
  const c = {
    btcAbove200: !!btc && btc.above200 === true,
    btc30dUp: !!btc && btc.chg30 !== null && btc.chg30 > 0,
    breadthOk: breadth50 !== null && breadth50 >= R.breadthThreshold,
  };
  const trend = (c.btcAbove200 ? 1 : 0) + (c.btc30dUp ? 1 : 0) + (c.breadthOk ? 1 : 0);
  return {
    trend, gate: trend >= R.gateOnAt ? 'ON' : 'OFF',
    components: c, breadth50, breadth200, medianRsi,
    washout: medianRsi !== null && medianRsi < R.washoutMedianRsi,   // whole market oversold at once
    btcVs200: btc ? btc.v200 : null, btc30d: btc ? btc.chg30 : null, members: n,
  };
}
