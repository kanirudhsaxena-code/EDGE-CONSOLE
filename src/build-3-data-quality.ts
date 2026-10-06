import { neon } from '@neondatabase/serverless';
import { MANDATORY_EDGE_RESEARCH_CATEGORIES } from './edge-research';
import { canonicalBuild3EvidenceJson, type Build3EvidenceSnapshot } from './build-3-evidence-snapshot';
import { REQUIRED_5DR_INPUTS, isObject } from './normalization';
import type { Build3DataQualityState, Build3Engine, Build3MarketPhase } from './build-3-run-contract';

export const BUILD3_DATA_QUALITY_VERSION='MDOS_BUILD_3_DATA_QUALITY_V1' as const;

export type Build3QualityInput={
  input:string;
  required:boolean;
  state:Build3DataQualityState;
  source_refs:string[];
  max_age_minutes?:number|null;
  newest_age_minutes?:number|null;
  detail?:string|null;
};

export type Build3DataQualityAssessment={
  quality_version:typeof BUILD3_DATA_QUALITY_VERSION;
  engine:Build3Engine;
  instrument:string;
  source_id:string;
  evidence_snapshot_id:string;
  evidence_hash:string;
  assessed_at:string;
  overall_state:Build3DataQualityState;
  valid_for_forecast:boolean;
  required_inputs:Build3QualityInput[];
  optional_inputs:Build3QualityInput[];
  blockers:string[];
};

const PHASE_MAX_AGE_MINUTES:Record<Build3MarketPhase,number>={
  PRE_OPEN:90,
  OPEN:30,
  INTRADAY:30,
  POST_CLOSE:180,
  CLOSED_SESSION:1440,
};

const ageMinutes=(assessedAt:Date,value:unknown):number|null=>{
  if(typeof value!=='string'||Number.isNaN(Date.parse(value)))return null;
  return (assessedAt.getTime()-Date.parse(value))/60000;
};

function aggregateState(items:Build3QualityInput[]):Build3DataQualityState{
  if(items.some(item=>item.required&&item.state==='MISSING'))return 'MISSING';
  if(items.some(item=>item.required&&item.state==='STALE'))return 'STALE';
  if(items.some(item=>item.required&&item.state==='PARTIAL'))return 'PARTIAL';
  return 'VERIFIED';
}

function finalAssessment(
  snapshot:Build3EvidenceSnapshot,
  requiredInputs:Build3QualityInput[],
  optionalInputs:Build3QualityInput[],
):Build3DataQualityAssessment{
  const overall=aggregateState(requiredInputs);
  const blockers=requiredInputs
    .filter(item=>item.state!=='VERIFIED')
    .map(item=>`${item.input}:${item.state}`);
  return {
    quality_version:BUILD3_DATA_QUALITY_VERSION,
    engine:snapshot.engine,
    instrument:snapshot.instrument,
    source_id:snapshot.source_id,
    evidence_snapshot_id:snapshot.snapshot_id,
    evidence_hash:snapshot.evidence_hash,
    assessed_at:snapshot.frozen_at,
    overall_state:overall,
    valid_for_forecast:overall==='VERIFIED',
    required_inputs:requiredInputs,
    optional_inputs:optionalInputs,
    blockers,
  };
}

