import router from './router';
import { createAutomatedRun, resumeProcessing } from './mobile-v1-entry';
import { dispatch5drAssessmentRefresh, type EngineDispatchEnv } from './engine-dispatch';

type JsonRecord=Record<string,unknown>;
type PreopenEnv=EngineDispatchEnv&{
  DATABASE_URL?:string;
  EDGE_DATABASE_URL?:string;
  EDGE_GITHUB_TOKEN?:string;
  APP_ENV?:string;
  OUTPUT_CONTRACT_VERSION?:string;
};

export type PreopenTick='PREP'|'AUCTION'|'OUTSIDE';

export const REQUIRED_PREOPEN_STOCK_TICKERS=['LTF','CUPID','RELIANCE'] as const;

function istClock(now:Date):{weekday:string;date:string;hour:number;minute:number;slot:string}{
  const parts=Object.fromEntries(
    new Intl.DateTimeFormat('en-US',{
      timeZone:'Asia/Kolkata',
      weekday:'short',
      year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value])
  );
  const hour=Number(parts.hour),minute=Number(parts.minute);
  return {
    weekday:String(parts.weekday),
    date:`${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
    slot:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`
  };
}

export function classifyPreopenTick(now:Date):PreopenTick{
  const c=istClock(now);
  if(!['Mon','Tue','Wed','Thu','Fri'].includes(c.weekday))return 'OUTSIDE';
  if(c.hour===8&&c.minute===50)return 'PREP';
  if(c.hour===9&&c.minute>=10&&c.minute<=14)return 'AUCTION';
  return 'OUTSIDE';
}

async function responseJson(response:Response):Promise<JsonRecord>{
  try{
    const body=await response.json();
    return body&&typeof body==='object'&&!Array.isArray(body)?body as JsonRecord:{};
  }catch{return {}}
}

async function stockTargets(env:PreopenEnv):Promise<JsonRecord[]>{
  const response=await router.fetch(new Request('https://edge-console.internal/api/edge-stocks/canonical-targets'),env as never);
  if(!response.ok){
    console.error('PREOPEN_STOCK_TARGETS_BLOCKED',response.status,await response.text());
    return [];
  }
  const body=await responseJson(response);
  const discovered=Array.isArray(body.canonical_targets)
    ?body.canonical_targets.filter((x):x is JsonRecord=>!!x&&typeof x==='object'&&!Array.isArray(x))
    :[];
  const byTicker=new Map(discovered.map(row=>[String(row.ticker??'').trim().toUpperCase(),row]));
  // G5.1 Monday acceptance requires these three governed stock targets regardless
  // of whether the open-call discovery view happens to omit one at prep time.
  // Preserve any additional governed targets while guaranteeing the required set.
  for(const ticker of REQUIRED_PREOPEN_STOCK_TICKERS){
    if(!byTicker.has(ticker))byTicker.set(ticker,{ticker,forecast_horizon:'D:D+4',latest_research_fresh_at:null,required_preopen_target:true});
  }
  return [...byTicker.values()].filter(row=>String(row.ticker??'').trim().length>0);
}

async function prep(env:PreopenEnv,now:Date):Promise<void>{
  const clock=istClock(now);
  const researchNotBefore=new Date(`${clock.date}T03:20:00.000Z`).toISOString();
  const [targets,assessment]=await Promise.all([
    stockTargets(env),
    dispatch5drAssessmentRefresh(
      env,
      `preopen-prep-${clock.date}`,
      env.FIVEDR_CALLBACK_URL?.trim()||'https://edge-console.k-anirudhsaxena.workers.dev',
      fetch
    )
  ]);

  const niftyPrepRequest=new Request('https://edge-console.internal/api/5dr/automated-runs',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      force_new:true,
      prep_only:true,
      client_invocation_id:`cf-preopen-prep-${clock.date}`,
      assessment:{objective:'BOTH',risk_posture:'CONSERVATIVE',capital_priority:'CAPITAL_PROTECTION'}
    })
  });
  const niftyPrepResponse=await createAutomatedRun(niftyPrepRequest,env as never);
  const niftyPrepBody=await responseJson(niftyPrepResponse);

  const readiness=targets.map(target=>{
    const ticker=String(target.ticker??'').toUpperCase();
    const freshAt=typeof target.latest_research_fresh_at==='string'?Date.parse(target.latest_research_fresh_at):NaN;
    return {
      ticker,
      research_ready:Number.isFinite(freshAt)&&freshAt>=Date.parse(researchNotBefore),
      research_refresh_required:!(Number.isFinite(freshAt)&&freshAt>=Date.parse(researchNotBefore)),
      latest_research_fresh_at:target.latest_research_fresh_at??null,
      research_not_before:researchNotBefore
    };
  });
  console.log(JSON.stringify({
    status:'PREOPEN_PREP_STARTED',
    date:clock.date,
    slot:clock.slot,
    research_not_before:researchNotBefore,
    assessment_refresh_dispatched:assessment.ok,
    nifty_prep_http_status:niftyPrepResponse.status,
    nifty_prep_request_id:(niftyPrepBody.request as JsonRecord|undefined)?.request_id??niftyPrepBody.request_id??null,
    nifty_prep_state:niftyPrepBody.status??(niftyPrepBody.request as JsonRecord|undefined)?.status??null,
    nifty_prep_next_step:niftyPrepBody.next_step??null,
    stock_research_readiness:readiness,
    canonical_created:false,
    trading_enabled:false
  }));
}

