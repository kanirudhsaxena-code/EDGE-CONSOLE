import { neon } from '@neondatabase/serverless';

export type Build3OutputPrecisionRow = {
  precision_version:string;
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  horizon:'D'|'D+1'|'D+2'|'D+3'|'D+4';
  target_session:string;
  calibration_version:string;
  calibration_state:string;
  normalization_basis:string;
  expected_centre:number;
  core_low:number;
  core_high:number;
  outer_low:number;
  outer_high:number;
  core_width_points:number;
  core_width_percent:number;
  outer_width_points:number;
  outer_width_percent:number;
  calibration_inputs:Record<string,unknown>;
};

const dateOnly=(value:unknown):string=>{
  const text=value instanceof Date?value.toISOString():String(value??'');
  const match=text.match(/^(\d{4}-\d{2}-\d{2})/);
  if(!match)throw new Error('BUILD3_OUTPUT_TARGET_SESSION_INVALID');
  return match[1];
};

const finite=(value:unknown,label:string):number=>{
  const n=Number(value);
  if(!Number.isFinite(n))throw new Error('BUILD3_OUTPUT_NUMERIC_INVALID:'+label);
  return n;
};

export async function readBuild3OutputPrecision(
  databaseUrl:string|undefined,
  engine:'5DR'|'EDGE_STOCKS',
  sourceId:string,
):Promise<Build3OutputPrecisionRow[]>{
  if(!databaseUrl?.trim()||!sourceId.trim())return [];
  const sql=neon(databaseUrl);
  const rows=await sql`
    select precision_version,engine,instrument,source_id,horizon,target_session,
           calibration_version,calibration_state,normalization_basis,expected_centre,
           core_low,core_high,outer_low,outer_high,core_width_points,core_width_percent,
           outer_width_points,outer_width_percent,calibration_inputs
      from build3_precision_issuance
     where engine=${engine} and source_id=${sourceId}
     order by case horizon when 'D' then 0 when 'D+1' then 1 when 'D+2' then 2 when 'D+3' then 3 else 4 end
  `;
  if(rows.length===0)return [];
  if(rows.length!==5)throw new Error('BUILD3_OUTPUT_PRECISION_COUNT_MISMATCH');
  const expected=['D','D+1','D+2','D+3','D+4'];
  return rows.map((row:any,index:number)=>{
    if(String(row.horizon)!==expected[index])throw new Error('BUILD3_OUTPUT_PRECISION_ORDER_MISMATCH');
    const outerLow=finite(row.outer_low,'outer_low');
    const outerHigh=finite(row.outer_high,'outer_high');
    const coreLow=finite(row.core_low,'core_low');
    const coreHigh=finite(row.core_high,'core_high');
    if(outerLow>outerHigh||coreLow>coreHigh||coreLow<outerLow||coreHigh>outerHigh){
      throw new Error('BUILD3_OUTPUT_PRECISION_ZONE_INVALID:'+expected[index]);
    }
    return {
      precision_version:String(row.precision_version),
      engine:String(row.engine) as '5DR'|'EDGE_STOCKS',
      instrument:String(row.instrument),
      source_id:String(row.source_id),
      horizon:String(row.horizon) as Build3OutputPrecisionRow['horizon'],
      target_session:dateOnly(row.target_session),
      calibration_version:String(row.calibration_version),
      calibration_state:String(row.calibration_state),
      normalization_basis:String(row.normalization_basis),
      expected_centre:finite(row.expected_centre,'expected_centre'),
      core_low:coreLow,
      core_high:coreHigh,
      outer_low:outerLow,
      outer_high:outerHigh,
      core_width_points:finite(row.core_width_points,'core_width_points'),
      core_width_percent:finite(row.core_width_percent,'core_width_percent'),
      outer_width_points:finite(row.outer_width_points,'outer_width_points'),
      outer_width_percent:finite(row.outer_width_percent,'outer_width_percent'),
      calibration_inputs:(row.calibration_inputs&&typeof row.calibration_inputs==='object'&&!Array.isArray(row.calibration_inputs))
        ? row.calibration_inputs as Record<string,unknown>
        : {},
    };
  });
}

export async function readBuild3NiftyPrecisionByRunId(
  databaseUrl:string|undefined,
  runId:string,
):Promise<{source_id:string;rows:Build3OutputPrecisionRow[]}|null>{
  if(!databaseUrl?.trim()||!runId.trim())return null;
  const sql=neon(databaseUrl);
  const requestRows=await sql`
    select request_id
      from analysis_requests
     where engine='5DR' and run_id=${runId}
     order by updated_at desc
     limit 1
  `;
  if(!requestRows.length)return null;
  const sourceId=String(requestRows[0].request_id);
  const rows=await readBuild3OutputPrecision(databaseUrl,'5DR',sourceId);
  return rows.length?{source_id:sourceId,rows}:null;
}

export function build3PrecisionOutput(rows:Build3OutputPrecisionRow[]){
  if(!rows.length)return null;
  return {
    version:'MDOS_BUILD_3_CORE_ZONE_OUTPUT_V1',
    engine:rows[0].engine,
    instrument:rows[0].instrument,
    source_id:rows[0].source_id,
    horizon_count:rows.length,
    shadow_only:true,
    production_methodology_changed:false,
    rows:rows.map(row=>({
      horizon:row.horizon,
      target_session:row.target_session,
      expected_centre:row.expected_centre,
      core_zone:{low:row.core_low,high:row.core_high},
      outer_zone:{low:row.outer_low,high:row.outer_high},
      core_width_points:row.core_width_points,
      core_width_percent:row.core_width_percent,
      outer_width_points:row.outer_width_points,
      outer_width_percent:row.outer_width_percent,
      calibration_version:row.calibration_version,
      calibration_state:row.calibration_state,
      normalization_basis:row.normalization_basis,
    })),
  };
}
