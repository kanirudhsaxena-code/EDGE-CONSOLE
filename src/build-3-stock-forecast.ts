import {
  BUILD3_FORECAST_VERSION,
  assertBuild3Forecast,
  type Build3Forecast,
  type Build3ForecastHorizon,
  type Build3Regime,
} from './build-3-forecast-contract';
import { BUILD3_HORIZONS, type Build3TargetSession } from './build-3-run-contract';

export const BUILD3_STOCK_SOURCE_PATH_VERSION='EDGE_STOCK_FORECAST_PATH_V1' as const;

export type Build3StockPathRow={
  horizon_label:string;
  target_trading_date:string;
  direction:string;
  bull_probability:number;
  base_probability:number;
  bear_probability:number;
  expected_centre:number|null;
  outer_expected_zone_low:number;
  outer_expected_zone_high:number;
  evidence_basis:string;
  regime_context:string;
  verification_state:string;
  lineage:Record<string,unknown>;
};

const positiveFinite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;

function direction(value:string):'BULL'|'RANGE'|'BEAR'{
  if(value==='BULL')return 'BULL';
  if(value==='BASE')return 'RANGE';
  if(value==='BEAR')return 'BEAR';
  throw new Error('BUILD3_STOCK_DIRECTION_INVALID');
}

export function build3StockRegimeFromContext(value:string):Build3Regime{
  const upper=String(value??'').trim().toUpperCase();
  if(!upper)throw new Error('BUILD3_STOCK_REGIME_INVALID');
  if(upper==='TREND'||upper==='RANGE'||upper==='TRANSITION'||upper==='EVENT_SHOCK')return upper;

  const fields=new Map<string,string>();
  for(const token of upper.split(';')){
    const split=token.indexOf('=');
    if(split>0)fields.set(token.slice(0,split).trim(),token.slice(split+1).trim());
  }
  const event=fields.get('EVENT');
  const stock=fields.get('STOCK');
  const sector=fields.get('SECTOR');
  if(event==='HIGH_RISK')return 'EVENT_SHOCK';
  if(stock==='TRANSITION'||sector==='TRANSITION')return 'TRANSITION';
  if(stock==='NEUTRAL'&&(sector==='NEUTRAL'||sector===undefined))return 'RANGE';
  if(stock==='BULLISH'||stock==='BEARISH')return 'TREND';

  if(upper.includes('EVENT_SHOCK'))return 'EVENT_SHOCK';
  if(upper.includes('TRANSITION'))return 'TRANSITION';
  if(upper.includes('RANGE'))return 'RANGE';
  if(upper.includes('TREND'))return 'TREND';
  throw new Error('BUILD3_STOCK_REGIME_INVALID');
}

function lineageString(row:Build3StockPathRow,key:string):string{
  const value=row.lineage?.[key];
  if(!nonEmpty(value))throw new Error(`BUILD3_STOCK_LINEAGE_${key.toUpperCase()}_MISSING`);
  return value.trim();
}

function referencePrice(rows:Build3StockPathRow[]):number{
  const values=rows.map((row,index)=>{
    const value=row.lineage?.p0;
    if(!positiveFinite(value))throw new Error(`BUILD3_STOCK_P0_INVALID:${index}`);
    return value;
  });
  const first=values[0];
  if(values.some(value=>Math.abs(value-first)>Math.max(1e-9,Math.abs(first)*1e-9))){
    throw new Error('BUILD3_STOCK_P0_LINEAGE_MISMATCH');
  }
  return first;
}

function modelVersion(rows:Build3StockPathRow[]):string{
  const versions=rows.map(row=>lineageString(row,'methodology_version'));
  const first=versions[0];
  if(versions.some(value=>value!==first))throw new Error('BUILD3_STOCK_MODEL_VERSION_MISMATCH');
  return first;
}

export function buildStockBuild3Forecast(input:{
  ticker:string;
  source_run_id:string;
  path_version:string;
  issued_at:string;
  target_sessions:Build3TargetSession[];
  rows:Build3StockPathRow[];
  evidence_snapshot_id:string;
  evidence_hash:string;
}):Build3Forecast{
  if(input.path_version!==BUILD3_STOCK_SOURCE_PATH_VERSION)throw new Error('BUILD3_STOCK_PATH_VERSION_INVALID');
  if(!nonEmpty(input.ticker)||!nonEmpty(input.source_run_id))throw new Error('BUILD3_STOCK_IDENTITY_INVALID');
  if(Number.isNaN(Date.parse(input.issued_at)))throw new Error('BUILD3_STOCK_ISSUED_AT_INVALID');
  if(input.target_sessions.length!==5||input.rows.length!==5)throw new Error('BUILD3_STOCK_REQUIRES_FIVE_HORIZONS');

  const p0=referencePrice(input.rows);
  const model=modelVersion(input.rows);
  const horizons:Build3ForecastHorizon[]=BUILD3_HORIZONS.map((horizon,index)=>{
    const row=input.rows[index];
    const target=input.target_sessions[index];
    if(row.horizon_label!==horizon||target.horizon!==horizon||row.target_trading_date!==target.target_session){
      throw new Error(`BUILD3_STOCK_SESSION_IDENTITY_MISMATCH:${horizon}`);
    }
    if(row.verification_state!=='VERIFIED')throw new Error(`BUILD3_STOCK_ROW_NOT_VERIFIED:${horizon}`);
    if(!nonEmpty(row.evidence_basis))throw new Error(`BUILD3_STOCK_EVIDENCE_BASIS_MISSING:${horizon}`);
    const centre=row.expected_centre;
    const low=row.outer_expected_zone_low;
    const high=row.outer_expected_zone_high;
    if(!positiveFinite(centre)||!positiveFinite(low)||!positiveFinite(high)||!(low<=centre&&centre<=high)||!(low<high)){
      throw new Error(`BUILD3_STOCK_GEOMETRY_INVALID:${horizon}`);
    }
    const bull=row.bull_probability;
    const base=row.base_probability;
    const bear=row.bear_probability;
    if(!finite(bull)||!finite(base)||!finite(bear))throw new Error(`BUILD3_STOCK_PROBABILITY_INVALID:${horizon}`);
    return {
      horizon,
      target_session:target.target_session,
      direction:direction(row.direction),
      probabilities:{BULL:bull,RANGE:base,BEAR:bear},
      regime:build3StockRegimeFromContext(row.regime_context),
      reasoning:row.evidence_basis.trim(),
      expected_centre:centre,
      core_zone_kind:'CENTRE_ONLY',
      core_zone:{low:centre,high:centre},
      outer_zone:{low,high},
    };
  });

  return assertBuild3Forecast({
    forecast_version:BUILD3_FORECAST_VERSION,
    engine:'EDGE_STOCKS',
    instrument:input.ticker.trim().toUpperCase(),
    source_id:input.source_run_id.trim(),
    model_version:model,
    issued_at:new Date(input.issued_at).toISOString(),
    reference_price_p0:p0,
    evidence_snapshot_id:input.evidence_snapshot_id,
    evidence_hash:input.evidence_hash,
    data_quality_state:'VERIFIED',
    horizons,
  });
}
