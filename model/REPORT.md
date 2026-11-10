# PrecisionTimer model — measured 2026-11-10

History 2020-09-06 → 2026-11-09 · 208,429 coin-days · 2256 days · universe = top 100 by 30-day median $ volume, re-selected every day.
"Since 2024" = from 2024-01-01 on. For the range, touch and plan tables (section 4) that is a true out-of-sample test: they were fitted on the earlier data and scored on the later.
For the rules themselves (which rank factors, the trend facts, the event definitions) it is weaker — they were picked with the whole history in view, so read those columns as "it also held in the later period". The only fully independent test is the live scorecard.

## 1. Rank (nearHigh + lowVol) — average return over the same-day universe, %

| horizon | period | worst fifth | 2nd | 3rd | 4th | best fifth | best − worst [95% CI] |
|---|---|---|---|---|---|---|---|
| 7d | before 2024 | -0.41 | -0.14 | +0.10 | +0.01 | +0.44 | +0.94 [+0.1, +1.8] |
| 7d | since 2024 | -0.78 | -0.24 | -0.35 | +0.38 | +0.99 | +1.82 [+1.1, +2.5] |
| 14d | before 2024 | -0.81 | -0.06 | +0.01 | +0.02 | +0.84 | +1.84 [+0.1, +3.6] |
| 14d | since 2024 | -1.27 | -0.58 | -0.74 | +0.65 | +1.92 | +3.26 [+1.8, +4.7] |
| 30d | before 2024 | -1.56 | +0.03 | +0.21 | -0.31 | +1.62 | +3.78 [-0.8, +8.2] |
| 30d | since 2024 | -2.36 | -0.99 | -1.50 | +0.68 | +4.15 | +6.55 [+3.6, +9.8] |

## 2. Market trend state — what followed, all history (median %, share of periods that were up, chance of a 10%+ drop)

| state | days | BTC 30d | ETH 30d | top-100 avg 30d |
|---|---|---|---|---|
| 3/3 | 666 | +4.1% · up 60% · −10% 11% | +7.3% · up 65% · −10% 17% | +7.2% · up 57% · −10% 28% |
| 2/3 | 441 | -1.3% · up 46% · −10% 27% | -0.4% · up 48% · −10% 30% | -3.8% · up 40% · −10% 41% |
| 1/3 | 540 | +4.3% · up 60% · −10% 23% | +0.4% · up 51% · −10% 30% | -2.7% · up 44% · −10% 37% |
| 0/3 | 609 | +0.6% · up 53% · −10% 23% | -1.9% · up 45% · −10% 33% | -5.7% · up 36% · −10% 41% |
| washout (median RSI < 35) | 121 | +0.3% · up 51% · −10% 21% | -2.5% · up 41% · −10% 31% | -2.9% · up 44% · −10% 34% |

### Exposure gate (hold only when trend ≥ 2/3; 0.10% per switch)

| asset | period | buy & hold | gated | max drawdown hold → gated | switches / yr |
|---|---|---|---|---|---|
| BTC | before 2024 | +331% | +886% | -77% → -38% | 14.2 |
| BTC | since 2024 | +71% | +76% | -53% → -27% | 26.2 |
| ETH | before 2024 | +567% | +2061% | -79% → -36% | 14.2 |
| ETH | since 2024 | -9% | +108% | -68% → -43% | 26.2 |
| universe | before 2024 | +282% | +3147% | -88% → -42% | 14.2 |
| universe | since 2024 | -86% | -63% | -92% → -78% | 26.2 |

## 3. Events — return over the same-day universe, and the frozen plan (stop 1.5 ATR, target 3 ATR, 14 days)

Any coin on any day, same plan: -0.026R (since 2024: -0.111R).

