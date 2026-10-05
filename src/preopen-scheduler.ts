import router, { persistEdgeResearchBundle } from './router';
import { createAutomatedRun, refreshPreopenPrepResearch, resumeProcessing } from './mobile-v1-entry';
import { dispatch5drAssessmentRefresh, type EngineDispatchEnv } from './engine-dispatch';
import { dispatchEdgeAuctionWorkflow, dispatchEdgeDataWorkflow } from './edge-command';
import {
  ensureStockLifecycle,
  getStockLifecycle,
  markStockAuctionBlocked,
  markStockAuctionPending,
  markStockDataBlocked,
  markStockResearchBlocked,
  markStockResearchPending,
  preopenStockLifecycleId,
  readMarketSnapshotPayload,
} from './stock-lifecycle';
import { produceStockSystemResearch } from './stock-system-research';

type JsonRecord=Record<string,unknown>;
type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type PreopenEnv=EngineDispatchEnv&{
  DATABASE_URL?:string;
  EDGE_DATABASE_URL?:string;
  EDGE_GITHUB_TOKEN?:string;
  APP_ENV?:string;
  OUTPUT_CONTRACT_VERSION?:string;
  AI:AiBinding;
};

export type PreopenTick='PREP'|'RESEARCH'|'AUCTION'|'OUTSIDE';

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
  if(c.hour===9&&c.minute>=5&&c.minute<=9)return 'RESEARCH';
  if(c.hour===9&&c.minute>=10&&c.minute<=14)return 'AUCTION';
  return 'OUTSIDE';
}

async function responseJson(response:Response):Promise<JsonRecord>{
  try{
    const body=await response.json();
    return body&&typeof body==='object'&&!Array.isArray(body)?body as JsonRecord:{};
  }catch{return {}}
}

async function prep(env:PreopenEnv,now:Date):Promise<void>{
  const clock=istClock(now);

  // NIFTY uses its existing governed pre-open acquisition -> system-research
  // path. The 09:05 stage below performs a separate fresh delta-research pass.
  const assessment=await dispatch5drAssessmentRefresh(
    env,
    `preopen-prep-${clock.date}`,
    env.FIVEDR_CALLBACK_URL?.trim()||'https://edge-console.k-anirudhsaxena.workers.dev',
    fetch
  );
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

  const stocks:JsonRecord[]=[];
  for(const ticker of REQUIRED_PREOPEN_STOCK_TICKERS){
    const lifecycleId=preopenStockLifecycleId(clock.date,ticker);
    try{
      let lifecycle=await ensureStockLifecycle(env,{
        lifecycle_id:lifecycleId,
        ticker,
        trigger_type:'SCHEDULED',
        target_session:clock.date,
      });
      let dispatch:JsonRecord|null=null;
      if(['RUN_CREATED','DATA_BLOCKED'].includes(lifecycle.stage)){
        const started=await dispatchEdgeDataWorkflow(env.EDGE_GITHUB_TOKEN??'',{
          ticker,
          lifecycle_id:lifecycleId,
          trigger_type:'SCHEDULED',
          target_session:clock.date,
        });
        dispatch={ok:started.ok,status:started.status,error:started.error??null};
        if(!started.ok){
          await markStockDataBlocked(env,lifecycleId,`DATA dispatch failed: ${started.error??started.status}`);
        }
        lifecycle=(await getStockLifecycle(env,lifecycleId))??lifecycle;
      }
      stocks.push({
        ticker,
        lifecycle_id:lifecycleId,
        lifecycle_stage:lifecycle.stage,
        market_snapshot_id:lifecycle.market_snapshot_id,
        data_dispatch:dispatch,
      });
    }catch(error){
      stocks.push({
        ticker,
        lifecycle_id:lifecycleId,
        lifecycle_stage:'DATA_BLOCKED',
        error:error instanceof Error?error.message:String(error),
      });
    }
  }

  console.log(JSON.stringify({
    status:'PREOPEN_PREP_STARTED',
    date:clock.date,
    slot:clock.slot,
    assessment_refresh_dispatched:assessment.ok,
    nifty:{
      http_status:niftyPrepResponse.status,
      request_id:(niftyPrepBody.request as JsonRecord|undefined)?.request_id??niftyPrepBody.request_id??null,
      state:niftyPrepBody.status??(niftyPrepBody.request as JsonRecord|undefined)?.status??null,
      next_step:niftyPrepBody.next_step??null,
    },
    stocks,
    invariant:'DATA_FIRST',
    canonical_created:false,
    trading_enabled:false
  }));
}

