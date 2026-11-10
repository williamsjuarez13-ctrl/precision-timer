# Why v11 looks like this — the evidence, as of the 9 Nov 2026 close

Everything here was computed, not recalled: the deployed dashboard was replayed hour by hour, every
signal was scored against what price did next, and each rule that survived was checked on a later
period. Reproduce any table with `npm run calibrate` (section 4) or the commands in
section 6.

## 1. What happened after the last analysis (28 Sep)

ETH coiled near $2,690 until 6 Oct, never closed above the $2,743 trigger, broke down 7–8 Oct
($2,574 → $2,475), lost $2,357 on 25 Oct and closed 9 Nov at $2,135. The 21 Sep high ($2,808) is the
top so far.

| 28 Sep close → 9 Nov close | |
|---|---|
| BTC | −9.7% (83,500 → 75,368) |
| ETH | −20.6% |
| LINK | −31.0% |
| AVAX | −18.5% |
| Average of the 84 coins in that day's universe | −24.9% (3 of 84 up) |

### The calls, scored

| Date | Call | Result |
|---|---|---|
| 24 Aug | week: chop | right |
| 24 Aug | month: bull bucket | right ($2,808 printed in September) |
| 24 Aug | quarter: 55–60% constructive | failing — ETH is under the level named as the falsifier |
| 25 Aug | September down, 55–60% | wrong |
| 30 Aug | a lower dip first, 60/40 | right (low $2,357) |
| 1 Sep | 65% resolves down | right |
| 1 Sep | 55% tests $2,150–2,205 before FOMC | wrong |
| 5 Sep | 60% upside over two weeks | right |
| 21 Sep | LINK trigger $13.69 | right for a week ($15.41), then −31% |
| 24 Sep | ETH $2,689 "highest-quality entry" | wrong (−21%) |
| 28 Sep | "~60% resolves upward… mid-trend digestion, not a top" | wrong |

Six of ten short-horizon calls were right — about what calls made at 55–65% confidence should
score, and not evidence of an edge. The two that decided capital (24 and 28 Sep) were wrong.
The plain Monte Carlo run in September (median outcome below 1×, roughly 60% chance of loss)
described the following two months better than any of the narratives.

## 2. What the deployed dashboard (v9.3) actually did

Method: the deployed `index.html` was run unmodified in a sandbox with a fake clock, fed real 1-hour
candles, once per hour from Aug 2023 to 10 Nov 2026 — 28,633 hours × 15 coins = 429,135 coin-hours.
"vs market" = minus the 15-coin average over the same hours. Baseline: +0.80% per 7 days.

**The regime / veto layer has never run in swing mode.** The page asks for 60 daily candles, drops
the forming one, then requires at least 60. Result over all 429,135 coin-hours: regime shown
"RANGE" 100% of the time, falling-knife guard fired 0 times, the ETF-outflow veto, crowded-long cap
and structure bonus never executed. Everything v8 was designed around was switched off by one number.

**The composite score does not predict.**

| | n (coin-hours) | next 7 days | vs market |
|---|---|---|---|
| Score 75+ ("high conviction") | 152,279 | +0.95% | −0.13% |
| Score crosses up into 75+ | 9,781 | +0.47% | −0.31% (95% CI −0.5 to −0.1) |
| Score below 30 | 45,746 | +1.97% | +0.27% |

**The expectancy panel would have misled.** Had a tab been open the whole time it would have logged
3,926 closed trades at −0.31R each. Auditing each against real highs and lows: 48% of the recorded
wins never happened — the zone moved under the price. The same entries with levels frozen at entry:
42% hit rate at a median 1.29:1, −0.07R per trade.

**How each improvement did**