| event | rank tier | period | n | 7d excess [CI] | beat market | 30d excess | plan mean R | plan win |
|---|---|---|---|---|---|---|---|---|
| Ignition | leader | all | 1759 | +1.09% [+0.1, +2.1] | 42% | +3.58% | +0.106 | 39% |
| Ignition | leader | since 2024 | 784 | +1.70% [+0.3, +3.1] | 46% | +4.72% | +0.016 | 35% |
| Ignition | middle | all | 1684 | -0.15% [-1.4, +1.1] | 38% | +1.26% | +0.138 | 39% |
| Ignition | middle | since 2024 | 720 | -0.71% [-2.3, +0.9] | 39% | +0.14% | +0.082 | 38% |
| Ignition | laggard | all | 975 | -1.15% [-2.9, +0.6] | 34% | -1.69% | +0.015 | 35% |
| Ignition | laggard | since 2024 | 423 | -0.21% [-2.3, +2.1] | 38% | -0.94% | -0.137 | 29% |
| Ignition | all | all | 4418 | +0.12% [-0.7, +0.9] | 39% | +1.53% | +0.098 | 38% |
| Ignition | all | since 2024 | 1927 | +0.38% [-0.8, +1.5] | 42% | +1.77% | +0.007 | 35% |
| Coil under the high | leader | all | 215 | +2.43% [+0.4, +4.6] | 52% | +3.15% | +0.228 | 44% |
| Coil under the high | leader | since 2024 | 83 | +2.71% [+0.4, +5.5] | 55% | +3.27% | +0.125 | 42% |
| Coil under the high | middle | all | 187 | +2.07% [-0.9, +5.3] | 43% | +2.39% | +0.056 | 37% |
| Coil under the high | middle | since 2024 | 67 | -1.14% [-4.6, +2.1] | 42% | -7.89% | -0.109 | 33% |
| Coil under the high | laggard | all | 77 | -0.99% [-3.8, +2.4] | 26% | -4.74% | -0.094 | 35% |
| Coil under the high | laggard | since 2024 | 20 | -5.20% [—, —] | 15% | -9.66% | -0.467 | 20% |
| Coil under the high | all | all | 479 | +1.74% [+0.3, +3.3] | 45% | +1.58% | +0.109 | 40% |
| Coil under the high | all | since 2024 | 170 | +0.25% [-1.6, +2.2] | 45% | -2.72% | -0.038 | 36% |

| just being in the tier (no event) | period | n | 7d excess | 30d excess | plan mean R |
|---|---|---|---|---|---|
| leader | all | 68967 | +0.52% | +1.81% | +0.009 |
| leader | since 2024 | 32394 | +0.79% | +2.93% | -0.072 |
| middle | all | 70495 | -0.11% | -0.46% | -0.040 |
| middle | since 2024 | 33075 | -0.23% | -1.16% | -0.135 |
| laggard | all | 68967 | -0.41% | -1.35% | -0.046 |
| laggard | since 2024 | 32394 | -0.56% | -1.76% | -0.126 |

## 4. Ranges and touch probabilities — out-of-sample check: fitted before 2024-01-01, scored after (tables: bucketed)

| horizon | 80% band held | 50% band held | closed below the 5% line | closed above the 95% line |
|---|---|---|---|---|
| 7d | 81% | 49% | 5% | 4% |
| 30d | 82% | 53% | 5% | 3% |

Touch probability — predicted vs realised (levels 5–50% away from spot):

- down7: 1→2 · 4→3 · 7→7 · 15→16 · 27→30 · 42→47 · 61→63 · 76→79 · 92→90
- down30: 1→2 · 4→8 · 8→12 · 15→18 · 27→30 · 43→46 · 60→65 · 81→84 · 92→96
- up7: 1→2 · 3→3 · 8→6 · 15→12 · 27→22 · 43→39 · 59→56 · 75→70 · 92→69
- up30: 1→1 · 4→8 · 8→16 · 16→14 · 28→23 · 42→36 · 59→53 · 80→76 · 92→80

By coin (80% band held; touch predicted → realised):

- BTC: 7d 82%, 30d 81%; 30d touch -10% 47→39, -20% 18→13, -30% 6→2, +10% 44→46, +20% 22→15
- ETH: 7d 81%, 30d 76%; 30d touch -10% 61→59, -20% 32→28, -30% 14→14, +10% 56→55, +20% 34→28
- LINK: 7d 80%, 30d 84%; 30d touch -10% 68→64, -20% 39→39, -30% 20→21, +10% 62→66, +20% 41→35
- AVAX: 7d 81%, 30d 81%; 30d touch -10% 69→67, -20% 41→43, -30% 22→27, +10% 64→64, +20% 43→39

Plan odds (config plan, 14d): target first predicted 21% vs realised 17%; stop first 44% vs 49%.
