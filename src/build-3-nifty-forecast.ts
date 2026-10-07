import type { Build3EvidenceSnapshot } from './build-3-evidence-snapshot';
import {
  BUILD3_FORECAST_VERSION,
  assertBuild3Forecast,
  type Build3Forecast,
  type Build3ForecastHorizon,
  type Build3Regime,
  type Build3Zone,
} from './build-3-forecast-contract';
import { BUILD3_HORIZONS, type Build3TargetSession } from './build-3-run-contract';

export const LEGACY_FIVEDR_HORIZON_ORDER=['D+1','D+2','D+3','D+4','D+5'] as const;

type GeometryRow={
  horizon:(typeof BUILD3_HORIZONS)[number];
  target_session:string;
  expected_centre:number;
  core_zone:Build3Zone;
  outer_zone:Build3Zone;
};

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const numberOrNull=(value:unknown):number|null=>{
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};

function direction(value:unknown):'BULL'|'RANGE'|'BEAR'{
  if(value==='BULLISH')return 'BULL';
  if(value==='BEARISH')return 'BEAR';
  if(value==='RANGE')return 'RANGE';
  throw new Error('BUILD3_NIFTY_DIRECTION_INVALID');
}

export function extractNiftyReferencePrice(snapshot:Build3EvidenceSnapshot):number|null{
  const root=isObject(snapshot.evidence)?snapshot.evidence:{};
  const context=isObject(root.issuance_context)?root.issuance_context:{};

  const automated=isObject(context.automated_market_evidence)?context.automated_market_evidence:{};
  const observations=Array.isArray(automated.observations)?automated.observations.filter(isObject):[];
  for(const observation of observations){
    if(observation.category!=='PRICE_TECHNICALS')continue;
    const data=isObject(observation.structured_data)?observation.structured_data:{};
    const nifty=isObject(data.nifty)?data.nifty:{};
    const spot=isObject(nifty.spot)?nifty.spot:{};
    const price=numberOrNull(spot.last_price);
    if(price!==null&&price>0)return price;
  }

  const screenshot=isObject(context.screenshot_intelligence)?context.screenshot_intelligence:{};
  const screenshotObs=Array.isArray(screenshot.observations)?screenshot.observations.filter(isObject):[];
  const prices:number[]=[];
  for(const observation of screenshotObs){
    const findings=Array.isArray(observation.findings)?observation.findings.filter(isObject):[];
    for(const finding of findings){
      if(!/^(Current Price|Spot Price|Underlying Value|Index Value)$/i.test(String(finding.label??'')))continue;
      const parsed=Number(String(finding.value??'').replace(/[^0-9.\-]/g,''));
      if(Number.isFinite(parsed)&&parsed>1000)prices.push(parsed);
    }
  }
  if(prices.length){
    const sorted=[...prices].sort((a,b)=>a-b);
    const m=Math.floor(sorted.length/2);
    return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;
  }

  const research=isObject(context.system_research_acquisition)?context.system_research_acquisition:{};
  const snapshots=Array.isArray(research.snapshots)?research.snapshots.filter(isObject):[];
  for(const item of snapshots){
    if(item.source_id!=='NSE_ALL_INDICES'||item.status!=='RETRIEVED'||typeof item.excerpt!=='string')continue;
    try{
      const parsed=JSON.parse(item.excerpt);
      const rows=Array.isArray(parsed?.data)?parsed.data:[];
      const nifty=rows.find((row:unknown)=>isObject(row)&&row.index==='NIFTY 50');
      if(isObject(nifty)){
        const price=numberOrNull(nifty.last);
        if(price!==null&&price>0)return price;
      }
    }catch{}
  }
  return null;
}

export function buildNiftyBuild3Forecast(input:{
  source_id:string;
  model_version:string;
  issued_at:string;
  result:Record<string,unknown>;
  target_sessions:Build3TargetSession[];
  geometry?:GeometryRow[];
  reference_price_p0:number;
  evidence_snapshot_id:string;
  evidence_hash:string;
}):Build3Forecast{
  if(input.target_sessions.length!==5||(input.geometry&&input.geometry.length!==5))throw new Error('BUILD3_NIFTY_REQUIRES_FIVE_HORIZONS');
  const slots=isObject(input.result.horizon_slots)?input.result.horizon_slots:{};
  const regime=String(input.result.regime??(isObject(input.result.engine_diagnostics)?input.result.engine_diagnostics.regime:''));
  if(!['TREND','RANGE','TRANSITION','EVENT_SHOCK'].includes(regime))throw new Error('BUILD3_NIFTY_REGIME_INVALID');

  const horizons:Build3ForecastHorizon[]=BUILD3_HORIZONS.map((horizon,index)=>{
    const legacyKey=LEGACY_FIVEDR_HORIZON_ORDER[index];
    const slot=isObject(slots[legacyKey])?slots[legacyKey]:null;
    if(!slot)throw new Error(`BUILD3_NIFTY_LEGACY_SLOT_MISSING:${legacyKey}`);
    const probs=isObject(slot.probabilities)?slot.probabilities:{};
    const target=input.target_sessions[index];
    const suppliedGeometry=input.geometry?.[index];
    let expectedCentre:number;
    let coreZone:Build3Zone;
    let outerZone:Build3Zone;
    let coreZoneKind:'CALIBRATED'|'CENTRE_ONLY';
    if(suppliedGeometry){
      if(target.horizon!==horizon||suppliedGeometry.horizon!==horizon||suppliedGeometry.target_session!==target.target_session){
        throw new Error(`BUILD3_NIFTY_SESSION_IDENTITY_MISMATCH:${horizon}`);
      }
      expectedCentre=suppliedGeometry.expected_centre;
      coreZone=suppliedGeometry.core_zone;
      outerZone=suppliedGeometry.outer_zone;
      coreZoneKind='CALIBRATED';
    }else{
      if(target.horizon!==horizon)throw new Error(`BUILD3_NIFTY_SESSION_IDENTITY_MISMATCH:${horizon}`);
      const low=numberOrNull(slot.zone_low);
      const high=numberOrNull(slot.zone_high);
      if(low===null||high===null||low<=0||high<=low)throw new Error(`BUILD3_NIFTY_LEGACY_ZONE_INVALID:${legacyKey}`);
      expectedCentre=(low+high)/2;
      coreZone={low:expectedCentre,high:expectedCentre};
      outerZone={low,high};
      coreZoneKind='CENTRE_ONLY';
    }
    return {
      horizon,
      target_session:target.target_session,
      direction:direction(slot.direction),
      probabilities:{BULL:Number(probs.BULL),RANGE:Number(probs.RANGE),BEAR:Number(probs.BEAR)},
      regime:regime as Build3Regime,
      reasoning:String(slot.basis??'').trim(),
      expected_centre:expectedCentre,
      core_zone_kind:coreZoneKind,
      core_zone:coreZone,
      outer_zone:outerZone,
    };
  });
  return assertBuild3Forecast({
    forecast_version:BUILD3_FORECAST_VERSION,
    engine:'5DR',
    instrument:'NIFTY',
    source_id:input.source_id,
    model_version:input.model_version,
    issued_at:new Date(input.issued_at).toISOString(),
    reference_price_p0:input.reference_price_p0,
    evidence_snapshot_id:input.evidence_snapshot_id,
    evidence_hash:input.evidence_hash,
    data_quality_state:'VERIFIED',
    horizons,
  });
}
