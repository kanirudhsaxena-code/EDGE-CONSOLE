const summary=document.getElementById('fiveDrSummary');
let latestEligibleRequest=null;

function stageError(data){
  if(data&&typeof data.error==='string'&&data.error)return data.error;
  if(data&&Array.isArray(data.blockers)&&data.blockers.length){
    const blocker=data.blockers[0]||{};
    if(Array.isArray(blocker.limitations)&&blocker.limitations.length)return String(blocker.limitations[0]);
  }
  if(data&&data.intelligence_reconciliation&&Array.isArray(data.intelligence_reconciliation.errors)&&data.intelligence_reconciliation.errors.length)return String(data.intelligence_reconciliation.errors[0]);
  if(data&&data.gate&&typeof data.gate.error==='string')return data.gate.error;
  return '5DR processing stage failed.';
}

async function postStage(requestId,suffix){
  const response=await fetch('/api/5dr/run-requests/'+encodeURIComponent(requestId)+'/'+suffix,{method:'POST'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(stageError(data));
  return data;
}

async function resumeRequest(button,statusNode,requestId){
  button.disabled=true;
  try{
    statusNode.textContent='Interpreting screenshot evidence…';
    await postStage(requestId,'shadow-vision');
    statusNode.textContent='Acquiring current system-owned research…';
    await postStage(requestId,'system-research');
    statusNode.textContent='Reconciling intelligence, normalizing inputs and dispatching 5DR…';
    const result=await postStage(requestId,'reconcile-intelligence');
    statusNode.textContent=result.status==='PROCESSING'?'Engine dispatched successfully. Refreshing…':'Pipeline advanced successfully. Refreshing…';
    setTimeout(()=>location.reload(),1200);
  }catch(error){
    statusNode.textContent=(error&&error.message?error.message:'Processing failed.')+' Request remains fail-closed.';
    button.disabled=false;
    button.textContent='Retry processing';
  }
}

function renderResumeControl(request){
  if(!summary||!request)return;
  if(document.getElementById('resume5drRequest'))return;
  const wrap=document.createElement('div');
  wrap.className='run';
  wrap.id='resume5drWrap';
  const button=document.createElement('button');
  button.id='resume5drRequest';
  button.type='button';
  button.className='primary';
  button.textContent='Continue this 5DR run';
  const status=document.createElement('p');
  status.className='muted';
  status.textContent='Uses the already-secured screenshots. No re-upload required.';
  button.addEventListener('click',()=>resumeRequest(button,status,request.request_id));
  wrap.append(button,status);
  summary.appendChild(wrap);
}

function ensureResumeControl(){
  if(!latestEligibleRequest)return;
  renderResumeControl(latestEligibleRequest);
}

async function loadEligibleRequest(){
  if(!summary)return;
  try{
    const response=await fetch('/api/5dr/run-requests/latest',{cache:'no-store'});
    const data=await response.json();
    const request=data&&data.request;
    const metadata=request&&request.metadata?request.metadata:{};
    if(request&&request.status==='READY_FOR_ENGINE'&&metadata.adapter_stage==='SCREENSHOTS_READY'){
      latestEligibleRequest=request;
      ensureResumeControl();
    }
  }catch(error){
    console.error('resume control unavailable',error);
  }
}

if(summary){
  const observer=new MutationObserver(()=>ensureResumeControl());
  observer.observe(summary,{childList:true,subtree:true});
}
window.addEventListener('load',()=>{
  setTimeout(loadEligibleRequest,150);
  setTimeout(ensureResumeControl,800);
  setTimeout(ensureResumeControl,1600);
});