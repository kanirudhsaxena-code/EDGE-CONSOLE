import { isObject, type JsonRecord } from './normalization';
import {
  EDGE_STOCK_FORECAST_LABELS,
  EDGE_STOCK_FORECAST_PATH_VERSION,
  validateEdgeStockForecastPath,
} from './edge-stock-forecast-path';

export type EdgeStockForecastReadModel = {
  forecastPath: JsonRecord;
  forecastSessions: JsonRecord[];
};

const number = (value: unknown): number => {
  const parsed=Number(value);
  if(!Number.isFinite(parsed)) throw new Error('forecast-path numeric value is not finite');
  return parsed;
};

const dateOnly = (value: unknown): string => {
  if(value instanceof Date)return value.toISOString().slice(0,10);
  const text=String(value??'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
  const parsed=new Date(text);
  if(Number.isNaN(parsed.getTime()))throw new Error('forecast-path target date is invalid');
  return parsed.toISOString().slice(0,10);
};

const isoDateTime = (value: unknown): string => {
  if(value instanceof Date)return value.toISOString();
  const text=String(value??'').trim();
  const parsed=new Date(text);
  if(!text||Number.isNaN(parsed.getTime()))throw new Error('forecast-path issued_at is invalid');
  return parsed.toISOString();
};

export function buildEdgeStockForecastReadModel(
  header: unknown,
  rowValues: unknown[],
  recommendationId: string,
): EdgeStockForecastReadModel | null {
  if(header===null||header===undefined)return null;
  if(!isObject(header))throw new Error('forecast-path header is malformed');
  if(!recommendationId.trim())throw new Error('forecast-path recommendation id is required');

  const rows=rowValues.filter(isObject).map(row=>row as JsonRecord).sort(
    (a,b)=>Number(a.horizon_index)-Number(b.horizon_index)
  );
  const payloadHash=String(header.payload_hash??'').trim();
  if(!payloadHash)throw new Error('forecast-path payload hash is missing');

  const sessions=rows.map((row,index)=>{
    const lineage=isObject(row.lineage)?row.lineage as JsonRecord:{};
    return {
      label:String(row.horizon_label??''),
      target_session:dateOnly(row.target_trading_date),
      probabilities:{
        bull:number(row.bull_probability),
        base:number(row.base_probability),
        bear:number(row.bear_probability),
      },
      expected_price_zone:{
        low:number(row.outer_expected_zone_low),
        high:number(row.outer_expected_zone_high),
      },
      lineage_id:`path:${recommendationId}:${Number(row.horizon_index)}:${payloadHash}`,
      direction:String(row.direction??''),
      expected_centre:row.expected_centre===null||row.expected_centre===undefined?null:number(row.expected_centre),
      evidence_basis:String(row.evidence_basis??''),
      regime_context:String(row.regime_context??''),
      verification_state:String(row.verification_state??''),
      methodology_version:String(lineage.methodology_version??''),
      producer_version:String(lineage.producer_version??''),
    };
  });

  const forecastPath:JsonRecord={
    version:String(header.path_version??''),
    source_run_id:String(header.source_run_id??''),
    generated_at:isoDateTime(header.issued_at),
    immutable_payload_hash:payloadHash,
    sessions,
  };

  const errors=validateEdgeStockForecastPath(forecastPath);
  if(errors.length)throw new Error('stored G5 forecast path failed Console read validation: '+errors.join('; '));

  const forecastSessions=sessions.map((session,index)=>({
    session_label:EDGE_STOCK_FORECAST_LABELS[index],
    trading_date:session.target_session,
    direction:session.direction,
    probabilities:session.probabilities,
    expected_centre:session.expected_centre,
    expected_zone:session.expected_price_zone,
    verification_state:session.verification_state,
    lineage_id:session.lineage_id,
    methodology_version:session.methodology_version,
    producer_version:session.producer_version,
  }));

  if(forecastPath.version!==EDGE_STOCK_FORECAST_PATH_VERSION){
    throw new Error('stored G5 forecast path version is not supported');
  }
  return {forecastPath,forecastSessions};
}