async function auction(env:PreopenEnv,now:Date):Promise<void>{
  const clock=istClock(now);
  // Runtime wall clock remains authoritative. Cloudflare Cron is only the precise wake-up source.
  if(classifyPreopenTick(now)!=='AUCTION')return;

  const niftyRequest=new Request('https://edge-console.internal/api/5dr/automated-runs',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      force_new:true,
      canonical_attempt:true,
      canonical_attempt_slot:clock.slot,
      client_invocation_id:`cf-preopen-${clock.date}`,
      assessment:{objective:'BOTH',risk_posture:'CONSERVATIVE',capital_priority:'CAPITAL_PROTECTION'}
    })
  });
  const nifty=await createAutomatedRun(niftyRequest,env as never);
  let niftyBody=await responseJson(nifty);
  const niftyRequestId=String(niftyBody.request_id??(niftyBody.request as JsonRecord|undefined)?.request_id??'');
  let niftyState=String(niftyBody.status??(niftyBody.request as JsonRecord|undefined)?.status??'');
  let resumed:JsonRecord|null=null;
  if(niftyRequestId&&niftyState!=='COMPLETED'){
    const resumeRequest=new Request(`https://edge-console.internal/api/5dr/run-requests/${encodeURIComponent(niftyRequestId)}/resume-processing`,{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'
    });
    const resumeResponse=await resumeProcessing(resumeRequest,env as never,niftyRequestId);
    resumed=await responseJson(resumeResponse);
    niftyState=String(resumed.status??niftyState);
    if(String(resumed.adapter_stage??'')==='AUTOMATED_MARKET_DATA_BLOCKED'){
      const retryRequest=new Request('https://edge-console.internal/api/5dr/automated-runs',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          force_new:true,
          canonical_attempt:true,
          canonical_attempt_slot:clock.slot,
          client_invocation_id:`cf-preopen-${clock.date}`,
          assessment:{objective:'BOTH',risk_posture:'CONSERVATIVE',capital_priority:'CAPITAL_PROTECTION'}
        })
      });
      const retry=await createAutomatedRun(retryRequest,env as never);
      niftyBody=await responseJson(retry);
      niftyState=String(niftyBody.status??niftyState);
    }
  }
  console.log(JSON.stringify({
    status:'PREOPEN_NIFTY_ATTEMPT',
    slot:clock.slot,
    http_status:nifty.status,
    request_id:niftyRequestId||null,
    state:niftyState||null,
    adapter_stage:niftyBody.adapter_stage??resumed?.adapter_stage??null,
    next_step:niftyBody.next_step??resumed?.next_step??null,
    idempotent:niftyBody.idempotent??false,
    trading_enabled:false
  }));

  const researchNotBefore=new Date(`${clock.date}T03:20:00.000Z`).toISOString();
  const targets=await stockTargets(env);
  for(const target of targets){
    const ticker=String(target.ticker??'').trim().toUpperCase();
    if(!ticker)continue;
    const request=new Request('https://edge-console.internal/api/edge-stocks/invoke',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        command:`EDGE ${ticker}`,
        force_new:true,
        canonical_attempt:true,
        canonical_attempt_slot:clock.slot,
        canonical_requested_at:now.toISOString(),
        research_not_before:researchNotBefore
      })
    });
    const response=await router.fetch(request,env as never);
    const body=await responseJson(response);
    console.log(JSON.stringify({
      status:'PREOPEN_STOCK_ATTEMPT',
      ticker,
      slot:clock.slot,
      http_status:response.status,
      state:body.status??body.code??'BLOCKED',
      run_id:body.run_id??null,
      research_bundle_id:body.research_bundle_id??null,
      trading_enabled:false
    }));
  }
}

export async function runPreopenScheduledTick(env:PreopenEnv,now=new Date(),scheduledTime?:number):Promise<void>{
  const tick=classifyPreopenTick(now);
  if(tick==='OUTSIDE'){
    console.log(JSON.stringify({status:'PREOPEN_CRON_OUTSIDE_WINDOW',actual:now.toISOString(),scheduled_time:scheduledTime??null,trading_enabled:false}));
    return;
  }
  if(tick==='PREP')return prep(env,now);
  return auction(env,now);
}
