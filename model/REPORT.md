# PrecisionTimer model — measured 2026-11-25

History 2020-05-31 → 2026-11-24 · 212,252 coin-days · 2345 days · universe = top 100 by 30-day median $ volume, re-selected every day.
"Since 2024" = from 2024-01-01 on. For the range, touch and plan tables (section 4) that is a true out-of-sample test: they were fitted on the earlier data and scored on the later.
For the rules themselves (which rank factors, the trend facts, the event definitions) it is weaker — they were picked with the whole history in view, so read those columns as "it also held in the later period". The only fully independent test is the live scorecard.

## 1. Rank (nearHigh + lowVol) — average return over the same-day universe, %

| horizon | period | worst fifth | 2nd | 3rd | 4th | best fifth | best − worst [95% CI] |
|---|---|---|---|---|---|---|---|
| 7d | before 2024 | -0.41 | -0.15 | +0.09 | +0.04 | +0.44 | +0.93 [+0.1, +1.8] |
| 7d | since 2024 | -0.77 | -0.25 | -0.35 | +0.38 | +1.00 | +1.83 [+1.1, +2.5] |
| 14d | before 2024 | -0.82 | -0.12 | +0.01 | +0.08 | +0.85 | +1.81 [+0.2, +3.5] |
| 14d | since 2024 | -1.28 | -0.62 | -0.73 | +0.66 | +1.95 | +3.30 [+1.9, +4.8] |
| 30d | before 2024 | -1.57 | -0.07 | +0.11 | -0.12 | +1.63 | +3.66 [-0.0, +8.2] |
| 30d | since 2024 | -2.38 | -1.02 | -1.50 | +0.71 | +4.17 | +6.59 [+3.6, +9.7] |

## 2. Market trend state — what followed, all history (median %, share of periods that were up, chance of a 10%+ drop)

| state | days | BTC 30d | ETH 30d | top-100 avg 30d |
|---|---|---|---|---|
| 3/3 | 724 | +2.6% · up 57% · −10% 12% | +6.1% · up 62% · −10% 18% | +6.3% · up 55% · −10% 30% |
| 2/3 | 454 | -1.3% · up 45% · −10% 27% | -0.4% · up 48% · −10% 30% | -3.4% · up 41% · −10% 41% |
| 1/3 | 543 | +4.1% · up 60% · −10% 24% | +0.1% · up 50% · −10% 30% | -3.0% · up 44% · −10% 37% |
| 0/3 | 624 | +0.6% · up 53% · −10% 23% | -1.9% · up 45% · −10% 33% | -5.7% · up 36% · −10% 41% |
| washout (median RSI < 35) | 131 | +0.3% · up 51% · −10% 21% | -2.5% · up 41% · −10% 31% | -2.9% · up 44% · −10% 34% |

### Exposure gate (turns ON at 2/3, OFF at 1/3; 0.10% per switch)

| asset | period | buy & hold | gated | max drawdown hold → gated | switches / yr |
|---|---|---|---|---|---|
| BTC | before 2024 | +383% | +992% | -77% → -38% | 13.6 |
| BTC | since 2024 | +35% | +76% | -53% → -27% | 25.9 |
| ETH | before 2024 | +873% | +3304% | -79% → -36% | 13.6 |
| ETH | since 2024 | -29% | +108% | -68% → -43% | 25.9 |
| universe | before 2024 | +374% | +3983% | -88% → -42% | 13.6 |
| universe | since 2024 | -89% | -63% | -93% → -78% | 25.9 |

## 3. Events — return over the same-day universe, and the frozen plan (stop 1.5 ATR, target 3 ATR, 14 days)

Any coin on any day, same plan: -0.031R (since 2024: -0.121R).

