import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyPreopenTick, REQUIRED_PREOPEN_STOCK_TICKERS } from '../src/preopen-scheduler';
import { classifyCachedNseSession, classifyGovernedNseSession } from '../src/nse-trading-calendar';

const ist=(iso:string)=>new Date(iso);

test('Cloudflare clock exposes explicit PREP, RESEARCH and AUCTION stages',()=>{
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:20:00Z')),'PREP');      // 08:50 IST
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:35:00Z')),'RESEARCH');  // 09:05 IST
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:39:59Z')),'RESEARCH');  // 09:09 IST
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:40:00Z')),'AUCTION');   // 09:10 IST
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:44:59Z')),'AUCTION');
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:45:00Z')),'OUTSIDE');
  assert.equal(classifyPreopenTick(ist('2026-10-03T03:40:00Z')),'OUTSIDE');
});

test('wrangler schedules redundant calendar refresh plus DATA, research and auction windows',()=>{
  const text=fs.readFileSync('wrangler.jsonc','utf8');
  assert.match(text,/"35 2 \* \* 1-5"/);
  assert.match(text,/"0 3 \* \* 1-5"/);
  assert.match(text,/"20 3 \* \* 1-5"/);
  assert.match(text,/"35-39 3 \* \* 1-5"/);
  assert.match(text,/"40-44 3 \* \* 1-5"/);
  assert.match(text,/FIVEDR_PREOPEN_ACQUIRE_WORKFLOW/);
});

test('required pre-open stock population is explicit and independent of open-call discovery',()=>{
  assert.deepEqual([...REQUIRED_PREOPEN_STOCK_TICKERS],['LTF','CUPID','RELIANCE']);
});

test('production scheduler owns DATA then RESEARCH then AUCTION dispatch',()=>{
  const scheduler=fs.readFileSync('src/preopen-scheduler.ts','utf8');
  assert.match(scheduler,/dispatchEdgeDataWorkflow/);
  assert.match(scheduler,/produceStockSystemResearch/);
  assert.match(scheduler,/persistEdgeResearchBundle/);
  assert.match(scheduler,/dispatchEdgeAuctionWorkflow/);
  assert.match(scheduler,/markStockAuctionPending/);
  assert.match(scheduler,/PREP_DATA_THEN_RESEARCH_THEN_AUCTION_DATA_THEN_COMPUTE/);
});

test('stock canonical invocation carries exact lifecycle instead of research-age lookup',()=>{
  const scheduler=fs.readFileSync('src/preopen-scheduler.ts','utf8');
  assert.match(scheduler,/lifecycle_id:lifecycleId/);
  assert.doesNotMatch(scheduler,/research_not_before:researchNotBefore/);
  assert.doesNotMatch(scheduler,/latest_research_fresh_at/);
});

test('NIFTY PREP and fresh delta research are both production-owned',()=>{
  const scheduler=fs.readFileSync('src/preopen-scheduler.ts','utf8');
  const mobile=fs.readFileSync('src/mobile-v1-entry.ts','utf8');
  assert.match(scheduler,/prep_only:true/);
  assert.match(scheduler,/refreshPreopenPrepResearch/);
  assert.match(mobile,/DELTA_RESEARCH_READY/);
  assert.match(mobile,/acquireSystemResearch\(\)/);
});

test('production entrypoint exposes the Cloudflare scheduled handler',()=>{
  const text=fs.readFileSync('src/production-entry.ts','utf8');
  assert.match(text,/async scheduled\(controller: ScheduledController/);
  assert.match(text,/runPreopenScheduledTick\(env, new Date\(\), controller\.scheduledTime\)/);
});
test('bootstrap calendar remains bounded while dynamic cache understands holidays and special timing',()=>{
  assert.equal(classifyGovernedNseSession('2026-10-06'),'TRADING_DAY');
  assert.equal(classifyGovernedNseSession('2026-10-20'),'TRADING_HOLIDAY');
  assert.equal(classifyGovernedNseSession('2026-10-03'),'WEEKEND');
  assert.equal(classifyGovernedNseSession('2027-01-04'),'CALENDAR_COVERAGE_MISSING');
  assert.equal(classifyCachedNseSession('2027-01-04',{
    trading_holidays:['2027-01-26'],
    special_timing_dates:['2027-11-01'],
  }),'TRADING_DAY');
  assert.equal(classifyCachedNseSession('2027-01-26',{
    trading_holidays:['2027-01-26'],
    special_timing_dates:[],
  }),'TRADING_HOLIDAY');
  assert.equal(classifyCachedNseSession('2027-11-01',{
    trading_holidays:[],
    special_timing_dates:['2027-11-01'],
  }),'SPECIAL_TIMING');
  // Clock classification is deliberately calendar-agnostic; the async
  // production session resolver owns the exchange-state gate.
  assert.equal(classifyPreopenTick(ist('2026-10-20T03:20:00Z')),'PREP');
});

test('G5.1 proof wakes every weekday at 09:20 IST but treats NSE holidays as clean no-op',()=>{
  const workflow=fs.readFileSync('.github/workflows/g5-1-preopen-proof.yml','utf8');
  const proof=fs.readFileSync('scripts/g5-1-preopen-proof.py','utf8');
  assert.match(workflow,/cron: '50 3 \* \* 1-5'/);
  assert.doesNotMatch(workflow,/50 3 5 10/);
  assert.match(proof,/NON_TRADING_DAY/);
  assert.match(proof,/CALENDAR_COVERAGE_MISSING/);
  assert.match(proof,/verification_required/);
  assert.doesNotMatch(proof,/TARGET="2026-10-05"/);
  assert.doesNotMatch(proof,/2026-10-01/);
});

test('production scheduler uses dynamic provider/cache session authority before any pre-open work',()=>{
  const scheduler=fs.readFileSync('src/preopen-scheduler.ts','utf8');
  const calendar=fs.readFileSync('src/nse-trading-calendar.ts','utf8');
  const entry=fs.readFileSync('src/production-entry.ts','utf8');
  assert.match(scheduler,/resolveGovernedNseSession/);
  assert.match(scheduler,/preopen_eligible/);
  assert.match(calendar,/v_nse_session_latest/);
  assert.match(calendar,/v_nse_calendar_year_latest/);
  assert.match(calendar,/EXACT_PROVIDER_SESSION/);
  assert.match(calendar,/VERIFIED_YEAR_CACHE/);
  assert.match(calendar,/BOOTSTRAP_STATIC/);
  assert.match(entry,/dispatchEdgeCalendarWorkflow/);
  assert.match(entry,/NSE_CALENDAR_REFRESH_DISPATCHED/);
});

test('calendar API is the shared proof and acceptance authority',()=>{
  const calendar=fs.readFileSync('src/nse-trading-calendar.ts','utf8');
  const proof=fs.readFileSync('scripts/g5-1-preopen-proof.py','utf8');
  assert.match(calendar,/\/api\/market-calendar\/session/);
  assert.match(calendar,/previous_trading_session/);
  assert.match(proof,/\/api\/market-calendar\/session\?date=/);
  assert.match(proof,/NON_STANDARD_SESSION/);
  assert.doesNotMatch(proof,/config\/nse-trading-calendar\.json/);
});
