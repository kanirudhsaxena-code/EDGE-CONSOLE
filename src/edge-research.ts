import { isNonEmptyString, isObject } from './normalization';

export const EDGE_RESEARCH_BUNDLE_LEGACY_VERSION='EDGE_RESEARCH_BUNDLE_V1' as const;
export const EDGE_RESEARCH_BUNDLE_VERSION='EDGE_RESEARCH_BUNDLE_V2' as const;
export const SUPPORTED_EDGE_RESEARCH_BUNDLE_VERSIONS=[EDGE_RESEARCH_BUNDLE_LEGACY_VERSION,EDGE_RESEARCH_BUNDLE_VERSION] as const;
export type ResearchAuthority='CHATGPT'|'EDGE_SYSTEM';
export type RetrievalProvider='CHATGPT_WEB'|'SYSTEM_WEB'|'EXA'|'UPSTOX';
export type SourceAuthority='PRIMARY'|'REGULATORY'|'EXCHANGE'|'COMPANY'|'REPUTABLE_SECONDARY'|'BROKER_PROVIDER';
export type VerificationStatus='VERIFIED'|'CONFLICTED'|'NOT_VERIFIED'|'NOT_AVAILABLE';
export type EvidenceCategory=
  'BUSINESS_FUNDAMENTALS'|'VALUATION'|'INSTITUTIONAL_BEHAVIOUR'|
  'NEWS_EVENTS_CATALYSTS'|'EVENT_SHOCK'|'SECTOR_MACRO'|'OTHER';
export type Materiality='LOW'|'MODERATE'|'HIGH'|'CRITICAL';
export type Direction='POSITIVE'|'NEUTRAL'|'NEGATIVE'|'BINARY_UNCERTAIN';

export const MANDATORY_EDGE_RESEARCH_CATEGORIES=[
  'BUSINESS_FUNDAMENTALS',
  'INSTITUTIONAL_BEHAVIOUR',
  'NEWS_EVENTS_CATALYSTS',
  'VALUATION',
  'EVENT_SHOCK',
] as const;

export type EdgeResearchSource={
  source_id:string;
  provider:RetrievalProvider;
  authority:SourceAuthority;
  url:string;
  title:string;
  retrieved_at:string;
  publication_date?:string|null;
  event_date?:string|null;
};

export type EdgeResearchClaim={
  claim_id:string;
  evidence_category:EvidenceCategory;
  statement:string;
  materiality:Materiality;
  direction:Direction;
  source_ids:string[];
  verification_status:VerificationStatus;
  independent_validation:boolean;
  conflict_note?:string|null;
};

export type EdgeResearchBundle={
  contract_version:typeof EDGE_RESEARCH_BUNDLE_LEGACY_VERSION|typeof EDGE_RESEARCH_BUNDLE_VERSION;
  bundle_id:string;
  ticker:string;
  command:string;
  created_at:string;
  research_fresh_at:string;
  research_authority:ResearchAuthority;
  lifecycle_id?:string;
  market_snapshot_id?:string;
  retrieval_providers:RetrievalProvider[];
  sources:EdgeResearchSource[];
  claims:EdgeResearchClaim[];
  limitations:string[];
};

const iso=(v:unknown)=>isNonEmptyString(v)&&!Number.isNaN(Date.parse(v));
const ticker=(v:unknown)=>isNonEmptyString(v)&&/^[A-Z0-9._&-]{1,20}$/.test(v);
const id=(v:unknown)=>isNonEmptyString(v)&&/^[A-Za-z0-9._:-]{3,160}$/.test(v);

