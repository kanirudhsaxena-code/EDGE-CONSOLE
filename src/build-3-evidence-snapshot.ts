import { neon } from '@neondatabase/serverless';
import type { Build3Engine } from './build-3-run-contract';

export const BUILD3_EVIDENCE_SNAPSHOT_VERSION='MDOS_BUILD_3_EVIDENCE_V1' as const;

export type Build3EvidenceSnapshot={
  snapshot_version:typeof BUILD3_EVIDENCE_SNAPSHOT_VERSION;
  snapshot_id:string;
  engine:Build3Engine;
  instrument:string;
  source_id:string;
  evidence_hash:string;
  frozen_at:string;
  evidence:unknown;
};

type SnapshotInput={
  engine:Build3Engine;
  instrument:string;
  source_id:string;
  evidence:unknown;
  frozen_at?:Date|string;
};

const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;

function jsonSafe(value:unknown):unknown{
  const encoded=JSON.stringify(value);
  if(encoded===undefined)throw new Error('BUILD3_EVIDENCE_NOT_JSON_SERIALIZABLE');
  return JSON.parse(encoded);
}

function stableJson(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
  if(value&&typeof value==='object'){
    const record=value as Record<string,unknown>;
    return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+stableJson(record[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}

async function sha256(text:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function canonicalBuild3EvidenceJson(value:unknown):string{
  return stableJson(jsonSafe(value));
}

export async function buildBuild3EvidenceSnapshot(input:SnapshotInput):Promise<Build3EvidenceSnapshot>{
  if(!nonEmpty(input.instrument))throw new Error('BUILD3_EVIDENCE_INSTRUMENT_REQUIRED');
  if(!nonEmpty(input.source_id))throw new Error('BUILD3_EVIDENCE_SOURCE_ID_REQUIRED');
  if(input.engine!=='5DR'&&input.engine!=='EDGE_STOCKS')throw new Error('BUILD3_EVIDENCE_ENGINE_INVALID');
  const evidence=jsonSafe(input.evidence);
  const evidenceHash=await sha256(canonicalBuild3EvidenceJson(evidence));
  const identityHash=await sha256(stableJson({
    snapshot_version:BUILD3_EVIDENCE_SNAPSHOT_VERSION,
    engine:input.engine,
    source_id:input.source_id.trim(),
    evidence_hash:evidenceHash,
  }));
  const frozenAt=input.frozen_at instanceof Date
    ?input.frozen_at
    :input.frozen_at?new Date(input.frozen_at):new Date();
  if(Number.isNaN(frozenAt.getTime()))throw new Error('BUILD3_EVIDENCE_FROZEN_AT_INVALID');
  return {
    snapshot_version:BUILD3_EVIDENCE_SNAPSHOT_VERSION,
    snapshot_id:`b3es_${identityHash.slice(0,32)}`,
    engine:input.engine,
    instrument:input.instrument.trim().toUpperCase(),
    source_id:input.source_id.trim(),
    evidence_hash:evidenceHash,
    frozen_at:frozenAt.toISOString(),
    evidence,
  };
}

export async function freezeBuild3EvidenceSnapshot(
  databaseUrl:string|undefined,
  input:SnapshotInput,
):Promise<Build3EvidenceSnapshot>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_EVIDENCE_DATABASE_NOT_CONFIGURED');
  const prepared=await buildBuild3EvidenceSnapshot(input);
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_evidence_snapshots(
      snapshot_id,snapshot_version,engine,instrument,source_id,evidence_hash,frozen_at,payload
    ) values(
      ${prepared.snapshot_id},${prepared.snapshot_version},${prepared.engine},
      ${prepared.instrument},${prepared.source_id},${prepared.evidence_hash},
      ${prepared.frozen_at},${JSON.stringify(prepared.evidence)}::jsonb
    )
    on conflict (engine,source_id) do nothing
  `;
  const stored=await readBuild3EvidenceSnapshot(databaseUrl,prepared.engine,prepared.source_id);
  if(!stored)throw new Error('BUILD3_EVIDENCE_READBACK_MISSING');
  if(
    stored.snapshot_version!==prepared.snapshot_version||
    stored.snapshot_id!==prepared.snapshot_id||
    stored.instrument!==prepared.instrument||
    stored.evidence_hash!==prepared.evidence_hash||
    canonicalBuild3EvidenceJson(stored.evidence)!==canonicalBuild3EvidenceJson(prepared.evidence)
  )throw new Error('BUILD3_EVIDENCE_MUTATION_CONFLICT');
  return stored;
}

export async function readBuild3EvidenceSnapshot(
  databaseUrl:string|undefined,
  engine:Build3Engine,
  sourceId:string,
):Promise<Build3EvidenceSnapshot|null>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_EVIDENCE_DATABASE_NOT_CONFIGURED');
  if(!nonEmpty(sourceId))throw new Error('BUILD3_EVIDENCE_SOURCE_ID_REQUIRED');
  const sql=neon(databaseUrl);
  const rows=await sql`
    select snapshot_id,snapshot_version,engine,instrument,source_id,evidence_hash,frozen_at,payload
      from build3_evidence_snapshots
     where engine=${engine} and source_id=${sourceId}
     limit 1
  `;
  if(!rows.length)return null;
  const row=rows[0];
  return {
    snapshot_version:String(row.snapshot_version) as typeof BUILD3_EVIDENCE_SNAPSHOT_VERSION,
    snapshot_id:String(row.snapshot_id),
    engine:String(row.engine) as Build3Engine,
    instrument:String(row.instrument).toUpperCase(),
    source_id:String(row.source_id),
    evidence_hash:String(row.evidence_hash),
    frozen_at:new Date(String(row.frozen_at)).toISOString(),
    evidence:row.payload,
  };
}

export function build3EvidenceSnapshotRef(snapshot:Build3EvidenceSnapshot):Record<string,string>{
  return {
    snapshot_version:snapshot.snapshot_version,
    snapshot_id:snapshot.snapshot_id,
    evidence_hash:snapshot.evidence_hash,
    frozen_at:snapshot.frozen_at,
  };
}