async function research(env:PreopenEnv,now:Date):Promise<void>{
  const clock=istClock(now);
  const niftyDelta=await refreshPreopenPrepResearch(env as never,clock.date);
  const niftyDeltaBody=await responseJson(niftyDelta);
  const stocks:JsonRecord[]=[];

  for(const ticker of REQUIRED_PREOPEN_STOCK_TICKERS){
    const lifecycleId=preopenStockLifecycleId(clock.date,ticker);
    try{
      let lifecycle=await getStockLifecycle(env,lifecycleId);
      if(!lifecycle){
        stocks.push({ticker,lifecycle_id:lifecycleId,status:'RESEARCH_BLOCKED',blocker:'LIFECYCLE_MISSING'});
        continue;
      }

      // A DATA-stage failure may be retried during the bounded 09:05-09:09
      // readiness window. No research runs until the retry reaches DATA_READY.
      if(lifecycle.stage==='DATA_BLOCKED'){
        const retried=await dispatchEdgeDataWorkflow(env.EDGE_GITHUB_TOKEN??'',{
          ticker,
          lifecycle_id:lifecycleId,
          trigger_type:'SCHEDULED',
          target_session:clock.date,
        });
        if(!retried.ok)await markStockDataBlocked(env,lifecycleId,`DATA retry dispatch failed: ${retried.error??retried.status}`);
        stocks.push({
          ticker,lifecycle_id:lifecycleId,status:'WAITING_FOR_DATA_RETRY',
          dispatch_ok:retried.ok,dispatch_status:retried.status
        });
        continue;
      }

      if(lifecycle.stage==='RESEARCH_READY'||lifecycle.stage==='AUCTION_PENDING'||lifecycle.stage==='AUCTION_READY'||lifecycle.stage==='COMPUTE_PENDING'||lifecycle.stage==='PERSISTED'||lifecycle.stage==='PRESENTED'){
        stocks.push({
          ticker,lifecycle_id:lifecycleId,status:'RESEARCH_READY',
          market_snapshot_id:lifecycle.market_snapshot_id,
          research_bundle_id:lifecycle.research_bundle_id,
          idempotent:true
        });
        continue;
      }

      if(lifecycle.stage!=='DATA_READY'){
        stocks.push({
          ticker,lifecycle_id:lifecycleId,status:'WAITING_FOR_DATA',
          lifecycle_stage:lifecycle.stage,
          market_snapshot_id:lifecycle.market_snapshot_id
        });
        continue;
      }

      if(!lifecycle.market_snapshot_id)throw new Error('DATA_READY lifecycle has no market_snapshot_id');
      const marketSnapshotId=lifecycle.market_snapshot_id;
      lifecycle=await markStockResearchPending(env,lifecycleId,marketSnapshotId);
      const snapshot=await readMarketSnapshotPayload(env,lifecycleId,marketSnapshotId);
      if(!snapshot)throw new Error('immutable DATA snapshot readback failed');

      try{
        const produced=await produceStockSystemResearch(env,{
          ticker,
          lifecycle_id:lifecycleId,
          market_snapshot_id:marketSnapshotId,
          data_captured_at:snapshot.captured_at,
          market_payload:snapshot.payload,
        },fetch);
        const saved=await persistEdgeResearchBundle(env as never,produced.bundle,ticker);
        if(!saved.bundleId)throw new Error(saved.error??'governed research persistence failed');
        const ready=await getStockLifecycle(env,lifecycleId);
        stocks.push({
          ticker,
          lifecycle_id:lifecycleId,
          status:ready?.stage??'RESEARCH_READY',
          market_snapshot_id:marketSnapshotId,
          research_bundle_id:saved.bundleId,
          research_model:produced.model,
          source_failures:produced.source_failures,
          sequence_proof:{
            data_captured_at:snapshot.captured_at,
            research_fresh_at:produced.bundle.research_fresh_at,
            research_after_data:Date.parse(produced.bundle.research_fresh_at)>=Date.parse(snapshot.captured_at)
          }
        });
      }catch(error){
        const detail=error instanceof Error?error.message:String(error);
        await markStockResearchBlocked(env,lifecycleId,detail);
        stocks.push({ticker,lifecycle_id:lifecycleId,status:'RESEARCH_BLOCKED',blocker:detail});
      }
    }catch(error){
      const detail=error instanceof Error?error.message:String(error);
      try{await markStockResearchBlocked(env,lifecycleId,detail)}catch{}
      stocks.push({ticker,lifecycle_id:lifecycleId,status:'RESEARCH_BLOCKED',blocker:detail});
    }
  }

  console.log(JSON.stringify({
    status:'PREOPEN_RESEARCH_READINESS',
    date:clock.date,
    slot:clock.slot,
    nifty_delta:{
      http_status:niftyDelta.status,
      status:niftyDeltaBody.status??'BLOCKED',
      request_id:niftyDeltaBody.request_id??null,
      research_manifest_complete:niftyDeltaBody.research_manifest_complete??false,
      missing_dimensions:niftyDeltaBody.missing_dimensions??[]
    },
    stocks,
    invariant:'DATA_THEN_RESEARCH',
    canonical_created:false,
    trading_enabled:false
  }));
}

