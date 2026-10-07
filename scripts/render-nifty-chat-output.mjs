import fs from 'node:fs';
import { createHash } from 'node:crypto';

const [finalPath, outputPath, manifestPath] = process.argv.slice(2);
if (!finalPath || !outputPath || !manifestPath) {
  throw new Error('usage: node scripts/render-nifty-chat-output.mjs <final.json> <chat-user-output.md> <manifest.json>');
}

const data = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
const request = data && data.request;
const run = data && data.run;

function fail(message) { throw new Error('NIFTY_CHAT_OUTPUT_BLOCKED: ' + message); }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function pct(value) { const n = num(value); return n === null ? 'Not scorable' : n.toFixed(2).replace(/\.00$/,'') + '%'; }
function fixed(value, digits=1) { const n = num(value); return n === null ? '—' : n.toFixed(digits); }
function text(value, fallback='—') { const s = String(value ?? '').trim(); return s || fallback; }
function md(value) { return text(value).replace(/\|/g, '\\|').replace(/\s+/g, ' '); }
function title(value) { return text(value).replaceAll('_',' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }

if (!isObject(request) || request.status !== 'COMPLETED') fail('request must be COMPLETED');
if (!isObject(run) || run.published !== true || !text(run.run_id, '')) fail('run must be published with run_id');
if (text(request.run_id, '') !== text(run.run_id, '')) fail('request/run identity mismatch');

const result = run.result;
if (!isObject(result)) fail('published result missing');
if (result.assessment_snapshot_complete !== true) fail('assessment snapshot incomplete');
if (result.recommendation_ledger_complete !== true) fail('recommendation ledger incomplete');
if (!text(result.forecast_assessment, '')) fail('forecast assessment missing');
if (!text(result.recommendation_assessment, '')) fail('recommendation assessment missing');
if (!isObject(result.assessment_snapshot) || !isObject(result.assessment_snapshot.metrics)) fail('frozen assessment snapshot missing');

const probs = result.probabilities;
for (const key of ['BULL','RANGE','BEAR']) {
  if (!isObject(probs) || num(probs[key]) === null) fail('overall probability vector incomplete');
}
const pTotal = Number(probs.BULL) + Number(probs.RANGE) + Number(probs.BEAR);
if (Math.abs(pTotal - 100) > 0.05) fail('overall probabilities must total 100');

const horizon = result.horizon_slots;
if (!isObject(horizon)) fail('horizon_slots missing');
const displayHorizon = [
  ['D','D+1'],
  ['D+1','D+2'],
  ['D+2','D+3'],
  ['D+3','D+4'],
  ['D+4','D+5'],
];
for (const [, internal] of displayHorizon) {
  const slot = horizon[internal];
  if (!isObject(slot)) fail(internal + ' forecast slot missing');
  if (!['BULLISH','RANGE','BEARISH'].includes(String(slot.direction))) fail(internal + ' direction invalid');
  if (num(slot.zone_low) === null || num(slot.zone_high) === null || Number(slot.zone_high) <= Number(slot.zone_low)) fail(internal + ' zone invalid');
  if (!isObject(slot.probabilities)) fail(internal + ' probabilities missing');
  const total = Number(slot.probabilities.BULL) + Number(slot.probabilities.RANGE) + Number(slot.probabilities.BEAR);
  if (![slot.probabilities.BULL,slot.probabilities.RANGE,slot.probabilities.BEAR].every(v => num(v) !== null) || Math.abs(total - 100) > 0.05) fail(internal + ' probabilities invalid');
}

const metrics = result.assessment_snapshot.metrics;
const dayMetrics = isObject(metrics.day_metrics) ? metrics.day_metrics : {};
const rec = isObject(metrics.recommendation_metrics) ? metrics.recommendation_metrics : {};
const ret = isObject(metrics.return_metrics) ? metrics.return_metrics : {};
const overall = isObject(metrics.overall_forecast_metrics) ? metrics.overall_forecast_metrics : {};
const ledger = Array.isArray(metrics.recommendation_ledger) ? metrics.recommendation_ledger : [];
const noTrade = isObject(metrics.no_trade_metrics) ? metrics.no_trade_metrics : {};

function dayAssessment(label) {
  const d = isObject(dayMetrics[label]) ? dayMetrics[label] : {};
  const hit = pct(d.hit_rate_pct);
  const zone = pct(d.zone_hit_rate_pct);
  const coverage = pct(d.coverage_pct);
  const margin = num(d.avg_directional_margin_points) === null ? '—' : fixed(d.avg_directional_margin_points, 2) + ' pts';
  const zoneErr = num(d.avg_zone_error_points) === null ? '—' : fixed(d.avg_zone_error_points, 2) + ' pts';
  return `${text(d.status,'NOT DUE')} · direction ${hit} · zone ${zone} · coverage ${coverage} · margin ${margin} · zone error ${zoneErr}`;
}

const ledgerStates = new Map();
for (const item of ledger) {
  const lifecycle = isObject(item && item.lifecycle) ? item.lifecycle : {};
  const state = text(lifecycle.latest_event, 'UNKNOWN');
  ledgerStates.set(state, (ledgerStates.get(state) || 0) + 1);
}
const ledgerSummary = ledger.length
  ? ledger.length + ' persisted · ' + [...ledgerStates.entries()].map(([k,v]) => k + ' ' + v).join(', ')
  : 'No persisted recommendations';

const table1 = [
  ['Overall Forecast Assessment', text(result.assessment_snapshot.headline, text(result.forecast_assessment))],
  ...displayHorizon.map(([display]) => [display, dayAssessment(display)]),
  ['Recommendation Ledger', ledgerSummary],
  ['Recommendation Hit Rate', (num(rec.hit_rate_pct) === null ? 'Not scorable' : pct(rec.hit_rate_pct)) + ' · ' + text(rec.hit_rate_fraction, text(rec.wins,0) + '/' + text(rec.resolved,0))],
  ['Average R', num(rec.average_resolved_r) === null ? 'Not scorable' : fixed(rec.average_resolved_r, 2) + 'R'],
  ['Realized Model P/L', num(ret.cumulative_resolved_pnl_pct) === null ? 'Not scorable' : pct(ret.cumulative_resolved_pnl_pct)],
  ['Open MTM', num(rec.open_standardized_mtm_pct) === null ? 'Not scorable' : pct(rec.open_standardized_mtm_pct)],
  ['No-Trade Effectiveness', num(noTrade.effectiveness_pct) === null ? 'Not scorable' : pct(noTrade.effectiveness_pct)],
  ['Assessment Completeness', metrics.assessment_snapshot_complete === true && metrics.recommendation_ledger_complete === true ? 'COMPLETE' : 'INCOMPLETE'],
  ['Learning Lab', 'No production change from this run; learning remains governed separately.'],
];

const pathText = displayHorizon.map(([display, internal]) => {
  const slot = horizon[internal];
  return `${display}: ${slot.direction} · B ${slot.probabilities.BULL}% / R ${slot.probabilities.RANGE}% / Be ${slot.probabilities.BEAR}% · ${slot.zone_low}–${slot.zone_high}`;
}).join('; ');

const components = isObject(result.engine_diagnostics) && isObject(result.engine_diagnostics.component_scores)
  ? result.engine_diagnostics.component_scores : {};
const eventShock = isObject(result.event_shock) ? result.event_shock : {};
const expectedZone = isObject(result.expected_nifty_zone) ? result.expected_nifty_zone : (isObject(result.expected_zone) ? result.expected_zone : null);
if (!expectedZone || num(expectedZone.low) === null || num(expectedZone.high) === null) fail('expected NIFTY zone missing');

let tradePlan;
if (result.tradeable === true) {
  const plan = isObject(result.execution_plan) ? result.execution_plan : null;
  if (!plan) fail('tradeable run missing execution_plan');
  tradePlan = [
    text(result.recommendation),
    'contract ' + text(plan.contract || plan.instrument),
    'entry ' + text(plan.entry || (plan.entry_low != null && plan.entry_high != null ? plan.entry_low + '–' + plan.entry_high : null)),
    'SL ' + text(plan.stop || plan.sl),
    'T1 ' + text(plan.target1),
    'T2 ' + text(plan.target2),
  ].join(' · ');
} else {
  tradePlan = 'NO TRADE · expected R:R ' + fixed(result.expected_rr, 2) + ' · blockers ' + (Array.isArray(result.tradeability_blockers) ? result.tradeability_blockers.join(', ') : 'governed gate failed');
}

const table2 = [
  ['Forecast', title(result.definitive_forecast || result.directional_label) + ' · Bull ' + fixed(probs.BULL,1) + '% / Range ' + fixed(probs.RANGE,1) + '% / Bear ' + fixed(probs.BEAR,1) + '%'],
  ['Expected Zone', 'D+4 ' + expectedZone.low + '–' + expectedZone.high + ' · ' + pathText],
  ['Regime / DES5', title(result.regime) + ' · DES5 ' + fixed(result.des5,1)],
  ['Market Trust / Event Shock', fixed(result.market_trust,1) + '/100 (' + title(result.market_trust_band) + ') · ' + title(eventShock.level) + ' · transmission ' + title(eventShock.transmission) + ' · kill switch ' + (eventShock.kill_switch === true ? 'ACTIVE' : 'inactive')],
  ['Forecast Assessment', text(result.forecast_assessment)],
  ['Recommendation Assessment', text(result.recommendation_assessment)],
  ['Trade Plan', tradePlan],
  ['Engine Diagnostics', 'Price ' + fixed(components.PRICE_STRUCTURE,1) + ' · PVPO ' + fixed(components.PVPO,1) + ' · Participation ' + fixed(components.PARTICIPATION,1) + ' · Macro ' + fixed(components.MACRO_CATALYSTS,1) + ' · Execution Edge ' + fixed(result.execution_edge,1)],
];

function markdownTable(titleText, rows) {
  return [
    '## ' + titleText,
    '| Field | Output |',
    '| --- | --- |',
    ...rows.map(([a,b]) => '| ' + md(a) + ' | ' + md(b) + ' |'),
  ].join('\n');
}

const output = [
  markdownTable('TABLE 1 — 5DR ASSESSMENT & EFFICACY', table1),
  '',
  markdownTable('TABLE 2 — CURRENT 5DR RUN', table2),
  '',
].join('\n');

const forbidden = ['WHAT WE SAW','WHAT IT MEANS','WHY IT MATTERS NOW','Advanced details','Future performance scorecard'];
for (const label of forbidden) if (output.includes(label)) fail('diagnostic narrative leaked into standard user output: ' + label);
if ((output.match(/^## TABLE /gm) || []).length !== 2) fail('standard output must contain exactly two tables');

fs.writeFileSync(outputPath, output, 'utf8');
const outputSha256 = createHash('sha256').update(output).digest('hex');
const manifest = {
  contract_version: 'BUILD_2_75_NIFTY_CHAT_USER_OUTPUT_V1',
  request_id: String(request.request_id),
  run_id: String(run.run_id),
  framework_version: String(run.framework_version || request.framework_version || ''),
  output_contract_version: String(run.contract_version || request.output_contract_version || ''),
  source: 'EXACT_PUBLISHED_RUN_WITH_FROZEN_ASSESSMENT_SNAPSHOT',
  sections: ['TABLE_1_5DR_ASSESSMENT_EFFICACY','TABLE_2_CURRENT_5DR_RUN'],
  display_horizons: displayHorizon.map(([display]) => display),
  output_sha256: outputSha256,
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
process.stdout.write(output);
