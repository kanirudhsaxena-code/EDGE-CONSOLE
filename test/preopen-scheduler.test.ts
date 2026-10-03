import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyPreopenTick } from '../src/preopen-scheduler';

const ist=(iso:string)=>new Date(iso);

test('Cloudflare pre-open clock recognizes only governed IST windows',()=>{
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:20:00Z')),'PREP');
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:40:00Z')),'AUCTION');
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:44:59Z')),'AUCTION');
  assert.equal(classifyPreopenTick(ist('2026-10-05T03:45:00Z')),'OUTSIDE');
  assert.equal(classifyPreopenTick(ist('2026-10-03T03:40:00Z')),'OUTSIDE');
});

test('wrangler schedules prep and each governed auction retry minute',()=>{
  const text=fs.readFileSync('wrangler.jsonc','utf8');
  assert.match(text,/"20 3 \* \* 1-5"/);
  assert.match(text,/"40-44 3 \* \* 1-5"/);
  assert.match(text,/FIVEDR_PREOPEN_ACQUIRE_WORKFLOW/);
  assert.match(text,/5dr-console-preopen-acquire-proxy\.yml/);
});

test('production entrypoint exposes Cloudflare scheduled handler',()=>{
  const text=fs.readFileSync('src/production-entry.ts','utf8');
  assert.match(text,/async scheduled\(controller: ScheduledController/);
  assert.match(text,/runPreopenScheduledTick\(env, new Date\(\), controller\.scheduledTime\)/);
});

test('NIFTY pre-open scheduler calls canonical endpoint with daily idempotency path',()=>{
  const scheduler=fs.readFileSync('src/preopen-scheduler.ts','utf8');
  const mobile=fs.readFileSync('src/mobile-v1-entry.ts','utf8');
  assert.match(scheduler,/canonical_attempt:true/);
  assert.match(scheduler,/canonical_attempt_slot:clock\.slot/);
  assert.match(scheduler,/cf-preopen-/);
  assert.match(mobile,/5DR:\$\{istParts\.year\}-\$\{istParts\.month\}-\$\{istParts\.day\}:PREOPEN/);
  assert.match(mobile,/dispatch5drPreopenAcquisition/);
  assert.match(mobile,/UPSTOX_PREOPEN_PRIMARY/);
});


test('NIFTY pre-open retries recover the same daily request instead of duplicating it',()=>{
  const scheduler=fs.readFileSync('src/preopen-scheduler.ts','utf8');
  const mobile=fs.readFileSync('src/mobile-v1-entry.ts','utf8');
  assert.match(scheduler,/resumeProcessing\(resumeRequest,env as never,niftyRequestId\)/);
  assert.match(scheduler,/AUTOMATED_MARKET_DATA_BLOCKED/);
  assert.match(scheduler,/const retry=await createAutomatedRun/);
  assert.match(mobile,/status in \('READY_FOR_ENGINE','PROCESSING','COMPLETED','FAILED'\)/);
  assert.match(mobile,/retryablePreopenBlock/);
  assert.match(mobile,/PREOPEN_ACQUISITION_RETRY/);
  assert.match(mobile,/preopen_retry_count/);
  assert.match(mobile,/dispatch5drPreopenAcquisition\(env,String\(row\.request_id\)/);
});
