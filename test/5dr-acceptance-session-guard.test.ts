import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function run(at:string){
  const r=spawnSync('python3',['scripts/nse-session-state.py','--at',at],{encoding:'utf8'});
  return {status:r.status,body:r.stdout?JSON.parse(r.stdout):null,stderr:r.stderr};
}

test('NSE session helper distinguishes live, closed, holiday and uncovered states',()=>{
  let r=run('2026-10-06T10:30:00+05:30');
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.body.session_state,'TRADING_DAY');
  assert.equal(r.body.market_phase,'LIVE_INTRADAY');
  assert.equal(r.body.expected_live_market_data,true);

  r=run('2026-10-06T00:18:00+05:30');
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.body.session_state,'TRADING_DAY');
  assert.equal(r.body.market_phase,'CLOSED_SESSION');
  assert.equal(r.body.expected_live_market_data,false);

  r=run('2026-10-20T10:30:00+05:30');
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.body.session_state,'TRADING_HOLIDAY');
  assert.equal(r.body.expected_live_market_data,false);

  r=run('2027-01-04T10:30:00+05:30');
  assert.equal(r.status,2);
  assert.equal(r.body.session_state,'CALENDAR_COVERAGE_MISSING');
});

test('5DR production acceptance treats governed closed-session market-data blocks as transport pass only',()=>{
  const workflow=fs.readFileSync('.github/workflows/5dr-automated-production-acceptance.yml','utf8');
  assert.match(workflow,/actions\/checkout@v4/);
  assert.match(workflow,/scripts\/nse-session-state\.py/);
  assert.match(workflow,/expected_live_market_data/);
  assert.match(workflow,/CLOSED_SESSION_FAIL_CLOSED/);
  assert.doesNotMatch(workflow,/WEEKEND_FAIL_CLOSED/);
  assert.match(workflow,/CALENDAR_COVERAGE_MISSING/);
});