async function attemptNiftyAuction(env:PreopenEnv,clock:ReturnType<typeof istClock>):Promise<JsonRecord>{
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
  const requestId=String(niftyBody.request_id??(niftyBody.request as JsonRecord|undefined)?.request_id??'');
  let state=String(niftyBody.status??(niftyBody.request as JsonRecord|undefined)?.status??'');
  let resumed:JsonRecord|null=null;
  if(requestId&&state!=='COMPLETED'){
    const resumeRequest=new Request(`https://edge-console.internal/api/5dr/run-requests/${encodeURIComponent(requestId)}/resume-processing`,{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'
    });
    const resumeResponse=await resumeProcessing(resumeRequest,env as never,requestId);
    resumed=await responseJson(resumeResponse);
    state=String(resumed.status??state);
    if(String(resumed.adapter_stage??'')==='AUTOMATED_MARKET_DATA_BLOCKED'){
      const retry=await createAutomatedRun(niftyRequest,env as never);
      niftyBody=await responseJson(retry);
      state=String(niftyBody.status??state);
    }
  }
  return {
    http_status:nifty.status,
    request_id:requestId||null,
    state:state||null,
    adapter_stage:niftyBody.adapter_stage??resumed?.adapter_stage??null,
    next_step:niftyBody.next_step??resumed?.next_step??null,
    idempotent:niftyBody.idempotent??false,
  };
}

