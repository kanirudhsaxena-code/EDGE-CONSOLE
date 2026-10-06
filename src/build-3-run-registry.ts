import { neon } from '@neondatabase/serverless';
import {
  BUILD3_MARKET_PHASES,
  BUILD3_RUN_CONTRACT_VERSION,
  BUILD3_TRIGGER_TYPES,
  type Build3Engine,
  type Build3MarketPhase,
  type Build3TriggerType,
} from './build-3-run-contract';
import { classifyGovernedNseSession } from './nse-trading-calendar';

export const BUILD3_RUN_REGISTRY_SCHEMA_VERSION='MDOS_BUILD_3_RUN_REGISTRY_V1' as const;

export type Build3RunRegistryRecord={
  registry_schema_version:typeof BUILD3_RUN_REGISTRY_SCHEMA_VERSION;
  contract_version:typeof BUILD3_RUN_CONTRACT_VERSION;
  engine:Build3Engine;
  instrument:string;
  source_id:string;
  model_version:string;
  run_timestamp:string;
  trigger_type:Build3TriggerType;
  market_phase:Build3MarketPhase;
};

const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;

function istParts(at:Date):{date:string;minuteOfDay:number}{
  const parts=Object.fromEntries(
    new Intl.DateTimeFormat('en-US',{
      timeZone:'Asia/Kolkata',
      year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(at).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])
  );
  return {
    date:`${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay:Number(parts.hour)*60+Number(parts.minute),
  };
}

export function classifyBuild3MarketPhase(at:Date):Build3MarketPhase{
  const {date,minuteOfDay}=istParts(at);
  if(classifyGovernedNseSession(date)!=='TRADING_DAY')return 'CLOSED_SESSION';
  if(minuteOfDay>=8*60+45&&minuteOfDay<9*60+15)return 'PRE_OPEN';
  if(minuteOfDay>=9*60+15&&minuteOfDay<9*60+30)return 'OPEN';
  if(minuteOfDay>=9*60+30&&minuteOfDay<15*60+30)return 'INTRADAY';
  if(minuteOfDay>=15*60+30&&minuteOfDay<=16*60+30)return 'POST_CLOSE';
  return 'CLOSED_SESSION';
}

export function validateBuild3RunRegistryRecord(value:Build3RunRegistryRecord):string[]{
  const errors:string[]=[];
  if(value.registry_schema_version!==BUILD3_RUN_REGISTRY_SCHEMA_VERSION)errors.push('registry_schema_version is invalid');
  if(value.contract_version!==BUILD3_RUN_CONTRACT_VERSION)errors.push('contract_version is invalid');
  if(value.engine!=='5DR'&&value.engine!=='EDGE_STOCKS')errors.push('engine is invalid');
  if(!nonEmpty(value.instrument))errors.push('instrument is mandatory');
  if(!nonEmpty(value.source_id))errors.push('source_id is mandatory');
  if(!nonEmpty(value.model_version))errors.push('model_version is mandatory');
  if(!nonEmpty(value.run_timestamp)||Number.isNaN(Date.parse(value.run_timestamp)))errors.push('run_timestamp must be a valid ISO timestamp');
  if(!BUILD3_TRIGGER_TYPES.includes(value.trigger_type))errors.push('trigger_type is invalid');
  if(!BUILD3_MARKET_PHASES.includes(value.market_phase))errors.push('market_phase is invalid');
  return errors;
}

export function buildBuild3RunRegistryRecord(input:{
  engine:Build3Engine;
  instrument:string;
  source_id:string;
  model_version:string;
  run_timestamp:Date|string;
  trigger_type:Build3TriggerType;
  market_phase?:Build3MarketPhase;
}):Build3RunRegistryRecord{
  const at=input.run_timestamp instanceof Date?input.run_timestamp:new Date(input.run_timestamp);
  const record:Build3RunRegistryRecord={
    registry_schema_version:BUILD3_RUN_REGISTRY_SCHEMA_VERSION,
    contract_version:BUILD3_RUN_CONTRACT_VERSION,
    engine:input.engine,
    instrument:input.instrument.trim().toUpperCase(),
    source_id:input.source_id.trim(),
    model_version:input.model_version.trim(),
    run_timestamp:at.toISOString(),
    trigger_type:input.trigger_type,
    market_phase:input.market_phase??classifyBuild3MarketPhase(at),
  };
  const errors=validateBuild3RunRegistryRecord(record);
  if(errors.length)throw new Error(`BUILD3_RUN_REGISTRY_INVALID:${errors.join('|')}`);
  return record;
}

export async function persistBuild3RunRegistryRecord(
  databaseUrl:string|undefined,
  record:Build3RunRegistryRecord,
):Promise<Build3RunRegistryRecord>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_RUN_REGISTRY_DATABASE_NOT_CONFIGURED');
  const errors=validateBuild3RunRegistryRecord(record);
  if(errors.length)throw new Error(`BUILD3_RUN_REGISTRY_INVALID:${errors.join('|')}`);
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_run_registry(
      engine,source_id,instrument,registry_schema_version,contract_version,
      model_version,run_timestamp,trigger_type,market_phase,payload
    ) values(
      ${record.engine},${record.source_id},${record.instrument},
      ${record.registry_schema_version},${record.contract_version},
      ${record.model_version},${record.run_timestamp},
      ${record.trigger_type},${record.market_phase},${JSON.stringify(record)}::jsonb
    )
    on conflict (engine,source_id) do nothing
  `;
  const rows=await sql`
    select engine,source_id,instrument,registry_schema_version,contract_version,
           model_version,run_timestamp,trigger_type,market_phase,payload
      from build3_run_registry
     where engine=${record.engine} and source_id=${record.source_id}
     limit 1
  `;
  if(!rows.length)throw new Error('BUILD3_RUN_REGISTRY_READBACK_MISSING');
  const row=rows[0];
  const same=
    String(row.engine)===record.engine&&
    String(row.source_id)===record.source_id&&
    String(row.instrument)===record.instrument&&
    String(row.registry_schema_version)===record.registry_schema_version&&
    String(row.contract_version)===record.contract_version&&
    String(row.model_version)===record.model_version&&
    Date.parse(String(row.run_timestamp))===Date.parse(record.run_timestamp)&&
    String(row.trigger_type)===record.trigger_type&&
    String(row.market_phase)===record.market_phase;
  if(!same)throw new Error('BUILD3_RUN_REGISTRY_IDENTITY_CONFLICT');
  return record;
}
