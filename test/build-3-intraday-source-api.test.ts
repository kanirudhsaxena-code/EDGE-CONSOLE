import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/mobile-v1-entry.ts',import.meta.url),'utf8');

test('one-minute truth ingestion is Build3-only and Access-gated',()=>{
  assert.match(source,/\/api\/build3\/recommendation-intraday-source/);
  assert.match(source,/build3RecommendationIntradaySourceApi/);
  assert.match(source,/Cloudflare Access proof is required/);
  assert.match(source,/persistBuild3RecommendationIntradaySource/);
  assert.match(source,/trading_enabled:false/);
});
