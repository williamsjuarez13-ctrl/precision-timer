// PrecisionTimer engine — which coins count as "the market" on a given day.
//
// The universe is a RULE, not a hand-typed list: the top N coins by trailing 30-day median dollar
// volume among those that pass the eligibility tests below, using only data up to that day. The same
// function selects it in the backtest (every historical day) and live (today).

// Not tradeable alt-coins: stablecoins, fiat, wrapped/staked duplicates, tokenised gold, leveraged tokens.
const EXCLUDE = /^(USDC|USDT|USD1|RLUSD|RWUSD|FDUSD|TUSD|USDP|BUSD|DAI|PAX|PAXG|XAUT|EUR|EURI|AEUR|GBP|AUD|TRY|BRL|RUB|UAH|NGN|IDRT|BIDR|BKRW|VAI|SUSD|USDS|USDSB|USDE|USDEB|XUSD|BFUSD|PYUSD|UST|USTC|U|WBTC|WBETH|BETH|WETH|STETH|BNSOL)$|(UP|DOWN|BULL|BEAR)$/;

export const isExcludedName = sym => EXCLUDE.test(sym);

// f = featuresAt(...) for the coin on that day, bars = how many closed daily bars exist up to it,
// weekend = weekendRatio(...) (may be null). Returns null if eligible, otherwise the reason.
export function ineligibleReason(sym, f, bars, weekend, U) {
  if (isExcludedName(sym)) return 'excluded name';
  if (bars < U.minHistoryDays) return 'history < ' + U.minHistoryDays + 'd';
  if (!f || f.med30 === null || f.sd30 === null || f.near250 === null || f.sigma === null) return 'indicators not warm';
  if (f.med30 < U.minMedianDollarVolume) return 'volume below floor';
  if (f.sd30 < U.minDailyVol) return 'not volatile enough (stable-like)';
  if (weekend !== null && weekend < U.minWeekendRatio) return 'weekday-only instrument';
  return null;
}

// rows: [{sym, f}] already filtered for eligibility. Returns the top-N by 30-day median $ volume.
export function selectUniverse(rows, U) {
  return [...rows].sort((a, b) => b.f.med30 - a.f.med30 || (a.sym < b.sym ? -1 : 1)).slice(0, U.size);
}
