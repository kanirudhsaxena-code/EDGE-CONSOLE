const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const money=v=>v==null||Number.isNaN(Number(v))?'—':'₹'+Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
const dateText=v=>{if(!v)return'—';const d=new Date(String(v)+'T00:00:00');return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})};
const EXPECTED=['D','D+1','D+2','D+3','D+4'];
function validateSessions(report){
  const d=report?.current_stock_outcome||{};
  if(d.forecast_horizon!=='D:D+4')throw new Error('EDGE Stocks forecast horizon must be D:D+4');
  const rows=d.forecast_sessions;
  if(!Array.isArray(rows)||rows.length!==5)throw new Error('EDGE Stocks must publish exactly five forecast sessions');
  rows.forEach((row,i)=>{if(row?.session_label!==EXPECTED[i])throw new Error('EDGE Stocks forecast session order mismatch at '+EXPECTED[i]);if(!row?.trading_date)throw new Error('EDGE Stocks '+EXPECTED[i]+' trading date missing');if(!row?.direction)throw new Error('EDGE Stocks '+EXPECTED[i]+' direction missing');if(!row?.expected_zone||row.expected_zone.low==null||row.expected_zone.high==null)throw new Error('EDGE Stocks '+EXPECTED[i]+' expected zone missing')});
  return rows;
}
function renderRows(rows){return '<section class="stock-section edge-five-session-path" data-edge-five-session-path="D:D+4"><div class="stock-section-title"><div><span>CANONICAL FORECAST PATH</span><h3>Five governed sessions · D through D+4</h3></div><span class="status-chip positive">EXACTLY 5</span></div><p class="stock-section-copy">These rows are rendered directly from the immutable current_stock_outcome.forecast_sessions read model. No session is independently reconstructed in the Console.</p><div class="stock-detail-grid">'+rows.map((row,i)=>'<div data-edge-forecast-row="'+esc(EXPECTED[i])+'" data-edge-trading-date="'+esc(row.trading_date)+'" data-edge-direction="'+esc(row.direction)+'" data-edge-zone-low="'+esc(row.expected_zone.low)+'" data-edge-zone-high="'+esc(row.expected_zone.high)+'"><span>'+esc(row.session_label)+' · '+esc(dateText(row.trading_date))+'</span><strong>'+esc(String(row.direction).replaceAll('_',' '))+'</strong><small>Expected zone '+money(row.expected_zone.low)+' – '+money(row.expected_zone.high)+(row.confidence!=null?' · Confidence '+esc(row.confidence):row.probability!=null?' · Probability '+esc(row.probability):'')+'</small></div>').join('')+'</div></section>'}
async function bind(){
  const root=document.getElementById('stocksSummary');if(!root)return;
  const ticker=()=>localStorage.getItem('edge-console-selected-stock')||'LTF';
  let applying=false;
  async function apply(){if(applying)return;const outcome=root.querySelector('[data-edge-section="current-stock-outcome"]');if(!outcome)return;applying=true;try{const resp=await fetch('/api/edge-stocks/report?ticker='+encodeURIComponent(ticker()),{cache:'no-store'}),data=await resp.json();if(!resp.ok)throw new Error(data.error||'EDGE live read failed');const report=data.report||{};const rows=validateSessions(report);outcome.querySelector('[data-edge-five-session-path]')?.remove();const marker=outcome.querySelector('.edge-decision-highlights');(marker||outcome.firstElementChild)?.insertAdjacentHTML('afterend',renderRows(rows));root.dataset.edgeFiveSessionRunId=String(report.run_id||'');}catch(e){console.error(e);root.dataset.edgeFiveSessionError=String(e.message||e)}finally{applying=false}}
  const observer=new MutationObserver(()=>{void apply()});observer.observe(root,{childList:true,subtree:true});await apply();setInterval(()=>void apply(),60000)
}
if(typeof document!=='undefined')void bind();
export {EXPECTED,validateSessions,renderRows};
