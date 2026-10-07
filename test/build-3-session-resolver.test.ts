import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuild3TargetSessions } from '../src/build-3-session-resolver';

const dates=(iso:string)=>resolveBuild3TargetSessions(iso).map(row=>row.target_session);

test('Build 3.0 resolves D:D+4 from an intraday trading timestamp',()=>{
  assert.deepEqual(
    dates('2026-10-06T06:30:00.000Z'), // 12:00 IST Tuesday
    ['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12']
  );
});

test('Build 3.0 rolls D forward after the market close',()=>{
  assert.deepEqual(
    dates('2026-10-06T10:30:00.000Z'), // 16:00 IST Tuesday
    ['2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13']
  );
});

test('Build 3.0 rolls weekend timestamps to the next NSE trading session',()=>{
  assert.deepEqual(
    dates('2026-10-10T06:30:00.000Z'), // Saturday
    ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16']
  );
});

test('Build 3.0 skips governed NSE holidays and the following weekend',()=>{
  assert.deepEqual(
    dates('2026-10-02T06:30:00.000Z'), // governed holiday, Friday
    ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09']
  );
});

test('Build 3.0 fails closed when the governed calendar has no coverage',()=>{
  assert.throws(
    ()=>resolveBuild3TargetSessions('2027-01-04T06:30:00.000Z'),
    /BUILD3_SESSION_CALENDAR_COVERAGE_MISSING/
  );
});
