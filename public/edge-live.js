const root=document.getElementById('edgePanel');
if(root){
  const summary=document.createElement('div');
  summary.id='edgeLiveSummary';
  summary.className='stack';
  root.appendChild(summary);
  const pct=v=>v===null||v===undefined?'N/A':Number(v).toFixed(1)+'%';
  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
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
      const r=report.report||{},o=r.official_efficacy||{},p=r.provisional_checkpoint_diagnostics||{},m=master.master||{};
      summary.innerHTML=['<article class="run">',
        '<div class="engine-row"><strong>EDGE LIVE DASHBOARD</strong><span class="badge">LIVE</span></div>',
        '<div class="metric"><span>Latest call</span><strong>'+esc(r.ticker||'—')+' · '+esc(r.decision?.forecast||'—')+'</strong></div>',
        '<div class="metric"><span>Official sample</span><strong>'+esc(o.sample_size??0)+' closed/scorable</strong></div>',
        '<div class="metric"><span>Official hit rate</span><strong>'+esc(pct(o.recommendation_hit_rate_pct))+'</strong></div>',
        '<div class="metric"><span>Official directional accuracy</span><strong>'+esc(pct(o.directional_accuracy_pct))+'</strong></div>',
        '<div class="metric"><span>Provisional forecast accuracy</span><strong>'+esc(pct(p.forecast_accuracy_pct))+' · '+esc(p.forecast_hits??0)+'/'+esc(p.forecast_scorable??0)+'</strong></div>',
        '<div class="metric"><span>Provisional zone accuracy</span><strong>'+esc(pct(p.zone_accuracy_pct))+' · '+esc(p.zone_hits??0)+'/'+esc(p.zone_scorable??0)+'</strong></div>',
        '<div class="metric"><span>Master open recommendations</span><strong>'+esc(m.open_recommendations??'—')+'</strong></div>',
        '<p class="muted">Auto-refreshed '+esc(new Date().toLocaleTimeString())+' · Official and provisional efficacy remain separate.</p>',
      '</article>'].join('');
    }catch(e){
      summary.innerHTML='<div class="run muted">EDGE live dashboard refresh failed: '+esc(e.message||'unknown error')+'</div>';
    }finally{loading=false;}
  }
  refreshEdgeLive();
  setInterval(refreshEdgeLive,60000);
}