| event | rank tier | period | n | 7d excess [CI] | beat market | 30d excess | plan mean R | plan win |
|---|---|---|---|---|---|---|---|---|
| Ignition | leader | all | 1811 | +1.17% [+0.2, +2.2] | 42% | +3.36% | +0.107 | 39% |
| Ignition | leader | since 2024 | 784 | +1.70% [+0.3, +3.1] | 46% | +4.69% | +0.015 | 35% |
| Ignition | middle | all | 1749 | -0.25% [-1.3, +1.0] | 38% | +0.65% | +0.139 | 39% |
| Ignition | middle | since 2024 | 721 | -0.74% [-2.4, +1.0] | 39% | +0.02% | +0.082 | 38% |
| Ignition | laggard | all | 999 | -1.03% [-2.6, +0.6] | 34% | -1.75% | +0.015 | 35% |
| Ignition | laggard | since 2024 | 423 | -0.21% [-2.3, +2.0] | 38% | -0.98% | -0.137 | 29% |
| Ignition | all | all | 4559 | +0.15% [-0.6, +0.8] | 39% | +1.20% | +0.099 | 38% |
| Ignition | all | since 2024 | 1928 | +0.37% [-0.7, +1.3] | 42% | +1.70% | +0.007 | 35% |
| Coil under the high | leader | all | 228 | +2.77% [+0.9, +4.8] | 53% | +3.03% | +0.236 | 44% |
| Coil under the high | leader | since 2024 | 83 | +2.80% [+0.3, +5.7] | 55% | +3.72% | +0.123 | 42% |
| Coil under the high | middle | all | 190 | +1.96% [-0.7, +5.0] | 43% | +2.18% | +0.055 | 37% |
| Coil under the high | middle | since 2024 | 67 | -1.15% [-4.3, +2.2] | 42% | -7.89% | -0.109 | 33% |
| Coil under the high | laggard | all | 83 | -1.04% [-4.1, +2.3] | 27% | -4.41% | -0.159 | 33% |
| Coil under the high | laggard | since 2024 | 20 | -5.20% [—, —] | 15% | -9.66% | -0.467 | 20% |
| Coil under the high | all | all | 501 | +1.83% [+0.4, +3.4] | 45% | +1.47% | +0.102 | 40% |
| Coil under the high | all | since 2024 | 170 | +0.30% [-1.6, +2.3] | 45% | -2.46% | -0.038 | 36% |

| just being in the tier (no event) | period | n | 7d excess | 30d excess | plan mean R |
|---|---|---|---|---|---|
| leader | all | 70243 | +0.53% | +1.88% | +0.004 |
| leader | since 2024 | 32709 | +0.80% | +2.97% | -0.082 |
| middle | all | 71766 | -0.11% | -0.49% | -0.046 |
| middle | since 2024 | 33385 | -0.24% | -1.17% | -0.144 |
| laggard | all | 70243 | -0.42% | -1.38% | -0.052 |
| laggard | since 2024 | 32709 | -0.56% | -1.78% | -0.134 |

## 3b. Daily signal — hysteresis gate (ON at 2/3, OFF at 1/3) + half-size capitulation tranche

