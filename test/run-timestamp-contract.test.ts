import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('EDGE invoke loads an existing governed autonomous result from today before requiring a new research bundle',()=>{
  const source=readFileSync('src/router.ts','utf8');
  const today=source.indexOf('const existingToday = await todaysAutonomousRecommendation(env, ticker)');
  const required=source.indexOf("Fresh ChatGPT research bundle is mandatory before EDGE dispatch");
  assert.ok(today>0);
  assert.ok(required>today);
  assert.ok(source.includes("const forceNew = body.force_new === true"));
  assert.ok(source.includes("if (existingToday && !forceNew && !isObject(body.research_bundle))"));
  assert.ok(source.includes("status: 'ALREADY_PUBLISHED_TODAY'"));
  assert.ok(source.includes('run_timestamp: existingToday.runTimestamp'));
});

test('EDGE Stocks report timestamp is the recommendation run timestamp, not page-open time',()=>{
  const source=readFileSync('src/router.ts','utf8');
  assert.ok(source.includes('generated_at: active.run_timestamp ?? new Date().toISOString()'));
});

test('EDGE NIFTY and EDGE Stocks primary results visibly include date/time',()=>{
  const app=readFileSync('public/app.js','utf8');
  const edge=readFileSync('public/edge-live.js','utf8');
  assert.ok(app.includes('Run date/time:'));
  assert.ok(app.includes('Run started:'));
  assert.ok(edge.includes('Run date/time:'));
  assert.ok(edge.includes('Call date/time:'));
});
