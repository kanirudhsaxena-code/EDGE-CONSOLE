import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('ticker-only EDGE command loads today governed result before research failure',()=>{
  const source=readFileSync('src/router.ts','utf8');
  const today=source.indexOf('const today = await todaysAutonomousRecommendation(env, ticker)');
  const required=source.indexOf("code: 'EDGE_RESEARCH_BUNDLE_REQUIRED'");
  assert.ok(today>=0);
  assert.ok(required>today);
  assert.ok(source.includes("status: 'ALREADY_PUBLISHED_TODAY'"));
  assert.ok(source.includes('run_timestamp: today.runTimestamp'));
});

test('ticker-only EDGE command may reuse a still-valid governed research bundle',()=>{
  const source=readFileSync('src/router.ts','utf8');
  assert.ok(source.includes('latestReusableEdgeResearchBundle'));
  assert.ok(source.includes("research_fresh_at >= now() - interval '24 hours'"));
  assert.ok(source.includes('researchBundleCanPublish(payload).ready'));
});

test('Console exposes India-local date and time on current and historical runs',()=>{
  const app=readFileSync('public/app.js','utf8');
  const edge=readFileSync('public/edge-live.js','utf8');
  assert.ok(app.includes("timeZone:'Asia/Kolkata'"));
  assert.ok(app.includes('Run time · '));
  assert.ok(edge.includes("timeZone:'Asia/Kolkata'"));
  assert.ok(edge.includes('Call time:'));
  assert.ok(edge.includes('Run time · '));
});
