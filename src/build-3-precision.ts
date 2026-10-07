import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import { assertBuild3Forecast, type Build3Forecast, type Build3ForecastHorizon } from './build-3-forecast-contract';
import { BUILD3_HORIZONS, type Build3Horizon } from './build-3-run-contract';
import type { Build3StockPathRow } from './build-3-stock-forecast';

export const BUILD3_PRECISION_VERSION='MDOS_BUILD_3_PRECISION_V1' as const;
export const NIFTY_CORE_CALIBRATION_VERSION='NIFTY_CORE_ZONE_V0_1_SHADOW' as const;
export const STOCK_CORE_CALIBRATION_VERSION='STOCK_CORE_ZONE_CHALLENGER_V0_1' as const;

export type Build3CalibrationState=
  |'CALIBRATED_SHADOW'
  |'UNVALIDATED_SHADOW'
  |'CALIBRATION_PENDING'
  |'CALIBRATION_BLOCKED';

export type Build3PrecisionIssuance={
  precision_version:typeof BUILD3_PRECISION_VERSION;
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  horizon:Build3Horizon;
  target_session:string;
  calibration_version:string;
  calibration_state:Build3CalibrationState;
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

export type Build3PrecisionPlan={
  forecast:Build3Forecast;
  issuance:Build3PrecisionIssuance[];
};

const NIFTY_HALF_WIDTH_PERCENT:Record<Build3Horizon,number>={
  D:0.50,
  'D+1':0.55,
  'D+2':0.60,
  'D+3':0.65,
  'D+4':0.75,
};

// Explicit SHADOW challenger coefficients. They are intentionally stock-specific,
// ATR-based and versioned. They are NOT validated production calibration.
// Missing attributable stock factors leaves the row centre-only and CALIBRATION_PENDING.
const STOCK_HORIZON_ATR_MULTIPLIER:Record<Build3Horizon,number>={
  D:0.35,
  'D+1':0.40,
  'D+2':0.45,
  'D+3':0.50,
  'D+4':0.60,
};
const LIQUIDITY_FACTOR:Record<string,number>={
  DEEP:0.90,HIGH:0.90,NORMAL:1.00,ADEQUATE:1.00,CAUTION:1.10,THIN:1.15,WEAK:1.25,LOW:1.25,
};
const EVENT_FACTOR:Record<string,number>={
  NONE:1.00,LOW:1.00,NO_MATERIAL_RISK:1.00,MODERATE:1.10,HIGH:1.25,HIGH_RISK:1.25,EXTREME:1.40,
};
const REGIME_FACTOR:Record<string,number>={
  BULLISH:1.00,BEARISH:1.00,TREND:1.00,NEUTRAL:0.90,RANGE:0.90,TRANSITION:1.15,EVENT_SHOCK:1.25,
};
const SECTOR_FACTOR:Record<string,number>={
  BULLISH:1.00,BEARISH:1.00,TREND:1.00,NEUTRAL:0.95,RANGE:0.95,TRANSITION:1.10,EVENT_SHOCK:1.20,
};

const finitePositive=(value:unknown):value is number=>
  typeof value==='number'&&Number.isFinite(value)&&value>0;
const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;

function widthMetrics(row:Build3ForecastHorizon){
  const coreWidth=row.core_zone.high-row.core_zone.low;
  const outerWidth=row.outer_zone.high-row.outer_zone.low;
  return {
    core_width_points:coreWidth,
    core_width_percent:coreWidth/row.expected_centre*100,
    outer_width_points:outerWidth,
    outer_width_percent:outerWidth/row.expected_centre*100,
  };
}

function issuanceFromRow(
  forecast:Build3Forecast,
  row:Build3ForecastHorizon,
  calibrationVersion:string,
  calibrationState:Build3CalibrationState,
  normalizationBasis:string,
  calibrationInputs:Record<string,unknown>,
):Build3PrecisionIssuance{
  return {
    precision_version:BUILD3_PRECISION_VERSION,
    engine:forecast.engine,
    instrument:forecast.instrument,
    source_id:forecast.source_id,
    horizon:row.horizon,
    target_session:row.target_session,
    calibration_version:calibrationVersion,
    calibration_state:calibrationState,
    normalization_basis:normalizationBasis,
    expected_centre:row.expected_centre,
    core_low:row.core_zone.low,
    core_high:row.core_zone.high,
    outer_low:row.outer_zone.low,
    outer_high:row.outer_zone.high,
    ...widthMetrics(row),
    calibration_inputs:calibrationInputs,
  };
}

export function buildNiftyPrecisionPlan(input:Build3Forecast):Build3PrecisionPlan{
  if(input.engine!=='5DR'||input.instrument!=='NIFTY')throw new Error('BUILD3_PRECISION_NIFTY_FORECAST_REQUIRED');
  const horizons=input.horizons.map((row):Build3ForecastHorizon=>{
    const halfWidthPercent=NIFTY_HALF_WIDTH_PERCENT[row.horizon];
    const halfWidthPoints=row.expected_centre*(halfWidthPercent/100);
    const candidate={low:row.expected_centre-halfWidthPoints,high:row.expected_centre+halfWidthPoints};
    const candidateWidth=candidate.high-candidate.low;
    const outerWidth=row.outer_zone.high-row.outer_zone.low;
    const fits=
      candidate.low>=row.outer_zone.low&&candidate.high<=row.outer_zone.high&&candidateWidth<outerWidth;
    return fits
      ?{...row,core_zone_kind:'CALIBRATED',core_zone:candidate}
      :{...row,core_zone_kind:'CENTRE_ONLY',core_zone:{low:row.expected_centre,high:row.expected_centre}};
  });
  const forecast=assertBuild3Forecast({...input,horizons});
  const issuance=forecast.horizons.map(row=>{
    const halfWidthPercent=NIFTY_HALF_WIDTH_PERCENT[row.horizon];
    const calibrated=row.core_zone_kind==='CALIBRATED';
    return issuanceFromRow(
      forecast,row,NIFTY_CORE_CALIBRATION_VERSION,
      calibrated?'CALIBRATED_SHADOW':'CALIBRATION_BLOCKED',
      'EXPECTED_CENTRE_PERCENT',
      {
        formula:'EXPECTED_CENTRE_X_SYMMETRIC_HALF_WIDTH_PERCENT',
        half_width_percent:halfWidthPercent,
        horizon:row.horizon,
        outer_containment_required:true,
        shadow_only:true,
        production_methodology_changed:false,
      },
    );
  });
  return {forecast,issuance};
}

function contextFields(value:string):Map<string,string>{
  const fields=new Map<string,string>();
  for(const token of String(value??'').toUpperCase().split(';')){
    const split=token.indexOf('=');
    if(split>0)fields.set(token.slice(0,split).trim(),token.slice(split+1).trim());
  }
  return fields;
}

function lineageObject(row:Build3StockPathRow):Record<string,unknown>{
  const candidates=[row.lineage?.core_calibration,row.lineage?.calibration_inputs,row.lineage];
  for(const value of candidates){
    if(value&&typeof value==='object'&&!Array.isArray(value))return value as Record<string,unknown>;
  }
  return row.lineage??{};
}

function firstPositive(record:Record<string,unknown>,keys:string[]):number|null{
  for(const key of keys){
    const n=Number(record[key]);
    if(Number.isFinite(n)&&n>0)return n;
  }
  return null;
}

function firstString(record:Record<string,unknown>,keys:string[]):string|null{
  for(const key of keys){
    if(nonEmpty(record[key]))return String(record[key]).trim().toUpperCase();
  }
  return null;
}

export type StockCoreCalibrationFactors={
  atr_points:number;
  liquidity_state:string;
  gap_event_risk:string;
  stock_regime:string;
  sector_regime:string;
};

export function stockCoreCalibrationFactors(row:Build3StockPathRow):{
  factors:StockCoreCalibrationFactors|null;
  missing:string[];
}{
  const lineage=lineageObject(row);
  const context=contextFields(row.regime_context);
  const atr=firstPositive(lineage,['atr_points','atr','atr14','median_true_range','realized_range_points']);
  const liquidity=firstString(lineage,['liquidity_state','liquidity'])??context.get('LIQUIDITY')??null;
  const event=firstString(lineage,['gap_event_risk','event_risk','event_gap_risk_state'])??context.get('EVENT')??null;
  const stock=firstString(lineage,['stock_regime'])??context.get('STOCK')??null;
  const sector=firstString(lineage,['sector_regime'])??context.get('SECTOR')??null;
  const missing:string[]=[];
  if(atr===null)missing.push('ATR_OR_STOCK_VOLATILITY');
  if(!liquidity)missing.push('LIQUIDITY');
  if(!event)missing.push('GAP_EVENT_RISK');
  if(!stock)missing.push('STOCK_REGIME');
  if(!sector)missing.push('SECTOR_REGIME');
  if(missing.length)return {factors:null,missing};
  const factors={atr_points:atr!,liquidity_state:liquidity!,gap_event_risk:event!,stock_regime:stock!,sector_regime:sector!};
  if(!(factors.liquidity_state in LIQUIDITY_FACTOR))missing.push('LIQUIDITY_STATE_UNSUPPORTED');
  if(!(factors.gap_event_risk in EVENT_FACTOR))missing.push('GAP_EVENT_RISK_UNSUPPORTED');
  if(!(factors.stock_regime in REGIME_FACTOR))missing.push('STOCK_REGIME_UNSUPPORTED');
  if(!(factors.sector_regime in SECTOR_FACTOR))missing.push('SECTOR_REGIME_UNSUPPORTED');
  return missing.length?{factors:null,missing}:{factors,missing:[]};
}

export function buildStockPrecisionPlan(
  input:Build3Forecast,
  sourceRows:Build3StockPathRow[],
):Build3PrecisionPlan{
  if(input.engine!=='EDGE_STOCKS')throw new Error('BUILD3_PRECISION_STOCK_FORECAST_REQUIRED');
  if(sourceRows.length!==BUILD3_HORIZONS.length)throw new Error('BUILD3_PRECISION_STOCK_FIVE_ROWS_REQUIRED');

  const states:Build3CalibrationState[]=[];
  const inputs:Record<string,unknown>[]=[];
  const horizons=input.horizons.map((row,index):Build3ForecastHorizon=>{
    const source=sourceRows[index];
    if(source.horizon_label!==row.horizon)throw new Error(`BUILD3_PRECISION_STOCK_HORIZON_MISMATCH:${row.horizon}`);
    const factorResult=stockCoreCalibrationFactors(source);
    if(!factorResult.factors){
      states.push('CALIBRATION_PENDING');
      inputs.push({
        required_factors:['ATR_OR_STOCK_VOLATILITY','LIQUIDITY','GAP_EVENT_RISK','STOCK_REGIME','SECTOR_REGIME','HORIZON'],
        missing_factors:factorResult.missing,
        shadow_only:true,
        empirical_validation_state:'2C-02_OPEN',
      });
      return {...row,core_zone_kind:'CENTRE_ONLY',core_zone:{low:row.expected_centre,high:row.expected_centre}};
    }
    const f=factorResult.factors;
    const horizonFactor=STOCK_HORIZON_ATR_MULTIPLIER[row.horizon];
    const halfWidth=
      f.atr_points*horizonFactor*LIQUIDITY_FACTOR[f.liquidity_state]*
      EVENT_FACTOR[f.gap_event_risk]*REGIME_FACTOR[f.stock_regime]*SECTOR_FACTOR[f.sector_regime];
    const candidate={low:row.expected_centre-halfWidth,high:row.expected_centre+halfWidth};
    const candidateWidth=candidate.high-candidate.low;
    const outerWidth=row.outer_zone.high-row.outer_zone.low;
    const fits=
      candidate.low>=row.outer_zone.low&&candidate.high<=row.outer_zone.high&&candidateWidth<outerWidth;
    states.push(fits?'UNVALIDATED_SHADOW':'CALIBRATION_BLOCKED');
    inputs.push({
      formula:'ATR_X_HORIZON_X_LIQUIDITY_X_EVENT_X_STOCK_REGIME_X_SECTOR_REGIME',
      atr_points:f.atr_points,
      horizon_multiplier:horizonFactor,
      liquidity_state:f.liquidity_state,
      liquidity_factor:LIQUIDITY_FACTOR[f.liquidity_state],
      gap_event_risk:f.gap_event_risk,
      event_factor:EVENT_FACTOR[f.gap_event_risk],
      stock_regime:f.stock_regime,
      stock_regime_factor:REGIME_FACTOR[f.stock_regime],
      sector_regime:f.sector_regime,
      sector_regime_factor:SECTOR_FACTOR[f.sector_regime],
      candidate_half_width_points:halfWidth,
      outer_containment_required:true,
      shadow_only:true,
      empirical_validation_state:'2C-02_OPEN',
    });
    return fits
      ?{...row,core_zone_kind:'CALIBRATED',core_zone:candidate}
      :{...row,core_zone_kind:'CENTRE_ONLY',core_zone:{low:row.expected_centre,high:row.expected_centre}};
  });

  const forecast=assertBuild3Forecast({...input,horizons});
  const issuance=forecast.horizons.map((row,index)=>issuanceFromRow(
    forecast,row,STOCK_CORE_CALIBRATION_VERSION,states[index],
    'STOCK_ATR_POINTS',inputs[index],
  ));
  return {forecast,issuance};
}

export async function persistBuild3PrecisionIssuance(
  databaseUrl:string|undefined,
  issuance:Build3PrecisionIssuance[],
):Promise<Build3PrecisionIssuance[]>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_PRECISION_DATABASE_NOT_CONFIGURED');
  if(issuance.length!==5)throw new Error('BUILD3_PRECISION_REQUIRES_FIVE_ROWS');
  const expected=BUILD3_HORIZONS.join(',');
  if(issuance.map(row=>row.horizon).join(',')!==expected)throw new Error('BUILD3_PRECISION_HORIZON_ORDER_INVALID');
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_precision_issuance(
      precision_version,engine,instrument,source_id,horizon,target_session,
      calibration_version,calibration_state,normalization_basis,expected_centre,
      core_low,core_high,outer_low,outer_high,core_width_points,core_width_percent,
      outer_width_points,outer_width_percent,calibration_inputs,payload
    )
    select
      x.precision_version,x.engine,x.instrument,x.source_id,x.horizon,x.target_session::date,
      x.calibration_version,x.calibration_state,x.normalization_basis,x.expected_centre,
      x.core_low,x.core_high,x.outer_low,x.outer_high,x.core_width_points,x.core_width_percent,
      x.outer_width_points,x.outer_width_percent,x.calibration_inputs,x.payload
    from jsonb_to_recordset(${JSON.stringify(issuance.map(row=>({...row,payload:row})))}::jsonb) as x(
      precision_version text,engine text,instrument text,source_id text,horizon text,target_session text,
      calibration_version text,calibration_state text,normalization_basis text,expected_centre double precision,
      core_low double precision,core_high double precision,outer_low double precision,outer_high double precision,
      core_width_points double precision,core_width_percent double precision,outer_width_points double precision,
      outer_width_percent double precision,calibration_inputs jsonb,payload jsonb
    )
    on conflict (engine,source_id,horizon) do nothing
  `;
  const rows=await sql`
    select payload
      from build3_precision_issuance
     where engine=${issuance[0].engine} and source_id=${issuance[0].source_id}
     order by case horizon when 'D' then 0 when 'D+1' then 1 when 'D+2' then 2 when 'D+3' then 3 else 4 end
  `;
  if(rows.length!==5)throw new Error('BUILD3_PRECISION_READBACK_COUNT_MISMATCH');
  const restored=rows.map(row=>row.payload as Build3PrecisionIssuance);
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(issuance)){
    throw new Error('BUILD3_PRECISION_IMMUTABLE_CONFLICT');
  }
  return restored;
}
