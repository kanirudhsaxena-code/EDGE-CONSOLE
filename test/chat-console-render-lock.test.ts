import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const capture=fs.readFileSync('scripts/capture-console-presentation.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/edge-chat-console-run.yml','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const stocks=fs.readFileSync('public/edge-live.js','utf8');

test('Chat presentation is captured from live Console DOM, not rebuilt from engine JSON',()=>{
  assert.match(capture,/querySelector\('#assessmentSummary'\)\?\.innerText/);
  assert.match(capture,/querySelector\('#fiveDrSummary'\)\?\.innerText/);
  assert.match(capture,/querySelector\('#stocksSummary'\)\?\.innerText/);
  assert.doesNotMatch(capture,/probabilities\.|directional_label|master_assessment|current_stock_outcome/);
});

test('capture selectors are owned by the current Console',()=>{
  for(const id of ['assessmentSummary','fiveDrSummary','stocksSummary','selectedModuleEyebrow','selectedModuleTitle']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(app,/Today’s Market View/);
  assert.match(app,/TABLE 1 · 5DR ASSESSMENT & EFFICACY/);
  assert.match(app,/TABLE 2 · CURRENT 5DR RUN/);
  assert.match(stocks,/1 — EDGE MASTER ASSESSMENT/);
  assert.match(stocks,/2 — ACTIVE CALLS/);
  assert.match(stocks,/3 — CURRENT STOCK OUTCOME/);
  assert.match(stocks,/4 — DRILL-DOWN/);
});

test('governed Chat workflow fails closed unless live Console sections are captured',()=>{
  assert.match(workflow,/CHAT_PRESENTATION_SOURCE=LIVE_EDGE_CONSOLE/);
  assert.match(workflow,/CHAT_PRESENTATION_VALID=TRUE/);
  assert.match(workflow,/missing_console_sections/);
  assert.match(workflow,/node scripts\/capture-console-presentation\.mjs/);
});


test('EDGE NIFTY runner advances then reads canonical persisted state',()=>{
  assert.match(workflow,/resume-processing/);
  assert.match(workflow,/api\/5dr\/run-requests\/\$CAPTURE_REQUEST_ID/);
  assert.match(workflow,/req=d\.get\('request'\) or \{\}/);
  assert.match(workflow,/run=d\.get\('run'\) or \{\}/);
  assert.match(workflow,/\/tmp\/status\.json/);
  assert.match(workflow,/RESUME_EXISTING/);
  assert.doesNotMatch(workflow,/d=json\.load\(open\('\/tmp\/resume\.json'\)\)/);
  assert.match(workflow,/d\.get\('run_id'\)/);
});


test('EDGE NIFTY Chat capture expands full analysis before reading Console text',()=>{
  assert.match(capture,/querySelector\('\[data-analysis-detail\]'\)/);
  assert.match(capture,/detail\.hidden=false/);
  assert.match(capture,/querySelectorAll\('details'\)\.forEach/);
  assert.match(capture,/node\.open=true/);
  assert.match(workflow,/5-day forecast/);
  assert.match(workflow,/WHAT WE SAW/);
  assert.match(workflow,/WHAT IT MEANS/);
  assert.match(workflow,/WHY IT MATTERS NOW/);
  assert.match(workflow,/What could change the view\?/);
  assert.match(workflow,/Future performance scorecard/);
});

test('Chat stock UAT preflights independently verified Event-Shock research before dispatch',()=>{
  assert.match(workflow,/G5 EVENT_SHOCK independently verified research is required before user dispatch/);
  assert.match(workflow,/evidence_category.*EVENT_SHOCK/);
  assert.match(workflow,/CHATGPT_WEB.*EXA/);
});


test('EDGE Stocks Chat capture always requires complete D:D+4 parity and visible regime/evidence',()=>{
  assert.match(capture,/waitForSelector\('#stocksSummary \[data-edge-five-session-path="D:D\+4"\] \[data-edge-forecast-row="D\+4"\]'/);
  assert.match(workflow,/CANONICAL FORECAST PATH/);
  assert.match(workflow,/Five governed sessions · D through D\+4/);
  assert.match(workflow,/Regime:/);
  assert.match(workflow,/Evidence:/);
  assert.match(workflow,/if module=='EDGE_STOCKS':/);
});


test('stock Chat parity compares regime evidence and verification fields to governed source',()=>{
  assert.match(workflow,/r\.get\('regime_context'\)==str\(s\.get\('regime_context'\) or ''\)/);
  assert.match(workflow,/r\.get\('evidence_basis'\)==str\(s\.get\('evidence_basis'\) or ''\)/);
  assert.match(workflow,/r\.get\('verification_state'\)==str\(s\.get\('verification_state'\) or ''\)/);
});


test('Build 2.75 locks NIFTY D:D+4 labels and semantic execution wording',()=>{
  assert.match(app,/Expected NIFTY zone · D\+4/);
  assert.doesNotMatch(app,/Expected NIFTY zone · D\+5/);
  assert.match(app,/D through D\+4 outcomes are available/);
  assert.doesNotMatch(app,/D\+1 to D\+5 outcomes are available/);
  assert.match(app,/R:R quality subscore/);
  assert.match(app,/actual expected R:R/);
});

test('Build 2.75 derives headline zone efficacy from the governed cumulative assessment when needed',()=>{
  assert.match(app,/overallZoneHits/);
  assert.match(app,/overallZoneScorable/);
  assert.match(app,/overallZoneRate/);
  assert.match(app,/zone hits across the selected canonical population/);
});

test('Build 2.75 explanation cards do not call scored structured evidence absent merely because screenshot drilldown is missing',()=>{
  assert.match(app,/Governed structured basis:/);
  assert.match(app,/Governed PVPO component/);
  assert.match(app,/PVPO may contribute to DES5 from the governed normalized evidence/);
});


test('Build 2.75 live Chat workflow fails on NIFTY semantic contradictions',()=>{
  assert.match(workflow,/forbidden_nifty_presentation/);
  assert.match(workflow,/contradictory_zone_efficacy_pairs/);
  assert.match(workflow,/actual expected R:R 0\.00 · hard gate FAIL/);
});