async function auction(env:PreopenEnv,now:Date):Promise<void>{
  const clock=istClock(now);
  if(classifyPreopenTick(now)!=='AUCTION')return;

  const nifty=await attemptNiftyAuction(env,clock);
  const stocks:JsonRecord[]=[];

  for(const ticker of REQUIRED_PREOPEN_STOCK_TICKERS){
    const lifecycleId=preopenStockLifecycleId(clock.date,ticker);
    try{
      let lifecycle=await getStockLifecycle(env,lifecycleId);
      if(!lifecycle){
        stocks.push({ticker,lifecycle_id:lifecycleId,status:'MISSING',blocker:'LIFECYCLE_MISSING'});
        continue;
      }

      if(lifecycle.stage==='RESEARCH_READY'||lifecycle.stage==='AUCTION_BLOCKED'){
        lifecycle=await markStockAuctionPending(env,lifecycleId);
        const dispatched=await dispatchEdgeAuctionWorkflow(env.EDGE_GITHUB_TOKEN??'',{
          ticker,lifecycle_id:lifecycleId
        });
        if(!dispatched.ok){
          await markStockAuctionBlocked(env,lifecycleId,`AUCTION dispatch failed: ${dispatched.error??dispatched.status}`);
          stocks.push({
            ticker,lifecycle_id:lifecycleId,status:'AUCTION_BLOCKED',
            dispatch_status:dispatched.status,blocker:dispatched.error??'AUCTION_DISPATCH_FAILED'
          });
        }else{
          stocks.push({
            ticker,lifecycle_id:lifecycleId,status:'AUCTION_PENDING',
            dispatch_status:dispatched.status
          });
        }
        continue;
      }

      if(lifecycle.stage==='AUCTION_PENDING'){
        stocks.push({ticker,lifecycle_id:lifecycleId,status:'AUCTION_PENDING',auction_snapshot_id:lifecycle.auction_snapshot_id});
        continue;
      }

      if(['COMPUTE_DISPATCHED','COMPUTE_PENDING','PERSISTED','PRESENTED'].includes(lifecycle.stage)){
        stocks.push({
          ticker,lifecycle_id:lifecycleId,status:lifecycle.stage,
          auction_snapshot_id:lifecycle.auction_snapshot_id,
          recommendation_id:lifecycle.recommendation_id,
          idempotent:true
        });
        continue;
      }

      if(lifecycle.stage!=='AUCTION_READY'){
        stocks.push({
          ticker,lifecycle_id:lifecycleId,status:'CANONICAL_BLOCKED',
          lifecycle_stage:lifecycle.stage,
          blocker:'LIFECYCLE_NOT_AUCTION_READY'
        });
        continue;
      }

      const request=new Request('https://edge-console.internal/api/edge-stocks/invoke',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          command:`EDGE ${ticker}`,
          force_new:true,
          canonical_attempt:true,
          canonical_attempt_slot:clock.slot,
          canonical_requested_at:now.toISOString(),
          lifecycle_id:lifecycleId
        })
      });
      const response=await router.fetch(request,env as never);
      const body=await responseJson(response);
      stocks.push({
        ticker,
        lifecycle_id:lifecycleId,
        status:body.status??body.code??'BLOCKED',
        http_status:response.status,
        lifecycle_stage:lifecycle.stage,
        market_snapshot_id:body.market_snapshot_id??lifecycle.market_snapshot_id,
        research_bundle_id:body.research_bundle_id??lifecycle.research_bundle_id,
        auction_snapshot_id:body.auction_snapshot_id??lifecycle.auction_snapshot_id,
        run_id:body.run_id??null,
        trading_enabled:false
      });
    }catch(error){
      stocks.push({
        ticker,lifecycle_id:lifecycleId,status:'CANONICAL_BLOCKED',
        blocker:error instanceof Error?error.message:String(error)
      });
    }
  }

  console.log(JSON.stringify({
    status:'PREOPEN_CANONICAL_ATTEMPTS',
    date:clock.date,
    slot:clock.slot,
    nifty,
    stocks,
    invariant:'PREP_DATA_THEN_RESEARCH_THEN_AUCTION_DATA_THEN_COMPUTE',
    trading_enabled:false
  }));
}

export async function runPreopenScheduledTick(env:PreopenEnv,now=new Date(),scheduledTime?:number):Promise<void>{
  const tick=classifyPreopenTick(now);
  if(tick==='OUTSIDE'){
    console.log(JSON.stringify({status:'PREOPEN_CRON_OUTSIDE_WINDOW',actual:now.toISOString(),scheduled_time:scheduledTime??null,trading_enabled:false}));
    return;
  }
  if(tick==='PREP')return prep(env,now);
  if(tick==='RESEARCH')return research(env,now);
  return auction(env,now);
}
