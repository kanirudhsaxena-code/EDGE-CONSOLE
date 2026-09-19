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
export function renderEdgeV13(report){
  const r=report||{};if(r.contract_version!==EDGE_RENDERER_CONTRACT)throw new Error('EDGE Stocks contract mismatch');if(r.presentation_contract!==EDGE_PRESENTATION_CONTRACT)throw new Error('EDGE Stocks presentation contract mismatch');
  const d=r.current_stock_outcome||{},p=d.probabilities||{},ex=d.execution||{},actionable=!noTrade(d.primary_action)&&String(ex.instrument||'NONE')!=='NONE';
  const sum=Number(p.bull||0)+Number(p.base||0)+Number(p.bear||0);if(Math.abs(sum-100)>0.02)throw new Error('EDGE probabilities do not total 100');
  return '<article class="simple-result stock-standard-result">'+
    '<section class="stock-hero"><div class="result-kicker">CURRENT STOCK OUTCOME · '+esc(d.forecast_horizon||'D+5')+'</div><div class="stock-hero-line"><div><h2>'+esc(r.ticker||'—')+' · '+esc(human(d.definitive_forecast||'—'))+'</h2><p>Current '+money(d.current_price)+' · Expected zone '+esc(zone(d.expected_price_zone))+' · Current return '+pct(d.current_return_pct)+'</p></div><span class="status-chip '+(actionable?'positive':'neutral')+'">'+(actionable?'ACTIONABLE':'NO TRADE')+'</span></div>'+
    '<div class="probability-line stock-probabilities"><span class="bull">Bull<strong>'+pct(p.bull)+'</strong></span><span class="range">Base<strong>'+pct(p.base)+'</strong></span><span class="bear">Bear<strong>'+pct(p.bear)+'</strong></span></div>'+
    '<div class="decision-grid"><div class="decision-card"><span>Confidence</span><strong>'+esc(human(d.market_trust?.band||'—'))+'</strong><small>Market Trust '+num(d.market_trust?.score,1)+'/100</small></div><div class="decision-card"><span>D+5 price zone</span><strong>'+esc(zone(d.expected_price_zone))+'</strong><small>Expiry/checkpoint '+esc(d.expiry_trading_date?new Date(d.expiry_trading_date).toLocaleDateString():'—')+'</small></div></div>'+
    '<div class="action-box"><span>Recommendation</span><strong>'+esc(d.primary_action||'—')+'</strong><small>'+esc(actionable?'Execution plan is available below.':'No trade is intentional: the decision/execution gates have not produced a governed setup.')+'</small></div></section>'+
    decisionDetails(d)+executionCard(d)+
    '<details class="why-details stock-details-block" open><summary>Why this view?</summary><p class="stock-section-copy">These are the governed EDGE components behind the current forecast. Positive and negative evidence are shown together rather than collapsed into one score.</p><div class="why-grid">'+stockWhyCards(r)+'</div></details>'+
    '<details class="change-details stock-details-block" open><summary>What could change the view?</summary><ul>'+stockChangeItems(r).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>'+
    '<details class="active-details stock-details-block"><summary>Active calls across EDGE Stocks</summary>'+activeCallCards(r.active_calls,r.ticker)+'</details>'+
    '<details class="tech-details stock-details-block"><summary>Advanced details</summary><div class="tech-body"><div><span>Run ID</span><strong>'+esc(r.run_id||'—')+'</strong></div><div><span>Framework</span><strong>'+esc(r.framework_version||'—')+'</strong></div><div><span>Contract</span><strong>'+esc(r.contract_version||'—')+'</strong></div><div><span>Generated</span><strong>'+esc(r.generated_at?new Date(r.generated_at).toLocaleString():'—')+'</strong></div><div><span>Execution instrument</span><strong>'+esc(human(ex.instrument||'NONE'))+'</strong></div><div><span>Option suitability</span><strong>'+esc(human(ex.option_suitability_status||'—'))+'</strong></div></div></details>'+
  '</article>'
}
if(typeof document!=='undefined'){
  const root=document.getElementById('stocksSummary');
  if(root){
    let loading=false;const ticker=()=>localStorage.getItem('edge-console-selected-stock')||'LTF';
    async function refreshEdgeLive(){
      if(loading)return;loading=true;
      try{const resp=await fetch('/api/edge-stocks/report?ticker='+encodeURIComponent(ticker()),{cache:'no-store'}),data=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(data.error||'EDGE live read failed');const report=data.report||{};renderStockAssessment(report);root.innerHTML=renderEdgeV13(report)}
      catch(e){root.innerHTML='<div class="generic-empty"><strong>EDGE Stocks details could not be published.</strong><br>'+esc(e.message||'unknown error')+'</div>'}
      finally{loading=false}
    }
    window.refreshEdgeLive=refreshEdgeLive;refreshEdgeLive();setInterval(refreshEdgeLive,60000)
  }
}