export function validateEdgeResearchBundle(body:unknown,now=new Date()):string[]{
  if(!isObject(body))return ['research bundle must be an object'];
  const errors:string[]=[];
  const version=String(body.contract_version||'');
  if(!SUPPORTED_EDGE_RESEARCH_BUNDLE_VERSIONS.includes(version as typeof SUPPORTED_EDGE_RESEARCH_BUNDLE_VERSIONS[number]))errors.push('contract_version must be EDGE_RESEARCH_BUNDLE_V1 or EDGE_RESEARCH_BUNDLE_V2');
  if(!id(body.bundle_id))errors.push('bundle_id is invalid');
  if(!ticker(body.ticker))errors.push('ticker is invalid');
  if(!isNonEmptyString(body.command)||!new RegExp('^EDGE\\s+'+String(body.ticker)+'
  if(!Array.isArray(body.sources)||body.sources.length===0)errors.push('sources must be a non-empty array');
  const sourceIds=new Set<string>();
  if(Array.isArray(body.sources))body.sources.forEach((raw,i)=>{
    if(!isObject(raw)){errors.push(`sources[${i}] must be an object`);return}
    if(!id(raw.source_id))errors.push(`sources[${i}].source_id is invalid`); else if(sourceIds.has(String(raw.source_id)))errors.push(`sources[${i}].source_id is duplicated`); else sourceIds.add(String(raw.source_id));
    if(!['CHATGPT_WEB','SYSTEM_WEB','EXA','UPSTOX'].includes(String(raw.provider)))errors.push(`sources[${i}].provider is invalid`);
    if(!['PRIMARY','REGULATORY','EXCHANGE','COMPANY','REPUTABLE_SECONDARY','BROKER_PROVIDER'].includes(String(raw.authority)))errors.push(`sources[${i}].authority is invalid`);
    if(!isNonEmptyString(raw.url)||!/^https?:\/\//i.test(raw.url))errors.push(`sources[${i}].url must be HTTP(S)`);
    if(!isNonEmptyString(raw.title))errors.push(`sources[${i}].title is mandatory`);
    if(!iso(raw.retrieved_at))errors.push(`sources[${i}].retrieved_at must be a valid ISO timestamp`);
    if(raw.publication_date!=null&&!iso(raw.publication_date))errors.push(`sources[${i}].publication_date must be ISO or null`);
    if(raw.event_date!=null&&!iso(raw.event_date))errors.push(`sources[${i}].event_date must be ISO or null`);
  });

  if(!Array.isArray(body.claims)||body.claims.length===0)errors.push('claims must be a non-empty array');
  const independentlyVerified=new Set<string>();
  if(Array.isArray(body.claims))body.claims.forEach((raw,i)=>{
    if(!isObject(raw)){errors.push(`claims[${i}] must be an object`);return}
    if(!id(raw.claim_id))errors.push(`claims[${i}].claim_id is invalid`);
    if(!['BUSINESS_FUNDAMENTALS','VALUATION','INSTITUTIONAL_BEHAVIOUR','NEWS_EVENTS_CATALYSTS','EVENT_SHOCK','SECTOR_MACRO','OTHER'].includes(String(raw.evidence_category)))errors.push(`claims[${i}].evidence_category is invalid`);
    if(!isNonEmptyString(raw.statement))errors.push(`claims[${i}].statement is mandatory`);
    if(!['LOW','MODERATE','HIGH','CRITICAL'].includes(String(raw.materiality)))errors.push(`claims[${i}].materiality is invalid`);
    if(!['POSITIVE','NEUTRAL','NEGATIVE','BINARY_UNCERTAIN'].includes(String(raw.direction)))errors.push(`claims[${i}].direction is invalid`);
    if(!['VERIFIED','CONFLICTED','NOT_VERIFIED','NOT_AVAILABLE'].includes(String(raw.verification_status)))errors.push(`claims[${i}].verification_status is invalid`);
    if(!Array.isArray(raw.source_ids)||raw.source_ids.length===0)errors.push(`claims[${i}].source_ids must be non-empty`);
    else for(const sid of raw.source_ids)if(!sourceIds.has(String(sid)))errors.push(`claims[${i}] references unknown source_id ${sid}`);

    const material=raw.materiality==='HIGH'||raw.materiality==='CRITICAL';
    const verified=raw.verification_status==='VERIFIED';
    if(material&&verified&&raw.independent_validation!==true)errors.push(`claims[${i}] material VERIFIED claim requires independent_validation=true`);
    if(raw.verification_status==='CONFLICTED'&&!isNonEmptyString(raw.conflict_note))errors.push(`claims[${i}] CONFLICTED claim requires conflict_note`);

    if(material&&verified&&Array.isArray(raw.source_ids)){
      const claimSourceIds=raw.source_ids.map(x=>String(x));
      const sourceRows=Array.isArray(body.sources)?body.sources:[];
      const used=sourceRows.filter((source:unknown)=>isObject(source)&&claimSourceIds.includes(String(source.source_id)));
      const independent=used.some((source:unknown)=>isObject(source)&&(source.provider==='CHATGPT_WEB'||source.provider==='SYSTEM_WEB'||source.provider==='EXA'));
      const providerOnly=used.length>0&&used.every((source:unknown)=>isObject(source)&&source.provider==='UPSTOX');
      if(!independent||providerOnly)errors.push(`claims[${i}] material VERIFIED claim cannot be provider-only`);
    }

    if(verified&&raw.independent_validation===true&&Array.isArray(raw.source_ids)){
      const ids=raw.source_ids.map(x=>String(x));
      const sourceRows=Array.isArray(body.sources)?body.sources:[];
      const independent=sourceRows.some((source:unknown)=>
        isObject(source)&&ids.includes(String(source.source_id))&&(source.provider==='CHATGPT_WEB'||source.provider==='SYSTEM_WEB'||source.provider==='EXA')
      );
      if(independent&&MANDATORY_EDGE_RESEARCH_CATEGORIES.includes(String(raw.evidence_category) as typeof MANDATORY_EDGE_RESEARCH_CATEGORIES[number])){
        independentlyVerified.add(String(raw.evidence_category));
      }
    }
  });

  const missingResearch=MANDATORY_EDGE_RESEARCH_CATEGORIES.filter(category=>!independentlyVerified.has(category));
  if(missingResearch.length)errors.push('mandatory research coverage incomplete: '+missingResearch.join(', '));

  if(!Array.isArray(body.limitations))errors.push('limitations must be an array');
  const fresh=iso(body.research_fresh_at)?new Date(String(body.research_fresh_at)):null;
  if(fresh){
    const age=(now.getTime()-fresh.getTime())/60000;
    if(age < -2)errors.push('research_fresh_at cannot be in the future');
    if(age > 24*60)errors.push('research bundle is stale (>24h)');
  }
  return errors;
}

export function researchBundleCanPublish(body:unknown,now=new Date()):{ready:boolean;errors:string[]}{
  const errors=validateEdgeResearchBundle(body,now);
  if(isObject(body)&&Array.isArray(body.claims)){
    const unresolved=body.claims.filter((c:unknown)=>isObject(c)&&(c.materiality==='HIGH'||c.materiality==='CRITICAL')&&(c.verification_status==='CONFLICTED'||c.verification_status==='NOT_VERIFIED'||c.verification_status==='NOT_AVAILABLE'));
    if(unresolved.length)errors.push('one or more HIGH/CRITICAL claims are unresolved');
  }
  return {ready:errors.length===0,errors};
}
,'i').test(body.command.trim()))errors.push('command must match EDGE <ticker>');
  if(!iso(body.created_at))errors.push('created_at must be a valid ISO timestamp');
  if(!iso(body.research_fresh_at))errors.push('research_fresh_at must be a valid ISO timestamp');

  if(version===EDGE_RESEARCH_BUNDLE_LEGACY_VERSION&&body.research_authority!=='CHATGPT')errors.push('V1 research_authority must be CHATGPT');
  if(version===EDGE_RESEARCH_BUNDLE_VERSION&&body.research_authority!=='EDGE_SYSTEM')errors.push('V2 research_authority must be EDGE_SYSTEM');
  if(version===EDGE_RESEARCH_BUNDLE_VERSION){
    if(!id(body.lifecycle_id))errors.push('V2 lifecycle_id is invalid');
    if(!id(body.market_snapshot_id))errors.push('V2 market_snapshot_id is invalid');
  }

  const providers=new Set(Array.isArray(body.retrieval_providers)?body.retrieval_providers:[]);
  const mandatoryProvider=version===EDGE_RESEARCH_BUNDLE_LEGACY_VERSION?'CHATGPT_WEB':'SYSTEM_WEB';
  if((version===EDGE_RESEARCH_BUNDLE_LEGACY_VERSION||version===EDGE_RESEARCH_BUNDLE_VERSION)&&!providers.has(mandatoryProvider))errors.push(mandatoryProvider+' is mandatory');
  for(const p of providers)if(!['CHATGPT_WEB','SYSTEM_WEB','EXA','UPSTOX'].includes(String(p)))errors.push('retrieval_providers contains an invalid provider');

  if(!Array.isArray(body.sources)||body.sources.length===0)errors.push('sources must be a non-empty array');
  const sourceIds=new Set<string>();
  if(Array.isArray(body.sources))body.sources.forEach((raw,i)=>{
    if(!isObject(raw)){errors.push(`sources[${i}] must be an object`);return}
    if(!id(raw.source_id))errors.push(`sources[${i}].source_id is invalid`); else if(sourceIds.has(String(raw.source_id)))errors.push(`sources[${i}].source_id is duplicated`); else sourceIds.add(String(raw.source_id));
    if(!['CHATGPT_WEB','SYSTEM_WEB','EXA','UPSTOX'].includes(String(raw.provider)))errors.push(`sources[${i}].provider is invalid`);
    if(!['PRIMARY','REGULATORY','EXCHANGE','COMPANY','REPUTABLE_SECONDARY','BROKER_PROVIDER'].includes(String(raw.authority)))errors.push(`sources[${i}].authority is invalid`);
    if(!isNonEmptyString(raw.url)||!/^https?:\/\//i.test(raw.url))errors.push(`sources[${i}].url must be HTTP(S)`);
    if(!isNonEmptyString(raw.title))errors.push(`sources[${i}].title is mandatory`);
    if(!iso(raw.retrieved_at))errors.push(`sources[${i}].retrieved_at must be a valid ISO timestamp`);
    if(raw.publication_date!=null&&!iso(raw.publication_date))errors.push(`sources[${i}].publication_date must be ISO or null`);
    if(raw.event_date!=null&&!iso(raw.event_date))errors.push(`sources[${i}].event_date must be ISO or null`);
  });

  if(!Array.isArray(body.claims)||body.claims.length===0)errors.push('claims must be a non-empty array');
  const independentlyVerified=new Set<string>();
  if(Array.isArray(body.claims))body.claims.forEach((raw,i)=>{
    if(!isObject(raw)){errors.push(`claims[${i}] must be an object`);return}
    if(!id(raw.claim_id))errors.push(`claims[${i}].claim_id is invalid`);
    if(!['BUSINESS_FUNDAMENTALS','VALUATION','INSTITUTIONAL_BEHAVIOUR','NEWS_EVENTS_CATALYSTS','EVENT_SHOCK','SECTOR_MACRO','OTHER'].includes(String(raw.evidence_category)))errors.push(`claims[${i}].evidence_category is invalid`);
    if(!isNonEmptyString(raw.statement))errors.push(`claims[${i}].statement is mandatory`);
    if(!['LOW','MODERATE','HIGH','CRITICAL'].includes(String(raw.materiality)))errors.push(`claims[${i}].materiality is invalid`);
    if(!['POSITIVE','NEUTRAL','NEGATIVE','BINARY_UNCERTAIN'].includes(String(raw.direction)))errors.push(`claims[${i}].direction is invalid`);
    if(!['VERIFIED','CONFLICTED','NOT_VERIFIED','NOT_AVAILABLE'].includes(String(raw.verification_status)))errors.push(`claims[${i}].verification_status is invalid`);
    if(!Array.isArray(raw.source_ids)||raw.source_ids.length===0)errors.push(`claims[${i}].source_ids must be non-empty`);
    else for(const sid of raw.source_ids)if(!sourceIds.has(String(sid)))errors.push(`claims[${i}] references unknown source_id ${sid}`);

    const material=raw.materiality==='HIGH'||raw.materiality==='CRITICAL';
    const verified=raw.verification_status==='VERIFIED';
    if(material&&verified&&raw.independent_validation!==true)errors.push(`claims[${i}] material VERIFIED claim requires independent_validation=true`);
    if(raw.verification_status==='CONFLICTED'&&!isNonEmptyString(raw.conflict_note))errors.push(`claims[${i}] CONFLICTED claim requires conflict_note`);

    if(material&&verified&&Array.isArray(raw.source_ids)){
      const claimSourceIds=raw.source_ids.map(x=>String(x));
      const sourceRows=Array.isArray(body.sources)?body.sources:[];
      const used=sourceRows.filter((source:unknown)=>isObject(source)&&claimSourceIds.includes(String(source.source_id)));
      const independent=used.some((source:unknown)=>isObject(source)&&(source.provider==='CHATGPT_WEB'||source.provider==='SYSTEM_WEB'||source.provider==='EXA'));
      const providerOnly=used.length>0&&used.every((source:unknown)=>isObject(source)&&source.provider==='UPSTOX');
      if(!independent||providerOnly)errors.push(`claims[${i}] material VERIFIED claim cannot be provider-only`);
    }

    if(verified&&raw.independent_validation===true&&Array.isArray(raw.source_ids)){
      const ids=raw.source_ids.map(x=>String(x));
      const sourceRows=Array.isArray(body.sources)?body.sources:[];
      const independent=sourceRows.some((source:unknown)=>
        isObject(source)&&ids.includes(String(source.source_id))&&(source.provider==='CHATGPT_WEB'||source.provider==='SYSTEM_WEB'||source.provider==='EXA')
      );
      if(independent&&MANDATORY_EDGE_RESEARCH_CATEGORIES.includes(String(raw.evidence_category) as typeof MANDATORY_EDGE_RESEARCH_CATEGORIES[number])){
        independentlyVerified.add(String(raw.evidence_category));
      }
    }
  });

  const missingResearch=MANDATORY_EDGE_RESEARCH_CATEGORIES.filter(category=>!independentlyVerified.has(category));
  if(missingResearch.length)errors.push('mandatory research coverage incomplete: '+missingResearch.join(', '));

  if(!Array.isArray(body.limitations))errors.push('limitations must be an array');
  const fresh=iso(body.research_fresh_at)?new Date(String(body.research_fresh_at)):null;
  if(fresh){
    const age=(now.getTime()-fresh.getTime())/60000;
    if(age < -2)errors.push('research_fresh_at cannot be in the future');
    if(age > 24*60)errors.push('research bundle is stale (>24h)');
  }
  return errors;
}

export function researchBundleCanPublish(body:unknown,now=new Date()):{ready:boolean;errors:string[]}{
  const errors=validateEdgeResearchBundle(body,now);
  if(isObject(body)&&Array.isArray(body.claims)){
    const unresolved=body.claims.filter((c:unknown)=>isObject(c)&&(c.materiality==='HIGH'||c.materiality==='CRITICAL')&&(c.verification_status==='CONFLICTED'||c.verification_status==='NOT_VERIFIED'||c.verification_status==='NOT_AVAILABLE'));
    if(unresolved.length)errors.push('one or more HIGH/CRITICAL claims are unresolved');
  }
  return {ready:errors.length===0,errors};
}
