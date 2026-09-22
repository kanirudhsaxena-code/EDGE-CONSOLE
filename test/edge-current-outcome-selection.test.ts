import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Current Stock Outcome uses latest run while Active Calls remain canonical-only',()=>{
  const router=readFileSync('src/router.ts','utf8');
  const start=router.indexOf('const activeRows = await sql');
  const end=router.indexOf("if (!activeRows.length)",start);
  assert.ok(start>=0 && end>start);
  const currentSelector=router.slice(start,end);
  assert.match(currentSelector,/where r\.ticker = \$\{symbol\}/);
  assert.match(currentSelector,/order by r\.run_timestamp desc/);
  assert.doesNotMatch(currentSelector,/include_in_master_metrics/);
  assert.doesNotMatch(currentSelector,/l\.status = 'OPEN'/);

  const activeStart=router.indexOf('const allActiveRows = await sql',end);
  assert.ok(activeStart>end);
  const activeBlock=router.slice(activeStart,router.indexOf('const master =',activeStart));
  assert.match(activeBlock,/v_edge_active_calls/);
});
