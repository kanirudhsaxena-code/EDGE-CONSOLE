const health=document.getElementById('health'),runs=document.getElementById('runs'),runsNote=document.getElementById('runsNote'),dialog=document.getElementById('runDialog'),fiveDrState=document.getElementById('fiveDrState'),fiveDrSummary=document.getElementById('fiveDrSummary'),runForm=document.getElementById('runForm'),runEngine=document.getElementById('runEngine'),evidenceMode=document.getElementById('evidenceMode'),decisionObjective=document.getElementById('decisionObjective'),riskPosture=document.getElementById('riskPosture'),capitalPriority=document.getElementById('capitalPriority'),priceFiles=document.getElementById('priceEvidenceFiles'),derivativesFiles=document.getElementById('derivativesEvidenceFiles'),fileSelection=document.getElementById('fileSelection'),uploadStatus=document.getElementById('uploadStatus'),uploadButton=document.getElementById('uploadEvidenceButton'),assessmentSummary=document.getElementById('assessmentSummary'),stocksAssessmentSummary=document.getElementById('stocksAssessmentSummary'),ipoAssessmentSummary=document.getElementById('ipoAssessmentSummary'),stocksSummary=document.getElementById('stocksSummary'),ipoSummary=document.getElementById('ipoSummary'),selectedModuleEyebrow=document.getElementById('selectedModuleEyebrow'),selectedModuleTitle=document.getElementById('selectedModuleTitle');
const MAX_FILES=20,MAX_FILE_BYTES=10*1024*1024,ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp','application/pdf']),REQUIRED_USER_CATEGORIES=['PRICE_TECHNICALS','DERIVATIVES_OI'];
let selectedPriceFiles=[],selectedDerivativesFiles=[],activeModule='5DR';
const MODULE_CONFIG={'5DR':{title:'Latest market view',action:'Run EDGE NIFTY'},EDGE_STOCKS:{title:'Latest stock decision',action:null},EDGE_IPO:{title:'Latest IPO decision',action:null}};
const moduleTiles=Array.from(document.querySelectorAll('.module-tile')),modulePanels={'5DR':document.getElementById('fiveDrPanel'),EDGE_STOCKS:document.getElementById('edgeStocksPanel'),EDGE_IPO:document.getElementById('edgeIpoPanel')};
function setActiveModule(module){if(!MODULE_CONFIG[module])return;activeModule=module;moduleTiles.forEach(t=>t.classList.toggle('active',t.dataset.module===module));Object.entries(modulePanels).forEach(([key,panel])=>{if(panel){panel.hidden=key!==module;panel.classList.toggle('active',key===module)}});selectedModuleEyebrow.textContent=module==='EDGE_STOCKS'?'EDGE STOCKS':module==='EDGE_IPO'?'EDGE IPO':'EDGE NIFTY';selectedModuleTitle.textContent=MODULE_CONFIG[module].title;const runButton=document.getElementById('runButton');if(runButton){runButton.hidden=module!=='5DR';runButton.textContent='Run EDGE NIFTY'};loadRecentResults(module)}
moduleTiles.forEach(tile=>tile.addEventListener('click',()=>setActiveModule(tile.dataset.module)));
document.getElementById('runButton')?.addEventListener('click',()=>dialog.showModal());
document.getElementById('closeRunDialog')?.addEventListener('click',()=>dialog.close());
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}function readableBytes(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB'}function setUploadStatus(m,s){uploadStatus.className='upload-status'+(s?' '+s:'');uploadStatus.textContent=m||''}
function friendlyEngineStatus(status){const map={EVIDENCE_GATE_READY:'Ready',ACTIVE:'Ready',FOUNDATION:'Setup in progress',INTEGRATION_PENDING:'Setup in progress',READY:'Ready'};return map[String(status)]||String(status||'Status unavailable').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase())}
function friendlyDirection(value){const map={BULL:'Bullish',BEAR:'Bearish',RANGE:'Range-bound'};return map[String(value)]||String(value||'—')}
function confidenceLabel(value){const n=Number(value);if(!Number.isFinite(n))return'Unavailable';if(n>=75)return'High';if(n>=50)return'Moderate';return'Low'}
function runDateTime(value){if(!value)return'—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}
function directionStrengthSummary(value){
  const n=Number(value);if(!Number.isFinite(n))return{value:'Unavailable',detail:'Directional evidence could not be measured.'};
  const a=Math.abs(n),strength=a>=60?'Strong':a>=30?'Moderate':'Weak',lean=n>0?'bullish':n<0?'bearish':'neutral';
  return{value:strength+' · '+n.toFixed(1),detail:'How strongly the evidence leans '+lean+'. Scores below 30 are not strong enough for the direction gate.'}
}
function tradeSetupStrengthSummary(value){
  const n=Number(value);if(!Number.isFinite(n))return{value:'Unavailable',detail:'Trade setup quality could not be measured.'};
  const label=n>=80?'Strong':n>=65?'Trade-ready':n>=45?'Moderate':'Weak';
  return{value:label+' · '+n.toFixed(0)+'/100',detail:'How usable the entry, stop, target and reward/risk setup is. 65/100 is the current execution gate.'}
}
function blockerText(code){const map={DATA_INADEQUATE:'Not enough reliable evidence',MARKET_TRUST_LT_50:'Market confidence is too low',DES5_LT_30:'Directional strength is too weak',EXECUTION_EDGE_LT_65:'Trade setup quality is too weak',RR_LT_2:'Potential reward is not high enough for the risk',EVENT_KILL_SWITCH:'A major event-risk safeguard is active'};return map[String(code)]||String(code||'').replaceAll('_',' ').toLowerCase()}
function friendlyFailureMessage(raw){
  const text=String(raw||'').toLowerCase();
  if(/timeout|timed out/.test(text))return'Analysis took too long to complete. Your uploaded evidence is saved, so you can safely retry.';
  if(/network|fetch/.test(text))return'The connection was interrupted. Your uploaded evidence is saved, so you can safely retry.';
  if(/missing cited evidence|data inadequate|not enough|missing.*evidence/.test(text))return'EDGE NIFTY could not verify enough reliable evidence to complete the analysis.';
  if(/conflict|reconciliation/.test(text))return'The available evidence did not agree strongly enough for EDGE NIFTY to complete safely.';
  if(/vision|image|screenshot/.test(text))return'One or more screenshots could not be interpreted reliably.';
  if(/source_refs|evidence reference|provenance/.test(text))return'EDGE NIFTY could not validate the evidence references for this run. Your screenshots are saved; retry is safe.';
  if(/evidence_conflict|conflicts with official nse|market level/.test(text))return'The uploaded screenshots do not match the current official NIFTY market level, so this run was stopped rather than producing a misleading result.';
  if(/research|market status|source/.test(text))return'EDGE NIFTY could not verify one or more required market sources.';
  if(/workflow|dispatch|engine/.test(text))return'The EDGE NIFTY engine did not complete normally.';
  return'The run stopped safely before producing a result.';
}
function diagnosticSummary(raw,status){
  const clean=String(raw||'').replace(/\s+/g,' ').trim();
  return '<details class="diagnostic-details"><summary>System details</summary><div class="diagnostic-body"><p><strong>Status:</strong> '+escapeHtml(status||'Stopped')+'</p><p>'+escapeHtml(clean||'No technical diagnostic was recorded.')+'</p></div></details>'
}
function stageLabel(stage,status){if(status==='COMPLETED')return'Result ready';const map={AUTOMATED_MARKET_DATA_PENDING:'Fetching automated market data',AUTOMATED_MARKET_DATA_READY:'Checking market conditions',AUTOMATED_MARKET_DATA_BLOCKED:'Automated data unavailable · screenshot backup available',EVIDENCE_READY:'Screenshots received',SCREENSHOTS_READY:'Reading screenshot backup',VISION_READY:'Reading screenshot backup',RESEARCH_RETRIEVED:'Checking market conditions',AUTONOMOUS_EVIDENCE_READY:'Checking market conditions',INTELLIGENCE_READY:'Combining evidence',NORMALIZED_READY:'Running EDGE NIFTY',PROCESSING:'Running EDGE NIFTY',PUBLICATION_SYNC_PENDING:'Publishing fresh result'};return map[String(stage)]||'Preparing analysis'}
const DECISION_PREFS_KEY='edge-console-5dr-decision-setup-v1';
const ACTIVE_NIFTY_REQUEST_KEY='edge-console-active-nifty-request-v1';
function rememberActiveNiftyRequest(requestId){try{if(requestId)localStorage.setItem(ACTIVE_NIFTY_REQUEST_KEY,String(requestId))}catch{}}
function clearActiveNiftyRequest(){try{localStorage.removeItem(ACTIVE_NIFTY_REQUEST_KEY)}catch{}}
function activeNiftyRequestId(){try{return localStorage.getItem(ACTIVE_NIFTY_REQUEST_KEY)||''}catch{return''}}
async function fetchExactNiftyRequest(requestId){
  if(!requestId)return null;
  const response=await fetch('/api/5dr/run-requests/'+encodeURIComponent(requestId),{cache:'no-store'});
  if(response.status===404){clearActiveNiftyRequest();return null}
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Could not load the current EDGE NIFTY run.');
  return body
}
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
  let breadth=null,sectorMoves=[],vix=null,repoRate=null,crude=null,usdInr=null,giftNifty=null,fed=null,rbiReference=null;
  for(const snap of research){
    if(!snap)continue;
    if(snap.source_id==='NSE_ALL_INDICES'){
      const facts=snap.facts&&typeof snap.facts==='object'?snap.facts:null;
      if(facts&&facts.nifty50){
        const n=facts.nifty50;breadth={change:Number(n.percent_change),advances:Number(n.advances),declines:Number(n.declines),month:Number(n.change_30d),year:Number(n.change_365d)};
        const pairs=[['Bank',facts.nifty_bank],['Financials',facts.nifty_financial_services],['IT',facts.nifty_it],['Auto',facts.nifty_auto],['Midcap',facts.nifty_midcap_100],['Smallcap',facts.nifty_smallcap_100]];
        sectorMoves=pairs.filter(([,x])=>x&&Number.isFinite(Number(x.percent_change))).map(([name,x])=>({name,change:Number(x.percent_change)}));
        if(facts.india_vix&&Number.isFinite(Number(facts.india_vix.percent_change)))vix={last:Number(facts.india_vix.last),change:Number(facts.india_vix.percent_change)};
      }else if(typeof snap.excerpt==='string'){
        try{const data=JSON.parse(snap.excerpt),rows=Array.isArray(data.data)?data.data:[],pick=name=>rows.find(x=>x&&x.index===name),n=pick('NIFTY 50');if(n){breadth={change:Number(n.percentChange),advances:Number(n.advances),declines:Number(n.declines),month:Number(n.perChange30d),year:Number(n.perChange365d)};const pairs=[['Bank',pick('NIFTY BANK')],['Financials',pick('NIFTY FINANCIAL SERVICES')],['IT',pick('NIFTY IT')],['Auto',pick('NIFTY AUTO')],['Midcap',pick('NIFTY MIDCAP 100')],['Smallcap',pick('NIFTY SMALLCAP 100')]];sectorMoves=pairs.filter(([,x])=>x&&Number.isFinite(Number(x.percentChange))).map(([name,x])=>({name,change:Number(x.percentChange)}));const iv=pick('INDIA VIX');if(iv)vix={last:Number(iv.last),change:Number(iv.percentChange)}}}catch{}
      }
    }
    if(snap.source_id==='NSE_MARKET_STATUS'){
      if(snap.facts&&snap.facts.usdinr_futures&&Number.isFinite(Number(snap.facts.usdinr_futures.last)))usdInr={value:Number(snap.facts.usdinr_futures.last),source:'NSE futures',asof:snap.facts.usdinr_futures.updated_time||null};
      if(snap.facts&&snap.facts.gift_nifty&&Number.isFinite(Number(snap.facts.gift_nifty.percent_change)))giftNifty={change:Number(snap.facts.gift_nifty.percent_change),last:Number(snap.facts.gift_nifty.last)};
      if((!usdInr||!giftNifty)&&typeof snap.excerpt==='string'){try{const d=JSON.parse(snap.excerpt),rows=Array.isArray(d.marketState)?d.marketState:[],fx=rows.find(x=>x&&String(x.underlying||'').toUpperCase()==='USDINR');if(!usdInr&&fx&&Number.isFinite(Number(fx.last)))usdInr={value:Number(fx.last),source:'NSE futures',asof:fx.updated_time||null};if(!giftNifty&&d.giftnifty&&Number.isFinite(Number(d.giftnifty.PERCHANGE)))giftNifty={change:Number(d.giftnifty.PERCHANGE),last:Number(d.giftnifty.LASTPRICE)}}catch{}}
    }
    if(snap.source_id==='RBI_CURRENT_RATES'){
      if(snap.facts&&Number.isFinite(Number(snap.facts.policy_repo_rate_pct)))repoRate=Number(snap.facts.policy_repo_rate_pct);
      if(snap.facts&&Number.isFinite(Number(snap.facts.usdinr_reference)))rbiReference={value:Number(snap.facts.usdinr_reference),asof:snap.facts.rates_as_of||null};
      if(typeof snap.excerpt==='string'){
        const rr=snap.excerpt.match(/Policy\s*Repo Rate\s*:?\s*(\d+(?:\.\d+)?)\s*%/i),fx=snap.excerpt.match(/INR\s*\/\s*1 USD\s*:?\s*(\d+(?:\.\d+)?)/i);
        if(repoRate==null&&rr)repoRate=Number(rr[1]);if(!rbiReference&&fx)rbiReference={value:Number(fx[1]),asof:null};
      }
    }
    if(snap.source_id==='EIA_CRUDE_SPOT'){
      if(snap.facts&&snap.facts.wti_usd_per_barrel){const w=snap.facts.wti_usd_per_barrel,recent=Array.isArray(w.recent)?w.recent.map(Number).filter(Number.isFinite):[];if(recent.length)crude={latest:Number(w.latest),first:recent[0],trend:Number(w.latest)-recent[0],brent:null};}
      if(typeof snap.excerpt==='string'){
        const wm=snap.excerpt.match(/WTI\s*-\s*Cushing, Oklahoma\s+([\d.\s]+?)(?=\s+\d{4}-\d{4})/i),bm=snap.excerpt.match(/Brent\s*-\s*Europe\s+([\d.\s]+?)(?=\s+\d{4}-\d{4})/i),wv=wm?[...wm[1].matchAll(/\d+(?:\.\d+)?/g)].map(x=>Number(x[0])).slice(0,10):[],bv=bm?[...bm[1].matchAll(/\d+(?:\.\d+)?/g)].map(x=>Number(x[0])).slice(0,10):[];
        if(wv.length)crude={latest:wv.at(-1),first:wv[0],trend:wv.at(-1)-wv[0],brent:bv.length?{latest:bv.at(-1),first:bv[0],trend:bv.at(-1)-bv[0]}:null};
      }
    }
    if(snap.source_id==='FED_LATEST_FOMC_STATEMENT'){
      const ff=snap.facts&&typeof snap.facts==='object'?snap.facts:{};
      fed={action:ff.policy_action||null,range:ff.target_range_text||null,inflation:ff.inflation_assessment||null,activity:ff.activity_assessment||null,geopolitical:ff.geopolitical_assessment||null};
      if(typeof snap.excerpt==='string'){
        const action=snap.excerpt.match(/Committee decided to\s+(raise|lower|maintain|keep)/i),range=snap.excerpt.match(/target range for the federal funds rate[^.]{0,100}?to\s+([^.;]+?)\s+percent/i);
        if(!fed.action&&action)fed.action=action[1].toLowerCase();if(!fed.range&&range)fed.range=range[1].trim();
      }
    }
    if(!fed&&snap.source_id==='FED_MONETARY_POLICY'&&typeof snap.excerpt==='string'){
      const rel=snap.excerpt.match(/FOMC Statement:[\s\S]{0,160}?Released\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i),next=snap.excerpt.match(/Upcoming Dates[\s\S]{0,500}?([A-Z][a-z]{2}\.?\s+\d{1,2}-\d{1,2})\s+FOMC Meeting/i);
      if(rel||next)fed={action:null,range:null,statementRelease:rel?rel[1]:null,nextMeeting:next?next[1]:null};
    }
  }
  const priceFacts=['NIFTY around '+(spot?spot.toLocaleString('en-IN',{maximumFractionDigits:2}):'—'),trend.detail];
  if(emaVals.some(v=>/above/i.test(v)))priceFacts.push('price is above the visible EMA');
  if(vwapVals.some(v=>/above/i.test(v)))priceFacts.push('price is above VWAP on at least one intraday view');
  if(support)priceFacts.push('support near '+support);if(resistance)priceFacts.push('resistance near '+resistance);
  const priceMeaning=result.directional_label==='RANGE'
    ? 'That is constructive underneath, but not a clean breakout: price structure is firmer than the headline range call, so the range view is being driven by missing confirmation from positioning, participation and execution rather than by outright bearish price action.'
    : 'The price structure supports the published direction only if derivatives, participation and macro risk confirm it; otherwise the system deliberately reduces conviction.';
  const optionsObserved=strikeText?('Near-ATM strikes show '+strikeText+'.'):'The stored derivatives extraction does not contain enough strike-level premium/OI/volume fields for a reliable directional read.';
  const optionsMeaning=rows.length?(mixedBias?'The strike surface is internally conflicted, so options are not confirming the constructive chart structure. That conflict is a direct reason the 5-day probability stays closer to range than to a directional breakout.':'Nearby strikes are broadly aligned, so options are reinforcing rather than contradicting the chart structure.'):'Without reliable strike-level alignment, aggregate OI is not allowed to create a directional call.';
  const sectorText=sectorMoves.length?sectorMoves.map(x=>x.name+' '+(x.change>=0?'+':'')+x.change.toFixed(2)+'%').join(', '):'sector participation unavailable';
  const vixText=vix&&Number.isFinite(vix.change)?('India VIX '+(vix.change>=0?'+':'')+vix.change.toFixed(2)+'%'):'India VIX unavailable';
  const marketObserved=breadth?('Official NSE breadth is '+breadth.advances+' advances vs '+breadth.declines+' declines with NIFTY '+(breadth.change>=0?'+':'')+breadth.change.toFixed(2)+'%. '+vixText+'. Sector tape: '+sectorText+'.'):'A structured NSE breadth reading was not available.';
  let marketMeaning='Participation cannot be used as confirmation because the breadth evidence is incomplete.';
  if(breadth){
    const spread=breadth.advances-breadth.declines,sectorPos=sectorMoves.filter(x=>x.change>0).length,sectorNeg=sectorMoves.filter(x=>x.change<0).length;
    marketMeaning=spread>=10&&sectorPos>sectorNeg?'Breadth is genuinely broad and supportive; this would strengthen a bullish interpretation if derivatives also align.':spread<=-10&&sectorNeg>sectorPos?'Breadth is broadly weak, so a bullish price move would be suspect until participation improves.':'Participation is mixed rather than decisive: the index move is not being confirmed strongly enough across breadth and sectors to justify high conviction.';
    if(vix&&vix.change>5)marketMeaning+=' Rising India VIX adds risk premium and argues for lower conviction.';
    else if(vix&&vix.change<-5)marketMeaning+=' Falling India VIX is supportive, but it does not override mixed directional evidence.';
  }
  const macro=raw.MACRO_CATALYSTS||{};
  const macroFacts=[];
  if(fed){
    if(fed.action)macroFacts.push('Fed '+fed.action+(fed.range?' the funds-rate target to '+fed.range+'%':''));
    else if(fed.statementRelease)macroFacts.push('latest FOMC statement released '+fed.statementRelease);
    if(fed.nextMeeting)macroFacts.push('next FOMC meeting '+fed.nextMeeting);
  }
  if(repoRate!=null)macroFacts.push('RBI repo '+repoRate.toFixed(2)+'%');
  if(usdInr&&Number.isFinite(usdInr.value))macroFacts.push('USD/INR futures '+usdInr.value.toFixed(2)+(usdInr.asof?' as of '+usdInr.asof:''));
  else if(rbiReference&&Number.isFinite(rbiReference.value))macroFacts.push('RBI/FBIL USD/INR reference '+rbiReference.value.toFixed(4));
  if(crude&&Number.isFinite(crude.latest)&&Number.isFinite(crude.trend)){
    macroFacts.push('WTI '+crude.latest.toFixed(2)+' ('+(crude.trend>=0?'+':'')+crude.trend.toFixed(2)+' vs first point)');
    if(crude.brent&&Number.isFinite(crude.brent.latest))macroFacts.push('Brent '+crude.brent.latest.toFixed(2)+' ('+(crude.brent.trend>=0?'+':'')+crude.brent.trend.toFixed(2)+')');
  }
  if(giftNifty&&Number.isFinite(giftNifty.change))macroFacts.push('GIFT Nifty '+(giftNifty.change>=0?'+':'')+giftNifty.change.toFixed(2)+'%');
  const macroObserved=(macroFacts.length?macroFacts.join(' · '):'Material macro facts were not cleanly extracted')+'.';
  const adverseCrude=Boolean(crude&&Number.isFinite(crude.trend)&&crude.trend>5);
  const fedTightening=Boolean(fed&&/raise|hike/i.test(String(fed.action||'')));
  const fedEasing=Boolean(fed&&/lower|cut/i.test(String(fed.action||'')));
  const fxStress=Boolean(usdInr&&rbiReference&&Number.isFinite(usdInr.value)&&Number.isFinite(rbiReference.value)&&usdInr.value>rbiReference.value*1.005);
  const supportiveGift=Boolean(giftNifty&&giftNifty.change>0.25),adverseGift=Boolean(giftNifty&&giftNifty.change<-0.25);
  const implications=[];
  if(fedTightening)implications.push('The Fed has just tightened policy, which is a negative global-liquidity/risk input for equities and can increase pressure on EM currencies and valuations.');
  else if(fedEasing)implications.push('The Fed has eased policy, which is generally supportive for global liquidity, subject to the reason for the cut.');
  else if(fed&&fed.statementRelease)implications.push('A fresh FOMC decision is inside the 5-day horizon, so post-policy repricing remains an active event risk even where the directional tone is not fully extracted.');
  if(adverseCrude)implications.push('Crude has risen sharply across the verified EIA sequence; for India this is adverse through inflation, import-bill and current-account channels.');
  else if(crude)implications.push('Crude is not showing a large adverse rise in the verified sequence.');
  if(fxStress)implications.push('USD/INR futures are above the RBI/FBIL reference level, adding currency-pressure risk.');
  else if(usdInr)implications.push('USD/INR is elevated in absolute terms, but without a clean same-window baseline it is treated as risk context rather than a standalone directional signal.');
  if(adverseGift)implications.push('GIFT Nifty is mildly negative, adding near-term external-market pressure.');
  else if(supportiveGift)implications.push('GIFT Nifty is positive, giving a modest external-market tailwind.');
  if(repoRate!=null)implications.push('The RBI repo rate defines the domestic policy backdrop; it does not offset a fresh Fed tightening/crude shock by itself.');
  const rawConflict=(fedTightening||adverseCrude||fxStress)&&Number(macro.crude_commodities_geopolitics||0)>0;
  if(rawConflict)implications.push('This retrieved evidence conflicts with the older scalar macro label, so the evidence-level interpretation takes precedence in the explanation and future runs are required to reconcile it before scoring.');
  implications.push('Net effect: macro is a conviction modifier for the 5-day view; when several adverse channels align, bullish conviction must be reduced unless price, breadth and derivatives provide unusually strong confirmation.');
  const macroMeaning=implications.join(' ');
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
function fileKey(file){return[file.name,file.size,file.lastModified].join('::')}function appendUniqueFiles(existing,incoming){const seen=new Set(existing.map(fileKey));for(const file of incoming){const key=fileKey(file);if(!seen.has(key)){existing.push(file);seen.add(key)}}}function selectedFiles(){return{price:[...selectedPriceFiles],derivatives:[...selectedDerivativesFiles]}}function validateFiles(files){const e=[];if(files.length>MAX_FILES)e.push('Maximum 20 files are allowed in one run.');files.forEach(f=>{if(!ALLOWED_TYPES.has(f.type))e.push(f.name+': unsupported file type.');if(f.size<=0||f.size>MAX_FILE_BYTES)e.push(f.name+': file must be 10 MB or smaller.')});return e}function fileNames(files){return files.length?files.map((file,index)=>'<span>'+(index+1)+'. '+escapeHtml(file.name)+'</span>').join(''):'<span class="muted">None selected</span>'}function renderFileSelection(){const f=selectedFiles(),all=[...f.price,...f.derivatives],errors=[...((all.length&& !f.price.length)?['NIFTY chart screenshot is required for manual backup.']:[]),...((all.length&& !f.derivatives.length)?['Options / OI screenshot is required for manual backup.']:[]),...validateFiles(all)];if(!all.length){fileSelection.className='file-selection muted';fileSelection.textContent='No screenshots selected · automated evidence will be used.';setUploadStatus('','');return}const total=all.reduce((s,x)=>s+x.size,0);fileSelection.className='file-selection';fileSelection.innerHTML=['<strong>Manual backup selected</strong>','<span>'+f.price.length+' chart · '+f.derivatives.length+' derivatives/OI file(s) · '+escapeHtml(readableBytes(total))+' total</span>','<strong>NIFTY charts</strong>',fileNames(f.price),'<strong>Options / OI</strong>',fileNames(f.derivatives),'<span class="muted">Because screenshot files are selected, this run will use HYBRID backup mode instead of the normal automated path.</span>'].join('');errors.length?setUploadStatus(errors[0],'error'):setUploadStatus('Manual screenshot backup is ready.','ready')}priceFiles.addEventListener('change',()=>{appendUniqueFiles(selectedPriceFiles,Array.from(priceFiles.files||[]));priceFiles.value='';renderFileSelection()});derivativesFiles.addEventListener('change',()=>{appendUniqueFiles(selectedDerivativesFiles,Array.from(derivativesFiles.files||[]));derivativesFiles.value='';renderFileSelection()});
function currentAssessment(){return{objective:decisionObjective?.value||'BOTH',risk_posture:riskPosture?.value||'CONSERVATIVE',capital_priority:capitalPriority?.value||'CAPITAL_PROTECTION'}}
async function createRunRequest(batchId){
  const assessment=currentAssessment();
  const r=await fetch('/api/5dr/run-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({batch_id:batchId,evidence_categories:REQUIRED_USER_CATEGORIES,assessment})}),d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Could not create 5DR run request.');
  rememberActiveNiftyRequest(d.request?.request_id);
  return d.request
}
async function createAutomatedRun(){
  const h=await fetch('/api/5dr/dispatch-health',{cache:'no-store'}),hd=await h.json().catch(()=>({}));
  if(!h.ok||hd.ok!==true){const detail=hd.detail||hd.error||'5DR automation permission is not ready.';throw new Error(detail+' Automated 5DR is blocked before run creation; screenshot backup remains available.')}
  const r=await fetch('/api/5dr/automated-runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({assessment:currentAssessment(),force_new:true,client_invocation_id:crypto.randomUUID()})}),d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||(d.dispatch_health&&d.dispatch_health.detail)||(d.acquisition_dispatch&&d.acquisition_dispatch.detail)||'Could not start automated 5DR run.');
  rememberActiveNiftyRequest(d.request?.request_id);
  return d.request
}
function extractStageError(data){if(data&&typeof data.error==='string'&&data.error)return data.error;if(data&&Array.isArray(data.blockers)&&data.blockers.length){const blocker=data.blockers[0]||{};if(Array.isArray(blocker.limitations)&&blocker.limitations.length)return String(blocker.limitations[0]);if(typeof blocker.reason==='string'&&blocker.reason)return blocker.reason}if(data&&data.intelligence_reconciliation&&Array.isArray(data.intelligence_reconciliation.errors)&&data.intelligence_reconciliation.errors.length)return String(data.intelligence_reconciliation.errors[0]);if(data&&data.gate&&typeof data.gate.error==='string')return data.gate.error;if(data&&typeof data.message==='string'&&data.message)return data.message;return''}
async function runStage(requestId,suffix,label){setUploadStatus(label,'working');let r;try{r=await fetch('/api/5dr/run-requests/'+encodeURIComponent(requestId)+'/'+suffix,{method:'POST',cache:'no-store'})}catch(e){throw new Error('Network/Worker request failed before an HTTP response was received'+(e&&e.message?': '+e.message:''))}const raw=await r.text().catch(()=> '');let d={};if(raw){try{d=JSON.parse(raw)}catch{}}if(!r.ok){const detail=extractStageError(d);if(detail)throw new Error(detail+' [HTTP '+r.status+']');const excerpt=raw.replace(/\s+/g,' ').trim().slice(0,300);throw new Error('5DR stage '+suffix+' returned HTTP '+r.status+(r.statusText?' '+r.statusText:'')+(excerpt?' · '+excerpt:''))}return d}
async function process5drRequest(requestId){return runStage(requestId,'resume-processing','Resuming EDGE NIFTY from its persisted governed stage…')}
runForm.addEventListener('submit',async event=>{event.preventDefault();saveDecisionPrefs();const f=selectedFiles(),all=[...f.price,...f.derivatives],useBackup=all.length>0,errors=[];if(useBackup&&!f.price.length)errors.push('Add at least one NIFTY chart screenshot for manual backup.');if(useBackup&&!f.derivatives.length)errors.push('Add at least one options / OI screenshot for manual backup.');errors.push(...validateFiles(all));if(errors.length){setUploadStatus(errors[0],'error');return}if(runEngine.value!=='5DR'){setUploadStatus('EDGE NIFTY is the only engine available in this run dialog.','error');return}uploadButton.disabled=true;uploadButton.textContent='Running EDGE NIFTY…';try{if(!useBackup){setUploadStatus('Starting authenticated Upstox acquisition…','working');const req=await createAutomatedRun();fileSelection.innerHTML=['<strong>Automated acquisition started</strong>','<span>Upstox + official/web research · no uploads</span>','<span>Request: '+escapeHtml(req.request_id)+'</span>'].join('');setUploadStatus('Automated EDGE NIFTY is running. The pipeline will continue without screenshot input.','success');dialog.close();setActiveModule('5DR');await loadDashboard();setTimeout(()=>loadDashboard(),7000);return}const form=new FormData();form.append('engine','5DR');form.append('provenance_mode',evidenceMode.value);form.append('captured_at',new Date().toISOString());const manifest=[];f.price.forEach(file=>{form.append('files',file,file.name);manifest.push({category:'PRICE_TECHNICALS',file_name:file.name})});f.derivatives.forEach(file=>{form.append('files',file,file.name);manifest.push({category:'DERIVATIVES_OI',file_name:file.name})});form.append('evidence_manifest',JSON.stringify(manifest));setUploadStatus('Uploading screenshot backup…','working');const r=await fetch('/api/evidence/upload',{method:'POST',body:form}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||(Array.isArray(d.details)?d.details.join(' '):'Evidence upload failed.'));const req=await createRunRequest(d.batch_id);fileSelection.innerHTML=['<strong>Screenshot backup intake complete</strong>','<span>'+d.file_count+' file'+(d.file_count===1?'':'s')+' secured in private R2</span>','<span>Request: '+escapeHtml(req.request_id)+'</span>'].join('');const result=await process5drRequest(req.request_id);setUploadStatus(result.status==='PROCESSING'?'EDGE NIFTY is running…':'EDGE NIFTY pipeline advanced…','success');selectedPriceFiles=[];selectedDerivativesFiles=[];priceFiles.value='';derivativesFiles.value='';dialog.close();setActiveModule('5DR');await loadDashboard()}catch(e){console.error(e);setUploadStatus(friendlyFailureMessage(e&&e.message)+' Your run is safe to retry.','error');await loadDashboard()}finally{uploadButton.disabled=false;uploadButton.textContent='Run EDGE NIFTY'}});
document.addEventListener('click',event=>{const toggle=event.target.closest&&event.target.closest('[data-analysis-toggle]');if(!toggle)return;const card=toggle.closest('.simple-result'),detail=card&&card.querySelector('[data-analysis-detail]');if(!detail)return;detail.hidden=!detail.hidden;toggle.textContent=detail.hidden?'View full analysis':'Hide full analysis';});
function pct(v){return v==null?'—':Number(v).toFixed(Number(v)%1?1:0)+'%'}
function canonicalLabel(value){
  const raw=String(value||'').toUpperCase();
  const labels={PREOPEN_CANONICAL:'Pre-open canonical',OVERNIGHT_FALLBACK_CANONICAL:'Overnight fallback canonical',EXCEPTION_CANONICAL:'Exception canonical',LEGACY_CANONICAL:'Legacy canonical',CANONICAL_MISSED:'Canonical missed',LEGACY_CANONICAL_MISSED:'Legacy canonical missed'};
  return labels[raw]||humanText(raw||'Not available')
}
function canonicalAssessmentContext(canonical){
  if(!canonical||typeof canonical!=='object')return '';
  const type=String(canonical.canonical_type||'NOT_AVAILABLE');
  const status=String(canonical.selection_status||'');
  const target=canonical.target_trading_date?new Date(String(canonical.target_trading_date)+'T00:00:00+05:30').toLocaleDateString('en-IN'):'—';
  const missed=/MISSED/.test(type)||status!=='SELECTED';
  return '<div class="scorecard-context canonical-status-card"><span>Official canonical · latest governed target</span><strong>'+escapeHtml(canonicalLabel(type))+' · '+escapeHtml(target)+'</strong><p>'+(missed?'No official forecast was admitted for this target; it is excluded from efficacy.':'Only this selected lineage contributes to official efficacy for the target date.')+'</p><small>'+escapeHtml(canonical.governance_era==='LEGACY'?'Legacy migration population':'Post-governance timing regime')+(canonical.selected_forecast_id?' · '+escapeHtml(canonical.selected_forecast_id):'')+'</small></div>'
}
function assessmentDayCell(label,day,zone,rec){
  const d=day&&typeof day==='object'?day:{},z=zone&&typeof zone==='object'?zone:{},r=rec&&typeof rec==='object'?rec:{};
  const eligible=Number(d.eligible_matured??0),scorable=Number(d.scorable||0),missing=Number(d.missing_unscorable??Math.max(eligible-scorable,0));
  const hits=Number(d.hits||0),zoneHits=Number(z.zone_hits??d.zone_hits??0),zoneScorable=Number(z.scorable??d.scorable??0);
  const dirPct=d.hit_rate_pct!=null?Number(d.hit_rate_pct):scorable?hits/scorable*100:null;
  const zonePct=z.zone_hit_rate_pct!=null?Number(z.zone_hit_rate_pct):(d.zone_hit_rate_pct!=null?Number(d.zone_hit_rate_pct):(zoneScorable?zoneHits/zoneScorable*100:null));
  const coverage=d.coverage_pct!=null?Number(d.coverage_pct):(eligible?scorable/eligible*100:null);
  const margin=d.avg_directional_margin_points??d.average_directional_margin_points??null;
  const zoneError=d.avg_zone_error_points??d.average_zone_error_points??null;
  const brier=d.avg_brier_score??d.brier_score??null;
  const resolved=Number(r.resolved||0),recHits=Number(r.hits||0),recMisses=Number(r.misses||0),recPct=r.hit_rate_pct!=null?Number(r.hit_rate_pct):(resolved?recHits/resolved*100:null);
  let forecastHtml='';
  if(eligible===0){
    forecastHtml='<div class="scorecard-pending"><span>Forecast</span><b>Not due</b><small>Awaiting governed checkpoint</small></div>';
  }else if(scorable===0){
    forecastHtml='<div class="scorecard-pending"><span>Forecast</span><b>Matured · not scorable</b><small>0/'+eligible+' scorable · frozen forecast context unavailable</small></div>';
  }else{
    forecastHtml='<div><span>Directional accuracy</span><b>'+pct(dirPct)+'</b><small>'+hits+'/'+scorable+' correct · '+scorable+'/'+eligible+' matured eligible scorable</small></div>'+
      '<div><span>Zone hit rate</span><b>'+pct(zonePct)+'</b><small>'+zoneHits+'/'+zoneScorable+' hits · coverage '+pct(coverage)+'</small></div>'+
      '<div><span>Avg directional margin</span><b>'+(margin==null?'Not scorable':escapeHtml(Number(margin).toFixed(2))+' pts')+'</b><small>Signed NIFTY points in favour of the frozen forecast.</small></div>'+
      '<div><span>Avg zone error</span><b>'+(zoneError==null?'Not scorable':escapeHtml(Number(zoneError).toFixed(2))+' pts')+'</b><small>Average distance from the frozen zone when missed; lower is better.</small></div>'+
      '<div><span>Probability calibration · Brier</span><b>'+(brier==null?'Not scorable':escapeHtml(Number(brier).toFixed(4)))+'</b><small>Three-scenario probability score; lower is better, 0 is perfect. Legacy single-probability rows are not reconstructed.</small></div>'+
      (missing?'<div class="scorecard-pending"><span>Data completeness</span><b>'+missing+' matured unscorable</b><small>Historical frozen context is incomplete.</small></div>':'');
  }
  const recHtml=resolved?'<div><span>Recommendation hit rate</span><b>'+pct(recPct)+'</b><small>'+recHits+'/'+resolved+' wins · '+recMisses+' loss'+(recMisses===1?'':'es')+'</small></div><div><span>Standardized model P/L</span><b>'+pct(r.overall_pnl_pct)+'</b><small>Hits '+pct(r.hit_pnl_pct)+' · Misses '+pct(r.miss_pnl_pct)+' · not user P/L</small></div>':'<div><span>Recommendation hit rate</span><b>Not scorable</b><small>No recommendation resolved on this horizon</small></div>';
  return '<div class="scorecard-day"><strong>'+escapeHtml(label)+'</strong>'+forecastHtml+recHtml+'</div>'
}
function slotValue(slot,keys){for(const key of keys){if(slot&&slot[key]!=null&&slot[key]!=='')return slot[key]}return null}
function pendingForecastDayCell(label,slot){
  const has=slot&&typeof slot==='object'&&Object.keys(slot).length>0;
  if(!has)return '<div class="scorecard-day pending-forecast-day"><strong>'+escapeHtml(label)+'</strong><div class="scorecard-pending"><span>Day-specific forecast</span><b>Not verified</b><small>No evidence-supported daily scenario/range was stored for this slot.</small></div></div>';
  const direction=slotValue(slot,['direction','bias','directional_label','forecast']);
  const probs=slot.probabilities&&typeof slot.probabilities==='object'?slot.probabilities:null;
  const legacyProbability=slotValue(slot,['probability','direction_probability','confidence']);
  const low=slotValue(slot,['zone_low','range_low','expected_zone_low','low']);
  const high=slotValue(slot,['zone_high','range_high','expected_zone_high','high']);
  const date=slotValue(slot,['trading_date','date','target_date']);
  const basis=slotValue(slot,['basis','notes']);
  const zoneText=(low!=null||high!=null)?((low??'—')+' – '+(high??'—')):'Not verified';
  const scenarioHtml=probs
    ? '<div class="scenario-mini-line"><span>Bull <b>'+escapeHtml(probs.BULL??'—')+'%</b></span><span>Range <b>'+escapeHtml(probs.RANGE??'—')+'%</b></span><span>Bear <b>'+escapeHtml(probs.BEAR??'—')+'%</b></span></div>'
    : '<small>'+(legacyProbability!=null?'Legacy selected-scenario probability '+escapeHtml(legacyProbability)+'%; full Bull/Range/Bear vector was not stored.':'Full Bull/Range/Bear probability vector not stored.')+'</small>';
  return '<div class="scorecard-day pending-forecast-day"><strong>'+escapeHtml(label)+(date?' · '+escapeHtml(new Date(date).toLocaleDateString('en-IN')):'')+'</strong>'+
    '<div><span>Selected direction</span><b>'+escapeHtml(direction?humanText(direction):'Not verified')+'</b>'+scenarioHtml+'</div>'+
    '<div><span>Expected range / zone</span><b>'+escapeHtml(zoneText)+'</b><small>Evidence-supported session range.</small></div>'+
    '<div><span>Evidence basis</span><b>'+escapeHtml(basis||'Not available')+'</b><small>Why this daily scenario was selected; missing evidence is not inferred.</small></div></div>'
}
const CANONICAL_HORIZON_DISPLAY=[
  {label:'D',internal:'D+1'},
  {label:'D+1',internal:'D+2'},
  {label:'D+2',internal:'D+3'},
  {label:'D+3',internal:'D+4'},
  {label:'D+4',internal:'D+5'}
];
function renderPendingForecasts(pending){
  const rows=Array.isArray(pending)?pending:[];
  if(!rows.length)return '<div class="scorecard-context"><p>No published forecasts are currently waiting for future assessment checkpoints.</p></div>';
  return rows.slice(0,5).map(run=>{
    const probs=run.probabilities||{},slots=run.horizon_slots||{};
    const title=(run.generated_at?runDateTime(run.generated_at):run.run_id||'Pending forecast')+' · '+friendlyDirection(run.directional_label);
    return '<details class="pending-forecast-block pending-forecast-details"><summary>'+escapeHtml(title)+'</summary><div class="scorecard-context"><span>Pending forecast</span><strong>'+escapeHtml(run.generated_at?runDateTime(run.generated_at):run.run_id||'—')+'</strong><p>'+escapeHtml(friendlyDirection(run.directional_label))+' · Up '+escapeHtml(probs.BULL??'—')+'% · Sideways '+escapeHtml(probs.RANGE??'—')+'% · Down '+escapeHtml(probs.BEAR??'—')+'%</p><small>Market Trust '+escapeHtml(run.market_trust??'—')+'/100 · '+(run.tradeable?'Tradeable':'No trade')+'. This operational run affects official accuracy only if it becomes the selected canonical and its governed checkpoints mature.</small></div><div class="scorecard-days">'+CANONICAL_HORIZON_DISPLAY.map(h=>pendingForecastDayCell(h.label,slots[h.internal])).join('')+'</div></details>'
  }).join('')
}
function currentForecastDrilldown(result){
  const slots=result&&result.horizon_slots&&typeof result.horizon_slots==='object'?result.horizon_slots:{};
  const populated=CANONICAL_HORIZON_DISPLAY.filter(h=>slots[h.internal]&&typeof slots[h.internal]==='object'&&Object.keys(slots[h.internal]).length>0).length;
  return '<details class="current-forecast-details"><summary>5-day forecast — D through D+4 scenarios & range</summary><div class="scorecard-context"><span>Current run forecast path</span><strong>'+populated+'/5 day slots populated</strong><p>D is the canonical target trading session; D+1 through D+4 are the next four NSE sessions. New runs show Bull/Range/Bear probabilities totaling 100% for every day; legacy missing vectors are never reconstructed.</p></div><div class="scorecard-days current-forecast-days">'+CANONICAL_HORIZON_DISPLAY.map(h=>pendingForecastDayCell(h.label,slots[h.internal])).join('')+'</div></details>'
}
function assessmentMetricForDisplay(metrics,label,index){
  const source=metrics&&typeof metrics==='object'?metrics:{};
  if(Object.prototype.hasOwnProperty.call(source,'D'))return source[label];
  return source['D+'+(index+1)];
}
function renderAssessmentDetails(details,pending){
  const labels=['D','D+1','D+2','D+3','D+4'];
  let maturedHtml='<p class="assessment-empty-copy">No matured outcome records yet.</p>';
  if(details.length){
    const latest=details.slice().sort((a,b)=>Date.parse(b.assessed_at||0)-Date.parse(a.assessed_at||0))[0]||{},m=latest.metrics||{},day=m.day_wise||m.daywise||{},zone=m.zone_wise||m.zonewise||{},rec=m.day_recommendation_metrics||{};
    maturedHtml=['<div class="scorecard-context"><span>Matured performance · last assessed</span><strong>'+escapeHtml(latest.assessed_at?new Date(latest.assessed_at).toLocaleDateString('en-IN'):'—')+'</strong><p>'+escapeHtml(latest.outcome||'Latest cumulative assessment')+'</p><small>D is the canonical target trading session; these rows affect the accuracy and return statistics above.</small></div>','<div class="scorecard-days">'+labels.map((label,index)=>assessmentDayCell(label,assessmentMetricForDisplay(day,label,index),assessmentMetricForDisplay(zone,label,index),assessmentMetricForDisplay(rec,label,index))).join('')+'</div>'].join('')
  }
  return '<div class="assessment-drill-section"><div class="step-label">Matured historical performance</div>'+maturedHtml+'</div><div class="assessment-drill-section"><div class="step-label">Legacy canonical forecasts awaiting assessment</div>'+renderPendingForecasts(pending)+'</div>'
}
function renderAssessment(container,payload){
  if(!container)return;
  const summary=payload&&payload.summary?payload.summary:null,details=payload&&Array.isArray(payload.details)?payload.details:[],pending=payload&&Array.isArray(payload.pending_forecasts)?payload.pending_forecasts:[];
  if(!summary){container.innerHTML='<div class="generic-empty">Till-date assessment is not available yet.</div>';return}
  const canonical=summary.canonical||null,f=summary.forecast||{},r=summary.recommendation||{},ret=summary.returns||{},eligible=Number(summary.matured_eligible_checkpoints??f.eligible_total??summary.matured_runs??0),scorable=Number(summary.scorable_checkpoints??f.total??0),missing=Number(summary.missing_unscorable_checkpoints??f.missing_unscorable??Math.max(eligible-scorable,0)),coverage=summary.scorable_coverage_pct??f.coverage_pct,pendingCount=Number(summary.pending_forecasts??pending.length??0);
  container.innerHTML=[
    '<div class="assessment-header"><div><div class="eyebrow">ASSESSMENT · TILL DATE</div><h3>Performance assessment</h3></div><small>'+eligible+' matured eligible · '+scorable+' scorable · '+pendingCount+' pending legacy canonical'+(pendingCount===1?'':'s')+'</small></div>',
    canonicalAssessmentContext(canonical),
    '<div class="assessment-grid">',
      '<div class="assessment-metric"><span>Forecast accuracy</span><strong>'+pct(f.accuracy_pct)+'</strong><small>'+escapeHtml(f.hits||0)+' hits / '+escapeHtml(f.total||0)+' scorable · '+escapeHtml(scorable)+'/'+escapeHtml(eligible)+' matured eligible scorable ('+pct(coverage)+')</small></div>',
      '<div class="assessment-metric"><span>Recommendation accuracy</span><strong>'+pct(r.accuracy_pct)+'</strong><small>'+escapeHtml(r.hits||0)+' wins / '+escapeHtml(r.total||0)+' resolved canonical recommendations</small></div>',
      '<div class="assessment-metric"><span>Overall gain / loss</span><strong>'+pct(ret.absolute_return_pct)+'</strong><small>Canonical actionable calls only</small></div>',
      '<div class="assessment-metric"><span>Return on hits</span><strong>'+pct(ret.hits_return_pct)+'</strong><small>Successful canonical calls</small></div>',
      '<div class="assessment-metric"><span>Return on misses</span><strong>'+pct(ret.misses_return_pct)+'</strong><small>Unsuccessful canonical calls</small></div>',
    '</div>',
    '<div class="scorecard-context assessment-pending-note"><p><strong>Official efficacy uses one selected DAILY_CANONICAL forecast per target trading date.</strong> Fresh reruns do not increase denominators.</p><p><strong>Matured eligible</strong> means the D or D+n trading session has passed. <strong>Scorable</strong> additionally requires the original frozen day-wise forecast context. '+(missing?escapeHtml(missing)+' matured checkpoint'+(missing===1?' is':'s are')+' currently unscorable because legacy frozen context is missing.':'All matured eligible checkpoints are currently scorable.')+'</p></div>',
    '<details class="assessment-detail-row"><summary>Drill down — day-wise forecast, range & outcomes</summary><div class="assessment-history">'+renderAssessmentDetails(details,pending)+'</div></details>'
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
  const pending=issue.grade==='NV'||issue.hard_blocker==='CRITICAL_EVIDENCE_NOT_VERIFIED',blocker=pending?'Autonomous research is still resolving critical evidence':humanText(issue.hard_blocker||'');
  return '<div class="ipo-issue-card"><div class="ipo-issue-head"><strong>'+escapeHtml(issue.company_name||'—')+'</strong><span class="evidence-chip '+(pending?'limited':'verified')+'">'+escapeHtml(pending?'Research pending':(issue.grade||'—'))+'</span></div><p>'+escapeHtml(issue.segment||'—')+(issue.exchange?' · '+escapeHtml(issue.exchange):'')+' · '+escapeHtml(band)+'</p><small>'+escapeHtml(dateText||'Dates pending')+' · '+escapeHtml(pending?'Decision withheld until evidence recovery completes':humanText(issue.decision||'NO_ACTION'))+'</small>'+(blocker?'<small class="ipo-blocker">'+escapeHtml(blocker)+'</small>':'')+'</div>'
}
function humanText(v){return String(v??'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}
function renderIpoAssessment(result){
  if(!ipoAssessmentSummary)return;
  const e=result.historical_efficacy||{},counts=result.counts||{},assessed=Number(e.assessed||0),actionable=Number(e.actionable_recommendation_count||0);
  ipoAssessmentSummary.innerHTML=[
    '<div class="assessment-header"><div><div class="eyebrow">ASSESSMENT · HISTORICAL</div><h3>IPO EDGE efficacy</h3></div><small>'+escapeHtml(assessed)+' assessed IPOs</small></div>',
    '<div class="assessment-grid">',
      '<div class="assessment-metric"><span>Decision accuracy</span><strong>'+pct(e.decision_accuracy_pct)+'</strong><small>'+escapeHtml(e.correct_avoidance||0)+' correct avoidances / '+escapeHtml(assessed)+' assessed</small></div>',
      '<div class="assessment-metric"><span>High-grade signal hit rate</span><strong>'+pct(e.high_grade_hit_rate_pct)+'</strong><small>'+escapeHtml(e.high_grade_20pct_count||0)+' / '+escapeHtml(e.high_grade_track_count||0)+' A-grade TRACK cases delivered ≥20% listing gain</small></div>',
      '<div class="assessment-metric"><span>Actionable recommendation accuracy</span><strong>'+(actionable?pct(e.actionable_recommendation_accuracy_pct):'Not scorable')+'</strong><small>'+escapeHtml(actionable)+' APPLY / SUBSCRIBE recommendations in stored history</small></div>',
      '<div class="assessment-metric"><span>A-grade avg listing gain</span><strong>'+pct(e.high_grade_avg_listing_gain_pct)+'</strong><small>Observed listing gain across '+escapeHtml(e.high_grade_track_count||0)+' high-grade TRACK cases</small></div>',
      '<div class="assessment-metric"><span>Missed opportunity rate</span><strong>'+pct(e.miss_rate_pct)+'</strong><small>'+escapeHtml(e.missed_opportunity||0)+' / '+escapeHtml(assessed)+' historical assessments</small></div>',
    '</div>',
    '<details class="assessment-detail-row"><summary>Gain/loss & backtest detail</summary><div class="scorecard-days">',
      '<div class="scorecard-day"><strong>All assessed IPOs</strong><div><span>Average listing gain</span><b>'+pct(e.all_outcomes_avg_listing_gain_pct)+'</b><small>'+escapeHtml(assessed)+' historical outcomes</small></div><div><span>Framework accuracy</span><b>'+pct(e.decision_accuracy_pct)+'</b><small>Correct avoidance vs missed opportunity</small></div></div>',
      '<div class="scorecard-day"><strong>Correct avoidances</strong><div><span>Count</span><b>'+escapeHtml(e.correct_avoidance||0)+'</b><small>Issues correctly filtered</small></div><div><span>Avg listing gain</span><b>'+pct(e.correct_avoidance_avg_listing_gain_pct)+'</b><small>Low average gain validates most avoidances</small></div></div>',
      '<div class="scorecard-day"><strong>Missed opportunities</strong><div><span>Count</span><b>'+escapeHtml(e.missed_opportunity||0)+'</b><small>Historical misses</small></div><div><span>Avg listing gain</span><b>'+pct(e.missed_opportunity_avg_listing_gain_pct)+'</b><small>Magnitude of opportunities the framework failed to capture</small></div></div>',
      '<div class="scorecard-day"><strong>A-grade TRACK signals</strong><div><span>Positive / ≥20%</span><b>'+escapeHtml(e.high_grade_positive_count||0)+' / '+escapeHtml(e.high_grade_20pct_count||0)+'</b><small>Out of '+escapeHtml(e.high_grade_track_count||0)+' signals</small></div><div><span>Avg listing gain</span><b>'+pct(e.high_grade_avg_listing_gain_pct)+'</b><small>Strong historical signal quality, but TRACK was not an APPLY recommendation</small></div></div>',
    '</div><div class="scorecard-context"><p>These are historical efficacy statistics from stored IPO outcomes. Listing gains are observed market outcomes, not portfolio returns. Actionable recommendation accuracy remains unscorable until the framework produces APPLY/SUBSCRIBE calls.</p></div></details>'
  ].join('')
}
function renderIpoSnapshot(target,runsData){
  const list=Array.isArray(runsData)?runsData:[],latest=list[0]||null;
  if(!target)return;
  if(!latest){target.innerHTML='<div class="generic-empty">No IPO EDGE snapshot is available.</div>';return}
  const r=latest.result||{},issues=Array.isArray(r.current_issues)?r.current_issues:[],ready=issues.filter(x=>x&&x.grade&&x.grade!=='NV'),pending=issues.filter(x=>x&&x.grade==='NV'),focus=issues[0]||null,validated=r.latest_validated||null;
  renderIpoAssessment(r);
  const headline=ready.length?ready.length+' current issue'+(ready.length===1?' is':'s are')+' decision-ready':(pending.length?'Current IPO research is still being completed':'No current IPO is decision-ready');
  const why=[
    '<div class="why-card"><strong>Current coverage</strong><p>'+escapeHtml(issues.length)+' open/upcoming issues are in the current snapshot; '+escapeHtml(pending.length)+' are still in autonomous evidence recovery. They are not treated as finished recommendations.</p></div>',
    '<div class="why-card"><strong>Decision quality</strong><p>'+escapeHtml(ready.length)+' current issues have a governed grade. Any issue still missing critical R2/R3/R4/R6/R7 evidence remains Research pending until recovery completes or the engine records an explicit exhausted-source exception.</p></div>',
    validated?'<div class="why-card"><strong>Latest validated checkpoint</strong><p><b>What we saw:</b> '+escapeHtml(validated.company_name)+' scored '+escapeHtml(validated.score)+' with grade '+escapeHtml(validated.grade)+' and decision '+escapeHtml(humanText(validated.decision))+'.</p><p><b>What it means:</b> The IPO engine is capable of producing a governed grade once the evidence gates are complete; current NVs are a data-readiness issue, not an empty engine.</p></div>':''
  ].join('');
  target.innerHTML=[
    '<article class="simple-result ipo-standard-result">',
      '<div class="result-kicker">CURRENT IPO VIEW</div>',
      '<h2>'+escapeHtml(headline)+'</h2>',
      '<p class="result-copy">'+escapeHtml(issues.length)+' current issues monitored · '+escapeHtml(pending.length)+' still in autonomous research recovery.</p>',
      '<div class="decision-grid"><div class="decision-card"><span>Decision status</span><strong>'+(ready.length?'Review graded issues':'Research pending')+'</strong><small>Unresolved evidence is withheld from recommendation output</small></div><div class="decision-card"><span>Framework</span><strong>V'+escapeHtml(r.framework_version||latest.framework_version||'1.1')+'</strong><small>IPO EDGE governed snapshot</small></div></div>',
      '<div class="action-box"><span>Suggested action</span><strong>'+(ready.length?'Review the governed graded issues below.':'No apply/reject call until autonomous evidence recovery completes.')+'</strong></div>',
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
  try{
    if(module==='EDGE_IPO'){const d=await fetch('/api/ipo-edge/snapshot',{cache:'no-store'}).then(r=>r.json()),snap=d.snapshot||null;if(!snap){runs.innerHTML='<div class="generic-empty">No IPO EDGE snapshot available.</div>';runsNote.textContent='0 recent';return}runs.innerHTML='<article class="run history-row"><strong>IPO EDGE snapshot</strong><span class="muted">'+escapeHtml(new Date(snap.captured_at).toLocaleString())+'</span></article>';runsNote.textContent='1 current snapshot';return}
    if(module==='EDGE_STOCKS'){const ticker=localStorage.getItem('edge-console-selected-stock')||'LTF',d=await fetch('/api/edge-stocks/history?ticker='+encodeURIComponent(ticker),{cache:'no-store'}).then(r=>r.json()),list=Array.isArray(d.recommendations)?d.recommendations:[];if(!list.length){runs.innerHTML='<div class="generic-empty">No published EDGE Stocks recommendations for '+escapeHtml(ticker)+'.</div>';runsNote.textContent='0 recent';return}runs.innerHTML=list.map(r=>'<article class="run history-row"><strong>'+escapeHtml(ticker)+' · '+escapeHtml(String(r.definitive_forecast||'—').replaceAll('_',' '))+'</strong><span class="muted">'+escapeHtml(new Date(r.run_timestamp).toLocaleString())+' · '+escapeHtml(r.outcome_verdict||r.status||'OPEN')+(r.current_return_pct!=null?' · '+escapeHtml(Number(r.current_return_pct).toFixed(1))+'%':'')+'</span></article>').join('');runsNote.textContent=list.length+' recent';return}
    const d=await fetch('/api/runs/latest?engine='+encodeURIComponent(module),{cache:'no-store'}).then(r=>r.json()),list=Array.isArray(d.runs)?d.runs:[];
    if(!list.length){runs.innerHTML='<div class="generic-empty">No published results for this module yet.</div>';runsNote.textContent='0 recent';return}
    runs.innerHTML=list.slice(0,8).map(r=>'<article class="run history-row"><strong>'+escapeHtml(module==='5DR'?'EDGE NIFTY result':'EDGE Stocks result')+'</strong><span class="muted">'+escapeHtml(new Date(r.generated_at).toLocaleString())+'</span></article>').join('');runsNote.textContent=list.length+' recent'
  }catch(e){console.error(e);runs.innerHTML='<div class="generic-empty">Unable to load recent results.</div>';runsNote.textContent='Unavailable'}
}
function render5dr(run,request,outcomeAssessment){
  if(!run){
    const meta=request&&request.metadata?request.metadata:{},stage=meta.adapter_stage||'—',status=request?request.status:'READY';
    fiveDrState.textContent=request?stageLabel(stage,status):'Ready';
    const progress=stageLabel(stage,status);
    const resume=status==='FAILED'
      ?'<p class="muted">This run stopped safely. Press Run EDGE NIFTY to start a fresh run.</p>'
      :'<p class="muted">No action is required. EDGE NIFTY will advance this run automatically and publish the result when complete.</p>';
    const technical=request?'<details class="tech-details"><summary>Advanced details</summary><div class="tech-body"><div><span>Request</span><strong>'+escapeHtml(request.request_id)+'</strong></div><div><span>Internal stage</span><strong>'+escapeHtml(stage)+'</strong></div><div><span>Status</span><strong>'+escapeHtml(status)+'</strong></div><div><span>Evidence files</span><strong>'+escapeHtml(meta.evidence_file_count||'—')+'</strong></div></div></details>':'';
    const rawError=request&&request.error?JSON.stringify(request.error):'';const setup=meta.decision_setup?friendlySetup(meta.decision_setup):null;const setupHtml=setup?'<div class="assessment-card"><div><span>Run assessment</span><strong>Recorded</strong></div><p>'+escapeHtml(setup.objective)+' · '+escapeHtml(setup.risk)+' · '+escapeHtml(setup.priority)+' · '+escapeHtml(setup.horizon)+'</p></div>':'';fiveDrSummary.innerHTML='<article class="simple-result pending-result"><div class="result-kicker">Current EDGE NIFTY run</div><h2>'+escapeHtml(progress)+'</h2><p class="run-timestamp">Run started: '+escapeHtml(runDateTime(request?.created_at||request?.updated_at||request?.submitted_at))+'</p><p class="result-copy">'+(status==='FAILED'?escapeHtml(friendlyFailureMessage(rawError)):'Your current run is still being processed. No previous result is being presented as the current answer.')+'</p>'+setupHtml+resume+(status==='FAILED'?diagnosticSummary(rawError,'Stopped safely'):'')+technical+'</article>';
    return;
  }
  const result=run.result||{},prob=result.probabilities||{},blockers=Array.isArray(result.tradeability_blockers)?result.tradeability_blockers:[],direction=friendlyDirection(result.directional_label),confidence=confidenceLabel(result.market_trust),tradeable=result.tradeable===true;
  const meta=request&&request.metadata?request.metadata:{},handoff=meta.intelligence_handoff||{},normalized=handoff.normalized||{},components=normalized.component_scores||{},trust=normalized.market_trust_inputs||{},execution=normalized.execution_inputs||{},limits=(meta.intelligence_reconciliation&&Array.isArray(meta.intelligence_reconciliation.limitations))?meta.intelligence_reconciliation.limitations:[];
  fiveDrState.textContent='Result ready';
  const action=tradeable?'A trade setup currently meets the EDGE NIFTY gates. Review the setup before acting.':'Wait for a stronger setup before taking a trade.';
  const directionStrength=directionStrengthSummary(result.des5),tradeSetupStrength=tradeSetupStrengthSummary(result.execution_edge);
  const why=governedWhy(meta,normalized,result);
  const changes=userChangeConditions(why,normalized,result);
  const blockersPlain=blockers.map(blockerText);
  fiveDrSummary.innerHTML=[
    '<article class="simple-result direction-'+escapeHtml(String(result.directional_label||'RANGE').toLowerCase())+'">',
      '<div class="result-kicker">Today’s Market View</div>',
      '<h2>'+escapeHtml(direction)+'</h2>',
      '<p class="run-timestamp">Run date/time: '+escapeHtml(runDateTime(run.generated_at||run.run_timestamp||run.created_at))+'</p>',
      '<div class="probability-line"><span class="bull">Up <strong>'+escapeHtml(prob.BULL??'—')+'%</strong></span><span class="range">Sideways <strong>'+escapeHtml(prob.RANGE??'—')+'%</strong></span><span class="bear">Down <strong>'+escapeHtml(prob.BEAR??'—')+'%</strong></span></div>',
      '<div class="nifty-signal-grid">',
        '<div class="decision-card"><span>Direction strength</span><strong>'+escapeHtml(directionStrength.value)+'</strong><small>'+escapeHtml(directionStrength.detail)+'</small></div>',
        '<div class="decision-card"><span>Evidence confidence</span><strong>'+escapeHtml(confidence)+' · '+escapeHtml(result.market_trust??'—')+'/100</strong><small>How reliable and internally consistent the evidence is for this market view.</small></div>',
        '<div class="decision-card"><span>Trade setup strength</span><strong>'+escapeHtml(tradeSetupStrength.value)+'</strong><small>'+escapeHtml(tradeSetupStrength.detail)+'</small></div>',
      '</div>',
      '<div class="decision-grid">',
        '<div class="decision-card"><span>Can I trade this?</span><strong>'+(tradeable?'Yes':'No trade')+'</strong><small>'+(tradeable?'Current gates passed':'Current gates are not met')+'</small></div>',
        '<div class="decision-card"><span>Market view</span><strong>'+escapeHtml(direction)+'</strong><small>Published five-day direction after all evidence checks.</small></div>',
      '</div>',
      '<div class="action-box"><span>Suggested action</span><strong>'+escapeHtml(action)+'</strong></div>',
      '<div class="assessment-card"><div><span>Run assessment</span><strong>'+(meta.decision_setup?'Recorded':'Legacy run')+'</strong></div><p>'+(meta.decision_setup?(escapeHtml(friendlySetup(meta.decision_setup).objective)+' · '+escapeHtml(friendlySetup(meta.decision_setup).risk)+' · '+escapeHtml(friendlySetup(meta.decision_setup).priority)+' · '+escapeHtml(friendlySetup(meta.decision_setup).horizon)):'This result was created before run-assessment capture was enabled. New runs record the decision setup before analysis.')+'</p></div>',
      '<button class="analysis-toggle ghost" type="button" data-analysis-toggle>View full analysis</button>',
      '<div class="analysis-detail" data-analysis-detail hidden>',
      currentForecastDrilldown(result),
      '<details class="why-details" open><summary>Why this view?</summary>',
        '<div class="why-grid">',
          '<div class="why-card"><strong>Price & structure</strong><p>'+escapeHtml(why.price.observed+' '+why.price.meaning)+'</p><small>'+escapeHtml(why.price.impact)+'</small></div>',
          '<div class="why-card"><strong>Options & positioning</strong><p>'+escapeHtml(why.options.observed+' '+why.options.meaning)+'</p><small>'+escapeHtml(why.options.impact)+'</small></div>',
          '<div class="why-card"><strong>Market participation</strong><p>'+escapeHtml(why.market.observed+' '+why.market.meaning)+'</p><small>'+escapeHtml(why.market.impact)+'</small></div>',
          '<div class="why-card"><strong>Macro & events</strong><p>'+escapeHtml(why.macro.observed+' '+why.macro.meaning)+'</p><small>'+escapeHtml(why.macro.impact)+'</small></div>',
          '<div class="why-card"><strong>Trade quality</strong><p>'+escapeHtml(why.trade.observed+' '+why.trade.meaning)+'</p><small>'+escapeHtml(why.trade.impact)+'</small></div>',
        '</div>',
        (blockersPlain.length?'<div class="plain-blockers"><strong>Main reasons for no trade</strong><ul>'+blockersPlain.slice(0,5).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul></div>':''),
      '</details>',
      '<details class="change-details"><summary>What could change the view?</summary><p class="change-intro">These are the market developments that would actually make the current assessment stronger, weaker or tradeable:</p><ul>'+changes.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul></details>',
      '<details class="assessment-future"><summary>Future performance scorecard</summary><p>'+(outcomeAssessment?('Outcome: '+escapeHtml(outcomeAssessment.outcome||'Assessed')+' · Horizon '+escapeHtml(outcomeAssessment.assessment_horizon||'—')+(outcomeAssessment.score!=null?' · Score '+escapeHtml(outcomeAssessment.score):'')):'Not due yet. This forecast will be scored after its D+1 to D+5 outcomes are available. That scorecard measures forecast/recommendation performance; it is separate from the run assessment above.')+'</p></details>',
      '<details class="tech-details"><summary>Advanced details</summary><div class="tech-body">',
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

    const trackedId=activeNiftyRequestId();
    let tracked=trackedId?await fetchExactNiftyRequest(trackedId).catch(error=>{console.error('Exact EDGE NIFTY request read failed',error);return null}):null;
    let latestReq=tracked?.request||null;
    let f=tracked?.run?{run:tracked.run}:await fetch('/api/5dr/latest',{cache:'no-store'}).then(r=>r.json());

    let active=Boolean(latestReq)&&!['COMPLETED','FAILED','CANCELLED'].includes(String(latestReq.status));
    const activeStage=latestReq&&latestReq.metadata?String(latestReq.metadata.adapter_stage||''):'';
    const autoResumableStages=new Set(['AUTOMATED_MARKET_DATA_PENDING','AUTOMATED_MARKET_DATA_READY','EVIDENCE_READY','SCREENSHOTS_READY','VISION_READY','RESEARCH_RETRIEVED','AUTONOMOUS_EVIDENCE_READY','INTELLIGENCE_BLOCKED','INTELLIGENCE_READY','NORMALIZATION_BLOCKED','NORMALIZED_READY']);
    const shouldAutoResume=active&&latestReq&&['READY_FOR_ENGINE','PROCESSING'].includes(String(latestReq.status))&&(String(latestReq.status)==='PROCESSING'||autoResumableStages.has(activeStage));

    if(shouldAutoResume){
      try{
        await fetch('/api/5dr/run-requests/'+encodeURIComponent(latestReq.request_id)+'/resume-processing',{method:'POST',cache:'no-store'});
        tracked=await fetchExactNiftyRequest(latestReq.request_id).catch(()=>tracked);
        if(tracked?.request)latestReq=tracked.request;
        if(tracked?.run)f={run:tracked.run};
        active=Boolean(latestReq)&&!['COMPLETED','FAILED','CANCELLED'].includes(String(latestReq.status));
      }catch(e){console.error('EDGE NIFTY automatic progression failed',e)}
    }

    if(latestReq&&latestReq.status==='COMPLETED'&&tracked?.run){
      f={run:tracked.run};
      active=false;
      if(tracked.run.published===true)clearActiveNiftyRequest();
    }

    let matchedRequest=null,oa=null;
    if(active){
      render5dr(null,latestReq,null);
    }else if(f.run&&f.run.run_id){
      matchedRequest=(latestReq&&latestReq.run_id===f.run.run_id)?latestReq:await fetch('/api/5dr/run-request?run_id='+encodeURIComponent(f.run.run_id),{cache:'no-store'}).then(r=>r.json()).then(d=>d.request||null).catch(()=>null);
      oa=await fetch('/api/5dr/outcome-assessment?run_id='+encodeURIComponent(f.run.run_id),{cache:'no-store'}).then(r=>r.json()).then(d=>d.assessment||null).catch(()=>null);
      render5dr(f.run,matchedRequest,oa);
    }else if(latestReq&&latestReq.status==='FAILED'){
      render5dr(null,latestReq,null);
    }else{
      render5dr(null,null,null);
    }

    const ipoData=await fetch('/api/ipo-edge/snapshot',{cache:'no-store'}).then(r=>r.json()).catch(()=>({snapshot:null}));
    const ipoSnap=ipoData.snapshot||null,ipoPayload=ipoSnap&&ipoSnap.payload?ipoSnap.payload:null;
    renderIpoSnapshot(ipoSummary,ipoPayload?[{run_id:'IPO-SNAPSHOT-'+String(ipoSnap.captured_at||''),generated_at:ipoSnap.captured_at,framework_version:ipoPayload.framework_version||'1.1',result:{...ipoPayload,current_issues:ipoPayload.issues||[]}}]:[]);
    await loadRecentResults(activeModule);
    if(active)setTimeout(()=>loadDashboard(),5000);
  }catch(e){
    console.error(e);health.textContent='Offline';fiveDrState.textContent='ERROR';fiveDrSummary.innerHTML='<div class="generic-empty">Unable to load EDGE NIFTY integration status.</div>';renderIpoSnapshot(ipoSummary,[]);runs.innerHTML='<div class="generic-empty">Unable to load recent results.</div>';runsNote.textContent='Unavailable'
  }
}
setActiveModule('5DR');
loadDashboard();

// Canonical EDGE Stocks prompt-driven command surface retained from production main.
const edgeCommandForm=document.getElementById('edgeCommandForm'),edgeCommandInput=document.getElementById('edgeCommandInput'),edgeCommandButton=document.getElementById('edgeCommandButton'),edgeCommandStatus=document.getElementById('edgeCommandStatus');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clearEdgeCommandStatus=()=>{edgeCommandStatus.className='upload-status';edgeCommandStatus.textContent='';};
async function pollEdgeInvocation(nextUrl){
  for(let i=0;i<24;i++){
    const r=await fetch(nextUrl,{cache:'no-store'}),d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Could not check EDGE invocation status.');
    if(d.status==='COMPLETE')return d;
    edgeCommandStatus.className='upload-status working';
    edgeCommandStatus.textContent='Governed EDGE run dispatched · waiting for a newly published V1.3 recommendation…';
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
      const r=await fetch('/api/edge-stocks/invoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,force_new:true})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.detail?((d.error||'EDGE dispatch failed')+' · '+d.detail):(d.error||'EDGE dispatch failed'));
      if(d.ticker)localStorage.setItem('edge-console-selected-stock',d.ticker);if(d.status==='ALREADY_PUBLISHED_TODAY'){
        throw new Error('Fresh EDGE run was requested, but the server attempted to reuse an earlier result. The older result was not accepted as this run.');
      }
      edgeCommandStatus.textContent='Dispatched '+d.ticker+' · monitoring for governed publication…';
      const completed=await pollEdgeInvocation(d.next);
      if(completed){
        edgeCommandStatus.className='upload-status success';
        edgeCommandStatus.textContent='EDGE '+completed.ticker+' complete · loading published result…';
        if(window.refreshEdgeLive){
          await window.refreshEdgeLive();
          clearEdgeCommandStatus();
        }else{
          window.location.reload();
        }
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
