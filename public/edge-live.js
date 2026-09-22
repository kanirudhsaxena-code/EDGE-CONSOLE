export const EDGE_RENDERER_CONTRACT='EDGE_STOCKS_V1_3';
export const EDGE_PRESENTATION_CONTRACT='EFFICACY_V2';
export const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const pct=v=>v===null||v===undefined||Number.isNaN(Number(v))?'—':Number(v).toFixed(1)+'%';
const num=(v,d=1)=>v===null||v===undefined||Number.isNaN(Number(v))?'—':Number(v).toFixed(d);
const money=v=>v===null||v===undefined||Number.isNaN(Number(v))?'—':'₹'+Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
const zone=z=>!z||(z.low==null&&z.high==null)?'—':[z.low??'—',z.high??'—'].join(' – ');
const dateText=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})};
const dateTimeText=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})};
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
  if(Number(d.directional_agreement||0)<65)items.push('More of the underlying signals need to point the same way before this view deserves higher confidence.');
  if(Number(d.market_trust?.score||0)<70)items.push('The evidence needs to become fresher and more consistent before the view deserves higher confidence.');
  if(d.risk_override?.status==='ACTIVE')items.push('An extra safety block is active and must clear before the setup can become actionable.');
  if(noTrade(d.primary_action)||String(d.execution?.instrument||'NONE')==='NONE')items.push('A trade requires a governed entry, invalidation, stop and target plan; until those exist, the forecast remains a view rather than an executable trade.');
  if(Number(p.bull||0)>0&&Number(p.bear||0)>0&&Math.abs(Number(p.bull)-Number(p.bear))<15)items.push('Bull and bear probabilities remain too close for a high-conviction directional call.');
  return [...new Set(items)].slice(0,7)
}
function activeCallCards(calls,currentTicker){
  if(!Array.isArray(calls)||!calls.length)return'<p class="muted">No active calls.</p>';
  return '<div class="active-call-grid">'+calls.map(c=>{const selected=String(c.ticker||'')===String(currentTicker||'');return '<div class="active-call-card '+(selected?'selected':'')+'"><div><strong>'+esc(c.ticker||'—')+'</strong><span>'+esc(human(c.definitive_forecast||'—'))+'</span></div><p>'+esc(noTrade(c.definitive_recommendation)?'No trade':human(c.definitive_recommendation||'—'))+'</p><small><b>Call date/time:</b> '+esc(dateTimeText(c.call_timestamp))+'</small><small>Current '+money(c.current_price)+' · D+5 zone '+esc(zone(c.expected_price_zone))+'</small><small>Move since call '+pct(c.current_return_pct)+' · '+esc(human(c.outcome_verdict||'OPEN'))+'</small></div>'}).join('')+'</div>'
}
function executionCard(d){
  const e=d.execution||{},none=String(e.instrument||'NONE')==='NONE';
  const quality=num(e.execution_quality_score,1)+'/100';
  const optionFit=human(e.option_suitability_status||'NO OPTION TRADE');
  const key='<div class="execution-key-grid">'+
    '<div class="execution-metric"><span>Trade setup quality</span><strong>'+quality+'</strong><small>Measures how complete and usable the governed entry, stop, target and risk structure is.</small></div>'+
    '<div class="execution-metric"><span>Options fit</span><strong>'+esc(optionFit)+'</strong><small>Shows whether an options trade is suitable for this stock view and current evidence.</small></div>'+
  '</div>';
  if(none)return '<section class="stock-section execution-section"><div class="stock-section-title"><div><span>Execution</span><h3>No executable trade</h3></div><span class="status-chip neutral">NO TRADE</span></div><p class="stock-section-copy">EDGE has a stock view, but no governed entry/stop/target structure currently passes the execution gate. A forecast is not automatically a trade.</p>'+key+
    '<div class="execution-support-grid"><div><span>Time exit</span><strong>'+esc(e.time_exit||'Frozen forecast horizon')+'</strong><small>The forecast remains valid only for its governed time window unless invalidated earlier.</small></div></div></section>';
  return '<section class="stock-section execution-section"><div class="stock-section-title"><div><span>Execution</span><h3>Trade plan</h3></div><span class="status-chip positive">'+esc(human(e.instrument))+'</span></div><p class="stock-section-copy">This setup has passed the governed execution checks. Entry, stop, targets and time exit define the trade—not the directional forecast alone.</p>'+key+
    '<div class="stock-detail-grid execution-detail-grid">'+
      '<div><span>Entry</span><strong>'+money(e.entry_low)+' – '+money(e.entry_high)+'</strong><small>Preferred price area for initiating the governed setup.</small></div>'+
      '<div><span>Stop</span><strong>'+money(e.stop_price)+'</strong><small>Price level that limits downside if the setup fails.</small></div>'+
      '<div><span>Target 1</span><strong>'+money(e.target1)+'</strong><small>First governed profit objective.</small></div>'+
      '<div><span>Target 2</span><strong>'+money(e.target2)+'</strong><small>Second objective if momentum and evidence remain supportive.</small></div>'+
      '<div><span>Invalidation</span><strong>'+esc(e.invalidation||'—')+'</strong><small>Condition that tells us the original trade thesis is no longer valid.</small></div>'+
      '<div><span>Time exit</span><strong>'+esc(e.time_exit||'—')+'</strong><small>Maximum time window for holding the setup if neither target nor stop is reached.</small></div>'+
      '<div><span>Option strike</span><strong>'+esc(e.option_strike??'—')+'</strong><small>Governed strike selected when an options expression is suitable.</small></div>'+
      '<div><span>Option expiry</span><strong>'+esc(e.option_expiry||'—')+'</strong><small>Expiry associated with the approved options expression.</small></div>'+
      '<div><span>Observed premium</span><strong>'+money(e.observed_premium)+'</strong><small>Premium observed when the trade setup was assessed.</small></div>'+
    '</div></section>'
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
function componentDisplayName(raw){
  const k=String(raw||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  if(k.includes('PV_PVPO')||k==='PVPO'||k==='PV')return 'Price & Volume / Price, Volume, Premium & Open Interest (PV/PVPO)';
  if(k.includes('PRICE_STRUCTURE'))return 'Price Structure';
  if(k.includes('SPECIFIC_CHART_PATTERN')||k.includes('CHART_PATTERN'))return 'Specific Chart Pattern';
  if(k.includes('RELATIVE_STRENGTH'))return 'Relative Strength';
  if(k.includes('BUSINESS_FUNDAMENTALS'))return 'Business Fundamentals';
  if(k.includes('VALUATION'))return 'Valuation';
  if(k.includes('INSTITUTIONAL'))return 'Institutional Behaviour';
  if(k.includes('NEWS')||k.includes('CATALYST'))return 'News, Events & Catalysts';
  if(k.includes('EVENT_SHOCK'))return 'Event Shock';
  return human(raw||'This factor');
}
function componentMeaning(raw){
  const k=String(raw||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  if(k.includes('PRICE_STRUCTURE'))return 'This checks the stock’s trend, range behaviour and acceptance or rejection around important price levels. It is a direct input into the five-day directional view.';
  if(k.includes('PV_PVPO')||k==='PVPO'||k==='PV')return 'PV means Price & Volume. PVPO means Price, Volume, Premium & Open Interest. It checks whether participation in the stock and, when available, derivatives evidence confirm or contradict the price move.';
  if(k.includes('RELATIVE_STRENGTH'))return 'This compares the stock with its relevant benchmark or market. Outperformance supports the view; underperformance weakens it.';
  if(k.includes('BUSINESS_FUNDAMENTALS'))return 'This captures whether business quality and fundamental evidence provide medium-term support or create a drag on the five-day setup.';
  if(k.includes('VALUATION'))return 'This asks whether valuation is supportive, neutral or restrictive at the current price. Valuation is a context factor, not a stand-alone trade trigger.';
  if(k.includes('INSTITUTIONAL'))return 'This checks whether institutional ownership, flows or behaviour strengthen confirmation, conflict with it, or remain neutral.';
  if(k.includes('NEWS')||k.includes('CATALYST'))return 'This checks whether current company, sector or market catalysts improve or worsen the risk/reward over the five-day horizon.';
  if(k.includes('EVENT_SHOCK'))return 'This checks whether an event risk is large enough to alter the normal five-day setup or force additional caution.';
  if(k.includes('SPECIFIC_CHART_PATTERN')||k.includes('CHART_PATTERN'))return 'This checks whether a recognised chart pattern is adding confirmation to the current setup.';
  return 'This governed factor contributes to the overall EDGE direction and confidence.';
}
function drillFinding(row){
  const published=String(row?.finding||'').trim();
  if(published)return published;
  const verified=String(row?.verification_status||'NOT_VERIFIED')==='VERIFIED';
  if(!verified){
    const component=String(row?.component||'').toUpperCase();
    if(component.includes('INSTITUTIONAL'))return 'This run did not contain independently verified FII, DII or mutual-fund holding/flow evidence, so EDGE left Institutional Behaviour unscored.';
    if(component.includes('VALUATION'))return 'This run did not contain independently verified valuation evidence that met the EDGE evidence gate, so valuation was left unscored.';
    return 'This run did not contain enough verified evidence to score this factor.';
  }
  const raw=String(row?.interpretation||'').trim();
  const legacy=row?.narrative_source==='LEGACY_SCORE_RECONSTRUCTION'||/legacy active run|original narrative field was not persisted|immutable verified component score/i.test(raw);
  if(legacy){
    const n=Number(row?.score_or_level);
    const score=Number.isFinite(n)?String(n):'not available';
    return 'This older run preserved a verified component score of '+score+' ('+scoreText(row?.score_or_level).toLowerCase()+'), but it did not preserve the detailed source narrative. No more specific market fact should be inferred from this historical row.';
  }
  return raw||String(row?.key_outcome||'No detailed finding was published.');
}
function metricCard(label,value,detail){
  return '<div class="edge-user-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail)+'</small></div>';
}
function edgeStockLegends(){
  return '<div class="metric-legend compact"><strong>EDGE Stocks legends</strong>'+
    '<span><b>Component score:</b> −2 Strong Bearish · −1 Bearish · 0 Neutral · +1 Bullish · +2 Strong Bullish</span>'+
    '<span><b>Market Trust:</b> 85–100 Very High · 70–84 High · 55–69 Moderate · 40–54 Low · &lt;40 Very Low</span>'+
    '<span><b>BOT grade:</b> A++ ≥90 · A+ ≥80 · A ≥70 · B ≥60 · C &lt;60</span>'+
    '<span><b>Decision Ladder:</b> Observe / Watchlist / Investigation = 0R · Pilot = 0.25R · Partial = 0.50R · Full = 1.00R</span></div>'
}
function trustBreakdown(d){
  const t=d?.market_trust||{},s=t.subscores||{},w=t.weights||{};
  const labels={evidence_quality:'Evidence quality',freshness:'Freshness',completeness:'Completeness',directional_agreement:'Directional agreement',market_confirmation:'Market confirmation'};
  return '<div class="breakdown-section"><div class="step-label">Market Trust breakdown</div><div class="metric-breakdown-grid">'+Object.keys(labels).map(key=>'<div class="breakdown-card"><span>'+esc(labels[key])+'</span><strong>'+(s[key]==null?'Not available':num(s[key],1)+'/100')+'</strong><small>Weight '+esc(w[key]??'—')+'%'+(s[key]==null?' · not persisted in this run':'')+'</small></div>').join('')+'</div></div>'
}
function botBreakdown(d){
  const b=d?.bot||{},s=b.subscores||{},w=b.weights||{};
  const labels={forecast_edge:'Forecast Edge',market_trust:'Market Trust',structure_pattern_quality:'Structure / pattern quality',pv_pvpo_confirmation:'PV/PVPO confirmation',catalyst_asymmetry:'Catalyst asymmetry',execution_quality:'Execution quality'};
  return '<div class="breakdown-section"><div class="step-label">BOT Hunter breakdown</div><div class="metric-breakdown-grid">'+Object.keys(labels).map(key=>'<div class="breakdown-card"><span>'+esc(labels[key])+'</span><strong>'+(s[key]==null?'Not available':num(s[key],1)+'/100')+'</strong><small>Weight '+esc(w[key]??'—')+'%</small></div>').join('')+'</div></div>'
}
function ladderMeaning(value){
  const map={
    OBSERVE:'Observe · 0R · no capital commitment',
    WATCHLIST:'Watchlist · 0R · monitor only',
    INVESTIGATION:'Investigation · 0R · setup not executable',
    PILOT:'Pilot · 0.25R · small governed risk unit',
    PARTIAL:'Partial · 0.50R · half governed risk unit',
    FULL:'Full · 1.00R · full governed risk unit'
  };
  return map[String(value||'').toUpperCase()]||human(value||'—')
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
  const gov=r.canonical_governance||{};
  const govType=human(gov.canonical_type||'Not available');
  const govTarget=gov.target_trading_date?new Date(String(gov.target_trading_date)).toLocaleDateString('en-IN'):'—';
  const govSelected=gov.current_run_is_selected===true;
  const govMissed=String(gov.canonical_type||'').toUpperCase()==='CANONICAL_MISSED'||String(gov.selection_status||'').toUpperCase()==='CANONICAL_MISSED';
  const canonicalCard='<div class="scorecard-context canonical-status-card"><span>Official canonical status</span><strong>'+esc(govType)+' · '+esc(govTarget)+'</strong><p>'+(govMissed?'No qualifying canonical was selected for this target. The displayed stock call remains informational/tracked and does not create a new official efficacy observation.':(govSelected?'This displayed recommendation is the selected canonical for its target key and is eligible for official efficacy when mature.':'The displayed run is not the selected canonical for the latest governed target; it does not add to official efficacy.'))+'</p></div>';

  const previousCard=previous
    ? '<div class="edge-previous-call"><div><span>Previous call</span><strong>'+esc(userForecastLabel(previous.definitive_forecast))+'</strong><small>'+esc(human(previous.definitive_recommendation||'—'))+'</small></div><div><span>What happened?</span><strong>'+esc(human(previous.outcome_verdict||previous.lifecycle_status||'Open'))+'</strong><small>'+(previous.current_return_pct==null?'Still being tracked':'Move since that earlier call: '+esc(pct(previous.current_return_pct))+(String(previous.outcome_verdict||previous.lifecycle_status||'').toUpperCase()==='OPEN'?' · still provisional':'') )+'</small></div></div>'
    : '<div class="edge-previous-call single"><div><span>Previous call</span><strong>None yet</strong><small>This stock does not yet have an earlier EDGE call to compare.</small></div></div>';

  const masterOfficial=Number(master.official_scorable_recommendations??0);
  const section1='<section class="edge-user-section" data-edge-section="master-assessment">'+
    '<div class="edge-user-head"><div><span>1 — EDGE MASTER ASSESSMENT</span><h3>System-wide efficacy first, then '+esc(r.ticker||'stock')+' efficacy</h3></div><p>OFFICIAL metrics use selected CLOSED/scorable recommendations only. PROVISIONAL diagnostics track open calls without inflating the official sample.</p></div>'+
    '<div class="step-label">SYSTEM-WIDE · OFFICIAL / PROVISIONAL</div>'+
    '<div class="edge-key-grid">'+
      metricCard('Tracked recommendations',master.recommendations??0,(master.open_recommendations??0)+' OPEN / '+(master.closed_recommendations??0)+' CLOSED · '+(master.unique_stocks??0)+' stocks')+
      metricCard('Official scorable sample',masterOfficial,masterOfficial?'Closed/scorable recommendations only.':'N/A · 0 closed/scorable. A zero sample is never displayed as 0% accuracy.')+
      metricCard('Recommendation hit rate',masterOfficial?pct(master.recommendation_hit_rate_pct):'N/A',masterOfficial?'WIN / resolved canonical recommendations.':'Not scorable yet.')+
      metricCard('Directional hit rate',masterOfficial?pct(master.direction_hit_rate_pct):'N/A',masterOfficial?'Correct direction / closed scorable recommendations.':'Not scorable yet.')+
      metricCard('Target hit rate',masterOfficial?pct(master.target_hit_rate_pct):'N/A',masterOfficial?'Defined target reached / closed scorable recommendations.':'Not scorable yet.')+
      metricCard('Average gain / loss',masterOfficial?(pct(master.avg_gain_pct)+' / '+pct(master.avg_loss_pct)):'N/A','Standardized model returns for winning / losing recommendations.')+
      metricCard('Average MFE / MAE',masterOfficial?(pct(master.avg_mfe_pct)+' / '+pct(master.avg_mae_pct)):'N/A','Maximum favourable / adverse excursion across resolved calls.')+
      metricCard('Cumulative model P/L',master.cumulative_model_pnl_units==null?'N/A':String(master.cumulative_model_pnl_units),'Standardized model units only · never inferred user P/L.')+
      metricCard('Provisional direction',Number(master.provisional_forecast_scorable||0)?pct(master.provisional_forecast_accuracy_pct):'Not enough history',(master.provisional_forecast_hits??0)+' / '+(master.provisional_forecast_scorable??0)+' scorable checkpoint hits')+
      metricCard('Provisional price zone',Number(master.provisional_zone_scorable||0)?pct(master.provisional_zone_accuracy_pct):'Not enough history',(master.provisional_zone_hits??0)+' / '+(master.provisional_zone_scorable??0)+' scorable zone hits')+
    '</div>'+
    '<div class="step-label">SELECTED STOCK · '+esc(r.ticker||'—')+'</div>'+
    previousCard+
    '<div class="edge-key-grid">'+
      metricCard('Tracked calls',stock.recommendations??0,(stock.open_recommendations??0)+' OPEN / '+(stock.closed_recommendations??0)+' CLOSED')+
      metricCard('Official recommendation accuracy',official?pct(stock.recommendation_hit_rate_pct):'N/A',official?(official+' closed/scorable recommendation'+(official===1?'':'s')+'.'):'0 closed/scorable · not yet a percentage')+
      metricCard('Directional / target hit rate',official?(pct(stock.direction_hit_rate_pct)+' / '+pct(stock.target_hit_rate_pct)):'N/A','Direction correctness / defined target attainment.')+
      metricCard('Average gain / loss',official?(pct(stock.avg_gain_pct)+' / '+pct(stock.avg_loss_pct)):'N/A','Standardized resolved recommendation results.')+
      metricCard('MFE / MAE',official?(pct(stock.avg_mfe_pct)+' / '+pct(stock.avg_mae_pct)):'N/A','Best / worst excursion during recommendation window.')+
      metricCard('Provisional forecast tracking',forecastScorable?pct(stock.provisional_forecast_accuracy_pct):'Not enough history',forecastScorable?(forecastHits+' / '+forecastScorable+' direction checkpoints hit.'):'No completed forecast checks yet.')+
      metricCard('Provisional zone tracking',zoneScorable?pct(stock.provisional_zone_accuracy_pct):'Not enough history',zoneScorable?(zoneHits+' / '+zoneScorable+' price-zone checkpoints hit.'):'No completed zone checks yet.')+
      metricCard('Outcome checks recorded',forecastChecks+' / '+dueChecks,'Each call is checked from D+1 through D+5; missing evidence stays unscored.')+
    '</div>'+
    edgeStockLegends()+
  '</section>';

  const section2='<section class="edge-user-section" data-edge-section="current-stock-outcome">'+
    '<div class="edge-result-hero"><div class="result-kicker">3 — CURRENT STOCK OUTCOME · '+esc(d.forecast_horizon||'D+5')+'</div><h3>'+esc(r.ticker||'—')+' decision view</h3><p class="run-timestamp">Run date/time: '+esc(dateTimeText(r.generated_at))+'</p></div>'+
    canonicalCard+
    '<div class="edge-decision-highlights">'+
      '<div class="edge-highlight-card direction"><span>5-DAY DIRECTION</span><strong>'+esc(userForecastLabel(d.definitive_forecast))+'</strong><small>Current price '+money(d.current_price)+'</small></div>'+
      '<div class="edge-highlight-card range"><span>EXPECTED 5-DAY RANGE</span><strong>'+esc(d.expected_price_zone?.low==null&&d.expected_price_zone?.high==null?'—':money(d.expected_price_zone?.low)+' – '+money(d.expected_price_zone?.high))+'</strong><small>Expected trading area over D+5; this is not a guaranteed target.</small></div>'+
    '</div>'+
    '<div class="probability-line edge-user-probabilities"><span class="bull">Bull <strong>'+pct(p.bull)+'</strong></span><span class="range">Base <strong>'+pct(p.base)+'</strong></span><span class="bear">Bear <strong>'+pct(p.bear)+'</strong></span></div>'+
    '<div class="edge-key-grid">'+
      metricCard('Evidence confidence',trust.value,trust.detail)+
      metricCard('Can I act on this?',actionable?'Trade setup available':'No trade',actionable?'A governed entry, stop and target plan is available below.':'The stock view exists, but the execution gates do not support a trade yet.')+
    '</div>'+
    '<div class="action-box"><span>Suggested action</span><strong>'+esc(userActionText(d))+'</strong></div>'+
    executionCard(d)+
    '<details class="change-details"><summary>What could change the view?</summary><ul>'+(changeItems.length?changeItems.map(x=>'<li>'+esc(x)+'</li>').join(''):'<li>No material change condition was published.</li>')+'</ul></details>'+
    '<details class="edge-advanced-details" open><summary>Metric breakdown & legends</summary><div class="edge-user-grid compact">'+
      metricCard('DES · Directional Evidence Score',num(d.des,2),'−100 to +100 evidence balance. It is direction, not probability or a recommendation.')+
      metricCard('Market Trust',num(d.market_trust?.score,1)+'/100 · '+human(d.market_trust?.band||'—'),'Confidence in evidence quality, freshness, completeness, agreement and market confirmation.')+
      metricCard('Directional Agreement',pct(d.directional_agreement),'Coherence of positive versus negative weighted evidence.')+
      metricCard('Effective Conviction',pct(d.effective_conviction==null?null:Number(d.effective_conviction)*100),'|DES| × Market Trust after normalization.')+
      metricCard('BOT Hunter',num(d.bot?.score,1)+' · '+human(d.bot?.grade||'—'),'Opportunity quality. A++ ≥90 · A+ ≥80 · A ≥70 · B ≥60 · C <60.')+
      metricCard('Decision Ladder',ladderMeaning(d.decision_ladder),'Governed capital-commitment classification; it does not force deployment.')+
      metricCard('Risk Override',d.risk_override?.status==='ACTIVE'?('Active · '+human(d.risk_override.code||'—')):'Clear','O1/O2/O3 or hard evidence gates can override normal arithmetic.')+
      metricCard('Execution Quality',ex.execution_quality_score==null?'Not executable':num(ex.execution_quality_score,1)+'/100 · '+human(ex.execution_quality_level||'—'),'Entry / stop / targets / risk structure quality.')+
    '</div>'+trustBreakdown(d)+botBreakdown(d)+edgeStockLegends()+'</details>'+
  '</section>';

  const drillCards=drill.length?drill.map(row=>{
    const verified=String(row.verification_status||'NOT_VERIFIED')==='VERIFIED';
    const outcome=scoreText(row.score_or_level);
    const finding=drillFinding(row);
    const meaning=componentMeaning(row.component);
    const weight=row.normalized_weight??row.original_weight;
    const contribution=row.weighted_contribution;
    return '<div class="edge-drill-card"><div class="edge-drill-head"><strong>'+esc(componentDisplayName(row.component||'—'))+'</strong><span class="score-pill '+scoreTone(row.score_or_level)+'">'+esc(outcome)+'</span></div>'+
      '<div class="edge-drill-metrics"><span>Raw score <b>'+esc(row.score_or_level??'N/A')+'</b></span><span>Original weight <b>'+esc(row.original_weight==null?'—':num(row.original_weight,1)+'%')+'</b></span><span>Used weight <b>'+esc(weight==null?'—':num(weight,1)+'%')+'</b></span><span>Contribution <b>'+esc(contribution==null?'—':num(contribution,2))+'</b></span></div>'+
      '<div class="edge-explanation-block"><span>WHAT WE SAW</span><p>'+esc(finding)+'</p></div>'+
      '<div class="edge-explanation-block"><span>WHAT IT MEANS</span><p>'+esc(row.interpretation||'No evidence-grounded interpretation was persisted.')+'</p></div>'+
      '<div class="edge-explanation-block"><span>WHY IT MATTERS NOW</span><p>'+esc(meaning)+'</p></div>'+
      '<div class="edge-drill-foot"><span class="evidence-chip '+(verified?'verified':'limited')+'">'+esc(verified?'Verified · '+human(row.evidence_quality||'—'):'Evidence limited')+'</span>'+(row.conflict_flag?'<span class="evidence-chip limited">Material conflict</span>':'')+'</div></div>';
  }).join(''):'<div class="generic-empty">No drill-down evidence was published for this run.</div>';
  const section3='<section class="edge-user-section" data-edge-section="drilldown"><div class="edge-user-head"><div><span>4 — DRILL-DOWN</span><h3>Why EDGE reached this view</h3></div><p>Each card shows whether a factor is helping, hurting or not materially affecting the five-day view.</p></div><div class="edge-drill-grid">'+drillCards+'</div></section>';

  const section4='<section class="edge-user-section" data-edge-section="active-calls"><div class="edge-user-head"><div><span>2 — ACTIVE CALLS</span><h3>Calls still being tracked</h3></div><p>These are open EDGE calls that have not completed their full assessment lifecycle yet.</p></div>'+activeCallCards(calls,r.ticker)+'</section>';

  return '<article class="canonical-edge-result edge-user-output" data-contract="'+esc(r.contract_version)+'">'+section1+section4+section2+section3+
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
