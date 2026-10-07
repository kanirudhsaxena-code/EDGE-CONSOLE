const EXPECTED=['D','D+1','D+2','D+3','D+4'];
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const level=v=>v==null||Number.isNaN(Number(v))?'—':Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
const pct=v=>v==null||Number.isNaN(Number(v))?'—':Number(v).toFixed(2)+'%';
const dateText=v=>{if(!v)return'—';const d=new Date(String(v)+'T00:00:00');return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})};

function validateBuild3CoreZoneOutput(value,expectedEngine){
  if(!value)return null;
  if(value.version!=='MDOS_BUILD_3_CORE_ZONE_OUTPUT_V1')throw new Error('Build 3.0 Core Zone version mismatch');
  if(expectedEngine&&value.engine!==expectedEngine)throw new Error('Build 3.0 Core Zone engine mismatch');
  if(value.shadow_only!==true||value.production_methodology_changed!==false)throw new Error('Build 3.0 Core Zone governance mismatch');
  if(!Array.isArray(value.rows)||value.rows.length!==5)throw new Error('Build 3.0 Core Zone requires exactly five horizons');
  value.rows.forEach((row,index)=>{
    if(row?.horizon!==EXPECTED[index])throw new Error('Build 3.0 Core Zone horizon order mismatch at '+EXPECTED[index]);
    if(!row?.target_session)throw new Error('Build 3.0 Core Zone target session missing at '+EXPECTED[index]);
    if(!row?.core_zone||![row.core_zone.low,row.core_zone.high].every(v=>Number.isFinite(Number(v))))throw new Error('Build 3.0 Core Zone missing at '+EXPECTED[index]);
    if(!row?.outer_zone||![row.outer_zone.low,row.outer_zone.high].every(v=>Number.isFinite(Number(v))))throw new Error('Build 3.0 outer zone missing at '+EXPECTED[index]);
    if(Number(row.core_zone.low)>Number(row.core_zone.high))throw new Error('Build 3.0 Core Zone order invalid at '+EXPECTED[index]);
    if(Number(row.core_zone.low)<Number(row.outer_zone.low)||Number(row.core_zone.high)>Number(row.outer_zone.high))throw new Error('Build 3.0 Core Zone must remain inside outer zone at '+EXPECTED[index]);
    if(!row.calibration_version||!row.calibration_state)throw new Error('Build 3.0 Core Zone calibration provenance missing at '+EXPECTED[index]);
  });
  return value;
}

function renderBuild3CoreZones(value,{title='Core Zones · D through D+4',instrument='NIFTY'}={}){
  const data=validateBuild3CoreZoneOutput(value,value?.engine);
  if(!data)return '<section class="stock-section build3-core-zone-panel legacy"><div class="stock-section-title"><div><span>BUILD 3.0 PRECISION</span><h3>'+esc(title)+'</h3></div><span class="status-chip neutral">LEGACY RUN</span></div><p class="stock-section-copy">This run predates Build 3.0 precision materialization, so no Core Zone is claimed retrospectively.</p></section>';
  return '<section class="stock-section build3-core-zone-panel" data-build3-core-zone-output="'+esc(data.engine)+'"><div class="stock-section-title"><div><span>BUILD 3.0 PRECISION · SHADOW</span><h3>'+esc(title)+'</h3></div><span class="status-chip positive">5 HORIZONS</span></div><p class="stock-section-copy">Core Zone is the tighter high-probability area inside the governed outer zone. It is shown from the persisted Build 3.0 issuance record and does not alter the production recommendation.</p><div class="stock-detail-grid">'+data.rows.map(row=>'<div data-build3-core-row="'+esc(row.horizon)+'"><span>'+esc(row.horizon)+' · '+esc(dateText(row.target_session))+'</span><strong>Core '+level(row.core_zone.low)+' – '+level(row.core_zone.high)+'</strong><small>Expected centre '+level(row.expected_centre)+' · Outer '+level(row.outer_zone.low)+' – '+level(row.outer_zone.high)+'</small><small>Core width '+level(row.core_width_points)+' pts · '+pct(row.core_width_percent)+' · '+esc(String(row.calibration_state).replaceAll('_',' '))+'</small><small>'+esc(row.calibration_version)+' · '+esc(instrument)+' · SHADOW only</small></div>').join('')+'</div></section>';
}

export {EXPECTED,validateBuild3CoreZoneOutput,renderBuild3CoreZones};
