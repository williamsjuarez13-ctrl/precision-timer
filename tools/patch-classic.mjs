// Applies the v9.4 fixes to the deployed v9.3 dashboard. Every replacement must match exactly once,
// so a silent no-op is impossible. Usage: node tools/patch-classic.mjs <v9.3 index.html> <out classic.html>
import fs from 'node:fs';
const [src,out]=process.argv.slice(2);
let s=fs.readFileSync(src,'utf8');
function rep(a,b,label){const n=s.split(a).length-1;if(n!==1)throw new Error(`patch "${label}": expected exactly 1 match, found ${n}`);s=s.replace(a,()=>b);console.log('ok  '+label)}

/* 1 ─ the regime/veto block never ran in swing mode: 60 daily candles requested, the forming one is
       dropped, and the block needs ≥60. Ask for 260 so the block runs and EMA200 is real. */
rep("limits:[100,100,80,60],refresh:60000","limits:[100,100,80,260],refresh:60000",'1 swing daily history 60 → 260 (regime/veto block now executes)');

/* 2 ─ turn-detection score nudges become policy (one place) and default to 0 = display-only.
       Replay 2023-08 → 2026-11: none of them preceded price in the direction it was scored. */
rep("  expectancy:{minEpisodes:5, minContribN:20} // below these: show \"collecting\", never fake numbers\n};",
"  expectancy:{minEpisodes:5, minContribN:20}, // below these: show \"collecting\", never fake numbers\n"+
"  /* ---- v9.4 TURN-DETECTION score deltas. All 0 = rows are information only. Measured on 429,135\n"+
"     coin-hours (Aug-2023 → Nov-2026): extension ≥ +3 ATR was followed by +2.9%/7d (it was scored −8);\n"+
"     divergences, higher-low retest and the trend gate had no measurable effect. Do not raise these\n"+
"     without a backtest (npm run backtest). ---- */\n"+
"  turn:{extHot:0, extCold:0, exhaustion:0, capitulation:0, bullDiv:0, bullDivBear:0, bearDiv:0, hlRetest:0, gateExpanding:0, gateRolling:0}\n};",
'2 V8E_PARAMS.turn added');
const T='V8E_PARAMS.turn';
rep("if(extHot)score=Math.max(0,score-8);\n    if(extCold)score=Math.min(100,score+6);",`if(extHot)score=Math.max(0,score-${T}.extHot);\n    if(extCold)score=Math.min(100,score+${T}.extCold);`,'3a extension nudges → params');
rep("sub:'Climax range, closed in bottom third — buyer exhaustion'});\n          score=Math.max(0,score-6);",`sub:'Climax range, closed in bottom third — buyer exhaustion'});\n          score=Math.max(0,score-${T}.exhaustion);`,'3b exhaustion nudge → param');
rep("sub:'Climax range, closed in top third — seller exhaustion'});\n          score=Math.min(100,score+6);",`sub:'Climax range, closed in top third — seller exhaustion'});\n          score=Math.min(100,score+${T}.capitulation);`,'3c capitulation nudge → param');
rep("score=Math.min(100,score+(sc_regime==='BEAR'?4:8));",`score=Math.min(100,score+(sc_regime==='BEAR'?${T}.bullDivBear:${T}.bullDiv));`,'3d bullish-divergence nudge → param');
rep("vs RSI '+r_[phs[0].i].toFixed(0)+'→'+r_[phs[1].i].toFixed(0)});\n        score=Math.max(0,score-10);",`vs RSI '+r_[phs[0].i].toFixed(0)+'→'+r_[phs[1].i].toFixed(0)});\n        score=Math.max(0,score-${T}.bearDiv);`,'3e bearish-divergence nudge → param');
rep("sub:'Pivot sequence rising & price at retest — structural bottom pattern'});\n          score=Math.min(100,score+6);",`sub:'Pivot sequence rising & price at retest — structural bottom pattern'});\n          score=Math.min(100,score+${T}.hlRetest);`,'3f higher-low-retest nudge → param');
rep("sub:'Overbought in an EXPANDING trend — sell pressure discounted (rollover not confirmed)'});\n          score=Math.min(100,score+5);",`sub:'Overbought in an EXPANDING trend — sell pressure discounted (rollover not confirmed)'});\n          score=Math.min(100,score+${T}.gateExpanding);`,'3g trend-gate (expanding) nudge → param');
rep("sub:'Overbought AND momentum rolling over — sell signal validated'});\n          score=Math.max(0,score-5);",`sub:'Overbought AND momentum rolling over — sell signal validated'});\n          score=Math.max(0,score-${T}.gateRolling);`,'3h trend-gate (rolling) nudge → param');

/* 4 ─ vetoes are final: nothing computed after the regime block may lift the score back over a cap */
rep("    score=Math.max(0,Math.min(100,score));\n  })();\n\n  /* ===== v9.3 DISPLAY ROWS",
"    score=Math.max(0,Math.min(100,score));\n  })();\n"+
"  /* v9.4: layered vetoes stay final — re-assert the regime caps after every later module */\n"+
"  if(sc_regime==='BEAR')score=Math.min(score,45);\n  if(sc_knife)score=Math.min(score,28);\n\n  /* ===== v9.3 DISPLAY ROWS",'4 regime caps re-asserted after later modules');

/* 5 ─ the synthetic re-anchor "price − 1.5 ATR" moved with every tick, so the ladder followed price and
       printed "AT TP1 — SCALE OUT" by construction. Build it from CLOSED bars only: it can change when a
       structure-TF bar closes, never in between. */