export function assessBuild3FiveDrDataQuality(
  snapshot:Build3EvidenceSnapshot,
  marketPhase:Build3MarketPhase,
):Build3DataQualityAssessment{
  const assessedAt=new Date(snapshot.frozen_at);
  const maxAge=PHASE_MAX_AGE_MINUTES[marketPhase];
  const root=isObject(snapshot.evidence)?snapshot.evidence:{};
  const packet=isObject(root.engine_input)?root.engine_input:{};
  const evidence=Array.isArray(packet.evidence)?packet.evidence.filter(isObject):[];

  const requiredInputs:Build3QualityInput[]=REQUIRED_5DR_INPUTS.map(input=>{
    const supporting=evidence.filter(item=>isObject(item.normalized)&&input in item.normalized);
    if(!supporting.length)return {
      input,required:true,state:'MISSING' as const,source_refs:[],max_age_minutes:maxAge,
      newest_age_minutes:null,detail:'No normalized evidence supplies this mandatory input'
    };
    const values=new Set(supporting.map(item=>canonicalBuild3EvidenceJson((item.normalized as Record<string,unknown>)[input])));
    const refs=supporting.map(item=>String(item.source_ref??'')).filter(Boolean);
    if(values.size>1)return {
      input,required:true,state:'PARTIAL' as const,source_refs:refs,max_age_minutes:maxAge,
      newest_age_minutes:null,detail:'Conflicting normalized values exist for this mandatory input'
    };
    const ages=supporting.map(item=>ageMinutes(assessedAt,item.captured_at)).filter((age):age is number=>age!==null);
    if(!ages.length)return {
      input,required:true,state:'PARTIAL' as const,source_refs:refs,max_age_minutes:maxAge,
      newest_age_minutes:null,detail:'Supporting evidence has no attributable capture timestamp'
    };
    const newest=Math.min(...ages);
    if(newest < -5)return {
      input,required:true,state:'PARTIAL' as const,source_refs:refs,max_age_minutes:maxAge,
      newest_age_minutes:newest,detail:'Supporting evidence timestamp is materially in the future'
    };
    if(newest>maxAge)return {
      input,required:true,state:'STALE' as const,source_refs:refs,max_age_minutes:maxAge,
      newest_age_minutes:newest,detail:`Newest supporting evidence exceeds ${maxAge} minute freshness bound`
    };
    return {
      input,required:true,state:'VERIFIED' as const,source_refs:refs,max_age_minutes:maxAge,
      newest_age_minutes:newest,detail:null
    };
  });

  return finalAssessment(snapshot,requiredInputs,[]);
}

function stockClaimState(
  claims:unknown[],
  category:string,
  required:boolean,
):Build3QualityInput{
  const matched=claims.filter(claim=>isObject(claim)&&String(claim.evidence_category)===category);
  if(!matched.length)return {
    input:`RESEARCH_${category}`,required,state:'MISSING',source_refs:[],
    detail:'No research claim covers this category'
  };
  const verified=matched.filter(claim=>
    isObject(claim)&&claim.verification_status==='VERIFIED'&&claim.independent_validation===true
  );
  const refs=[...new Set(verified.flatMap(claim=>
    isObject(claim)&&Array.isArray(claim.source_ids)?claim.source_ids.map(String):[]
  ))];
  if(!verified.length)return {
    input:`RESEARCH_${category}`,required,state:'PARTIAL',source_refs:refs,
    detail:'Category exists but has no independently VERIFIED claim'
  };
  return {
    input:`RESEARCH_${category}`,required,state:'VERIFIED',source_refs:refs,detail:null
  };
}

