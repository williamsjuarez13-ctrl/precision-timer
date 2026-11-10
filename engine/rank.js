// PrecisionTimer engine — the cross-sectional rank.
//
// Each universe member gets a percentile (0..1) on every rank factor named in the config, the factor
// percentiles are averaged, and that average is ranked again. 1.00 = best in the universe today.
// Which factors exist is mechanism (FACTORS below); which ones are USED is policy (pt.config.js →
// rank.factors) and each change must go through `npm run calibrate`, which measures the result.

export const FACTORS = {
  // closer to the 250-day high is better (George & Hwang "52-week high" effect; holds every year 2020-26)
  nearHigh: f => f.near250,
  // lower 30-day volatility is better (the most volatile fifth of coins lagged in 6 of 7 years)
  lowVol: f => (f.sd30 === null ? null : -f.sd30),
  // kept available for experiments — NOT in the default rank: no out-of-sample edge 2024-26
  momentum30: f => f.chg30,
  momentum7: f => f.chg7,
  extension: f => f.ext20,
  rsi: f => f.rsi,
};

// Percentile of each value among the defined ones: (position + 0.5) / count. Ties broken by index.
export function percentiles(values) {
  const idx = [];
  values.forEach((v, j) => { if (v !== null && v !== undefined && !Number.isNaN(v)) idx.push([v, j]); });
  idx.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array(values.length).fill(null);
  idx.forEach(([, j], k) => { out[j] = (k + 0.5) / idx.length; });
  return out;
}

export const tierOf = rp => (rp === null ? null : rp >= 2 / 3 ? 'leader' : rp < 1 / 3 ? 'laggard' : 'middle');
export const quintileOf = rp => (rp === null ? null : Math.min(5, Math.floor(rp * 5) + 1));

// feats: array of featuresAt(...) objects (the universe on one day). Returns a parallel array of
// { score, rankPct, rank (1 = best), quintile (5 = best), tier }.
export function rankUniverse(feats, factorNames) {
  const parts = factorNames.map(name => {
    const fn = FACTORS[name]; if (!fn) throw new Error('unknown rank factor: ' + name);
    return percentiles(feats.map(fn));
  });
  const score = feats.map((_, j) => {
    let s = 0; for (const p of parts) { if (p[j] === null) return null; s += p[j]; }
    return s / parts.length;
  });
  const rp = percentiles(score);
  const order = feats.map((_, j) => j).filter(j => rp[j] !== null).sort((a, b) => rp[b] - rp[a]);
  const pos = new Array(feats.length).fill(null); order.forEach((j, k) => { pos[j] = k + 1; });
  return feats.map((_, j) => ({ score: score[j], rankPct: rp[j], rank: pos[j], quintile: quintileOf(rp[j]), tier: tierOf(rp[j]) }));
}
