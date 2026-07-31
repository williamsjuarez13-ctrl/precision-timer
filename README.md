# PrecisionTimer

Real-time crypto TA dashboard with Swing/Scalp modes.

Live: https://precision-timer-three.vercel.app/

## v9 — Orthogonal inputs + measurement layer

**New: `/api/etf`** — spot-ETF daily net flows (Farside, browser-header fetch, 30-min edge cache). Fails loud (502 → UI shows SOURCE DOWN); never serves stale-as-fresh.

**Upgraded: `/api/futures`** — new `type=funding-hist` (Binance → OKX chain). The crowded-leverage check is now a 3-day funding trend + 7-day OI slope → CROWDED_LONG / CROWDED_SHORT / DELEVERAGED / NEUTRAL, replacing the snapshot read.

**Gates (layered, never blended):**
- ETF STRONG_OUT → score capped at `flow.strongOutCap` (veto notch)
- ETF STRONG_IN → lifts ONLY the v8d volume-demotion (documented un-veto)
- CROWDED_LONG outside BEAR → chase-guard cap at `positioning.crowdedLongCap`
- Missing/stale data → no gate fires, UI says so (fail-safe + visible)

**Expectancy engine (📈 header button)** — builds trade episodes from the existing zone-transition blotter (BUYZONE → TP1/2/3 = +1/2/3R, → BELOW = −1R; zero new API calls). Tables: overall, per-regime (the sizing table), per-flow-state, and indicator ON/OFF contribution. The prune-one-oscillator decision waits for the contribution table at n≥20 — measured, not guessed. Below minimums it says "collecting"; no synthetic numbers, ever.

All v9 tunables live in `V8E_PARAMS` (flow / positioning / expectancy blocks) — policy in one home, mechanism downstream.
