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
  assert.match(workflow,/resume_http=/);
  assert.match(workflow,/RESUME_EXISTING/);
  assert.doesNotMatch(workflow,/d=json\.load\(open\('\/tmp\/resume\.json'\)\)/);
});


test('EDGE NIFTY Chat capture expands full analysis before reading Console text',()=>{
  assert.match(capture,/querySelector\('\[data-analysis-detail\]'\)/);
  assert.match(capture,/detail\.hidden=false/);
  assert.match(capture,/querySelectorAll\('details'\)\.forEach/);
  assert.match(capture,/node\.open=true/);
  assert.match(workflow,/5-day forecast — day-wise direction & range/);
  assert.match(workflow,/Why this view\?/);
  assert.match(workflow,/What could change the view\?/);
  assert.match(workflow,/Future performance scorecard/);
});
