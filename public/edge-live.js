export const EDGE_RENDERER_CONTRACT='EDGE_STOCKS_V1_3';
export const EDGE_PRESENTATION_CONTRACT='EFFICACY_V2';
export const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const pct=v=>v===null||v===undefined||Number.isNaN(Number(v))?'—':Number(v).toFixed(1)+'%';
const num=(v,d=1)=>v===null||v===undefined||Number.isNaN(Number(v))?'—':Number(v).toFixed(d);
const money=v=>v===null||v===undefined||Number.isNaN(Number(v))?'—':'₹'+Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
const zone=z=>!z||(z.low==null&&z.high==null)?'—':[z.low??'—',z.high??'—'].join(' – ');
const human=s=>String(s??'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
const noTrade=v=>/NO[_ ]?TRADE|NONE|WAIT|AVOID/i.test(String(v??''));
const scoreTone=v=>Number(v)>0?'positive':Number(v)<0?'negative':'neutral';
const scoreText=v=>Number(v)===2?'Strongly positive':Number(v)===1?'Positive':Number(v)===0?'Neutral':Number(v)===-1?'Negative':Number(v)===-2?'Strongly negative':'Not scored';
function ratioText(hits,total){const h=Number(hits||0),t=Number(total||0);return t?(h+'/'+t+' hits'):'0 assessed'}

function renderStockAssessment(report){
  if(typeof document==='undefined')return;
  const root=document.getElementById('stocksAssessmentSummary');if(!root)return;
  const master=report.master_assessment||{},m=master.stock_assessment||{};
  const provisionalTotal=Number(m.provisional_forecast_scorable||0),provisionalHits=Number(m.provisional_forecast_hits||0);
  const zoneTotal=Number(m.provisional_zone_scorable||0),zoneHits=Number(m.provisional_zone_hits||0);
  const official=Number(m.official_scorable_recommendations||0),recRate=m.recommendation_hit_rate_pct;
  const recHits=official&&recRate!=null?Math.round(official*Number(recRate)/100):0;
  root.innerHTML=[
    '<div class="assessment-header"><div><div class="eyebrow">ASSESSMENT · '+esc(report.ticker||'STOCK')+' · TILL DATE</div><h3>Performance assessment</h3></div><small>'+esc(m.recommendations??0)+' tracked call'+(Number(m.recommendations||0)===1?'':'s')+'</small></div>',
    '<div class="assessment-grid stock-assessment-grid">',
      '<div class="assessment-metric"><span>Forecast accuracy</span><strong>'+pct(m.provisional_forecast_accuracy_pct)+'</strong><small>'+esc(ratioText(provisionalHits,provisionalTotal))+' · provisional checkpoints</small></div>',
      '<div class="assessment-metric"><span>Zone accuracy</span><strong>'+pct(m.provisional_zone_accuracy_pct)+'</strong><small>'+esc(ratioText(zoneHits,zoneTotal))+' · provisional checkpoints</small></div>',
      '<div class="assessment-metric"><span>Recommendation accuracy</span><strong>'+(official?pct(recRate):'Not scorable')+'</strong><small>'+(official?esc(recHits+'/'+official+' official calls'):'No officially resolved recommendation yet')+'</small></div>',
      '<div class="assessment-metric"><span>Model P/L</span><strong>'+esc(m.cumulative_model_pnl_units??'—')+'</strong><small>Governed model P/L units</small></div>',
      '<div class="assessment-metric"><span>Hit / miss return</span><strong>'+pct(m.avg_gain_pct)+' / '+pct(m.avg_loss_pct)+'</strong><small>Average gain on hits / loss on misses</small></div>',
    '</div>',
    '<details class="assessment-detail-row"><summary>Assessment details</summary>',
      '<div class="stock-assessment-details">',
        '<div><span>Captured checkpoints</span><strong>'+esc(m.provisional_captured_checkpoints??0)+'</strong></div>',
        '<div><span>Due checkpoints</span><strong>'+esc(m.provisional_due_checkpoints??0)+'</strong></div>',
        '<div><span>Direction hit rate</span><strong>'+pct(m.direction_hit_rate_pct)+'</strong></div>',
        '<div><span>Target hit rate</span><strong>'+pct(m.target_hit_rate_pct)+'</strong></div>',
        '<div><span>Average MFE</span><strong>'+pct(m.avg_mfe_pct)+'</strong></div>',
        '<div><span>Average MAE</span><strong>'+pct(m.avg_mae_pct)+'</strong></div>',
      '</div>',
      '<div class="scorecard-context"><p><b>All EDGE Stocks:</b> '+esc(master.recommendations??0)+' recommendations across '+esc(master.unique_stocks??0)+' stocks · '+esc(master.open_recommendations??0)+' open · '+esc(master.closed_recommendations??0)+' closed. Official efficacy and provisional checkpoint accuracy remain separate.</p></div>',
    '</details>'
  ].join('')
}
function componentOrder(name){
  const k=String(name||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  const order=['PRICE_STRUCTURE','SPECIFIC_CHART_PATTERN','PV_PVPO','RELATIVE_STRENGTH','BUSINESS_FUNDAMENTALS','VALUATION','INSTITUTIONAL_BEHAVIOUR','NEWS_EVENTS_CATALYSTS','EVENT_SHOCK'];
  const i=order.findIndex(x=>k.includes(x));return i<0?99:i
}
function stockWhyCards(report){
  const rows=Array.isArray(report.drilldown)?[...report.drilldown]:[];rows.sort((a,b)=>componentOrder(a.component)-componentOrder(b.component));
  if(!rows.length)return'<div class="why-card"><strong>Evidence detail unavailable</strong><p>No component drill-down was published for this run.</p></div>';
  return rows.map(row=>{
    const legacy=row.narrative_source==='LEGACY_SCORE_RECONSTRUCTION';
    return '<div class="why-card stock-why-card"><div class="stock-factor-head"><strong>'+esc(human(row.component))+'</strong><span class="score-pill '+scoreTone(row.score_or_level)+'">'+esc(scoreText(row.score_or_level))+' · '+esc(row.score_or_level)+'</span></div><p>'+esc(row.interpretation||row.key_outcome||'No interpretation published.')+'</p><div class="stock-factor-foot"><span class="evidence-chip '+(String(row.verification_status)==='VERIFIED'?'verified':'limited')+'">'+esc(human(row.verification_status||'NOT VERIFIED'))+'</span>'+(legacy?'<small>Legacy narrative reconstructed from immutable score; original prose was not persisted.</small>':'')+'</div></div>'
  }).join('')
}
function stockChangeItems(report){
  const d=report.current_stock_outcome||{},items=[],z=d.expected_price_zone||{},p=d.probabilities||{},forecast=String(d.definitive_forecast||'');
  if(z.high!=null)items.push('A sustained close above '+z.high+' with stronger breadth/volume and improving directional agreement would strengthen the bullish case.');
  if(z.low!=null)items.push('A sustained close below '+z.low+' with confirming price-volume weakness would strengthen the bearish case.');
  if(/BASE|RANGE/i.test(forecast))items.push('The current base/range forecast changes only if price accepts outside the expected D+5 zone rather than briefly touching it.');
  if(Number(d.directional_agreement||0)<65)items.push('Directional agreement needs to rise materially from '+num(d.directional_agreement,1)+'% before the setup deserves higher conviction.');
  if(Number(d.market_trust?.score||0)<70)items.push('Market Trust needs to improve from '+num(d.market_trust?.score,1)+'/100 through fresher, more consistent evidence.');
  if(d.risk_override?.status==='ACTIVE')items.push('The active risk override ('+human(d.risk_override.code||'unspecified')+') must clear before the setup can become actionable.');
  if(noTrade(d.primary_action)||String(d.execution?.instrument||'NONE')==='NONE')items.push('A trade requires a governed entry, invalidation, stop and target plan; until those exist, the forecast remains a view rather than an executable trade.');
  if(Number(p.bull||0)>0&&Number(p.bear||0)>0&&Math.abs(Number(p.bull)-Number(p.bear))<15)items.push('Bull and bear probabilities remain too close for a high-conviction directional call.');
  return [...new Set(items)].slice(0,7)
}
function activeCallCards(calls,currentTicker){
  if(!Array.isArray(calls)||!calls.length)return'<p class="muted">No active calls.</p>';
  return '<div class="active-call-grid">'+calls.map(c=>{const selected=String(c.ticker||'')===String(currentTicker||'');return '<div class="active-call-card '+(selected?'selected':'')+'"><div><strong>'+esc(c.ticker||'—')+'</strong><span>'+esc(human(c.definitive_forecast||'—'))+'</span></div><p>'+esc(human(c.definitive_recommendation||'—'))+'</p><small>Current '+money(c.current_price)+' · D+5 zone '+esc(zone(c.expected_price_zone))+'</small><small>Return '+pct(c.current_return_pct)+' · '+esc(human(c.outcome_verdict||'OPEN'))+'</small></div>'}).join('')+'</div>'
}
function executionCard(d){
  const e=d.execution||{},none=String(e.instrument||'NONE')==='NONE';
  if(none)return '<section class="stock-section"><div class="stock-section-title"><div><span>EXECUTION</span><h3>No executable trade</h3></div><span class="status-chip neutral">NO TRADE</span></div><p class="stock-section-copy">The engine has published a stock view, but no governed entry/stop/target structure passes the execution gate. A forecast is not automatically a trade.</p><div class="stock-detail-grid"><div><span>Execution quality</span><strong>'+num(e.execution_quality_score,1)+'/100</strong></div><div><span>Option suitability</span><strong>'+esc(human(e.option_suitability_status||'NO OPTION TRADE'))+'</strong></div><div><span>Time exit</span><strong>'+esc(e.time_exit||'Frozen forecast horizon')+'</strong></div></div></section>';
  return '<section class="stock-section"><div class="stock-section-title"><div><span>EXECUTION</span><h3>Trade plan</h3></div><span class="status-chip positive">'+esc(human(e.instrument))+'</span></div><div class="stock-detail-grid"><div><span>Entry</span><strong>'+money(e.entry_low)+' – '+money(e.entry_high)+'</strong></div><div><span>Stop</span><strong>'+money(e.stop_price)+'</strong></div><div><span>Target 1</span><strong>'+money(e.target1)+'</strong></div><div><span>Target 2</span><strong>'+money(e.target2)+'</strong></div><div><span>Invalidation</span><strong>'+esc(e.invalidation||'—')+'</strong></div><div><span>Time exit</span><strong>'+esc(e.time_exit||'—')+'</strong></div><div><span>Option strike</span><strong>'+esc(e.option_strike??'—')+'</strong></div><div><span>Option expiry</span><strong>'+esc(e.option_expiry||'—')+'</strong></div><div><span>Observed premium</span><strong>'+money(e.observed_premium)+'</strong></div><div><span>Execution quality</span><strong>'+num(e.execution_quality_score,1)+'/100</strong></div></div></section>'
}
function decisionDetails(d){
  return '<section class="stock-section"><div class="stock-section-title"><div><span>DECISION DETAILS</span><h3>Conviction & governance</h3></div></div><div class="stock-detail-grid"><div><span>DES</span><strong>'+num(d.des,2)+'</strong></div><div><span>Market Trust</span><strong>'+num(d.market_trust?.score,1)+'/100 · '+esc(human(d.market_trust?.band||'—'))+'</strong></div><div><span>Directional agreement</span><strong>'+pct(d.directional_agreement)+'</strong></div><div><span>Effective conviction</span><strong>'+pct(d.effective_conviction==null?null:Number(d.effective_conviction)*100)+'</strong></div><div><span>BOT</span><strong>'+num(d.bot?.score,1)+' · '+esc(human(d.bot?.grade||'—'))+'</strong></div><div><span>Decision ladder</span><strong>'+esc(human(d.decision_ladder||'—'))+'</strong></div><div><span>Risk override</span><strong>'+esc(d.risk_override?.status==='ACTIVE'?'ACTIVE · '+human(d.risk_override.code):'Clear')+'</strong></div><div><span>Outcome status</span><strong>'+esc(human(d.outcome_status||'OPEN'))+'</strong></div></div></section>'
}
function userForecastLabel(value){
  const v=String(value||'').toUpperCase();
  if(/BASE|RANGE/.test(v))return 'Range-bound';
  if(/STRONG_BULL/.test(v))return 'Strong bullish';
  if(/MILD_BULL/.test(v))return 'Mild bullish';
  if(/BULL/.test(v))return 'Bullish';
  if(/STRONG_BEAR/.test(v))return 'Strong bearish';
  if(/MILD_BEAR/.test(v))return 'Mild bearish';
  if(/BEAR/.test(v))return 'Bearish';
  return human(value||'—');
}
function trustUserText(d){
  const score=Number(d?.market_trust?.score);
  const band=human(d?.market_trust?.band||'—');
  const view=userForecastLabel(d?.definitive_forecast);
  if(!Number.isFinite(score))return {value:'Not available',detail:'The quality and consistency of the evidence could not be measured.'};
  if(score>=70)return {value:band+' · '+num(score,0)+'/100',detail:'The evidence is consistent enough to trust the current '+view.toLowerCase()+' view. High evidence confidence does not mean bullish; it means the evidence agrees with the published view.'};
  if(score>=50)return {value:band+' · '+num(score,0)+'/100',detail:'The evidence is usable but still mixed. Treat the '+view.toLowerCase()+' view as moderate-confidence rather than a strong directional signal.'};
  return {value:band+' · '+num(score,0)+'/100',detail:'The evidence behind the '+view.toLowerCase()+' view is weak or mixed, so the forecast should be treated cautiously.'};
}
function userActionText(d){
  if(noTrade(d?.primary_action)||String(d?.execution?.instrument||'NONE')==='NONE')return 'Wait — no trade setup currently passes the EDGE execution gates.';
  return human(d?.primary_action||'Review the governed trade plan');
}
function friendlyLegacyInterpretation(row){
  const raw=String(row?.interpretation||'').trim();
  const legacy=row?.narrative_source==='LEGACY_SCORE_RECONSTRUCTION'||/legacy active run|original narrative field was not persisted|immutable verified component score/i.test(raw);
  if(!legacy)return raw||'No user-facing interpretation is available.';
  const component=human(row?.component||'This factor');
  const n=Number(row?.score_or_level);
  if(n>0)return component+' is currently supporting the five-day stock view.';
  if(n<0)return component+' is currently weighing against the five-day stock view.';
  if(n===0)return component+' is currently neutral and is not pushing the view in either direction.';
  return component+' is retained for audit history, but there is not enough user-facing detail to draw a stronger conclusion.';
}
function metricCard(label,value,detail){
  return '<div class="edge-user-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail)+'</small></div>';
}
export function renderEdgeV13(report){
  const r=report||{};
  if(r.contract_version!==EDGE_RENDERER_CONTRACT)throw new Error('EDGE Stocks contract mismatch');
  if(r.presentation_contract!==EDGE_PRESENTATION_CONTRACT)throw new Error('EDGE Stocks presentation contract mismatch');
  const d=r.current_stock_outcome||{},p=d.probabilities||{},ex=d.execution||{};
  for(const row of (Array.isArray(r.drilldown)?r.drilldown:[])){
    if(row.verification_status==='VERIFIED'&&(!row.interpretation||/no additional interpretation|retained in immutable audit record|component evidence retained/i.test(String(row.interpretation))))throw new Error('Verified drill-down interpretation missing')
  }
  const sum=Number(p.bull||0)+Number(p.base||0)+Number(p.bear||0);
  if(Math.abs(sum-100)>0.02)throw new Error('EDGE probabilities do not total 100');

  const master=r.master_assessment||{},stock=master.stock_assessment||{};
  const calls=Array.isArray(r.active_calls)?r.active_calls:[];
  const drill=Array.isArray(r.drilldown)?r.drilldown:[];
  const previous=stock.previous_recommendation||null;
  const changeItems=stockChangeItems(r);
  const trust=trustUserText(d);
  const actionable=!noTrade(d.primary_action)&&String(ex.instrument||'NONE')!=='NONE';
  const forecastChecks=Number(stock.provisional_captured_checkpoints??0);
  const dueChecks=Number(stock.provisional_due_checkpoints??0);
  const forecastHits=Number(stock.provisional_forecast_hits??0);
  const forecastScorable=Number(stock.provisional_forecast_scorable??0);
  const zoneHits=Number(stock.provisional_zone_hits??0);
  const zoneScorable=Number(stock.provisional_zone_scorable??0);
  const official=Number(stock.official_scorable_recommendations??0);

  const previousCard=previous
    ? '<div class="edge-previous-call"><div><span>Previous call</span><strong>'+esc(userForecastLabel(previous.definitive_forecast))+'</strong><small>'+esc(human(previous.definitive_recommendation||'—'))+'</small></div><div><span>What happened?</span><strong>'+esc(human(previous.outcome_verdict||previous.lifecycle_status||'Open'))+'</strong><small>'+(previous.current_return_pct==null?'Still being tracked':'Return since that call: '+esc(pct(previous.current_return_pct)))+'</small></div></div>'
    : '<div class="edge-previous-call single"><div><span>Previous call</span><strong>None yet</strong><small>This stock does not yet have an earlier EDGE call to compare.</small></div></div>';

  const section1='<section class="edge-user-section" data-edge-section="master-assessment">'+
    '<div class="edge-user-head"><div><span>1 — EDGE MASTER ASSESSMENT</span><h3>How has EDGE performed on '+esc(r.ticker||'this stock')+'?</h3></div><p>Past calls are checked against what actually happened. More completed checks make the performance record more meaningful.</p></div>'+
    previousCard+
    '<div class="edge-user-grid">'+
      metricCard('Past forecast accuracy',forecastScorable?pct(stock.provisional_forecast_accuracy_pct):'Not enough history',forecastScorable?(forecastHits+' of '+forecastScorable+' completed direction checks were correct.'):'No completed forecast checks yet.')+
      metricCard('Price-zone accuracy',zoneScorable?pct(stock.provisional_zone_accuracy_pct):'Not enough history',zoneScorable?(zoneHits+' of '+zoneScorable+' completed price-zone checks were correct.'):'No completed price-zone checks yet.')+
      metricCard('Recommendation accuracy',official?pct(stock.recommendation_hit_rate_pct):'Not enough history',official?(official+' officially resolved recommendation'+(official===1?'':'s')+' are available.'):'No recommendation has matured enough for an official score yet.')+
      metricCard('Forecast checks completed',forecastChecks+' of '+dueChecks,'Each check compares an earlier D+1 to D+5 forecast with the market outcome. This is the evidence behind the accuracy numbers.')+
    '</div>'+
    '<details class="edge-advanced-details"><summary>Advanced assessment details</summary><div class="edge-user-grid compact">'+
      metricCard('Tracked calls',stock.recommendations??0,'All EDGE calls recorded for this stock.')+
      metricCard('Open / closed calls',(stock.open_recommendations??0)+' / '+(stock.closed_recommendations??0),'Open calls are still being tracked; closed calls have finished their lifecycle.')+
      metricCard('Internal model P/L score',stock.cumulative_model_pnl_units??'—','Audit-only model score. It is not your portfolio return and should not be read as rupees or percentage profit.')+
      metricCard('Average gain / loss on resolved calls',pct(stock.avg_gain_pct)+' / '+pct(stock.avg_loss_pct),'Average move on past hits versus misses, when enough resolved history exists.')+
    '</div></details>'+
  '</section>';

  const section2='<section class="edge-user-section" data-edge-section="current-stock-outcome">'+
    '<div class="edge-result-hero"><div class="result-kicker">2 — CURRENT STOCK OUTCOME · '+esc(d.forecast_horizon||'D+5')+'</div><h2>'+esc(r.ticker||'—')+' · '+esc(userForecastLabel(d.definitive_forecast))+'</h2>'+
    '<p>Current '+money(d.current_price)+' · Expected D+5 zone '+esc(zone(d.expected_price_zone))+'</p></div>'+
    '<div class="probability-line edge-user-probabilities"><span class="bull">Bull <strong>'+pct(p.bull)+'</strong></span><span class="range">Base <strong>'+pct(p.base)+'</strong></span><span class="bear">Bear <strong>'+pct(p.bear)+'</strong></span></div>'+
    '<div class="edge-user-grid">'+
      metricCard('Evidence confidence',trust.value,trust.detail)+
      metricCard('Can I act on this?',actionable?'Trade setup available':'No trade',actionable?'A governed entry, stop and target plan is available below.':'The stock view exists, but the execution gates do not support a trade yet.')+
      metricCard('Expected price area',zone(d.expected_price_zone),'The zone EDGE expects the stock to trade around over the D+5 horizon; it is not a guaranteed target.')+
    '</div>'+
    '<div class="action-box"><span>Suggested action</span><strong>'+esc(userActionText(d))+'</strong></div>'+
    executionCard(d)+
    '<details class="change-details" open><summary>What could change the view?</summary><ul>'+(changeItems.length?changeItems.map(x=>'<li>'+esc(x)+'</li>').join(''):'<li>No material change condition was published.</li>')+'</ul></details>'+
    '<details class="edge-advanced-details"><summary>Advanced decision details</summary><div class="edge-user-grid compact">'+
      metricCard('Directional score (DES)',num(d.des,2),'Internal directional score used by the frozen EDGE engine.')+
      metricCard('Signals pointing the same way',pct(d.directional_agreement),'How much the underlying evidence agrees on direction. Higher agreement means fewer conflicting signals.')+
      metricCard('Overall conviction after checks',pct(d.effective_conviction==null?null:Number(d.effective_conviction)*100),'Final strength after evidence quality and risk checks are applied.')+
      metricCard('Extra safety block',d.risk_override?.status==='ACTIVE'?('Active · '+human(d.risk_override.code||'—')):'None','An active safety block can prevent a trade even when the directional view looks attractive.')+
      metricCard('Decision stage',human(d.decision_ladder||'—'),'Where the setup currently sits in the governed decision process.')+
      metricCard('BOT',num(d.bot?.score,1)+' · '+human(d.bot?.grade||'—'),'Internal execution-quality grade retained for audit and governance.')+
    '</div></details>'+
  '</section>';

  const drillCards=drill.length?drill.map(row=>{
    const verified=String(row.verification_status||'NOT_VERIFIED')==='VERIFIED';
    const outcome=human(row.key_outcome||'—');
    const interpretation=verified?friendlyLegacyInterpretation(row):'There is not enough verified evidence to use this factor confidently in the user-facing explanation.';
    return '<div class="edge-drill-card"><div class="edge-drill-head"><strong>'+esc(human(row.component||'—'))+'</strong><span class="score-pill '+scoreTone(row.score_or_level)+'">'+esc(scoreText(row.score_or_level))+'</span></div><p>'+esc(interpretation)+'</p><div class="edge-drill-foot"><span class="evidence-chip '+(verified?'verified':'limited')+'">'+esc(verified?'Verified':'Evidence limited')+'</span><small>'+esc(outcome)+'</small></div></div>';
  }).join(''):'<div class="generic-empty">No drill-down evidence was published for this run.</div>';
  const section3='<section class="edge-user-section" data-edge-section="drilldown"><div class="edge-user-head"><div><span>3 — WHY EDGE REACHED THIS VIEW</span><h3>Drill-down</h3></div><p>Each card shows whether a factor is helping, hurting or not materially affecting the five-day view.</p></div><div class="edge-drill-grid">'+drillCards+'</div></section>';

  const section4='<section class="edge-user-section" data-edge-section="active-calls"><div class="edge-user-head"><div><span>4 — ACTIVE CALLS</span><h3>Calls still being tracked</h3></div><p>These are open EDGE calls that have not completed their full assessment lifecycle yet.</p></div>'+activeCallCards(calls,r.ticker)+'</section>';

  return '<article class="canonical-edge-result edge-user-output" data-contract="'+esc(r.contract_version)+'">'+section1+section2+section3+section4+
    '<div class="canonical-edge-meta">Run '+esc(r.run_id||'—')+' · '+esc(r.framework_version||'—')+' · Generated '+esc(r.generated_at?new Date(r.generated_at).toLocaleString():'—')+'</div></article>';
}
if(typeof document!=='undefined'){
  const root=document.getElementById('stocksSummary');
  if(root){
    let loading=false;const ticker=()=>localStorage.getItem('edge-console-selected-stock')||'LTF';
    async function refreshEdgeLive(){
      if(loading)return;loading=true;
      try{const resp=await fetch('/api/edge-stocks/report?ticker='+encodeURIComponent(ticker()),{cache:'no-store'}),data=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(data.error||'EDGE live read failed');const report=data.report||{};const assessmentRoot=document.getElementById('stocksAssessmentSummary');if(assessmentRoot)assessmentRoot.hidden=true;root.innerHTML=renderEdgeV13(report)}
      catch(e){root.innerHTML='<div class="generic-empty"><strong>EDGE Stocks details could not be published.</strong><br>'+esc(e.message||'unknown error')+'</div>'}
      finally{loading=false}
    }
    window.refreshEdgeLive=refreshEdgeLive;refreshEdgeLive();setInterval(refreshEdgeLive,60000)
  }
}
