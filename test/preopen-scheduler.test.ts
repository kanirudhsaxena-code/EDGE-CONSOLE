import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyPreopenTick, REQUIRED_PREOPEN_STOCK_TICKERS } from '../src/preopen-scheduler';

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

test('wrangler schedules DATA, bounded research readiness and auction windows',()=>{
  const text=fs.readFileSync('wrangler.jsonc','utf8');
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
