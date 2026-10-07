import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration=readFileSync(new URL('../database/0010_build3_truth_outcomes.sql',import.meta.url),'utf8');
const efficacy=readFileSync(new URL('../database/0011_build3_efficacy_scoring_contract.sql',import.meta.url),'utf8');
const recommendationTruth=readFileSync(new URL('../database/0012_build3_recommendation_truth.sql',import.meta.url),'utf8');
const intradayTruth=readFileSync(new URL('../database/0013_build3_recommendation_intraday_sources.sql',import.meta.url),'utf8');
const intradayDispatch=readFileSync(new URL('../database/0014_build3_intraday_dispatch_attempts.sql',import.meta.url),'utf8');

test('Wave 3 Truth migration defines immutable full-OHLC source evidence',()=>{
  assert.match(migration,/create table if not exists build3_session_ohlc_sources/i);
  assert.match(migration,/actual_open double precision not null/i);
  assert.match(migration,/actual_high double precision not null/i);
  assert.match(migration,/actual_low double precision not null/i);
  assert.match(migration,/actual_close double precision not null/i);
  assert.match(migration,/corporate_action_state text not null/i);
  assert.match(migration,/prevent_build3_session_ohlc_mutation/i);
});

test('Wave 3 expands horizon truth metrics without mutating frozen issuance',()=>{
  for(const field of [
    'direction_result','direction_margin_points','outer_touch','outer_close_hit',
    'core_touch','core_close_hit','probability_state','realized_probability_class',
    'brier_score','scorability_state','scorability_reason'
  ])assert.match(migration,new RegExp('add column if not exists '+field,'i'));
});

test('Wave 3 outcome attempts and decision outcomes are append-only/idempotent surfaces',()=>{
  assert.match(migration,/create table if not exists build3_outcome_attempts/i);
  assert.match(migration,/prevent_build3_outcome_attempt_mutation/i);
  assert.match(migration,/create table if not exists build3_decision_outcomes/i);
  assert.match(migration,/unique\(engine,source_id\)/i);
  assert.match(migration,/prevent_build3_decision_outcome_mutation/i);
});


test('Efficacy migration adds zone deviation/traffic-light fields and immutable recommendation efficacy',()=>{
  for(const field of [
    'zone_efficacy_version','outer_high_breach_points','outer_low_breach_points',
    'outer_range_deviation_pct','outer_deviation_hit','outer_challenger_3pct_hit','outer_quality_status',
    'core_high_breach_points','core_low_breach_points','core_range_deviation_pct',
    'core_deviation_hit','core_challenger_3pct_hit','core_quality_status'
  ])assert.match(efficacy,new RegExp('add column if not exists '+field,'i'));
  assert.match(efficacy,/create table if not exists build3_recommendation_efficacy/i);
  assert.match(efficacy,/DUAL_TOUCH/);
  assert.match(efficacy,/prevent_build3_recommendation_efficacy_mutation/i);
});


test('recommendation Truth attempts are append-only and retryable',()=>{
  assert.match(recommendationTruth,/create table if not exists build3_recommendation_observation_attempts/i);
  assert.match(recommendationTruth,/PENDING_SOURCE/);
  assert.match(recommendationTruth,/NOT_SCORABLE/);
  assert.match(recommendationTruth,/prevent_build3_recommendation_observation_attempt_mutation/i);
});


test('one-minute recommendation truth sources are immutable and provider-key bound',()=>{
  assert.match(intradayTruth,/create table if not exists build3_recommendation_intraday_sources/i);
  assert.match(intradayTruth,/provider_instrument_key text not null/i);
  assert.match(intradayTruth,/candle_interval_minutes integer not null check \(candle_interval_minutes=1\)/i);
  assert.match(intradayTruth,/prevent_build3_recommendation_intraday_source_mutation/i);
});


test('intraday truth dispatch attempts are append-only and retry-auditable',()=>{
  assert.match(intradayDispatch,/create table if not exists build3_recommendation_intraday_dispatch_attempts/i);
  assert.match(intradayDispatch,/DISPATCHED/);
  assert.match(intradayDispatch,/CONFIGURATION_BLOCKED/);
  assert.match(intradayDispatch,/prevent_build3_intraday_dispatch_attempt_mutation/i);
});
