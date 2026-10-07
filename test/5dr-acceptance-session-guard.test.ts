import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('5DR production acceptance resolves session state from the production governed calendar API',()=>{
  const workflow=fs.readFileSync('.github/workflows/5dr-automated-production-acceptance.yml','utf8');
  assert.match(workflow,/\/api\/market-calendar\/session\?date=/);
  assert.match(workflow,/expected_live_market_data/);
  assert.match(workflow,/CLOSED_SESSION_FAIL_CLOSED/);
  assert.match(workflow,/CALENDAR_COVERAGE_MISSING/);
  assert.doesNotMatch(workflow,/scripts\/nse-session-state\.py/);
  assert.doesNotMatch(workflow,/WEEKEND_FAIL_CLOSED/);
});

test('closed-session exception stays bounded to known missing-live-candle blockers',()=>{
  const workflow=fs.readFileSync('.github/workflows/5dr-automated-production-acceptance.yml','utf8');
  assert.match(workflow,/CANDLE_ARRAY_MISSING/);
  assert.match(workflow,/INTRADAY_CANDLES_EMPTY/);
  assert.match(workflow,/expected_live_market_data'\) is False/);
  assert.match(workflow,/raise SystemExit\(2\)/);
});
