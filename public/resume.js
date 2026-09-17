const summary=document.getElementById('fiveDrSummary');

async function postStage(requestId,suffix){
  const response=await fetch('/api/5dr/run-requests/'+encodeURIComponent(requestId)+'/'+suffix,{method:'POST'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const detail=data.error||(data.intelligence_reconciliation&&Array.isArray(data.intelligence_reconciliation.errors)?data.intelligence_reconciliation.errors[0]:null)||'5DR processing stage failed.';
    throw new Error(detail);
  }
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

async function installResumeControl(){
  if(!summary)return;
  try{
    const response=await fetch('/api/5dr/run-requests/latest');
    const data=await response.json();
    const request=data&&data.request;
    if(!request||request.status!=='READY_FOR_ENGINE')return;
    const metadata=request.metadata||{};
    if(metadata.adapter_stage!=='SCREENSHOTS_READY')return;
    if(document.getElementById('resume5drRequest'))return;
    const wrap=document.createElement('div');
    wrap.className='run';
    const button=document.createElement('button');
    button.id='resume5drRequest';
    button.type='button';
    button.className='primary';
    button.textContent='Continue this 5DR run';
    const status=document.createElement('p');
    status.className='muted';
    status.textContent='Uses the 5 already-secured screenshots. No re-upload required.';
    button.addEventListener('click',()=>resumeRequest(button,status,request.request_id));
    wrap.append(button,status);
    summary.appendChild(wrap);
  }catch(error){
    console.error('resume control unavailable',error);
  }
}

window.addEventListener('load',()=>setTimeout(installResumeControl,400));