| Version | Intended | Measured |
|---|---|---|
| v9.1 re-anchor | stop showing targets already passed | Worked: "all three targets below price" fell from 13.0% to 4.8% of coin-hours. Side effect: 23% of re-anchored hours used "price − 1.5 ATR", which moves with every tick, so the ladder followed price and printed "AT TP1 — SCALE OUT 50%" by construction (the 24 Aug screenshot). The page says some form of "scale out" 57% of all hours. |
| v9.2 turn detection | catch tops and bottoms | At the 21 Sep top it was right: score 5–17, "EXIT", extension +3.4 ATR. As a rule it is not: extension ≥ +3 ATR (scored −8) was followed by +2.85% per 7 days across 9,808 coin-hours — strength continued. Divergences, higher-low retest and the trend gate had no measurable effect. In the decline its bottom detectors (capitulation, higher-low retest, extension ≤ −3 ATR) fired 21 times on ETH and pushed the score up while price kept falling. |
| v9.3 liq shelves, ETH/BTC | context rows | Display-only, never scored, not evaluated here. |
| v10 scanner | catch breakouts across the top 100 | Never deployed — see section 3. |

**The decline, 7 Oct → 9 Nov (ETH −20.8%).** Score averaged 73; "BUY" or "STRONG BUY" 26% of all
hours; ten fresh buy banners, ETH lower a week later after eight of the nine that have matured. On
7 Oct at $2,579, under the stop, the banner read "STRONG BUY — 3 of 4 timeframes aligned", score 100.
On 9 Nov at $2,094: "STRONG BUY — 4 of 4", score 100.

**With the one-number fix (v9.4, `classic.html`)** the same replay shows, for the same decline:
"BEAR REGIME — no new longs" 65% of hours, "FALLING KNIFE" 8%, STRONG BUY 0%; 7 Oct score 38. That
is what v8 was meant to do. It does not make the score predictive (75+ → +0.03% vs market) and its
BEAR flag is on 59% of all hours — the classic page is now safe to look at, not something to trade from.

## 3. v10, audited before shipping

| Problem | Evidence |
|---|---|
| The deployment would have failed | `vercel.json` schedules an hourly cron; Vercel Hobby rejects anything more frequent than daily at deploy time (Vercel docs, "Hobby scheduling limits"). |
| Daily alerts could never fire | The de-dup test compares "now" with the candle's *open* time (24h earlier) against a 70-minute window. Only `?force=1` would ever send. |
| Its ranking pointed at the wrong coins | Ranking by 30-day return vs BTC: best-minus-worst fifth +0.04% per 7 days and −1.57% per 30 on 2024–26 data. On 28 Sep its top fifth went on to lose 30.3% against 24.9% for the market. |
| Events sent unfiltered | Ignition, all coins: beat the market 39% of the time. "Resurrection": −2.6% vs market over 7 days, −8.8% over 30. |
| Also | hand-typed coin list with delisted tickers, September's watch levels frozen in config, mixed UTC / UTC+8 candles on the fallback exchange, no heartbeat. |

## 4. What survived testing — and is in v11

Daily candles, 2020-09 → 2026-11, 208,429 coin-days; universe re-selected every day as the top 100
by 30-day median dollar volume, delisted coins included while they traded. "Since 2024" = from
2024-01-01 on. How much that proves differs by item, and it matters:

- **Ranges, touch and plan tables (c)** were fitted on the earlier data and scored on the later — a
  true out-of-sample test.
- **The rules (a), (b), (d)** — which rank factors, the three trend facts, the event definitions —
  were chosen with the whole history in view. On pre-2024 data alone, closeness to the high was
  significant and low volatility was borderline (+0.81% per 7 days, CI −0.1 to +1.6). So "since
  2024" for these means *it also held later*, which is supporting evidence, not proof.
- The only fully independent test is the live scorecard, starting now.

Full tables: `model/REPORT.md`.

**(a) Rank — which coins to prefer.** Closeness to the 250-day high plus low 30-day volatility.
Since 2024 the best fifth beat the market by +0.99% per 7 days and +4.15% per 30; the worst fifth
lagged by −0.78% and −2.36% (best minus worst +1.82% per 7 days, 95% CI +1.1 to +2.5). It is not
just low beta: after removing market exposure the best fifth still earned +0.79% per 7 days.
Frozen on 28 Sep, to 9 Nov: best fifth −18.6%, market −24.9%, worst fifth −30.6%. It tells you what
to prefer and what to avoid; it does not make a falling market rise.

