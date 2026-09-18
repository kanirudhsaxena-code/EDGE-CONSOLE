export const EDGE_RENDERER_CONTRACT = 'EDGE_STOCKS_V1_3';
export const EDGE_PRESENTATION_CONTRACT = 'EFFICACY_V2';
export const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const pct = v => v === null || v === undefined ? 'N/A' : Number(v).toFixed(1) + '%';
const num = (v, digits=2) => v === null || v === undefined || Number.isNaN(Number(v)) ? 'N/A' : Number(v).toFixed(digits);
const zone = z => !z || (z.low == null && z.high == null) ? 'N/A' : [z.low ?? '—', z.high ?? '—'].join(' – ');
const override = o => !o ? 'N/A' : o.status === 'ACTIVE' ? 'ACTIVE · ' + esc(o.code || 'UNSPECIFIED') : 'CLEAR';

export function renderEdgeV13(report) {
  const r = report || {};
  if (r.contract_version !== 'EDGE_STOCKS_V1_3') throw new Error('EDGE Stocks contract mismatch');
  if (r.presentation_contract !== 'EFFICACY_V2') throw new Error('EDGE Stocks presentation contract mismatch');
  if (r.presentation?.standard_table_count !== 4) throw new Error('EDGE Stocks table-count contract mismatch');
  const expected=['EDGE_MASTER_ASSESSMENT','ACTIVE_CALLS','CURRENT_STOCK_OUTCOME','DRILLDOWN'];
  expected.forEach((name,i)=>{ if(r.presentation?.['table_'+(i+1)]!==name) throw new Error('EDGE Stocks section order mismatch'); });

  const m=r.master_assessment||{};
  const d=r.current_stock_outcome||{};
  const probs=d.probabilities||{};
  const ex=d.execution||{};
  const active=Array.isArray(r.active_calls)?r.active_calls:[];
  const rows=Array.isArray(r.drilldown)?r.drilldown:[];
  if(!rows.length) throw new Error('Drill-down unavailable');
  for(const row of rows){
    if(row.verification_status==='VERIFIED' && (!row.interpretation || /no additional interpretation|retained in immutable audit record|component evidence retained/i.test(row.interpretation))){
      throw new Error('Verified drill-down interpretation missing');
    }
  }

  const table1=[
    '<div class="edge-table-wrap"><table class="edge-table"><caption>1 — EDGE MASTER ASSESSMENT</caption><tbody>',
    '<tr><th>Tracked recommendations</th><td>'+esc(m.recommendations??0)+'</td><th>Open / Closed</th><td>'+esc(m.open_recommendations??0)+' / '+esc(m.closed_recommendations??0)+'</td></tr>',
    '<tr><th>Tracked stocks</th><td>'+esc(m.unique_stocks??0)+'</td><th>Official scorable sample</th><td>'+esc(m.official_scorable_recommendations??0)+'</td></tr>',
    '<tr><th>Official recommendation hit rate</th><td>'+esc(pct(m.recommendation_hit_rate_pct))+'</td><th>Official directional hit rate</th><td>'+esc(pct(m.direction_hit_rate_pct))+'</td></tr>',
    '<tr><th>Official target hit rate</th><td>'+esc(pct(m.target_hit_rate_pct))+'</td><th>Cumulative model P/L</th><td>'+esc(m.cumulative_model_pnl_units??'N/A')+'</td></tr>',
    '<tr><th>Provisional forecast accuracy</th><td>'+esc(pct(m.provisional_forecast_accuracy_pct))+' · '+esc(m.provisional_forecast_hits??0)+'/'+esc(m.provisional_forecast_scorable??0)+'</td><th>Provisional zone accuracy</th><td>'+esc(pct(m.provisional_zone_accuracy_pct))+' · '+esc(m.provisional_zone_hits??0)+'/'+esc(m.provisional_zone_scorable??0)+'</td></tr>',
    '<tr><th>Checkpoint state</th><td colspan="3">'+esc(m.provisional_captured_checkpoints??0)+' captured / '+esc(m.provisional_due_checkpoints??0)+' due</td></tr>',
    '</tbody></table></div>'
  ].join('');

  const activeRows=active.length?active.map(call=>[
    '<tr><td>'+esc(call.ticker||'—')+'</td><td>'+esc(call.recommendation_id||'—')+'</td><td>'+esc(call.definitive_forecast||'—')+' · '+esc(call.definitive_recommendation||'—')+'</td><td>'+esc(zone(call.expected_price_zone))+' · '+esc(call.outcome_verdict||'OPEN')+'</td></tr>'
  ].join('')).join(''):'<tr><td colspan="4">None</td></tr>';
  const table2='<div class="edge-table-wrap"><table class="edge-table"><caption>2 — ACTIVE CALLS</caption><thead><tr><th>Stock</th><th>Recommendation</th><th>Current State</th><th>Efficacy / Horizon</th></tr></thead><tbody>'+activeRows+'</tbody></table></div>';

  const table3=[
    '<div class="edge-table-wrap"><table class="edge-table"><caption>3 — CURRENT STOCK OUTCOME</caption><tbody>',
    '<tr><th>Stock</th><td>'+esc(r.ticker||'—')+'</td><th>Run ID</th><td>'+esc(r.run_id||'—')+'</td></tr>',
    '<tr><th>Primary action</th><td colspan="3"><strong>'+esc(d.primary_action||'—')+'</strong></td></tr>',
    '<tr><th>Forecast</th><td>'+esc(d.definitive_forecast||'—')+'</td><th>Horizon</th><td>'+esc(d.forecast_horizon||'—')+'</td></tr>',
    '<tr><th>Bull / Base / Bear</th><td colspan="3">'+esc(pct(probs.bull))+' / '+esc(pct(probs.base))+' / '+esc(pct(probs.bear))+'</td></tr>',
    '<tr><th>Expected price zone</th><td>'+esc(zone(d.expected_price_zone))+'</td><th>Current price</th><td>'+esc(d.current_price??'N/A')+'</td></tr>',
    '<tr><th>DES</th><td>'+esc(num(d.des,2))+'</td><th>Market Trust</th><td>'+esc(num(d.market_trust?.score,2))+' · '+esc(d.market_trust?.band||'—')+'</td></tr>',
    '<tr><th>Directional agreement</th><td>'+esc(pct(d.directional_agreement))+'</td><th>Effective conviction</th><td>'+esc(pct(d.effective_conviction==null?null:d.effective_conviction*100))+'</td></tr>',
    '<tr><th>BOT</th><td>'+esc(num(d.bot?.score,2))+' · '+esc(d.bot?.grade||'—')+'</td><th>Decision Ladder</th><td>'+esc(d.decision_ladder||'—')+'</td></tr>',
    '<tr><th>Risk override</th><td>'+override(d.risk_override)+'</td><th>Execution</th><td>'+esc(ex.instrument||'N/A')+' · Entry '+esc(zone({low:ex.entry_low,high:ex.entry_high}))+' · Stop '+esc(ex.stop_price??'N/A')+' · T1 '+esc(ex.target1??'N/A')+' · T2 '+esc(ex.target2??'N/A')+'</td></tr>',
    '</tbody></table></div>'
  ].join('');

  const drillRows=rows.map(row=>'<tr><td>'+esc(row.component||'—')+'</td><td>'+esc(row.score_or_level??'N/A')+'</td><td><span class="verify '+esc(String(row.verification_status||'').toLowerCase())+'">'+esc(row.verification_status||'NOT_VERIFIED')+'</span><br>'+esc(row.key_outcome||'—')+'</td><td>'+esc(row.interpretation||'—')+'</td></tr>').join('');
  const table4='<div class="edge-table-wrap"><table class="edge-table"><caption>4 — DRILL-DOWN</caption><thead><tr><th>Component</th><th>Score / Level</th><th>Key Outcome</th><th>Interpretation</th></tr></thead><tbody>'+drillRows+'</tbody></table></div>';

  return '<article class="run edge-v13"><div class="engine-row"><strong>EDGE STOCKS · V1.3</strong><span class="badge">EFFICACY V2</span></div>'+table1+table2+table3+table4+'<p class="muted">Assessment-first semantic contract enforced · Auto-refreshed '+esc(new Date().toLocaleTimeString())+'</p></article>';
}

export const renderEdgeV12 = renderEdgeV13;

if (typeof document !== 'undefined') {
  const root=document.getElementById('edgePanel');
  if(root){
    const summary=document.createElement('div');
    summary.id='edgeLiveSummary';summary.className='stack';root.appendChild(summary);
    let loading=false;
    async function refreshEdgeLive(){
      if(loading)return;loading=true;
      try{
        const resp=await fetch('/api/edge-stocks/report?ticker=TCS',{cache:'no-store'});
        const data=await resp.json().catch(()=>({}));
        if(!resp.ok)throw new Error(data.error||'EDGE live read failed');
        summary.innerHTML=renderEdgeV13(data.report||{});
      }catch(e){
        summary.innerHTML='<div class="run muted">EDGE Efficacy V2 render blocked: '+esc(e.message||'unknown error')+'</div>';
      }finally{loading=false;}
    }
    refreshEdgeLive();setInterval(refreshEdgeLive,60000);
  }
}
