export const EDGE_RENDERER_CONTRACT='EDGE_STOCKS_V1_3';
export const EDGE_PRESENTATION_CONTRACT='EFFICACY_V2';
export const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const pct=v=>v===null||v===undefined||Number.isNaN(Number(v))?'—':Number(v).toFixed(1)+'%';
const num=(v,d=1)=>v===null||v===undefined||Number.isNaN(Number(v))?'—':Number(v).toFixed(d);
const zone=z=>!z||(z.low==null&&z.high==null)?'—':[z.low??'—',z.high??'—'].join(' – ');
const human=s=>String(s??'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
const noTrade=v=>/NO[_ ]?TRADE|NONE|WAIT|AVOID/i.test(String(v??''));

function renderStockAssessment(report){
  const root=document.getElementById('stocksAssessmentSummary');if(!root)return;
  const m=report.master_assessment||{};
  const recTotal=Number(m.official_scorable_recommendations||0);
  const provisionalTotal=Number(m.provisional_forecast_scorable||0);
  root.innerHTML=[
    '<div class="assessment-header"><div><div class="eyebrow">ASSESSMENT · TILL DATE</div><h3>Performance assessment</h3></div><small>'+esc(m.recommendations??0)+' tracked calls</small></div>',
    '<div class="assessment-grid">',
      '<div class="assessment-metric"><span>Forecast accuracy</span><strong>'+pct(m.provisional_forecast_accuracy_pct)+'</strong><small>'+esc(m.provisional_forecast_hits??0)+' hits / '+esc(provisionalTotal)+' assessed · provisional</small></div>',
      '<div class="assessment-metric"><span>Recommendation accuracy</span><strong>'+pct(m.recommendation_hit_rate_pct)+'</strong><small>'+esc(recTotal?Math.round(recTotal*Number(m.recommendation_hit_rate_pct||0)/100):0)+' hits / '+esc(recTotal)+' official</small></div>',
      '<div class="assessment-metric"><span>Cumulative model P/L</span><strong>'+esc(m.cumulative_model_pnl_units??'—')+'</strong><small>Governed model P/L units</small></div>',
      '<div class="assessment-metric"><span>Avg gain on hits</span><strong>'+pct(m.avg_gain_pct)+'</strong><small>Official resolved winners</small></div>',
      '<div class="assessment-metric"><span>Avg loss on misses</span><strong>'+pct(m.avg_loss_pct)+'</strong><small>Official resolved misses</small></div>',
    '</div>',
    '<details class="assessment-detail-row"><summary>Assessment details</summary><div class="scorecard-context"><span>Coverage</span><strong>'+esc(m.open_recommendations??0)+' open · '+esc(m.closed_recommendations??0)+' closed</strong><p>Zone accuracy '+pct(m.provisional_zone_accuracy_pct)+' · '+esc(m.provisional_zone_hits??0)+'/'+esc(m.provisional_zone_scorable??0)+' provisional checkpoints. Official and provisional efficacy remain separate.</p></div></details>'
  ].join('')
}

function stockWhyCards(report){
  const rows=Array.isArray(report.drilldown)?report.drilldown:[];
  const preferred=['PRICE_STRUCTURE','PV_PVPO','RELATIVE_STRENGTH','VALUATION','FUNDAMENTALS','MARKET_TRUST','TECHNICAL'];
  const sorted=[...rows].sort((a,b)=>{const ai=preferred.indexOf(String(a.component)),bi=preferred.indexOf(String(b.component));return(ai<0?99:ai)-(bi<0?99:bi)});
  return sorted.slice(0,6).map(row=>[
    '<div class="why-card">',
      '<strong>'+esc(human(row.component))+'</strong>',
      '<p><b>What we saw:</b> '+esc(row.key_outcome||'No governed observation published.')+'</p>',
      '<p><b>What it means:</b> '+esc(row.interpretation||'No interpretation published.')+'</p>',
      '<span class="evidence-chip '+(String(row.verification_status)==='VERIFIED'?'verified':'limited')+'">'+esc(human(row.verification_status||'NOT VERIFIED'))+'</span>',
    '</div>'
  ].join('')).join('')
}
function stockChangeItems(report){
  const d=report.current_stock_outcome||{},items=[];
  const z=d.expected_price_zone||{};
  if(z.high!=null)items.push('A sustained move above '+z.high+' with improving directional agreement would strengthen the bullish case.');
  if(z.low!=null)items.push('A sustained break below '+z.low+' would weaken the current base case and require reassessment.');
  if(d.risk_override?.status==='ACTIVE')items.push('The active risk override ('+human(d.risk_override.code||'unspecified')+') must clear before the setup can become actionable.');
  if(Number(d.directional_agreement||0)<50)items.push('Directional agreement needs to improve materially; the current components are not aligned strongly enough.');
  if(noTrade(d.primary_action)||String(d.execution?.instrument||'NONE')==='NONE')items.push('An actionable trade still needs a governed entry, invalidation, stop and target structure.');
  if(!items.length)items.push('The view changes only if price, evidence components and execution conditions materially diverge from the published setup.');
  return items
}
function activeCallCards(calls){
  if(!Array.isArray(calls)||!calls.length)return'<p class="muted">No active calls.</p>';
  return '<div class="active-call-grid">'+calls.map(c=>[
    '<div class="active-call-card">',
      '<div><strong>'+esc(c.ticker||'—')+'</strong><span>'+esc(human(c.definitive_forecast||'—'))+'</span></div>',
      '<p>'+esc(human(c.definitive_recommendation||'—'))+'</p>',
      '<small>Zone '+esc(zone(c.expected_price_zone))+' · '+esc(human(c.outcome_verdict||'OPEN'))+'</small>',
    '</div>'
  ].join('')).join('')+'</div>'
}
export function renderEdgeV13(report){
  const r=report||{};
  if(r.contract_version!==EDGE_RENDERER_CONTRACT)throw new Error('EDGE Stocks contract mismatch');
  if(r.presentation_contract!==EDGE_PRESENTATION_CONTRACT)throw new Error('EDGE Stocks presentation contract mismatch');
  const d=r.current_stock_outcome||{},p=d.probabilities||{},ex=d.execution||{};
  const actionable=!noTrade(d.primary_action)&&String(ex.instrument||'NONE')!=='NONE';
  renderStockAssessment(r);
  return [
    '<article class="simple-result stock-standard-result">',
      '<div class="result-kicker">TODAY’S STOCK VIEW</div>',
      '<h2>'+esc(r.ticker||'—')+' · '+esc(human(d.definitive_forecast||'—'))+'</h2>',
      '<div class="probability-line"><span class="bull">Bull<strong>'+pct(p.bull)+'</strong></span><span class="range">Base<strong>'+pct(p.base)+'</strong></span><span class="bear">Bear<strong>'+pct(p.bear)+'</strong></span></div>',
      '<div class="decision-grid">',
        '<div class="decision-card"><span>Confidence</span><strong>'+esc(human(d.market_trust?.band||'—'))+'</strong><small>Market Trust '+num(d.market_trust?.score,1)+'/100</small></div>',
        '<div class="decision-card"><span>Can I trade this?</span><strong>'+(actionable?'Actionable':'No trade')+'</strong><small>'+esc(human(d.primary_action||'—'))+'</small></div>',
      '</div>',
      '<div class="action-box"><span>Suggested action</span><strong>'+esc(human(d.primary_action||'—'))+'</strong><small>Expected D+5 zone: '+esc(zone(d.expected_price_zone))+'</small></div>',
      '<details class="why-details" open><summary>Why this view?</summary><div class="why-grid">'+stockWhyCards(r)+'</div></details>',
      '<details class="change-details" open><summary>What could change the view?</summary><ul>'+stockChangeItems(r).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>',
      '<details class="active-details"><summary>Active calls</summary>'+activeCallCards(r.active_calls)+'</details>',
      '<details class="tech-details"><summary>Advanced details</summary><div class="tech-body">',
        '<div><span>DES</span><strong>'+num(d.des,2)+'</strong></div>',
        '<div><span>Market Trust</span><strong>'+num(d.market_trust?.score,2)+' · '+esc(d.market_trust?.band||'—')+'</strong></div>',
        '<div><span>Directional agreement</span><strong>'+pct(d.directional_agreement)+'</strong></div>',
        '<div><span>Effective conviction</span><strong>'+pct(d.effective_conviction==null?null:d.effective_conviction*100)+'</strong></div>',
        '<div><span>BOT</span><strong>'+num(d.bot?.score,2)+' · '+esc(d.bot?.grade||'—')+'</strong></div>',
        '<div><span>Decision ladder</span><strong>'+esc(human(d.decision_ladder||'—'))+'</strong></div>',
        '<div><span>Risk override</span><strong>'+esc(d.risk_override?.status==='ACTIVE'?'ACTIVE · '+human(d.risk_override.code):'Clear')+'</strong></div>',
        '<div><span>Run ID</span><strong>'+esc(r.run_id||'—')+'</strong></div>',
      '</div></details>',
    '</article>'
  ].join('')
}
export const renderEdgeV12=renderEdgeV13;

if(typeof document!=='undefined'){
  const root=document.getElementById('stocksSummary');
  if(root){
    let loading=false;
    const ticker=()=>localStorage.getItem('edge-console-selected-stock')||'LTF';
    async function refreshEdgeLive(){
      if(loading)return;loading=true;
      try{
        const resp=await fetch('/api/edge-stocks/report?ticker='+encodeURIComponent(ticker()),{cache:'no-store'});
        const data=await resp.json().catch(()=>({}));
        if(!resp.ok)throw new Error(data.error||'EDGE live read failed');
        root.innerHTML=renderEdgeV13(data.report||{});
      }catch(e){root.innerHTML='<div class="generic-empty">EDGE Stocks result unavailable: '+esc(e.message||'unknown error')+'</div>'}
      finally{loading=false}
    }
    window.refreshEdgeLive=refreshEdgeLive;
    refreshEdgeLive();setInterval(refreshEdgeLive,60000)
  }
}