rep("    if(na===null)na=p-atr*1.5; // synthetic trailing anchor: never leave the ladder in the past",
"    if(na===null){ // v9.4 frozen trailing anchor: closed bars only — constant until the next bar closes\n"+
"      const nb=V8E_PARAMS.pivotLR*2+4;\n"+
"      const hh=hs&&hs.length?Math.max(...hs.slice(-nb)):p;\n"+
"      const lc=cs&&cs.length?cs[cs.length-1]:p;\n"+
"      na=Math.min(hh-atr*3,lc-atr*0.5);\n"+
"    }",'5 synthetic anchor frozen to closed bars');

/* 6 ─ the "EST %" win rates and "R:R" in the stats table were invented by a formula (72 + 5 x timeframes + …).
       Replace them with measured odds from the shared engine and model (swing mode; the model is daily). */
rep("<th style=\"text-align:center\">EST %*</th><th style=\"text-align:center\">R:R</th>","<th style=\"text-align:center\">TP FIRST*</th><th style=\"text-align:center\">R:R NOW</th>",'6a stats table headers');
rep("*Synthetic estimates, not backtested — live signal log is accumulating real hit rates to replace these.","*Measured, not estimated: how often a target this far away traded before a stop this far away within 14 days, across every coin-day in model/model.js. R:R is from the current price. “—” = already hit, price under the stop, scalp mode, or model not loaded.",'6b stats footnote');
rep(`  const statsData=[
    {tp:z.hits&&z.hits[0]?'TP1 ✓':'TP1',wr:Math.min(94,72+bTFs*5+sc.score*.1).toFixed(0),pf:(1.2+bTFs*.3).toFixed(1),risk:fmtP(risk),tgt:(z.hits&&z.hits[0]?'✓ ':'')+fmtP(z.t1)},
    {tp:z.hits&&z.hits[1]?'TP2 ✓':'TP2',wr:Math.min(82,55+bTFs*4+sc.score*.08).toFixed(0),pf:(1.0+bTFs*.25).toFixed(1),risk:fmtP(risk),tgt:(z.hits&&z.hits[1]?'✓ ':'')+fmtP(z.t2)},
    {tp:z.hits&&z.hits[2]?'TP3 ✓':'TP3',wr:Math.min(68,38+bTFs*3+sc.score*.06).toFixed(0),pf:(0.8+bTFs*.2).toFixed(1),risk:fmtP(risk),tgt:(z.hits&&z.hits[2]?'✓ ':'')+fmtP(z.t3)}
  ];`,
`  // v9.4: measured odds (engine/forecast.js reading model/model.js) — never a formula
  const ptOdds=function(tgt){try{if(mode!=='swing'||!window.PTM)return null;return window.PTM.odds(d.__macroCloses,d.price,z.stop,tgt)}catch(e){return null}};
  const ptRow=function(lbl,hit,tgt){const o=hit?null:ptOdds(tgt);return{tp:hit?lbl+' ✓':lbl,wr:o?(o.pTarget*100).toFixed(0)+'%':'—',pf:o?o.rr.toFixed(1)+':1':'—',risk:fmtP(risk),tgt:(hit?'✓ ':'')+fmtP(tgt)}};
  const statsData=[ptRow('TP1',z.hits&&z.hits[0],z.t1),ptRow('TP2',z.hits&&z.hits[1],z.t2),ptRow('TP3',z.hits&&z.hits[2],z.t3)];`,'6c stats rows use measured odds');
rep("`<tr><td>${r.tp}</td><td style=\"text-align:center\">${r.wr}%</td>","`<tr><td>${r.tp}</td><td style=\"text-align:center\">${r.wr}</td>",'6d stats row template');
rep(`refreshEtfFlows(); // v9: flows update once per trading day → poll every 30 min
setInterval(refreshEtfFlows,V8E_PARAMS.flow.refreshMs);
</script>`,
`refreshEtfFlows(); // v9: flows update once per trading day → poll every 30 min
setInterval(refreshEtfFlows,V8E_PARAMS.flow.refreshMs);
window.addEventListener('ptm-ready',function(){try{if(allData[selSym])updateSignalCard()}catch(e){}}); // v9.4: redraw once the model has loaded
</script>
<script type="module">
// v9.4: the classic page borrows its probabilities from the same engine and model as the measured board.
import model from './model/model.js';
import { planOdds } from './engine/forecast.js';
import { sigmaFromCloses } from './engine/series.js';
window.PTM = { fittedThrough: model.fittedThrough,
  odds(dailyCloses, entry, stop, target) { const s = sigmaFromCloses(dailyCloses); return s ? planOdds(model, { entry, stop, target, sigma: s, k: 14 }) : null; } };
window.dispatchEvent(new Event('ptm-ready'));
</script>`,'6e engine + model loaded as a module');

/* 7 ─ link to the measured board, and say plainly what this page's score is */
rep(`  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <div class="mode-toggle">`,`  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <a class="btn btn-sm btn-em" href="./" style="text-decoration:none" title="Rank, market state, calibrated ranges and the scorecard">◆ Measured board</a>
    <div class="mode-toggle">`,'7 link to the measured board');

/* 8 ─ version label */
rep("<small>v9.3 · quant</small>","<small>v9.4 · classic</small>",'8 version label');
fs.writeFileSync(out,s);
console.log(`wrote ${out} (${s.length} bytes)`);