| coin | period | signal CAGR / max DD | buy & hold CAGR / max DD | v11 gate CAGR / max DD | in market | changes / yr | capitulation trades (hit) |
|---|---|---|---|---|---|---|---|
| BTC | 2020→ | +59% / -37% | +33% / -77% | +58% / -38% | 52% | 21.1 | 5 (60%) |
| BTC | since 2024 | +23% / -27% | +11% / -53% | +22% / -27% | 52% | 27.6 |  |
| ETH | 2020→ | +106% / -47% | +36% / -79% | +93% / -43% | 55% | 21.3 | 7 (71%) |
| ETH | since 2024 | +36% / -47% | -11% / -68% | +29% / -43% | 55% | 28.3 |  |
| SOL | 2021→ | +136% / -53% | +34% / -96% | +136% / -53% | 46% | 21.3 | 0 (—) |
| SOL | since 2024 | -3% / -52% | -15% / -76% | -3% / -52% | 48% | 26.2 |  |
| BNB | 2020→ | +109% / -41% | +71% / -71% | +109% / -41% | 50% | 20 | 0 (—) |
| BNB | since 2024 | +39% / -41% | +21% / -59% | +39% / -41% | 48% | 26.2 |  |
| XRP | 2020→ | +54% / -70% | +26% / -83% | +54% / -70% | 50% | 20 | 0 (—) |
| XRP | since 2024 | +17% / -57% | +14% / -74% | +17% / -57% | 48% | 26.2 |  |
| LINK | 2020→ | +54% / -56% | +13% / -90% | +54% / -56% | 50% | 20 | 0 (—) |
| LINK | since 2024 | -7% / -56% | -18% / -75% | -7% / -56% | 48% | 26.2 |  |
| AVAX | 2021→ | +52% / -76% | -24% / -96% | +52% / -76% | 45% | 21.7 | 0 (—) |
| AVAX | since 2024 | -29% / -76% | -47% / -90% | -29% / -76% | 48% | 26.2 |  |
| DOGE | 2020→ | +152% / -68% | +61% / -92% | +152% / -68% | 50% | 20 | 0 (—) |
| DOGE | since 2024 | +23% / -68% | -16% / -88% | +23% / -68% | 48% | 26.2 |  |
| ADA | 2020→ | +66% / -64% | +11% / -95% | +66% / -64% | 50% | 20 | 0 (—) |
| ADA | since 2024 | -9% / -61% | -40% / -88% | -9% / -61% | 48% | 26.2 |  |
| DOT | 2021→ | +6% / -79% | -50% / -99% | +6% / -79% | 46% | 21.3 | 0 (—) |
| DOT | since 2024 | -29% / -79% | -59% / -94% | -29% / -79% | 48% | 26.2 |  |
| SUI | 2023→ | +53% / -61% | +5% / -88% | +53% / -61% | 50% | 25.2 | 0 (—) |
| SUI | since 2024 | +34% / -61% | -9% / -88% | +34% / -61% | 48% | 26.2 |  |
| NEAR | 2021→ | +67% / -86% | -11% / -95% | +67% / -86% | 44% | 21.6 | 0 (—) |
| NEAR | since 2024 | +2% / -86% | -9% / -89% | +2% / -86% | 48% | 26.2 |  |
| AAVE | 2021→ | +21% / -62% | -25% / -92% | +21% / -62% | 44% | 21.6 | 0 (—) |
| AAVE | since 2024 | +20% / -54% | -7% / -84% | +20% / -54% | 48% | 26.2 |  |
| LTC | 2020→ | +45% / -54% | -2% / -90% | +45% / -54% | 50% | 20 | 0 (—) |
| LTC | since 2024 | +12% / -49% | -19% / -71% | +12% / -49% | 48% | 26.2 |  |
| UNI | 2021→ | +5% / -75% | -29% / -94% | +5% / -75% | 45% | 21.6 | 0 (—) |
| UNI | since 2024 | +20% / -69% | -15% / -87% | +20% / -69% | 48% | 26.2 |  |

## 4. Ranges and touch probabilities — out-of-sample check: fitted before 2024-01-01, scored after (tables: bucketed)

| horizon | 80% band held | 50% band held | closed below the 5% line | closed above the 95% line |
|---|---|---|---|---|
| 7d | 81% | 49% | 4% | 4% |
| 30d | 81% | 52% | 5% | 3% |

Touch probability — predicted vs realised (levels 5–50% away from spot):

- down7: 1→2 · 4→3 · 7→6 · 15→16 · 27→30 · 42→47 · 61→63 · 76→79 · 92→90
- down30: 1→2 · 4→9 · 8→12 · 15→18 · 27→31 · 43→46 · 60→65 · 81→84 · 92→96
- up7: 1→2 · 3→3 · 8→6 · 15→12 · 27→22 · 43→39 · 59→55 · 75→70 · 92→69
- up30: 1→1 · 4→8 · 8→15 · 16→14 · 27→22 · 42→35 · 60→53 · 80→76 · 92→79

By coin (80% band held; touch predicted → realised):

- BTC: 7d 83%, 30d 80%; 30d touch -10% 47→40, -20% 18→14, -30% 6→3, +10% 44→46, +20% 23→14
- ETH: 7d 81%, 30d 76%; 30d touch -10% 61→60, -20% 31→29, -30% 14→14, +10% 56→54, +20% 34→28
- LINK: 7d 81%, 30d 84%; 30d touch -10% 68→65, -20% 39→40, -30% 20→21, +10% 62→65, +20% 41→34
- AVAX: 7d 81%, 30d 81%; 30d touch -10% 69→67, -20% 41→44, -30% 22→28, +10% 64→63, +20% 43→39

Plan odds (config plan, 14d): target first predicted 21% vs realised 17%; stop first 44% vs 50%.
