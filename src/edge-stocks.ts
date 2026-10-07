import { isNonEmptyString, isObject, type JsonRecord } from './normalization';
import { validateEdgeStockForecastPath } from './edge-stock-forecast-path';

const percentOrNull = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);

const nonNegativeInt = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0;

const requiredNumber = (obj: JsonRecord, key: string, min: number, max: number, errors: string[], path: string): void => {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path}.${key} must be ${min}-${max}`);
  }
};

export function validateEdgeStocksResult(body: unknown, options: { requireForecastPath?: boolean } = {}): string[] {
  const errors: string[] = [];
  if (!isObject(body)) return ['request body must be a JSON object'];
  if (body.contract_version !== 'EDGE_STOCKS_V1_3') errors.push('contract_version must be EDGE_STOCKS_V1_3');
  if (body.presentation_contract !== 'EFFICACY_V2') errors.push('presentation_contract must be EFFICACY_V2');
  if (body.engine !== 'EDGE_STOCKS') errors.push('engine must be EDGE_STOCKS');
  if (body.framework_version !== 'EDGE_V1') errors.push('framework_version must be EDGE_V1');
  if (!isNonEmptyString(body.ticker)) errors.push('ticker is mandatory');
  if (!isNonEmptyString(body.run_id)) errors.push('run_id is mandatory');
  if (!isNonEmptyString(body.generated_at) || Number.isNaN(Date.parse(String(body.generated_at)))) {
    errors.push('generated_at must be a valid ISO timestamp');
  }

  // G5 remains a governed cutover gate. The target contract requires the five-row path,
  // while Lane-1 production may explicitly use compatibility mode until the genuine
  // upstream D:D+4 producer is promoted. Default stays strict for G5/schema tests.
  if (options.requireForecastPath !== false) {
    errors.push(...validateEdgeStockForecastPath(body.forecast_path));
  }

  const presentation = body.presentation;
  if (!isObject(presentation)) errors.push('presentation is mandatory');
  else {
    if (presentation.standard_table_count !== 4) errors.push('presentation.standard_table_count must be exactly 4');
    if (presentation.table_1 !== 'EDGE_MASTER_ASSESSMENT') errors.push('presentation.table_1 must be EDGE_MASTER_ASSESSMENT');
    if (presentation.table_2 !== 'ACTIVE_CALLS') errors.push('presentation.table_2 must be ACTIVE_CALLS');
    if (presentation.table_3 !== 'CURRENT_STOCK_OUTCOME') errors.push('presentation.table_3 must be CURRENT_STOCK_OUTCOME');
    if (presentation.table_4 !== 'DRILLDOWN') errors.push('presentation.table_4 must be DRILLDOWN');
  }

  const master = body.master_assessment;
  if (!isObject(master)) errors.push('master_assessment is mandatory');
  else {
    for (const key of ['recommendations','unique_stocks','open_recommendations','closed_recommendations','official_scorable_recommendations','provisional_captured_checkpoints','provisional_due_checkpoints','provisional_forecast_scorable','provisional_forecast_hits','provisional_forecast_misses','provisional_zone_scorable','provisional_zone_hits','provisional_zone_misses']) {
      if (!nonNegativeInt(master[key])) errors.push(`master_assessment.${key} must be a non-negative integer`);
    }
    for (const key of ['recommendation_hit_rate_pct','direction_hit_rate_pct','target_hit_rate_pct','provisional_forecast_accuracy_pct','provisional_zone_accuracy_pct']) {
      if (!percentOrNull(master[key])) errors.push(`master_assessment.${key} must be null or 0-100`);
    }
    if (master.official_scorable_recommendations === 0) {
      for (const key of ['recommendation_hit_rate_pct','direction_hit_rate_pct','target_hit_rate_pct']) {
        if (master[key] !== null) errors.push(`master_assessment.${key} must be null when official_scorable_recommendations is 0`);
      }
    }
  }

  const build3Precision=body.build3_precision;
  if(build3Precision!==null&&build3Precision!==undefined){
    if(!isObject(build3Precision))errors.push('build3_precision must be an object when present');
    else{
      if(build3Precision.version!=='MDOS_BUILD_3_CORE_ZONE_OUTPUT_V1')errors.push('build3_precision.version must be MDOS_BUILD_3_CORE_ZONE_OUTPUT_V1');
      if(build3Precision.engine!=='EDGE_STOCKS')errors.push('build3_precision.engine must be EDGE_STOCKS');
      if(build3Precision.shadow_only!==true)errors.push('build3_precision.shadow_only must be true');
      if(build3Precision.production_methodology_changed!==false)errors.push('build3_precision.production_methodology_changed must be false');
      if(!Array.isArray(build3Precision.rows)||build3Precision.rows.length!==5)errors.push('build3_precision.rows must contain exactly D through D+4');
      else{
        const expected=['D','D+1','D+2','D+3','D+4'];
        build3Precision.rows.forEach((item,index)=>{
          if(!isObject(item)){errors.push(`build3_precision.rows[${index}] must be an object`);return;}
          if(item.horizon!==expected[index])errors.push(`build3_precision.rows[${index}].horizon must be ${expected[index]}`);
          if(!isNonEmptyString(item.target_session))errors.push(`build3_precision.rows[${index}].target_session is mandatory`);
          if(!isObject(item.core_zone))errors.push(`build3_precision.rows[${index}].core_zone is mandatory`);
          if(!isObject(item.outer_zone))errors.push(`build3_precision.rows[${index}].outer_zone is mandatory`);
          for(const key of ['core_width_points','core_width_percent','outer_width_points','outer_width_percent']){
            if(typeof item[key]!=='number'||!Number.isFinite(item[key] as number))errors.push(`build3_precision.rows[${index}].${key} must be numeric`);
          }
          if(!isNonEmptyString(item.calibration_version))errors.push(`build3_precision.rows[${index}].calibration_version is mandatory`);
          if(!isNonEmptyString(item.calibration_state))errors.push(`build3_precision.rows[${index}].calibration_state is mandatory`);
        });
      }
    }
  }

  if (!Array.isArray(body.active_calls)) errors.push('active_calls must be an array');

  const decision = body.current_stock_outcome;
  if (!isObject(decision)) errors.push('current_stock_outcome is mandatory');
  else {
    const d = decision as JsonRecord;
    requiredNumber(d, 'des', -100, 100, errors, 'current_stock_outcome');
    requiredNumber(d, 'directional_agreement', 0, 100, errors, 'current_stock_outcome');
    requiredNumber(d, 'effective_conviction', 0, 1, errors, 'current_stock_outcome');
    if (!isNonEmptyString(d.definitive_forecast)) errors.push('current_stock_outcome.definitive_forecast is mandatory');
    if (!isNonEmptyString(d.forecast_horizon)) errors.push('current_stock_outcome.forecast_horizon is mandatory');
    if (options.requireForecastPath !== false) {
      if (d.forecast_horizon !== 'D:D+4') errors.push('current_stock_outcome.forecast_horizon must be D:D+4');
      const expected=['D','D+1','D+2','D+3','D+4'];
      if (!Array.isArray(d.forecast_sessions) || d.forecast_sessions.length !== 5) {
        errors.push('current_stock_outcome.forecast_sessions must contain exactly D through D+4');
      } else {
        d.forecast_sessions.forEach((session,index)=>{
          if (!isObject(session)) { errors.push(`current_stock_outcome.forecast_sessions[${index}] must be an object`); return; }
          const row=session as JsonRecord;
          if (row.session_label !== expected[index]) errors.push(`current_stock_outcome.forecast_sessions[${index}].session_label must be ${expected[index]}`);
          if (!isNonEmptyString(row.trading_date)) errors.push(`current_stock_outcome.forecast_sessions[${index}].trading_date is mandatory`);
          if (!isNonEmptyString(row.direction)) errors.push(`current_stock_outcome.forecast_sessions[${index}].direction is mandatory`);
          if (!isNonEmptyString(row.regime_context)) errors.push(`current_stock_outcome.forecast_sessions[${index}].regime_context is mandatory`);
          if (!isNonEmptyString(row.evidence_basis)) errors.push(`current_stock_outcome.forecast_sessions[${index}].evidence_basis is mandatory`);
          if (!isNonEmptyString(row.verification_state)) errors.push(`current_stock_outcome.forecast_sessions[${index}].verification_state is mandatory`);
          if (!isObject(row.expected_zone)) errors.push(`current_stock_outcome.forecast_sessions[${index}].expected_zone is mandatory`);
          if(isObject(build3Precision)){
            if(!isObject(row.core_zone))errors.push(`current_stock_outcome.forecast_sessions[${index}].core_zone is mandatory when build3_precision is present`);
            else{
              const cz=row.core_zone as JsonRecord;
              for(const key of ['low','high'])if(typeof cz[key]!=='number'||!Number.isFinite(cz[key] as number))errors.push(`current_stock_outcome.forecast_sessions[${index}].core_zone.${key} must be numeric`);
              if(typeof cz.low==='number'&&typeof cz.high==='number'&&cz.low>cz.high)errors.push(`current_stock_outcome.forecast_sessions[${index}].core_zone must be ordered`);
            }
            if(!isObject(row.core_zone_calibration))errors.push(`current_stock_outcome.forecast_sessions[${index}].core_zone_calibration is mandatory when build3_precision is present`);
          }
          if (!isObject(row.probabilities)) errors.push(`current_stock_outcome.forecast_sessions[${index}].probabilities is mandatory`);
          else {
            const p=row.probabilities as JsonRecord;
            for (const key of ['bull','base','bear']) requiredNumber(p,key,0,100,errors,`current_stock_outcome.forecast_sessions[${index}].probabilities`);
            if (typeof p.bull==='number' && typeof p.base==='number' && typeof p.bear==='number' && Math.abs(p.bull+p.base+p.bear-100)>0.01) {
              errors.push(`current_stock_outcome.forecast_sessions[${index}].probabilities must sum to 100 within 0.01`);
            }
          }
        });
      }
    }
    if (!isNonEmptyString(d.primary_action)) errors.push('current_stock_outcome.primary_action is mandatory');
    if (!isNonEmptyString(d.decision_ladder)) errors.push('current_stock_outcome.decision_ladder is mandatory');
    if (!isObject(d.market_trust)) errors.push('current_stock_outcome.market_trust is mandatory');
    else {
      const mt=d.market_trust as JsonRecord;
      requiredNumber(mt, 'score', 0, 100, errors, 'current_stock_outcome.market_trust');
      if (!isNonEmptyString(mt.band)) errors.push('current_stock_outcome.market_trust.band is mandatory');
      if (!isObject(mt.subscores)) errors.push('current_stock_outcome.market_trust.subscores is mandatory');
      else for (const key of ['evidence_quality','freshness','completeness','directional_agreement','market_confirmation']) requiredNumber(mt.subscores as JsonRecord,key,0,100,errors,'current_stock_outcome.market_trust.subscores');
      if (!isObject(mt.weights)) errors.push('current_stock_outcome.market_trust.weights is mandatory');
      else {
        const w=mt.weights as JsonRecord;
        for (const key of ['evidence_quality','freshness','completeness','directional_agreement','market_confirmation']) requiredNumber(w,key,0,100,errors,'current_stock_outcome.market_trust.weights');
        const total=Object.values(w).reduce<number>((sum,value)=>sum+(typeof value==='number'?value:0),0);
        if(Math.abs(total-100)>0.01)errors.push('current_stock_outcome.market_trust.weights must sum to 100');
      }
    }
    if (!isObject(d.bot)) errors.push('current_stock_outcome.bot is mandatory');
    else {
      const bot=d.bot as JsonRecord;
      requiredNumber(bot, 'score', 0, 100, errors, 'current_stock_outcome.bot');
      if (!isNonEmptyString(bot.grade)) errors.push('current_stock_outcome.bot.grade is mandatory');
      if (!isObject(bot.subscores)) errors.push('current_stock_outcome.bot.subscores is mandatory');
      else for (const key of ['forecast_edge','market_trust','structure_pattern_quality','pv_pvpo_confirmation','catalyst_asymmetry','execution_quality']) requiredNumber(bot.subscores as JsonRecord,key,0,100,errors,'current_stock_outcome.bot.subscores');
      if (!isObject(bot.weights)) errors.push('current_stock_outcome.bot.weights is mandatory');
      else {
        const w=bot.weights as JsonRecord;
        for (const key of ['forecast_edge','market_trust','structure_pattern_quality','pv_pvpo_confirmation','catalyst_asymmetry','execution_quality']) requiredNumber(w,key,0,100,errors,'current_stock_outcome.bot.weights');
        const total=Object.values(w).reduce<number>((sum,value)=>sum+(typeof value==='number'?value:0),0);
        if(Math.abs(total-100)>0.01)errors.push('current_stock_outcome.bot.weights must sum to 100');
      }
    }
    if (!isObject(d.risk_override)) errors.push('current_stock_outcome.risk_override is mandatory');
    if (!isObject(d.expected_price_zone)) errors.push('current_stock_outcome.expected_price_zone is mandatory');
    if (!isObject(d.execution)) errors.push('current_stock_outcome.execution is mandatory');
    if (!isObject(d.probabilities)) errors.push('current_stock_outcome.probabilities is mandatory');
    else {
      const p = d.probabilities as JsonRecord;
      for (const key of ['bull','base','bear']) requiredNumber(p, key, 0, 100, errors, 'current_stock_outcome.probabilities');
      if (typeof p.bull === 'number' && typeof p.base === 'number' && typeof p.bear === 'number' && Math.abs(p.bull + p.base + p.bear - 100) > 0.01) {
        errors.push('current_stock_outcome.probabilities must sum to 100 within 0.01');
      }
    }
  }

  if (!Array.isArray(body.drilldown)) errors.push('drilldown must be an array');
  else if (body.drilldown.length === 0) errors.push('drilldown must contain at least one component');
  else {
    body.drilldown.forEach((row, index) => {
      if (!isObject(row)) {
        errors.push(`drilldown[${index}] must be an object`);
        return;
      }
      for (const key of ['component','key_outcome','interpretation','finding']) {
        if (!isNonEmptyString(row[key])) errors.push(`drilldown[${index}].${key} is mandatory`);
      }
      if (typeof row.original_weight !== 'number' || !Number.isFinite(row.original_weight) || row.original_weight < 0) errors.push(`drilldown[${index}].original_weight is mandatory`);
      for (const key of ['normalized_weight','weighted_contribution']) {
        if (row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]))) errors.push(`drilldown[${index}].${key} must be numeric or null`);
      }
      if (typeof row.conflict_flag !== 'boolean') errors.push(`drilldown[${index}].conflict_flag is mandatory`);
      if (row.evidence_quality == null) errors.push(`drilldown[${index}].evidence_quality is mandatory`);
      if (!['VERIFIED','NOT_VERIFIED','NOT_AVAILABLE','NOT_SCORABLE','N/A'].includes(String(row.verification_status))) {
        errors.push(`drilldown[${index}].verification_status is invalid`);
      }
      if (String(row.verification_status) === 'VERIFIED') {
        const interpretation = String(row.interpretation ?? '').trim();
        if (!interpretation || /no additional interpretation|retained in immutable audit record|component evidence retained/i.test(interpretation)) {
          errors.push(`drilldown[${index}].interpretation must be meaningful for VERIFIED components`);
        }
      }
    });
  }
  return errors;
}

export function componentVerificationStatus(availability: unknown, quality: unknown): 'VERIFIED'|'NOT_VERIFIED'|'NOT_AVAILABLE'|'N/A' {
  if (availability === 'NOT_AVAILABLE') return 'NOT_AVAILABLE';
  if (availability === 'N/A') return 'N/A';
  if (availability !== 'AVAILABLE' || quality === 'NOT_VERIFIED' || quality == null) return 'NOT_VERIFIED';
  return 'VERIFIED';
}