export function assessBuild3StockDataQuality(
  snapshot:Build3EvidenceSnapshot,
):Build3DataQualityAssessment{
  const assessedAt=new Date(snapshot.frozen_at);
  const root=isObject(snapshot.evidence)?snapshot.evidence:{};
  const lifecycle=isObject(root.lifecycle)?root.lifecycle:{};
  const market=isObject(root.market_snapshot)?root.market_snapshot:{};
  const research=isObject(root.research_bundle)?root.research_bundle:{};
  const auction=isObject(root.auction_snapshot)?root.auction_snapshot:null;
  const researchPayload=isObject(research.payload)?research.payload:{};
  const claims=Array.isArray(researchPayload.claims)?researchPayload.claims:[];

  const marketAge=ageMinutes(assessedAt,market.captured_at);
  const researchAge=ageMinutes(assessedAt,research.research_fresh_at);
  const requiredInputs:Build3QualityInput[]=[];

  requiredInputs.push({
    input:'MARKET_DATA',required:true,
    state:!market.snapshot_id||market.status!=='DATA_READY'||typeof market.payload_hash!=='string'
      ?'MISSING'
      :marketAge===null||marketAge < -5?'PARTIAL'
      :marketAge>60?'STALE':'VERIFIED',
    source_refs:market.snapshot_id?[String(market.snapshot_id)]:[],
    max_age_minutes:60,newest_age_minutes:marketAge,
    detail:marketAge!==null&&marketAge>60?'Market snapshot exceeds 60 minute freshness bound':null
  });

  requiredInputs.push({
    input:'RESEARCH_BUNDLE',required:true,
    state:!research.bundle_id||research.status!=='READY'||typeof research.payload_hash!=='string'
      ?'MISSING'
      :researchAge===null||researchAge < -5?'PARTIAL'
      :researchAge>90?'STALE':'VERIFIED',
    source_refs:research.bundle_id?[String(research.bundle_id)]:[],
    max_age_minutes:90,newest_age_minutes:researchAge,
    detail:researchAge!==null&&researchAge>90?'Research bundle exceeds 90 minute freshness bound':null
  });

  for(const category of MANDATORY_EDGE_RESEARCH_CATEGORIES){
    requiredInputs.push(stockClaimState(claims,category,true));
  }

  if(String(lifecycle.trigger_type)==='SCHEDULED'){
    const auctionAge=auction?ageMinutes(assessedAt,auction.captured_at):null;
    requiredInputs.push({
      input:'AUCTION_DATA',required:true,
      state:!auction||!auction.auction_snapshot_id||auction.status!=='AUCTION_READY'||typeof auction.payload_hash!=='string'
        ?'MISSING'
        :auctionAge===null||auctionAge < -5?'PARTIAL'
        :auctionAge>15?'STALE':'VERIFIED',
      source_refs:auction?.auction_snapshot_id?[String(auction.auction_snapshot_id)]:[],
      max_age_minutes:15,newest_age_minutes:auctionAge,
      detail:auctionAge!==null&&auctionAge>15?'Auction snapshot exceeds 15 minute freshness bound':null
    });
  }

  const optionalInputs=['SECTOR_MACRO','OTHER'].map(category=>stockClaimState(claims,category,false));
  return finalAssessment(snapshot,requiredInputs,optionalInputs);
}

export async function persistBuild3DataQuality(
  databaseUrl:string|undefined,
  assessment:Build3DataQualityAssessment,
):Promise<Build3DataQualityAssessment>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_DATA_QUALITY_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_data_quality_assessments(
      quality_version,engine,instrument,source_id,evidence_snapshot_id,evidence_hash,
      assessed_at,overall_state,valid_for_forecast,payload
    ) values(
      ${assessment.quality_version},${assessment.engine},${assessment.instrument},
      ${assessment.source_id},${assessment.evidence_snapshot_id},${assessment.evidence_hash},
      ${assessment.assessed_at},${assessment.overall_state},${assessment.valid_for_forecast},
      ${JSON.stringify(assessment)}::jsonb
    )
    on conflict (engine,source_id) do nothing
  `;
  const rows=await sql`
    select payload from build3_data_quality_assessments
     where engine=${assessment.engine} and source_id=${assessment.source_id}
     limit 1
  `;
  if(!rows.length||!isObject(rows[0].payload))throw new Error('BUILD3_DATA_QUALITY_READBACK_MISSING');
  const stored=rows[0].payload as Build3DataQualityAssessment;
  if(canonicalBuild3EvidenceJson(stored)!==canonicalBuild3EvidenceJson(assessment)){
    throw new Error('BUILD3_DATA_QUALITY_MUTATION_CONFLICT');
  }
  return stored;
}

export function build3DataQualityRef(assessment:Build3DataQualityAssessment):Record<string,unknown>{
  return {
    quality_version:assessment.quality_version,
    overall_state:assessment.overall_state,
    valid_for_forecast:assessment.valid_for_forecast,
    blockers:assessment.blockers,
    assessed_at:assessment.assessed_at,
  };
}
