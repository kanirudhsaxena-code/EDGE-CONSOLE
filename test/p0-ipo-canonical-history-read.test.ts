import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production entry gives IPO adapter first refusal on common canonical history route', () => {
  const entry = readFileSync('src/production-entry.ts', 'utf8');
  const ipoPos = entry.indexOf('handleP0IpoCanonicalHistoryRead(request, env)');
  const sharedPos = entry.indexOf('handleP0CanonicalHistoryRead(request, env)');
  assert.ok(ipoPos >= 0);
  assert.ok(sharedPos > ipoPos);
});

test('IPO exact history uses isolated IPO database binding and common CANONICAL_READ_V1 contract', () => {
  const source = readFileSync('src/p0-ipo-canonical-history-read.ts', 'utf8');
  assert.match(source, /\/api\/canonical-history/);
  assert.match(source, /CANONICAL_READ_V1/);
  assert.match(source, /env\.IPO_DATABASE_URL/);
  assert.match(source, /neon\(env\.IPO_DATABASE_URL\)/);
  assert.match(source, /reconstructed_from_latest_run: false/);
  assert.match(source, /inferred_from_workflow_name: false/);
  assert.match(source, /fail_closed: true/);
});

test('IPO canonical is T2_FINAL_DAY only and earlier checkpoints remain audit-only', () => {
  const source = readFileSync('src/p0-ipo-canonical-history-read.ts', 'utf8');
  assert.match(source, /checkpoint_type !== 'T2_FINAL_DAY'/);
  assert.match(source, /status: 'NON_CANONICAL_CHECKPOINT'/);
  assert.match(source, /selected_for_headline_efficacy: false/);
  assert.match(source, /Only T2_FINAL_DAY is the governed IPO canonical efficacy checkpoint/);
  assert.match(source, /checkpoint_type='T2_FINAL_DAY'/);
  assert.match(source, /canonical_rule: 'T2_FINAL_DAY'/);
});

test('IPO missing final canonical fails closed without substituting latest checkpoint', () => {
  const source = readFileSync('src/p0-ipo-canonical-history-read.ts', 'utf8');
  assert.match(source, /status: 'NO_FINAL_CANONICAL_YET'/);
  assert.match(source, /Earlier checkpoints are not substituted as the canonical/);
  assert.match(source, /selected_for_headline_efficacy: false/);
});

test('IPO exact canonical history includes evidence, demand, outcome, assessment and receipts', () => {
  const source = readFileSync('src/p0-ipo-canonical-history-read.ts', 'utf8');
  assert.match(source, /from checkpoints/);
  assert.match(source, /from research_evidence/);
  assert.match(source, /from subscription_snapshots/);
  assert.match(source, /from market_sentiment_snapshots/);
  assert.match(source, /from listing_outcomes/);
  assert.match(source, /from assessments/);
  assert.match(source, /from runtime_receipts/);
  assert.match(source, /from learnings/);
  assert.match(source, /NOT_AVAILABLE_UNTIL_P0_11/);
});

test('IPO gateway is read-only', () => {
  const source = readFileSync('src/p0-ipo-canonical-history-read.ts', 'utf8');
  assert.doesNotMatch(source, /insert\s+into/i);
  assert.doesNotMatch(source, /update\s+(ipos|checkpoints|assessments|listing_outcomes|research_evidence)/i);
  assert.doesNotMatch(source, /delete\s+from/i);
});