**(b) Market trend and the exposure gate.** Three facts — BTC above its 200-day EMA, BTC up over
30 days, half the universe above its 50-day EMA. Holding only when at least two are true:

| | buy & hold | gated | worst drawdown |
|---|---|---|---|
| ETH, 2024 → Nov 2026 | −9% | +108% | −68% → −43% |
| BTC, same | +71% | +76% | −53% → −27% |
| ETH, full pipeline replayed daily from Jan 2025 with a model frozen at end-2024 | −36.5% | +37.9% | 44 switches |
| ETH, 1 Aug → 9 Nov 2026 | +15.7% | +6.0% | ON 19 Aug at $2,253, OFF 22 Oct at $2,389 |

It is late at both ends by design and flips about 26 times a year. It did not see the September top
— nothing tested did; all three facts were true on 21 Sep, 28 Sep and 7 Oct. What it does is keep
you out of the long grind: every one of ten trend rules tested was OFF on 25 Jan, 5 Feb, 20 Feb,
1 Jun and 10 Jun 2026, and the gate has been OFF since 22 Oct (ETH $2,389 → $2,135 since).

**(c) Calibrated ranges and touch probabilities.** For each coin, where the close has landed and how
far price has travelled on the way, in units of that coin's own volatility. Out of sample the 80%
range held 81% of the time at 7 days and 82% at 30 (ETH: 81% and 76%). In the 22-month replay with
a frozen model: 84% of 10,065 seven-day ranges and 82% of 9,720 thirty-day ranges.

**(d) Events, by rank tier.** The same breakout means different things in different coins:

| | n | vs market, 7 days | beat market | frozen plan (1.5 ATR stop, 3 ATR target, 14 days) |
|---|---|---|---|---|
| Any coin, any day | 208,429 | 0 | — | −0.03R (since 2024: −0.11R) |
| Ignition in a leader | 1,759 | +1.09% (CI +0.1 to +2.1) | 42% | +0.11R |
| Ignition in a laggard | 975 | −1.15% | 34% | +0.02R (since 2024: −0.14R) |
| Coil under the high, leader | 215 | +2.43% (CI +0.4 to +4.6) | 52% | +0.23R |

Even the good ones lose more often than they win; the edge is in the size of the winners.

**(e) The fact that frames all of it.** An equal-weight basket of the top-100 coins lost 86% from
January 2024 to November 2026. "Scan the top 100 for breakouts" was fishing in a draining pond; BTC
and ETH with a trend gate were not.

## 5. What was removed, and what is still unknown

Removed from anything that scores or alerts: the composite score, intraday oscillator confluence,
the v9.2 score nudges, 30-day relative-strength ranking, "resurrection" and stoch-trigger events,
every estimated win rate.

Not solved: calling tops. Limits of the evidence: six years and roughly two cycles of one exchange's
spot data; coins the exchange has fully delisted are missing (flatters the universe slightly); the
vs-market numbers exclude trading costs (the gate curves include 0.10% per switch); event samples
are small and their intervals wide. That is why v11 keeps a ledger: every forecast is frozen when
made and scored when it matures, and the scorecard shows live results beside these numbers.

## 6. Reproducing this

```
npm run calibrate                      # section 4 → model/REPORT.md
PT_UNTIL=2024-12-31 PT_MODEL_OUT=.cache/m24 npm run calibrate -- --offline
npm run paper -- --from 2025-01-01 --model .cache/m24/model.js    # the 22-month replay
npm test                               # no-look-ahead, live/backtest parity, ledger, scan
```

Section 2 used a browser-sandbox replay of the old page (not shipped — it tests code that v11
replaces); the one finding that matters going forward, the dead veto block, is fixed in
`classic.html` by `tools/patch-classic.mjs`, which lists every change against v9.3.
