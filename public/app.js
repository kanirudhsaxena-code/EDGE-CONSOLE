const health=document.getElementById('health'),runs=document.getElementById('runs'),runsNote=document.getElementById('runsNote'),dialog=document.getElementById('runDialog'),fiveDrState=document.getElementById('fiveDrState'),fiveDrSummary=document.getElementById('fiveDrSummary'),runForm=document.getElementById('runForm'),runEngine=document.getElementById('runEngine'),evidenceMode=document.getElementById('evidenceMode'),decisionObjective=document.getElementById('decisionObjective'),riskPosture=document.getElementById('riskPosture'),capitalPriority=document.getElementById('capitalPriority'),priceFiles=document.getElementById('priceEvidenceFiles'),derivativesFiles=document.getElementById('derivativesEvidenceFiles'),fileSelection=document.getElementById('fileSelection'),uploadStatus=document.getElementById('uploadStatus'),uploadButton=document.getElementById('uploadEvidenceButton'),assessmentSummary=document.getElementById('assessmentSummary'),stocksAssessmentSummary=document.getElementById('stocksAssessmentSummary'),ipoAssessmentSummary=document.getElementById('ipoAssessmentSummary'),stocksSummary=document.getElementById('stocksSummary'),ipoSummary=document.getElementById('ipoSummary'),selectedModuleEyebrow=document.getElementById('selectedModuleEyebrow'),selectedModuleTitle=document.getElementById('selectedModuleTitle');
const MAX_FILES=20,MAX_FILE_BYTES=10*1024*1024,ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp','application/pdf']),REQUIRED_USER_CATEGORIES=['PRICE_TECHNICALS','DERIVATIVES_OI'];
let selectedPriceFiles=[],selectedDerivativesFiles=[],activeModule='5DR';
const MODULE_CONFIG={'5DR':{title:'Latest market view',action:'Run 5DR'},EDGE_STOCKS:{title:'Latest stock decision',action:null},EDGE_IPO:{title:'Latest IPO decision',action:null}};
const moduleTiles=Array.from(document.querySelectorAll('.module-tile')),modulePanels={'5DR':document.getElementById('fiveDrPanel'),EDGE_STOCKS:document.getElementById('edgeStocksPanel'),EDGE_IPO:document.getElementById('edgeIpoPanel')};
function setActiveModule(module){if(!MODULE_CONFIG[module])return;activeModule=module;moduleTiles.forEach(t=>t.classList.toggle('active',t.dataset.module===module));Object.entries(modulePanels).forEach(([key,panel])=>{if(panel){panel.hidden=key!==module;panel.classList.toggle('active',key===module)}});selectedModuleEyebrow.textContent=module==='EDGE_STOCKS'?'EDGE STOCKS':module==='EDGE_IPO'?'EDGE IPO':'5DR';selectedModuleTitle.textContent=MODULE_CONFIG[module].title;const runButton=document.getElementById('runButton');if(runButton){runButton.hidden=module!=='5DR';runButton.textContent='Run 5DR'};loadRecentResults(module)}
moduleTiles.forEach(tile=>tile.addEventListener('click',()=>setActiveModule(tile.dataset.module)));
document.getElementById('runButton')?.addEventListener('click',()=>dialog.showModal());
document.getElementById('closeRunDialog')?.addEventListener('click',()=>dialog.close());
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}function readableBytes(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB'}function setUploadStatus(m,s){uploadStatus.className='upload-status'+(s?' '+s:'');uploadStatus.textContent=m||''}
function friendlyEngineStatus(status){const map={EVIDENCE_GATE_READY:'Ready',ACTIVE:'Ready',FOUNDATION:'Setup in progress',INTEGRATION_PENDING:'Setup in progress',READY:'Ready'};return map[String(status)]||String(status||'Status unavailable').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase())}
function friendlyDirection(value){const map={BULL:'Bullish',BEAR:'Bearish',RANGE:'Range-bound'};return map[String(value)]||String(value||'—')}
function confidenceLabel(value){const n=Number(value);if(!Number.isFinite(n))return'Unavailable';if(n>=75)return'High';if(n>=50)return'Moderate';return'Low'}
function blockerText(code){const map={DATA_INADEQUATE:'Not enough reliable evidence',MARKET_TRUST_LT_50:'Market confidence is too low',DES5_LT_30:'Directional strength is too weak',EXECUTION_EDGE_LT_65:'Trade setup quality is too weak',RR_LT_2:'Potential reward is not high enough for the risk',EVENT_KILL_SWITCH:'A major event-risk safeguard is active'};return map[String(code)]||String(code||'').replaceAll('_',' ').toLowerCase()}
function friendlyFailureMessage(raw){
  const text=String(raw||'').toLowerCase();
  if(/timeout|timed out/.test(text))return'Analysis took too long to complete. Your uploaded evidence is saved, so you can safely retry.';
  if(/network|fetch/.test(text))return'The connection was interrupted. Your uploaded evidence is saved, so you can safely retry.';
  if(/missing cited evidence|data inadequate|not enough|missing.*evidence/.test(text))return'5DR could not verify enough reliable evidence to complete the analysis.';
  if(/conflict|reconciliation/.test(text))return'The available evidence did not agree strongly enough for 5DR to complete safely.';
  if(/vision|image|screenshot/.test(text))return'One or more screenshots could not be interpreted reliably.';
  if(/source_refs|evidence reference|provenance/.test(text))return'5DR could not validate the evidence references for this run. Your screenshots are saved; retry is safe.';
  if(/evidence_conflict|conflicts with official nse|market level/.test(text))return'The uploaded screenshots do not match the current official NIFTY market level, so this run was stopped rather than producing a misleading result.';
  if(/research|market status|source/.test(text))return'5DR could not verify one or more required market sources.';
  if(/workflow|dispatch|engine/.test(text))return'The 5DR engine did not complete normally.';
  return'The run stopped safely before producing a result.';
}
function diagnosticSummary(raw,status){
  const clean=String(raw||'').replace(/\s+/g,' ').trim();
  return '<details class="diagnostic-details"><summary>System details</summary><div class="diagnostic-body"><p><strong>Status:</strong> '+escapeHtml(status||'Stopped')+'</p><p>'+escapeHtml(clean||'No technical diagnostic was recorded.')+'</p></div></details>'
}
function stageLabel(stage,status){if(status==='COMPLETED')return'Result ready';const map={EVIDENCE_READY:'Screenshots received',SCREENSHOTS_READY:'Reading screenshots',VISION_READY:'Reading screenshots',RESEARCH_RETRIEVED:'Checking market conditions',AUTONOMOUS_EVIDENCE_READY:'Checking market conditions',INTELLIGENCE_READY:'Combining evidence',NORMALIZED_READY:'Running 5DR',PROCESSING:'Running 5DR'};return map[String(stage)]||'Preparing analysis'}
const DECISION_PREFS_KEY='edge-console-5dr-decision-setup-v1';
function loadDecisionPrefs(){try{const saved=JSON.parse(localStorage.getItem(DECISION_PREFS_KEY)||'{}');if(decisionObjective&&saved.objective)decisionObjective.value=saved.objective;if(riskPosture&&saved.risk_posture)riskPosture.value=saved.risk_posture;if(capitalPriority&&saved.capital_priority)capitalPriority.value=saved.capital_priority}catch{}}
function saveDecisionPrefs(){try{localStorage.setItem(DECISION_PREFS_KEY,JSON.stringify({objective:decisionObjective?.value||'BOTH',risk_posture:riskPosture?.value||'CONSERVATIVE',capital_priority:capitalPriority?.value||'CAPITAL_PROTECTION'}))}catch{}}
[decisionObjective,riskPosture,capitalPriority].filter(Boolean).forEach(el=>el.addEventListener('change',saveDecisionPrefs));loadDecisionPrefs();
function firstFinding(observations,category,labelPattern){
  const obs=(Array.isArray(observations)?observations:[]).filter(o=>o&&o.category===category);
  for(const o of obs){for(const f of (Array.isArray(o.findings)?o.findings:[])){if(labelPattern.test(String(f.label||'')))return f.value}}
  return null
}
function parseNumberText(v){const n=Number(String(v??'').replace(/[^0-9.\-]/g,''));return Number.isFinite(n)?n:null}
function allFindings(observations,category){
  const out=[];for(const o of (Array.isArray(observations)?observations:[])){if(!o||o.category!==category)continue;for(const f of (Array.isArray(o.findings)?o.findings:[])){if(f&&typeof f.label==='string')out.push(f)}}return out
}
function firstFindingByPatterns(findings,patterns){for(const p of patterns){const f=findings.find(x=>p.test(String(x.label||'')));if(f)return f}return null}
function signedSignal(v){const n=Number(v);if(!Number.isFinite(n))return'not verified';if(n>=1)return n>=2?'strongly supportive':'supportive';if(n<=-1)return n<=-2?'strongly adverse':'adverse';return'neutral'}
function friendlySetup(setup){
  const objective={BOTH:'Market view + options setup',MARKET_VIEW:'Market view only',OPTIONS_SETUP:'Options setup only'}[String(setup?.objective)]||'Not recorded';
  const risk={CONSERVATIVE:'Conservative',BALANCED:'Balanced',OPPORTUNISTIC:'Opportunistic'}[String(setup?.risk_posture)]||'Not recorded';
  const priority={CAPITAL_PROTECTION:'Protect capital first',BALANCED:'Balanced',GROWTH:'Growth first'}[String(setup?.capital_priority)]||'Not recorded';
  return {objective,risk,priority,horizon:'Next 5 market days'}
}
function optionStrikeSummary(findings,spot){
  const rows=new Map();
  for(const f of findings){
    const m=String(f.label||'').match(/^Strike\s+([0-9.]+)\s+(CE|PE)\s+(LTP|Premium|OI|Change OI|Volume|IV)$/i);
    if(!m)continue;const strike=Number(m[1]),side=m[2].toUpperCase(),field=m[3].toUpperCase().replace('PREMIUM','LTP').replace('CHANGE OI','CHG_OI');
    if(!rows.has(strike))rows.set(strike,{strike,CE:{},PE:{}});rows.get(strike)[side][field]=f.value
  }
  const arr=[...rows.values()];
  if(!arr.length)return null;
  arr.sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot));
  return arr.slice(0,5).map(r=>{
    const ce=[],pe=[];
    if(r.CE.LTP!=null)ce.push('premium '+r.CE.LTP);if(r.CE.OI!=null)ce.push('OI '+r.CE.OI);if(r.CE.CHG_OI!=null)ce.push('ΔOI '+r.CE.CHG_OI);if(r.CE.VOLUME!=null)ce.push('vol '+r.CE.VOLUME);
    if(r.PE.LTP!=null)pe.push('premium '+r.PE.LTP);if(r.PE.OI!=null)pe.push('OI '+r.PE.OI);if(r.PE.CHG_OI!=null)pe.push('ΔOI '+r.PE.CHG_OI);if(r.PE.VOLUME!=null)pe.push('vol '+r.PE.VOLUME);
    return r.strike+': '+(ce.length?'CE '+ce.join(', '):'CE —')+' | '+(pe.length?'PE '+pe.join(', '):'PE —')
  }).join('; ')
}
function medianNumber(values){const a=values.map(parseNumberText).filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function exactFindings(findings,re){return findings.filter(f=>re.test(String(f.label||'')))}
function preferredTrend(findings){
  const vals=exactFindings(findings,/^(Visible Trend Structure|Trend Structure|Long-term Trend|Long Term Trend)$/i).map(f=>String(f.value||'')).filter(Boolean);
  const usable=vals.filter(v=>!/single data point/i.test(v));
  const pool=usable.length?usable:vals;
  let bull=0,bear=0,side=0;pool.forEach(v=>{/bull|upward|higher high|higher low/i.test(v)?bull++:/bear|downward|lower high|lower low/i.test(v)?bear++:side++});
  if(bull>bear&&bull>=side)return {label:'Bullish structure',detail:side?'Most chart views are bullish, with one shorter-term consolidation view.':'Multiple chart views show bullish/upward structure.'};
  if(bear>bull&&bear>=side)return {label:'Bearish structure',detail:side?'Most chart views are bearish, with one shorter-term consolidation view.':'Multiple chart views show bearish/downward structure.'};
  if(side)return {label:'Consolidating / mixed',detail:'The visible chart views are predominantly sideways or mixed.'};
  return {label:'Not verified',detail:'No reliable trend-structure observation was preserved.'}
}
function optionRows(findings){
  const rows=new Map();
  for(const f of findings){
    const m=String(f.label||'').match(/^Strike\s+([0-9.]+)\s+(CE|PE)\s+(LTP|Premium|OI|Change OI|Volume|IV)$/i);
    if(!m)continue;
    const strike=Number(m[1]),side=m[2].toUpperCase(),field=m[3].toUpperCase().replace('PREMIUM','LTP').replace('CHANGE OI','CHG_OI');
    if(!rows.has(strike))rows.set(strike,{strike,CE:{},PE:{}});
    rows.get(strike)[side][field]=parseNumberText(f.value);
  }
  return [...rows.values()].sort((a,b)=>a.strike-b.strike)
}
function strikeBias(row){
  let ce=0,pe=0,known=0;
  for(const k of ['OI','CHG_OI','VOLUME']){const a=Number(row.CE[k]),b=Number(row.PE[k]);if(Number.isFinite(a)&&Number.isFinite(b)){known++;if(a>b)ce++;else if(b>a)pe++}}
  if(!known)return'unclear';if(ce>=2)return'call-heavy';if(pe>=2)return'put-heavy';return'mixed'
}
function compactStrikeText(rows,spot){
  const sorted=[...rows].sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot)).slice(0,4);
  return sorted.map(r=>{const parts=[];if(Number.isFinite(r.CE.OI))parts.push('CE OI '+Math.round(r.CE.OI).toLocaleString('en-IN'));if(Number.isFinite(r.CE.CHG_OI))parts.push('CE ΔOI '+Math.round(r.CE.CHG_OI).toLocaleString('en-IN'));if(Number.isFinite(r.PE.OI))parts.push('PE OI '+Math.round(r.PE.OI).toLocaleString('en-IN'));if(Number.isFinite(r.PE.CHG_OI))parts.push('PE ΔOI '+Math.round(r.PE.CHG_OI).toLocaleString('en-IN'));return r.strike+' · '+parts.join(' · ')+' · '+strikeBias(r)}).join('; ')
}
function governedWhy(meta,normalized,result){
  const vision=meta&&meta.screenshot_intelligence&&Array.isArray(meta.screenshot_intelligence.observations)?meta.screenshot_intelligence.observations:[];
  const research=meta&&meta.system_research_acquisition&&Array.isArray(meta.system_research_acquisition.snapshots)?meta.system_research_acquisition.snapshots:[];
  const rec=meta&&meta.intelligence_reconciliation?meta.intelligence_reconciliation:{},judgment=rec&&rec.judgment?rec.judgment:{},raw=judgment.directional_raw||{};
  const pf=allFindings(vision,'PRICE_TECHNICALS'),df=allFindings(vision,'DERIVATIVES_OI');
  const prices=exactFindings(pf,/^(Current Price|Index Value|Last Price)$/i).map(f=>f.value),spot=medianNumber(prices)||0;
  const ranges=exactFindings(pf,/^Day Range$/i).map(f=>String(f.value||'')).filter(v=>v&&!/^(\s*[0-9,.]+\s*-\s*\1\s*)$/.test(v));
  const trend=preferredTrend(pf);
  const emaVals=exactFindings(pf,/^Price vs EMA$/i).map(f=>String(f.value||'')),vwapVals=exactFindings(pf,/^Price vs VWAP$/i).map(f=>String(f.value||''));
  const supportVals=exactFindings(pf,/^(Support Level|Support)$/i).map(f=>f.value),resistanceVals=exactFindings(pf,/^(Resistance Level|Resistance)$/i).map(f=>f.value);
  const supportNum=medianNumber(supportVals),resistanceNum=medianNumber(resistanceVals);
  const support=supportNum?supportNum.toLocaleString('en-IN',{maximumFractionDigits:2}):null,resistance=resistanceNum?resistanceNum.toLocaleString('en-IN',{maximumFractionDigits:2}):null;
  const rows=optionRows(df),strikeText=rows.length?compactStrikeText(rows,spot):null,biases=rows.map(strikeBias).filter(x=>x!=='unclear'),mixedBias=new Set(biases).size>1||biases.includes('mixed');
  let breadth=null;
  for(const snap of research){if(snap&&snap.source_id==='NSE_ALL_INDICES'&&typeof snap.excerpt==='string'){try{const data=JSON.parse(snap.excerpt);const n50=Array.isArray(data.data)?data.data.find(x=>x&&x.index==='NIFTY 50'):null;if(n50){breadth={change:Number(n50.percentChange),advances:Number(n50.advances),declines:Number(n50.declines),month:Number(n50.perChange30d),year:Number(n50.perChange365d)};break}}catch{}}}
  const priceFacts=['NIFTY around '+(spot?spot.toLocaleString('en-IN',{maximumFractionDigits:2}):'—'),trend.detail];
  if(emaVals.some(v=>/above/i.test(v)))priceFacts.push('price is above the visible EMA');
  if(vwapVals.some(v=>/above/i.test(v)))priceFacts.push('price is above VWAP on at least one intraday view');
  if(support)priceFacts.push('support near '+support);if(resistance)priceFacts.push('resistance near '+resistance);
  const priceMeaning=result.directional_label==='RANGE'
    ? 'The underlying chart structure is constructive, but price is still close to an immediate resistance zone and the shorter-term views are not uniformly trending. That supports a range/transition call unless derivatives and participation confirm a breakout.'
    : 'The price structure supports the published direction only to the extent that it is confirmed by derivatives, participation and execution quality.';
  const optionsObserved=strikeText?('Near-ATM strikes show '+strikeText+'.'):'The stored derivatives extraction does not contain enough strike-level premium/OI/volume fields for a reliable directional read.';
  const optionsMeaning=rows.length?(mixedBias?'Adjacent strikes are not aligned: some are call-heavy while others are put-heavy/mixed. That is a real reason directional conviction stays low even though the chart itself looks constructive.':'Nearby strikes are broadly aligned, which provides directional confirmation.'):'No directional conclusion should be inferred from aggregate OI alone.';
  const marketObserved=breadth?('Official NSE breadth: NIFTY '+(breadth.change>=0?'+':'')+breadth.change.toFixed(2)+'%; '+breadth.advances+' advances vs '+breadth.declines+' declines. The index is '+breadth.month.toFixed(2)+'% over 30 days and '+breadth.year.toFixed(2)+'% over one year.'):'A structured breadth reading was not available.';
  const marketMeaning=breadth?(breadth.advances>breadth.declines?'Breadth is mildly positive, but 26 vs 24 is not strong enough to validate a high-conviction directional move by itself.':'Breadth is weak or negative, so the headline price move lacks broad confirmation.'):'Without breadth, the system should not claim broad market confirmation.';
  const macro=raw.MACRO_CATALYSTS||{};
  let crudeText='Crude context was retrieved but not converted into a clean governed numeric signal.';
  const eia=research.find(x=>x&&x.source_id==='EIA_CRUDE_SPOT'&&typeof x.excerpt==='string');
  if(eia){const m=String(eia.excerpt).match(/WTI[^0-9]+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i);if(m)crudeText='WTI rose from '+m[1]+' to '+m[6]+' over the visible EIA sequence, so crude was an adverse inflation/risk input rather than a bullish confirmation.'}
  const macroObserved='Global risk '+signedSignal(macro.global_risk_environment)+'; India rates/INR '+signedSignal(macro.india_macro_rbi_inr_rates)+'; crude/geopolitics '+signedSignal(macro.crude_commodities_geopolitics)+'; scheduled catalysts '+signedSignal(macro.scheduled_high_impact_catalysts)+'. '+crudeText;
  const macroMeaning='Macro was not strong enough to rescue an otherwise mixed setup. Any unavailable or degraded macro input is treated as lack of confirmation, not as a neutral positive.';
  const rr=Number(normalized.expected_rr??0),edge=Number(result.execution_edge??0),trust=Number(result.market_trust??0);
  const tradeObserved='Market Trust '+(Number.isFinite(trust)?trust.toFixed(1):'—')+'/100; execution edge '+(Number.isFinite(edge)?edge.toFixed(0):'—')+'/100; expected reward/risk '+(Number.isFinite(rr)?rr.toFixed(1):'—')+'.';
  const tradeMeaning=result.tradeable===true?'The directional view and execution gates both passed, so the setup is actionable.':'The forecast can still be valid while the trade is rejected. Here the evidence quality, execution setup and reward/risk are not strong enough to justify a position.';
  return {
    price:{observed:priceFacts.join(' · ')+'.',meaning:priceMeaning,impact:'Price structure is constructive, but not decisive on its own.'},
    options:{observed:optionsObserved,meaning:optionsMeaning,impact:mixedBias?'Options are a major source of directional conflict.':'Options provide some directional confirmation.'},
    market:{observed:marketObserved,meaning:marketMeaning,impact:'Participation is confirmation evidence, not a substitute for price.'},
    macro:{observed:macroObserved,meaning:macroMeaning,impact:'Macro is treated as confirmation/risk context.'},
    trade:{observed:tradeObserved,meaning:tradeMeaning,impact:result.tradeable===true?'Execution gates passed.':'Execution gates did not pass.'},
    levels:{support,resistance},
    hasStrikes:Boolean(rows.length)
  }
}
function userChangeConditions(why,normalized,result){
  const items=[];
  if(result.directional_label==='RANGE'){
    if(why.levels.resistance)items.push('A sustained move and close above '+why.levels.resistance+' with stronger participation would shift the view toward bullish.');
    if(why.levels.support)items.push('A sustained break and close below '+why.levels.support+' with stronger participation would shift the view toward bearish.');
    if(!why.levels.resistance&&!why.levels.support)items.push('Price needs to break out of the current range and hold outside it, not merely touch an intraday level.');
  }else items.push('Price must continue to hold in the forecast direction; a failed breakout or loss of the key structure would weaken the view.');
  items.push(why.hasStrikes?'Nearby option strikes need premium, volume and OI change to confirm the same direction rather than give mixed signals.':'The option chain needs clear strike-level agreement between premium, volume and OI change.');
  items.push('The move needs broader participation from sectors and heavyweight stocks, not only the headline index.');
  items.push('Macro conditions need to stop conflicting with the direction: global risk, RBI/INR/rates, crude/geopolitics and scheduled events should be supportive or at least non-adverse.');
  if(result.tradeable!==true)items.push('A trade also needs a clear entry and invalidation point with acceptable liquidity and at least 2:1 expected reward versus risk.');
  return items
}
function fileKey(file){return[file.name,file.size,file.lastModified].join('::')}function appendUniqueFiles(existing,incoming){const seen=new Set(existing.map(fileKey));for(const file of incoming){const key=fileKey(file);if(!seen.has(key)){existing.push(file);seen.add(key)}}}function selectedFiles(){return{price:[...selectedPriceFiles],derivatives:[...selectedDerivativesFiles]}}function validateFiles(files){const e=[];if(!files.length)e.push('Select at least one file in each screenshot group.');if(files.length>MAX_FILES)e.push('Maximum 20 files are allowed in one run.');files.forEach(f=>{if(!ALLOWED_TYPES.has(f.type))e.push(f.name+': unsupported file type.');if(f.size<=0||f.size>MAX_FILE_BYTES)e.push(f.name+': file must be 10 MB or smaller.')});return e}function fileNames(files){return files.length?files.map((file,index)=>'<span>'+(index+1)+'. '+escapeHtml(file.name)+'</span>').join(''):'<span class="muted">None selected</span>'}function renderFileSelection(){const f=selectedFiles(),all=[...f.price,...f.derivatives],errors=[...(f.price.length?[]:['NIFTY chart screenshot is required.']),...(f.derivatives.length?[]:['Options / OI screenshot is required.']),...validateFiles(all).filter(x=>all.length)];if(!all.length){fileSelection.className='file-selection muted';fileSelection.textContent='Select both screenshot groups to continue.';setUploadStatus('','');return}const total=all.reduce((s,x)=>s+x.size,0);fileSelection.className='file-selection';fileSelection.innerHTML=['<strong>'+f.price.length+' chart · '+f.derivatives.length+' derivatives/OI file(s)</strong>','<span>'+escapeHtml(readableBytes(total))+' total</span>','<strong>NIFTY charts</strong>',fileNames(f.price),'<strong>Options / OI</strong>',fileNames(f.derivatives),'<span class="muted">These files are staged in your browser and will be uploaded only when you tap Run 5DR. Tap Choose files again to add more screenshots one at a time.</span>'].join('');errors.length?setUploadStatus(errors[0],'error'):setUploadStatus('Ready to run 5DR.','ready')}priceFiles.addEventListener('change',()=>{appendUniqueFiles(selectedPriceFiles,Array.from(priceFiles.files||[]));priceFiles.value='';renderFileSelection()});derivativesFiles.addEventListener('change',()=>{appendUniqueFiles(selectedDerivativesFiles,Array.from(derivativesFiles.files||[]));derivativesFiles.value='';renderFileSelection()});
async function createRunRequest(batchId){const assessment={objective:decisionObjective?.value||'BOTH',risk_posture:riskPosture?.value||'CONSERVATIVE',capital_priority:capitalPriority?.value||'CAPITAL_PROTECTION'};const r=await fetch('/api/5dr/run-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({batch_id:batchId,evidence_categories:REQUIRED_USER_CATEGORIES,assessment})}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not create 5DR run request.');return d.request}
function extractStageError(data){if(data&&typeof data.error==='string'&&data.error)return data.error;if(data&&Array.isArray(data.blockers)&&data.blockers.length){const blocker=data.blockers[0]||{};if(Array.isArray(blocker.limitations)&&blocker.limitations.length)return String(blocker.limitations[0]);if(typeof blocker.reason==='string'&&blocker.reason)return blocker.reason}if(data&&data.intelligence_reconciliation&&Array.isArray(data.intelligence_reconciliation.errors)&&data.intelligence_reconciliation.errors.length)return String(data.intelligence_reconciliation.errors[0]);if(data&&data.gate&&typeof data.gate.error==='string')return data.gate.error;if(data&&typeof data.message==='string'&&data.message)return data.message;return''}
async function runStage(requestId,suffix,label){setUploadStatus(label,'working');let r;try{r=await fetch('/api/5dr/run-requests/'+encodeURIComponent(requestId)+'/'+suffix,{method:'POST',cache:'no-store'})}catch(e){throw new Error('Network/Worker request failed before an HTTP response was received'+(e&&e.message?': '+e.message:''))}const raw=await r.text().catch(()=> '');let d={};if(raw){try{d=JSON.parse(raw)}catch{}}if(!r.ok){const detail=extractStageError(d);if(detail)throw new Error(detail+' [HTTP '+r.status+']');const excerpt=raw.replace(/\s+/g,' ').trim().slice(0,300);throw new Error('5DR stage '+suffix+' returned HTTP '+r.status+(r.statusText?' '+r.statusText:'')+(excerpt?' · '+excerpt:''))}return d}
async function process5drRequest(requestId){return runStage(requestId,'resume-processing','Resuming 5DR from its persisted governed stage…')}
runForm.addEventListener('submit',async event=>{event.preventDefault();saveDecisionPrefs();const f=selectedFiles(),all=[...f.price,...f.derivatives],errors=[];if(!f.price.length)errors.push('Add at least one NIFTY chart screenshot.');if(!f.derivatives.length)errors.push('Add at least one options / OI screenshot.');errors.push(...validateFiles(all));if(errors.length){setUploadStatus(errors[0],'error');return}if(runEngine.value!=='5DR'){setUploadStatus('Mobile V1 screenshot intake is enabled for 5DR only.','error');return}const form=new FormData();form.append('engine','5DR');form.append('provenance_mode',evidenceMode.value);form.append('captured_at',new Date().toISOString());const manifest=[];f.price.forEach(file=>{form.append('files',file,file.name);manifest.push({category:'PRICE_TECHNICALS',file_name:file.name})});f.derivatives.forEach(file=>{form.append('files',file,file.name);manifest.push({category:'DERIVATIVES_OI',file_name:file.name})});form.append('evidence_manifest',JSON.stringify(manifest));uploadButton.disabled=true;uploadButton.textContent='Running 5DR…';setUploadStatus('Uploading screenshots…','working');try{const r=await fetch('/api/evidence/upload',{method:'POST',body:form}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||(Array.isArray(d.details)?d.details.join(' '):'Evidence upload failed.'));const req=await createRunRequest(d.batch_id);fileSelection.innerHTML=['<strong>Screenshot intake complete</strong>','<span>'+d.file_count+' file'+(d.file_count===1?'':'s')+' secured in private R2</span>','<span>Request: '+escapeHtml(req.request_id)+'</span>'].join('');const result=await process5drRequest(req.request_id);setUploadStatus(result.status==='PROCESSING'?'5DR is running…':'5DR is running…','success');selectedPriceFiles=[];selectedDerivativesFiles=[];priceFiles.value='';derivativesFiles.value='';dialog.close();setActiveModule('5DR');await loadDashboard()}catch(e){console.error(e);setUploadStatus(friendlyFailureMessage(e&&e.message)+' Your run is safe to retry.','error');await loadDashboard()}finally{uploadButton.disabled=false;uploadButton.textContent='Run 5DR'}});
document.addEventListener('click',event=>{const toggle=event.target.closest&&event.target.closest('[data-analysis-toggle]');if(!toggle)return;const card=toggle.closest('.simple-result'),detail=card&&card.querySelector('[data-analysis-detail]');if(!detail)return;detail.hidden=!detail.hidden;toggle.textContent=detail.hidden?'View full analysis':'Hide full analysis';});
document.addEventListener('click',async event=>{const button=event.target.closest&&event.target.closest('#resume5drRequest');if(!button)return;const requestId=button.dataset.requestId,status=document.getElementById('resume5drStatus');if(!requestId||!status)return;button.disabled=true;button.textContent='Processing…';try{status.textContent='Resuming from the last persisted governed stage…';const result=await runStage(requestId,'resume-processing','Resuming 5DR from its persisted governed stage…');status.textContent=result.status==='PROCESSING'?'Engine dispatched successfully. Refreshing…':'Pipeline advanced successfully. Refreshing…';setTimeout(()=>location.reload(),1200)}catch(error){status.textContent=friendlyFailureMessage(error&&error.message);const card=status.closest('.simple-result');if(card&&!card.querySelector('.diagnostic-details'))card.insertAdjacentHTML('beforeend',diagnosticSummary(error&&error.message,'Safe to retry'));button.disabled=false;button.textContent='Retry 5DR'}});
function pct(v){return v==null?'—':Number(v).toFixed(Number(v)%1?1:0)+'%'}
function assessmentDayCell(label,day,zone,rec){
  const d=day&&typeof day==='object'?day:{},z=zone&&typeof zone==='object'?zone:{},r=rec&&typeof rec==='object'?rec:{};
  const status=String(d.status||'').toUpperCase();
  const forecastDue=status!=='NOT DUE'&&Number(d.scorable||0)>0;
  const hits=Number(d.hits||0),scorable=Number(d.scorable||0),zoneHits=Number(z.zone_hits??d.zone_hits??0),zoneScorable=Number(z.scorable??d.scorable??0);
  const dirPct=d.hit_rate_pct!=null?Number(d.hit_rate_pct):scorable?hits/scorable*100:null;
  const zonePct=z.zone_hit_rate_pct!=null?Number(z.zone_hit_rate_pct):(d.zone_hit_rate_pct!=null?Number(d.zone_hit_rate_pct):(zoneScorable?zoneHits/zoneScorable*100:null));
  const resolved=Number(r.resolved||0),recHits=Number(r.hits||0),recMisses=Number(r.misses||0);
  const recPct=r.hit_rate_pct!=null?Number(r.hit_rate_pct):(resolved?recHits/resolved*100:null);
  const pnl=r.overall_pnl_pct!=null?Number(r.overall_pnl_pct):null,hitPnl=r.hit_pnl_pct!=null?Number(r.hit_pnl_pct):null,missPnl=r.miss_pnl_pct!=null?Number(r.miss_pnl_pct):null;
  const forecastHtml=forecastDue
    ? '<div><span>Direction</span><b>'+pct(dirPct)+'</b><small>'+hits+'/'+scorable+' correct</small></div><div><span>Zone</span><b>'+pct(zonePct)+'</b><small>'+zoneHits+'/'+zoneScorable+' hits</small></div>'
    : '<div class="scorecard-pending"><span>Forecast</span><b>Not due</b><small>Awaiting governed checkpoint</small></div>';
  const recHtml=resolved
    ? '<div><span>Recommendation hit rate</span><b>'+pct(recPct)+'</b><small>'+recHits+'/'+resolved+' hits · '+recMisses+' miss'+(recMisses===1?'':'es')+'</small></div><div><span>Gain / loss</span><b>'+pct(pnl)+'</b><small>Hits '+pct(hitPnl)+' · Misses '+pct(missPnl)+'</small></div>'
    : '<div><span>Recommendation hit rate</span><b>—</b><small>No recommendation resolved on this horizon</small></div><div><span>Gain / loss</span><b>—</b><small>No realized P/L on this horizon</small></div>';
  return '<div class="scorecard-day"><strong>'+escapeHtml(label)+'</strong>'+forecastHtml+recHtml+'</div>'
}
function renderAssessmentDetails(details){
  if(!details.length)return '<p class="assessment-empty-copy">No matured outcome records yet. The current forecast will enter this scorecard only as governed checkpoints mature.</p>';
  const latest=details.slice().sort((a,b)=>Date.parse(b.assessed_at||0)-Date.parse(a.assessed_at||0))[0]||{};
  const m=latest.metrics||{},day=m.day_wise||m.daywise||{},zone=m.zone_wise||m.zonewise||{},rec=m.day_recommendation_metrics||{};
  const labels=['D+1','D+2','D+3','D+4','D+5'];
  return [
    '<div class="scorecard-context"><span>Last assessed</span><strong>'+escapeHtml(latest.assessed_at?new Date(latest.assessed_at).toLocaleDateString():'—')+'</strong><p>'+escapeHtml(latest.outcome||'Latest cumulative assessment')+'</p><small>Recommendation hit/P&L is attributed once, to the D+n horizon on which the call first resolves. This avoids double-counting later days.</small></div>',
    '<div class="scorecard-days">'+labels.map(label=>assessmentDayCell(label,day[label],zone[label],rec[label])).join('')+'</div>'
  ].join('')
}
function renderAssessment(container,payload){
  if(!container)return;
  const summary=payload&&payload.summary?payload.summary:null,details=payload&&Array.isArray(payload.details)?payload.details:[];
  if(!summary){container.innerHTML='<div class="generic-empty">Till-date assessment is not available yet.</div>';return}
  const f=summary.forecast||{},r=summary.recommendation||{},ret=summary.returns||{},matured=Number(summary.matured_runs||0);
  container.innerHTML=[
    '<div class="assessment-header"><div><div class="eyebrow">ASSESSMENT · TILL DATE</div><h3>Performance assessment</h3></div><small>'+matured+' matured checkpoint'+(matured===1?'':'s')+'</small></div>',
    '<div class="assessment-grid">',
      '<div class="assessment-metric"><span>Forecast accuracy</span><strong>'+pct(f.accuracy_pct)+'</strong><small>'+escapeHtml(f.hits||0)+' hits / '+escapeHtml(f.total||0)+' assessed</small></div>',
      '<div class="assessment-metric"><span>Recommendation accuracy</span><strong>'+pct(r.accuracy_pct)+'</strong><small>'+escapeHtml(r.hits||0)+' hits / '+escapeHtml(r.total||0)+' assessed</small></div>',
      '<div class="assessment-metric"><span>Overall gain / loss</span><strong>'+pct(ret.absolute_return_pct)+'</strong><small>Absolute cumulative model return</small></div>',
      '<div class="assessment-metric"><span>Return on hits</span><strong>'+pct(ret.hits_return_pct)+'</strong><small>Successful calls</small></div>',
      '<div class="assessment-metric"><span>Return on misses</span><strong>'+pct(ret.misses_return_pct)+'</strong><small>Unsuccessful calls</small></div>',
    '</div>',
    '<details class="assessment-detail-row"><summary>Day-wise & zone-wise details</summary><div class="assessment-history">'+renderAssessmentDetails(details)+'</div></details>'
  ].join('')
}
async function loadAssessment(engine,container){
  try{const d=await fetch('/api/assessment-summary?engine='+encodeURIComponent(engine),{cache:'no-store'}).then(r=>r.json());renderAssessment(container,d)}catch(e){console.error(e);renderAssessment(container,null)}
}
function genericResultTitle(engine,result){if(!result)return'No published result';if(engine==='EDGE_STOCKS')return result.recommendation||result.decision||result.definitive_forecast||result.direction||'Stock result ready';return result.recommendation||result.decision||result.grade||result.ipo_grade||'IPO result ready'}
function normalizeReasons(value){if(Array.isArray(value))return value.map(v=>typeof v==='string'?v:JSON.stringify(v));if(typeof value==='string')return[value];if(value&&typeof value==='object')return Object.entries(value).map(([k,v])=>k.replaceAll('_',' ')+': '+(typeof v==='object'?JSON.stringify(v):String(v)));return[]}
function probabilityCards(result,engine){
  const p=result.probabilities||result.scenario_probabilities||{};
  if(engine==='EDGE_STOCKS'){
    const bull=p.BULL??p.bull??p.up,base=p.BASE??p.base??p.range,bear=p.BEAR??p.bear??p.down;
    if([bull,base,bear].every(v=>v==null))return'';
    return '<div class="probability-line"><span class="bull">Bull <strong>'+escapeHtml(bull??'—')+'%</strong></span><span class="range">Base <strong>'+escapeHtml(base??'—')+'%</strong></span><span class="bear">Bear <strong>'+escapeHtml(bear??'—')+'%</strong></span></div>'
  }
  const strong=p.STRONG??p.strong??p.bull,base=p.BASE??p.base,weak=p.WEAK??p.weak??p.bear;
  if([strong,base,weak].every(v=>v==null))return'';
  return '<div class="probability-line"><span class="bull">Strong <strong>'+escapeHtml(strong??'—')+'%</strong></span><span class="range">Base <strong>'+escapeHtml(base??'—')+'%</strong></span><span class="bear">Weak <strong>'+escapeHtml(weak??'—')+'%</strong></span></div>'
}
function ipoIssueCard(issue){
  const band=issue.price_band_low!=null||issue.price_band_high!=null?('₹'+(issue.price_band_low??'—')+' – ₹'+(issue.price_band_high??'—')):'Price band pending';
  const dateText=[issue.issue_open_date,issue.issue_close_date].filter(Boolean).map(x=>new Date(x).toLocaleDateString()).join(' → ');
  const blocker=issue.hard_blocker==='CRITICAL_EVIDENCE_NOT_VERIFIED'?'Critical evidence not verified':humanText(issue.hard_blocker||'');
  return '<div class="ipo-issue-card"><div class="ipo-issue-head"><strong>'+escapeHtml(issue.company_name||'—')+'</strong><span class="evidence-chip '+(issue.grade==='NV'?'limited':'verified')+'">'+escapeHtml(issue.grade||'—')+'</span></div><p>'+escapeHtml(issue.segment||'—')+(issue.exchange?' · '+escapeHtml(issue.exchange):'')+' · '+escapeHtml(band)+'</p><small>'+escapeHtml(dateText||'Dates pending')+' · '+escapeHtml(humanText(issue.decision||'NO_ACTION'))+'</small>'+(blocker?'<small class="ipo-blocker">'+escapeHtml(blocker)+'</small>':'')+'</div>'
}
function humanText(v){return String(v??'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}
function renderIpoAssessment(result){
  if(!ipoAssessmentSummary)return;
  const e=result.efficacy||{},counts=result.counts||{};
  const recs=Number(e.recommendation_count||0);
  ipoAssessmentSummary.innerHTML=[
    '<div class="assessment-header"><div><div class="eyebrow">ASSESSMENT · TILL DATE</div><h3>Performance assessment</h3></div><small>'+escapeHtml(counts.assessments??0)+' assessments</small></div>',
    '<div class="assessment-grid">',
      '<div class="assessment-metric"><span>Forecast accuracy</span><strong>—</strong><small>No matured forecast-accuracy sample in latest efficacy snapshot</small></div>',
      '<div class="assessment-metric"><span>Recommendation accuracy</span><strong>'+pct(e.positive_hit_rate==null?null:Number(e.positive_hit_rate)*100)+'</strong><small>'+recs+' recommendations in efficacy sample</small></div>',
      '<div class="assessment-metric"><span>Overall gain / loss</span><strong>'+pct(e.avg_recommended_gain==null?null:Number(e.avg_recommended_gain)*100)+'</strong><small>Average recommended gain where available</small></div>',
      '<div class="assessment-metric"><span>Correct avoidance</span><strong>'+pct(e.correct_avoidance_rate==null?null:Number(e.correct_avoidance_rate)*100)+'</strong><small>Rejected/avoided issues correctly filtered</small></div>',
      '<div class="assessment-metric"><span>Opportunity capture</span><strong>'+pct(e.opportunity_capture_rate==null?null:Number(e.opportunity_capture_rate)*100)+'</strong><small>Latest governed efficacy snapshot</small></div>',
    '</div>',
    '<details class="assessment-detail-row"><summary>Assessment details</summary><div class="scorecard-context"><span>Coverage</span><strong>'+escapeHtml(counts.ipos??0)+' IPOs · '+escapeHtml(counts.listing_outcomes??0)+' listing outcomes</strong><p>'+escapeHtml(counts.checkpoints??0)+' checkpoints · '+escapeHtml(counts.evidence??0)+' evidence records · '+escapeHtml(counts.runs??0)+' autonomous runs.</p></div></details>'
  ].join('')
}
function renderIpoSnapshot(target,runsData){
  const list=Array.isArray(runsData)?runsData:[],latest=list[0]||null;
  if(!target)return;
  if(!latest){target.innerHTML='<div class="generic-empty">No IPO EDGE snapshot is available.</div>';return}
  const r=latest.result||{},issues=Array.isArray(r.current_issues)?r.current_issues:[],ready=issues.filter(x=>x&&x.grade&&x.grade!=='NV'),nv=issues.filter(x=>x&&x.grade==='NV'),focus=issues[0]||null,validated=r.latest_validated||null;
  renderIpoAssessment(r);
  const headline=ready.length?ready.length+' current issue'+(ready.length===1?' is':'s are')+' decision-ready':'No current IPO is decision-ready';
  const why=[
    '<div class="why-card"><strong>Current coverage</strong><p><b>What we saw:</b> '+escapeHtml(issues.length)+' open/upcoming issues are in the current snapshot; '+escapeHtml(nv.length)+' are NV because critical evidence is not yet verified.</p><p><b>What it means:</b> NV is an evidence state, not a negative investment score. The system is refusing to grade issues that do not yet meet the evidence gates.</p></div>',
    '<div class="why-card"><strong>Decision quality</strong><p><b>What we saw:</b> '+escapeHtml(ready.length)+' current issues have a validated non-NV grade.</p><p><b>What it means:</b> The Console should show “wait/no action” rather than manufacture an apply/reject call when R2/R3/R4/R6/R7 evidence is incomplete.</p></div>',
    validated?'<div class="why-card"><strong>Latest validated checkpoint</strong><p><b>What we saw:</b> '+escapeHtml(validated.company_name)+' scored '+escapeHtml(validated.score)+' with grade '+escapeHtml(validated.grade)+' and decision '+escapeHtml(humanText(validated.decision))+'.</p><p><b>What it means:</b> The IPO engine is capable of producing a governed grade once the evidence gates are complete; current NVs are a data-readiness issue, not an empty engine.</p></div>':''
  ].join('');
  target.innerHTML=[
    '<article class="simple-result ipo-standard-result">',
      '<div class="result-kicker">CURRENT IPO VIEW</div>',
      '<h2>'+escapeHtml(headline)+'</h2>',
      '<p class="result-copy">'+escapeHtml(issues.length)+' current issues monitored · '+escapeHtml(nv.length)+' awaiting critical evidence verification.</p>',
      '<div class="decision-grid"><div class="decision-card"><span>Decision status</span><strong>'+(ready.length?'Review graded issues':'Wait')+'</strong><small>Do not act on NV issues</small></div><div class="decision-card"><span>Framework</span><strong>V'+escapeHtml(r.framework_version||latest.framework_version||'1.1')+'</strong><small>IPO EDGE governed snapshot</small></div></div>',
      '<div class="action-box"><span>Suggested action</span><strong>'+(ready.length?'Review the graded current issues below.':'Wait for critical evidence to be verified before any apply/reject decision.')+'</strong></div>',
      '<details class="why-details" open><summary>Why this view?</summary><div class="why-grid">'+why+'</div></details>',
      '<details class="change-details" open><summary>What could change the view?</summary><ul><li>Critical R2/R3/R4/R6/R7 evidence must move from unresolved to verified.</li><li>Subscription/QIB/NII/retail demand and GMP should be incorporated when available and governed.</li><li>The final-day checkpoint can upgrade, retain or reject the issue once evidence coverage is sufficient.</li><li>A hard blocker keeps the issue at NV/No Action regardless of superficial market enthusiasm.</li></ul></details>',
      '<details class="active-details" open><summary>Current IPO queue</summary><div class="ipo-issue-grid">'+(issues.length?issues.map(ipoIssueCard).join(''):'<p class="muted">No current issues.</p>')+'</div></details>',
      '<details class="tech-details"><summary>Advanced details</summary><div class="tech-body"><div><span>IPOs tracked</span><strong>'+escapeHtml(r.counts?.ipos??'—')+'</strong></div><div><span>Evidence records</span><strong>'+escapeHtml(r.counts?.evidence??'—')+'</strong></div><div><span>Assessments</span><strong>'+escapeHtml(r.counts?.assessments??'—')+'</strong></div><div><span>Checkpoints</span><strong>'+escapeHtml(r.counts?.checkpoints??'—')+'</strong></div><div><span>Listing outcomes</span><strong>'+escapeHtml(r.counts?.listing_outcomes??'—')+'</strong></div><div><span>Snapshot</span><strong>'+escapeHtml(latest.run_id)+'</strong></div></div></details>',
    '</article>'
  ].join('')
}
function renderGenericModule(engine,target,runsData){
  const list=Array.isArray(runsData)?runsData:[],latest=list[0]||null;
  if(!target)return;
  const label=engine==='EDGE_STOCKS'?'EDGE STOCKS':'EDGE IPO';
  if(!latest){target.innerHTML='<div class="generic-empty">No published '+(engine==='EDGE_STOCKS'?'EDGE Stocks':'EDGE IPO')+' result yet.</div>';return}
  const result=latest.result||{},title=genericResultTitle(engine,result);
  const confidence=result.confidence??result.market_trust??result.trust??null;
  const actionable=result.tradeable===true||result.actionable===true||/apply|buy|trade/i.test(String(result.recommendation||result.decision||''));
  const action=result.suggested_action||result.action||result.recommendation||result.decision||'Review the published assessment.';
  const why=normalizeReasons(result.why||result.reasons||result.key_drivers||result.rationale||result.decision_reasons);
  const changes=normalizeReasons(result.what_could_change||result.change_conditions||result.invalidation||result.key_risks||result.risks);
  const primaryZone=result.expected_price_zone||result.price_zone||result.expected_zone||result.listing_range||result.expected_listing_zone||null;
  const secondary=engine==='EDGE_STOCKS'?(result.des??result.des5??result.directional_agreement??null):(result.grade??result.ipo_grade??result.issue_quality??null);
  target.innerHTML=[
    '<article class="simple-result generic-standard-result">',
      '<div class="result-kicker">'+label+'</div>',
      '<h2>'+escapeHtml(title)+'</h2>',
      probabilityCards(result,engine),
      '<div class="decision-grid">',
        '<div class="decision-card"><span>Confidence</span><strong>'+escapeHtml(confidence==null?'—':confidence)+'</strong><small>'+(confidence==null?'Not provided in this run':'Published confidence')+'</small></div>',
        '<div class="decision-card"><span>'+(engine==='EDGE_STOCKS'?'Can I act on this?':'Decision status')+'</span><strong>'+(actionable?'Actionable':'Review')+'</strong><small>'+escapeHtml(primaryZone?('Key zone: '+(typeof primaryZone==='object'?JSON.stringify(primaryZone):primaryZone)):'See analysis below')+'</small></div>',
      '</div>',
      '<div class="action-box"><span>Suggested action</span><strong>'+escapeHtml(action)+'</strong></div>',
      '<button class="analysis-toggle ghost" type="button" data-analysis-toggle>View full analysis</button>',
      '<div class="analysis-detail" data-analysis-detail hidden>',
        '<details class="why-details" open><summary>Why this view?</summary><div class="why-grid">',
          (why.length?why.slice(0,6).map((x,i)=>'<div class="why-card"><strong>'+(engine==='EDGE_STOCKS'?'Decision factor ':'IPO factor ')+(i+1)+'</strong><p>'+escapeHtml(x)+'</p></div>').join(''):'<div class="why-card"><strong>Published evidence</strong><p>The current result does not yet expose structured user-facing reasoning fields. The Console will show them here when the engine publishes them.</p></div>'),
        '</div></details>',
        '<details class="change-details"><summary>What could change the view?</summary><ul>',
          (changes.length?changes.slice(0,8).map(x=>'<li>'+escapeHtml(x)+'</li>').join(''):'<li>No structured change conditions were published with this run.</li>'),
        '</ul></details>',
        '<details class="tech-details"><summary>Advanced details</summary><div class="tech-body">',
          (primaryZone!=null?'<div><span>Key zone</span><strong>'+escapeHtml(typeof primaryZone==='object'?JSON.stringify(primaryZone):primaryZone)+'</strong></div>':''),
          (secondary!=null?'<div><span>'+(engine==='EDGE_STOCKS'?'Directional metric':'Grade / quality')+'</span><strong>'+escapeHtml(typeof secondary==='object'?JSON.stringify(secondary):secondary)+'</strong></div>':''),
          '<div><span>Run ID</span><strong>'+escapeHtml(latest.run_id)+'</strong></div>',
          '<div><span>Framework</span><strong>'+escapeHtml(latest.framework_version||'—')+'</strong></div>',
          '<div><span>Source mode</span><strong>'+escapeHtml(latest.provenance_mode||'—')+'</strong></div>',
        '</div></details>',
      '</div>',
    '</article>'
  ].join('')
}
async function loadRecentResults(module){
  if(!runs||!runsNote)return;
  try{const d=await fetch('/api/runs/latest?engine='+encodeURIComponent(module),{cache:'no-store'}).then(r=>r.json()),list=Array.isArray(d.runs)?d.runs:[];if(!list.length){runs.innerHTML='<div class="generic-empty">No published results for this module yet.</div>';runsNote.textContent='0 recent';return}runs.innerHTML=list.slice(0,8).map(r=>'<article class="run history-row"><strong>'+escapeHtml(module==='5DR'?'5DR result':module==='EDGE_STOCKS'?'EDGE Stocks result':'EDGE IPO result')+'</strong><span class="muted">'+escapeHtml(new Date(r.generated_at).toLocaleString())+'</span></article>').join('');runsNote.textContent=list.length+' recent'}catch(e){console.error(e);runs.innerHTML='<div class="generic-empty">Unable to load recent results.</div>';runsNote.textContent='Unavailable'}
}
function render5dr(run,request,outcomeAssessment){
  if(!run){
    const meta=request&&request.metadata?request.metadata:{},stage=meta.adapter_stage||'—',status=request?request.status:'READY';
    fiveDrState.textContent=request?stageLabel(stage,status):'Ready';
    const progress=stageLabel(stage,status);
    const resume=request&&((['READY_FOR_ENGINE','FAILED'].includes(status)&&['SCREENSHOTS_READY','AUTONOMOUS_EVIDENCE_BLOCKED','AUTONOMOUS_EVIDENCE_READY','INTELLIGENCE_BLOCKED','INTELLIGENCE_READY','NORMALIZATION_BLOCKED','NORMALIZED_READY'].includes(stage))||(status==='PROCESSING'&&stage==='NORMALIZED_READY'))?
      '<div class="simple-action"><button id="resume5drRequest" class="primary" type="button" data-request-id="'+escapeHtml(request.request_id)+'">'+(status==='PROCESSING'?'Check result':status==='FAILED'?'Retry 5DR':'Continue 5DR')+'</button><p id="resume5drStatus" class="muted">'+(status==='PROCESSING'?'5DR is running. Check again for the completed result.':'Continue from where the run stopped. Your screenshots are already saved.')+'</p></div>':'';
    const technical=request?'<details class="tech-details"><summary>Advanced details</summary><div class="tech-body"><div><span>Request</span><strong>'+escapeHtml(request.request_id)+'</strong></div><div><span>Internal stage</span><strong>'+escapeHtml(stage)+'</strong></div><div><span>Status</span><strong>'+escapeHtml(status)+'</strong></div><div><span>Evidence files</span><strong>'+escapeHtml(meta.evidence_file_count||'—')+'</strong></div></div></details>':'';
    const rawError=request&&request.error?JSON.stringify(request.error):'';const setup=meta.decision_setup?friendlySetup(meta.decision_setup):null;const setupHtml=setup?'<div class="assessment-card"><div><span>Run assessment</span><strong>Recorded</strong></div><p>'+escapeHtml(setup.objective)+' · '+escapeHtml(setup.risk)+' · '+escapeHtml(setup.priority)+' · '+escapeHtml(setup.horizon)+'</p></div>':'';fiveDrSummary.innerHTML='<article class="simple-result pending-result"><div class="result-kicker">Current 5DR run</div><h2>'+escapeHtml(progress)+'</h2><p class="result-copy">'+(status==='FAILED'?escapeHtml(friendlyFailureMessage(rawError)):'Your current run is still being processed. No previous result is being presented as the current answer.')+'</p>'+setupHtml+resume+(status==='FAILED'?diagnosticSummary(rawError,'Stopped safely'):'')+technical+'</article>';
    return;
  }
  const result=run.result||{},prob=result.probabilities||{},blockers=Array.isArray(result.tradeability_blockers)?result.tradeability_blockers:[],direction=friendlyDirection(result.directional_label),confidence=confidenceLabel(result.market_trust),tradeable=result.tradeable===true;
  const meta=request&&request.metadata?request.metadata:{},handoff=meta.intelligence_handoff||{},normalized=handoff.normalized||{},components=normalized.component_scores||{},trust=normalized.market_trust_inputs||{},execution=normalized.execution_inputs||{},limits=(meta.intelligence_reconciliation&&Array.isArray(meta.intelligence_reconciliation.limitations))?meta.intelligence_reconciliation.limitations:[];
  fiveDrState.textContent='Result ready';
  const action=tradeable?'A trade setup currently meets the 5DR gates. Review the setup before acting.':'Wait for a stronger setup before taking a trade.';
  const why=governedWhy(meta,normalized,result);
  const changes=userChangeConditions(why,normalized,result);
  const blockersPlain=blockers.map(blockerText);
  fiveDrSummary.innerHTML=[
    '<article class="simple-result direction-'+escapeHtml(String(result.directional_label||'RANGE').toLowerCase())+'">',
      '<div class="result-kicker">Today’s Market View</div>',
      '<h2>'+escapeHtml(direction)+'</h2>',
      '<div class="probability-line"><span class="bull">Up <strong>'+escapeHtml(prob.BULL??'—')+'%</strong></span><span class="range">Sideways <strong>'+escapeHtml(prob.RANGE??'—')+'%</strong></span><span class="bear">Down <strong>'+escapeHtml(prob.BEAR??'—')+'%</strong></span></div>',
      '<div class="decision-grid">',
        '<div class="decision-card"><span>Confidence</span><strong>'+escapeHtml(confidence)+'</strong><small>'+escapeHtml(result.market_trust??'—')+'/100</small></div>',
        '<div class="decision-card"><span>Can I trade this?</span><strong>'+(tradeable?'Yes':'No trade')+'</strong><small>'+(tradeable?'Current gates passed':'Current gates are not met')+'</small></div>',
      '</div>',
      '<div class="action-box"><span>Suggested action</span><strong>'+escapeHtml(action)+'</strong></div>',
      '<div class="assessment-card"><div><span>Run assessment</span><strong>'+(meta.decision_setup?'Recorded':'Legacy run')+'</strong></div><p>'+(meta.decision_setup?(escapeHtml(friendlySetup(meta.decision_setup).objective)+' · '+escapeHtml(friendlySetup(meta.decision_setup).risk)+' · '+escapeHtml(friendlySetup(meta.decision_setup).priority)+' · '+escapeHtml(friendlySetup(meta.decision_setup).horizon)):'This result was created before run-assessment capture was enabled. New runs record the decision setup before analysis.')+'</p></div>',
      '<button class="analysis-toggle ghost" type="button" data-analysis-toggle>View full analysis</button>',
      '<div class="analysis-detail" data-analysis-detail hidden>',
      '<details class="why-details" open><summary>Why this view?</summary>',
        '<div class="why-grid">',
          '<div class="why-card"><strong>Price & structure</strong><p><b>What we saw:</b> '+escapeHtml(why.price.observed)+'</p><p><b>What it means:</b> '+escapeHtml(why.price.meaning)+'</p><small>'+escapeHtml(why.price.impact)+'</small></div>',
          '<div class="why-card"><strong>Options & positioning</strong><p><b>What we saw:</b> '+escapeHtml(why.options.observed)+'</p><p><b>What it means:</b> '+escapeHtml(why.options.meaning)+'</p><small>'+escapeHtml(why.options.impact)+'</small></div>',
          '<div class="why-card"><strong>Market participation</strong><p><b>What we saw:</b> '+escapeHtml(why.market.observed)+'</p><p><b>What it means:</b> '+escapeHtml(why.market.meaning)+'</p><small>'+escapeHtml(why.market.impact)+'</small></div>',
          '<div class="why-card"><strong>Macro & events</strong><p><b>What we saw:</b> '+escapeHtml(why.macro.observed)+'</p><p><b>What it means:</b> '+escapeHtml(why.macro.meaning)+'</p><small>'+escapeHtml(why.macro.impact)+'</small></div>',
          '<div class="why-card"><strong>Trade quality</strong><p><b>What we saw:</b> '+escapeHtml(why.trade.observed)+'</p><p><b>What it means:</b> '+escapeHtml(why.trade.meaning)+'</p><small>'+escapeHtml(why.trade.impact)+'</small></div>',
        '</div>',
        (blockersPlain.length?'<div class="plain-blockers"><strong>Main reasons for no trade</strong><ul>'+blockersPlain.slice(0,5).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul></div>':''),
      '</details>',
      '<details class="change-details"><summary>What could change the view?</summary><p class="change-intro">These are the market developments that would actually make the current assessment stronger, weaker or tradeable:</p><ul>'+changes.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul></details>',
      '<details class="assessment-future"><summary>Future performance scorecard</summary><p>'+(outcomeAssessment?('Outcome: '+escapeHtml(outcomeAssessment.outcome||'Assessed')+' · Horizon '+escapeHtml(outcomeAssessment.assessment_horizon||'—')+(outcomeAssessment.score!=null?' · Score '+escapeHtml(outcomeAssessment.score):'')):'Not due yet. This forecast will be scored after its D+1 to D+5 outcomes are available. That scorecard measures forecast/recommendation performance; it is separate from the run assessment above.')+'</p></details>',
      '<details class="tech-details"><summary>Advanced details</summary><div class="tech-body">',
        '<div><span>DES5</span><strong>'+escapeHtml(result.des5??'—')+'</strong></div>',
        '<div><span>Market Trust</span><strong>'+escapeHtml(result.market_trust??'—')+' · '+escapeHtml(result.market_trust_band||'—')+'</strong></div>',
        '<div><span>Execution Edge</span><strong>'+escapeHtml(result.execution_edge??'—')+'</strong></div>',
        '<div><span>Framework</span><strong>'+escapeHtml(run.framework_version)+'</strong></div>',
        '<div><span>Run ID</span><strong>'+escapeHtml(run.run_id)+'</strong></div>',
        '<div><span>Source mode</span><strong>'+escapeHtml(run.provenance_mode)+'</strong></div>',
        (blockers.length?'<div class="full"><span>System reason codes</span><strong>'+blockers.map(escapeHtml).join(' · ')+'</strong></div>':''),
      '</div></details>',
      '</div>',
    '</article>'
  ].join('');
}
async function loadDashboard(){
  try{
    const h=await fetch('/api/health',{cache:'no-store'}).then(r=>r.json());health.textContent=h.ok?'System online':'Degraded';
    const ed=await fetch('/api/engines',{cache:'no-store'}).then(r=>r.json()).catch(()=>({engines:[]}));
    (ed.engines||[]).forEach(e=>{const tile=moduleTiles.find(t=>t.dataset.module===e.id);const status=tile&&tile.querySelector('.module-status');if(status)status.textContent=friendlyEngineStatus(e.status)});
    await loadAssessment('5DR',assessmentSummary);

    let f=await fetch('/api/5dr/latest',{cache:'no-store'}).then(r=>r.json());
    let latestReq=await fetch('/api/5dr/run-requests/latest',{cache:'no-store'}).then(r=>r.json()).then(d=>d.request||null).catch(()=>null);
    let active=latestReq&&latestReq.status!=='COMPLETED'&&(!f.run||latestReq.run_id!==f.run.run_id);
    if(active&&latestReq.status==='PROCESSING'){
      try{
        const rr=await fetch('/api/5dr/run-requests/'+encodeURIComponent(latestReq.request_id)+'/resume-processing',{method:'POST',cache:'no-store'}),rd=await rr.json();
        if(rd&&rd.status==='COMPLETED'){f=await fetch('/api/5dr/latest',{cache:'no-store'}).then(r=>r.json());latestReq=await fetch('/api/5dr/run-requests/latest',{cache:'no-store'}).then(r=>r.json()).then(d=>d.request||null).catch(()=>null);active=false}
        else if(rd&&rd.status==='FAILED'){latestReq=await fetch('/api/5dr/run-requests/latest',{cache:'no-store'}).then(r=>r.json()).then(d=>d.request||latestReq).catch(()=>latestReq)}
      }catch(e){console.error('5DR result sync failed',e)}
    }
    let matchedRequest=null,oa=null;
    if(active)render5dr(null,latestReq,null);
    else if(f.run&&f.run.run_id){
      matchedRequest=await fetch('/api/5dr/run-request?run_id='+encodeURIComponent(f.run.run_id),{cache:'no-store'}).then(r=>r.json()).then(d=>d.request||null).catch(()=>null);
      oa=await fetch('/api/5dr/outcome-assessment?run_id='+encodeURIComponent(f.run.run_id),{cache:'no-store'}).then(r=>r.json()).then(d=>d.assessment||null).catch(()=>null);
      render5dr(f.run,matchedRequest,oa)
    }else render5dr(null,latestReq,null);

    const ipoRuns=await fetch('/api/runs/latest?engine=EDGE_IPO',{cache:'no-store'}).then(r=>r.json()).then(d=>d.runs||[]).catch(()=>[]);
    renderIpoSnapshot(ipoSummary,ipoRuns);
    await loadRecentResults(activeModule);
  }catch(e){
    console.error(e);health.textContent='Offline';fiveDrState.textContent='ERROR';fiveDrSummary.innerHTML='<div class="generic-empty">Unable to load 5DR integration status.</div>';renderIpoSnapshot(ipoSummary,[]);runs.innerHTML='<div class="generic-empty">Unable to load recent results.</div>';runsNote.textContent='Unavailable'
  }
}
setActiveModule('5DR');
loadDashboard();

// Canonical EDGE Stocks prompt-driven command surface retained from production main.
const edgeCommandForm=document.getElementById('edgeCommandForm'),edgeCommandInput=document.getElementById('edgeCommandInput'),edgeCommandButton=document.getElementById('edgeCommandButton'),edgeCommandStatus=document.getElementById('edgeCommandStatus');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function pollEdgeInvocation(nextUrl){
  for(let i=0;i<24;i++){
    const r=await fetch(nextUrl,{cache:'no-store'}),d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Could not check EDGE invocation status.');
    if(d.status==='COMPLETE')return d;
    edgeCommandStatus.className='upload-status working';
    edgeCommandStatus.textContent='Governed EDGE run dispatched · waiting for a newly published V1.2 recommendation…';
    await sleep(5000);
  }
  return null;
}
if(edgeCommandForm){
  edgeCommandForm.addEventListener('submit',async event=>{
    event.preventDefault();
    const command=String(edgeCommandInput.value||'').trim();
    edgeCommandButton.disabled=true;
    edgeCommandButton.textContent='Dispatching…';
    edgeCommandStatus.className='upload-status working';
    edgeCommandStatus.textContent='Dispatching to the governed EDGE autonomous publisher…';
    try{
      const r=await fetch('/api/edge-stocks/invoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.detail?((d.error||'EDGE dispatch failed')+' · '+d.detail):(d.error||'EDGE dispatch failed'));
      if(d.ticker)localStorage.setItem('edge-console-selected-stock',d.ticker);if(d.status==='ALREADY_PUBLISHED_TODAY'){
        edgeCommandStatus.className='upload-status success';
        edgeCommandStatus.textContent='Today’s governed EDGE '+d.ticker+' result already exists · '+d.run_id+' · loading canonical V1.2 result…';
        window.refreshEdgeLive?window.refreshEdgeLive():window.location.reload();
        return;
      }
      edgeCommandStatus.textContent='Dispatched '+d.ticker+' · monitoring for governed publication…';
      const completed=await pollEdgeInvocation(d.next);
      if(completed){
        edgeCommandStatus.className='upload-status success';
        edgeCommandStatus.textContent='EDGE '+completed.ticker+' complete · '+completed.run_id+' · loading canonical V1.2 result…';
        window.location.reload();
      }else{
        edgeCommandStatus.className='upload-status ready';
        edgeCommandStatus.textContent='Dispatch accepted, but no newer governed recommendation has published yet. The runner may have failed closed; check again after the governed run window.';
      }
    }catch(e){
      console.error(e);
      edgeCommandStatus.className='upload-status error';
      edgeCommandStatus.textContent=e.message||'EDGE command failed.';
    }finally{
      edgeCommandButton.disabled=false;
      edgeCommandButton.textContent='Run EDGE';
    }
  });
}
