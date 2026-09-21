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
  assert.match(app,/ASSESSMENT · TILL DATE/);
  assert.match(stocks,/1 — EDGE MASTER ASSESSMENT/);
  assert.match(stocks,/2 — CURRENT STOCK OUTCOME/);
  assert.match(stocks,/3 — DRILL-DOWN/);
  assert.match(stocks,/4 — ACTIVE CALLS/);
});

test('governed Chat workflow fails closed unless live Console sections are captured',()=>{
  assert.match(workflow,/CHAT_PRESENTATION_SOURCE=LIVE_EDGE_CONSOLE/);
  assert.match(workflow,/CHAT_PRESENTATION_VALID=TRUE/);
  assert.match(workflow,/missing_console_sections/);
  assert.match(workflow,/node scripts\/capture-console-presentation\.mjs/);
});
