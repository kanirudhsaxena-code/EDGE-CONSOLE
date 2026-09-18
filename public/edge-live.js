export const EDGE_RENDERER_CONTRACT = 'EDGE_STOCKS_V1_2';
export const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const pct = v => v === null || v === undefined ? 'N/A' : Number(v).toFixed(1) + '%';
const num = (v, digits=2) => v === null || v === undefined || Number.isNaN(Number(v)) ? 'N/A' : Number(v).toFixed(digits);
const zone = z => !z || (z.low == null && z.high == null) ? 'N/A' : [z.low ?? '—', z.high ?? '—'].join(' – ');
const override = o => !o ? 'N/A' : o.status === 'ACTIVE' ? 'ACTIVE · ' + esc(o.code || 'UNSPECIFIED') : 'CLEAR';

export function renderEdgeV12(report, master = {}) {
  const r = report || {};
  if (r.contract_version !== 'EDGE_STOCKS_V1_2') throw new Error('EDGE Stocks contract mismatch');
  if (r.presentation?.standard_table_count !== 2) throw new Error('EDGE Stocks presentation contract mismatch');

  const d = r.decision || {};
  const o = r.official_efficacy || {};
  const p = r.provisional_checkpoint_diagnostics || {};
  const m = master || {};
  const probs = d.probabilities || {};
  const ex = d.execution || {};
  const rows = Array.isArray(r.institutional_drilldown) ? r.institutional_drilldown : [];
  if (!rows.length) throw new Error('Institutional drill-down unavailable');

  const table1 = [
    '<div class="edge-table-wrap">',
    '<table class="edge-table"><caption>Table 1 — EDGE Outcome / Decision</caption><tbody>',
    '<tr><th>Stock</th><td>'+esc(r.ticker||'—')+'</td><th>Run ID</th><td>'+esc(r.run_id||'—')+'</td></tr>',
    '<tr><th>Primary action</th><td colspan="3"><strong>'+esc(d.primary_action||'—')+'</strong></td></tr>',
    '<tr><th>Definitive forecast</th><td>'+esc(d.definitive_forecast||'—')+'</td><th>Forecast horizon</th><td>'+esc(d.forecast_horizon||'—')+'</td></tr>',
    '<tr><th>Bull / Base / Bear</th><td colspan="3">'+esc(pct(probs.bull))+' / '+esc(pct(probs.base))+' / '+esc(pct(probs.bear))+'</td></tr>',
    '<tr><th>Expected price zone</th><td>'+esc(zone(d.expected_price_zone))+'</td><th>Current price</th><td>'+esc(d.current_price ?? 'N/A')+'</td></tr>',
    '<tr><th>DES</th><td>'+esc(num(d.des,2))+'</td><th>Market Trust</th><td>'+esc(num(d.market_trust?.score,2))+' · '+esc(d.market_trust?.band||'—')+'</td></tr>',
    '<tr><th>Directional agreement</th><td>'+esc(pct(d.directional_agreement))+'</td><th>Effective conviction</th><td>'+esc(pct(d.effective_conviction == null ? null : d.effective_conviction*100))+'</td></tr>',
    '<tr><th>BOT</th><td>'+esc(num(d.bot?.score,2))+' · '+esc(d.bot?.grade||'—')+'</td><th>Decision Ladder</th><td>'+esc(d.decision_ladder||'—')+'</td></tr>',
    '<tr><th>Risk override</th><td colspan="3">'+override(d.risk_override)+'</td></tr>',
    '<tr><th>Execution</th><td colspan="3">'+
      'Instrument '+esc(ex.instrument||'N/A')+
      ' · Entry '+esc(zone({low:ex.entry_low,high:ex.entry_high}))+
      ' · Stop '+esc(ex.stop_price ?? 'N/A')+
      ' · T1 '+esc(ex.target1 ?? 'N/A')+
      ' · T2 '+esc(ex.target2 ?? 'N/A')+
      ' · Time exit '+esc(ex.time_exit ?? 'N/A')+
      '</td></tr>',
    '</tbody></table></div>'
  ].join('');

  const drillRows = rows.map(row => [
    '<tr>',
    '<td>'+esc(row.component||'—')+'</td>',
    '<td>'+esc(row.score_or_level ?? 'N/A')+'</td>',
    '<td><span class="verify '+esc(String(row.verification_status||'').toLowerCase())+'">'+esc(row.verification_status||'NOT_VERIFIED')+'</span><br>'+esc(row.key_outcome||'—')+'</td>',
    '<td>'+esc(row.interpretation||'—')+'</td>',
    '</tr>'
  ].join('')).join('');

  const table2 = [
    '<div class="edge-table-wrap">',
    '<table class="edge-table"><caption>Table 2 — Institutional Drill-down</caption>',
    '<thead><tr><th>Component</th><th>Score / Level</th><th>Key Outcome</th><th>Interpretation</th></tr></thead>',
    '<tbody>'+drillRows+'</tbody></table></div>'
  ].join('');

  const efficacy = [
    '<div class="edge-efficacy">',
    '<div class="metric"><span>OFFICIAL sample</span><strong>'+esc(o.sample_size ?? 0)+' closed/scorable</strong></div>',
    '<div class="metric"><span>OFFICIAL recommendation hit rate</span><strong>'+esc(pct(o.recommendation_hit_rate_pct))+'</strong></div>',
    '<div class="metric"><span>OFFICIAL directional accuracy</span><strong>'+esc(pct(o.directional_accuracy_pct))+'</strong></div>',
    '<div class="metric"><span>PROVISIONAL forecast accuracy</span><strong>'+esc(pct(p.forecast_accuracy_pct))+' · '+esc(p.forecast_hits??0)+'/'+esc(p.forecast_scorable??0)+'</strong></div>',
    '<div class="metric"><span>PROVISIONAL zone accuracy</span><strong>'+esc(pct(p.zone_accuracy_pct))+' · '+esc(p.zone_hits??0)+'/'+esc(p.zone_scorable??0)+'</strong></div>',
    '<div class="metric"><span>Master open recommendations</span><strong>'+esc(m.open_recommendations??'—')+'</strong></div>',
    '</div>'
  ].join('');

  return [
    '<article class="run edge-v12">',
    '<div class="engine-row"><strong>EDGE STOCKS · V1.2</strong><span class="badge">CANONICAL</span></div>',
    table1,
    table2,
    '<div class="edge-efficacy-title">Efficacy — separate from the two standard tables</div>',
    efficacy,
    '<p class="muted">Auto-refreshed '+esc(new Date().toLocaleTimeString())+' · OFFICIAL and PROVISIONAL efficacy remain separate.</p>',
    '</article>'
  ].join('');
}

if (typeof document !== 'undefined') {
  const root=document.getElementById('edgePanel');
  if(root){
    const summary=document.createElement('div');
    summary.id='edgeLiveSummary';
    summary.className='stack';
    root.appendChild(summary);
    let loading=false;
    async function refreshEdgeLive(){
      if(loading)return;loading=true;
      try{
        const [reportResp,masterResp]=await Promise.all([
          fetch('/api/edge-stocks/report?ticker=LTF',{cache:'no-store'}),
          fetch('/api/edge-stocks/master',{cache:'no-store'})
        ]);
        const report=await reportResp.json().catch(()=>({}));
        const master=await masterResp.json().catch(()=>({}));
        if(!reportResp.ok||!masterResp.ok)throw new Error(report.error||master.error||'EDGE live read failed');
        summary.innerHTML=renderEdgeV12(report.report||{},master.master||{});
      }catch(e){
        summary.innerHTML='<div class="run muted">EDGE V1.2 render blocked: '+esc(e.message||'unknown error')+'</div>';
      }finally{loading=false;}
    }
    refreshEdgeLive();
    setInterval(refreshEdgeLive,60000);
  }
}
