import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEdgeAuctionWorkflowAccess, checkEdgeDataWorkflowAccess, checkEdgeWorkflowAccess, dispatchEdgeAuctionWorkflow, dispatchEdgeDataWorkflow, dispatchEdgeWorkflow, normalizeTickerCandidate, parseEdgeCommand } from '../src/edge-command';

test('parses canonical EDGE command case-insensitively', () => {
  assert.deepEqual(parseEdgeCommand('  edge LTF  '), { raw: 'edge LTF', target: 'LTF' });
  assert.deepEqual(parseEdgeCommand('EDGE Jio Financial Services'), { raw: 'EDGE Jio Financial Services', target: 'Jio Financial Services' });
});

test('rejects non-EDGE or empty commands', () => {
  assert.equal(parseEdgeCommand('LTF'), null);
  assert.equal(parseEdgeCommand('EDGE   '), null);
  assert.equal(parseEdgeCommand(null), null);
});

test('normalizes ticker candidates without guessing company names', () => {
  assert.equal(normalizeTickerCandidate('ltf'), 'LTF');
  assert.equal(normalizeTickerCandidate('M&MFIN'), 'M&MFIN');
  assert.equal(normalizeTickerCandidate('Jio Financial Services'), null);
});

test('dispatch fails closed without runtime credential', async () => {
  const result = await dispatchEdgeWorkflow('', 'LTF');
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('dispatch uses existing governed autonomous workflow and no trading endpoint', async () => {
  const original = globalThis.fetch;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(null, { status: 204 });
  };
  try {
    const result = await dispatchEdgeWorkflow('secret-token', 'LTF', 'UNKNOWN', 'EDGE-RESEARCH-LTF-20260919-TEST');
    assert.equal(result.ok, true);
    assert.match(capturedUrl, /EDGE---V1\/actions\/workflows\/autonomous-publish\.yml\/dispatches$/);
    const body = JSON.parse(String(capturedInit?.body));
    assert.equal(body.ref, 'main');
    assert.equal(body.inputs.ticker, 'LTF');
    assert.equal(body.inputs.holding_state, 'UNKNOWN');
    assert.equal(body.inputs.research_bundle_id, 'EDGE-RESEARCH-LTF-20260919-TEST');
    assert.equal(capturedInit?.method, 'POST');
  } finally {
    globalThis.fetch = original;
  }
});


test('all lifecycle workflow access checks are non-mutating and target exact governed workflows', async () => {
  const original = globalThis.fetch;
  const calls:{url:string;method:string}[]=[];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({url:String(input),method:String(init?.method || 'GET')});
    return new Response(JSON.stringify({ id: 1 }), { status: 200 });
  };
  try {
    const [compute,data,auction]=await Promise.all([
      checkEdgeWorkflowAccess('secret-token'),
      checkEdgeDataWorkflowAccess('secret-token'),
      checkEdgeAuctionWorkflowAccess('secret-token'),
    ]);
    assert.equal(compute.ok,true);
    assert.equal(data.ok,true);
    assert.equal(auction.ok,true);
    assert.deepEqual(calls.map(x=>x.method),['GET','GET','GET']);
    assert.ok(calls.some(x=>/autonomous-publish\.yml$/.test(x.url)));
    assert.ok(calls.some(x=>/stock-data-snapshot\.yml$/.test(x.url)));
    assert.ok(calls.some(x=>/stock-auction-snapshot\.yml$/.test(x.url)));
  } finally {
    globalThis.fetch = original;
  }
});


test('canonical EDGE dispatch carries request timestamp and slot to governed workflow', async () => {
  const original = globalThis.fetch;
  let body:any = null;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(null, { status: 204 });
  };
  try {
    const result = await dispatchEdgeWorkflow(
      'secret-token','LTF','UNKNOWN','EDGE-RESEARCH-LTF-X',
      '2026-09-22T03:25:00.000Z','08:55'
    );
    assert.equal(result.ok,true);
    assert.equal(body.inputs.canonical_requested_at,'2026-09-22T03:25:00.000Z');
    assert.equal(body.inputs.canonical_attempt_slot,'08:55');
  } finally {
    globalThis.fetch = original;
  }
});


test('governed compute dispatch transports DATA, research and auction lineage', async () => {
  const original = globalThis.fetch;
  let body:any = null;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(null, { status: 204 });
  };
  try {
    const result = await dispatchEdgeWorkflow(
      'secret-token','LTF','UNKNOWN','ER2-LTF-X',
      '2026-10-05T03:41:00.000Z','09:11',
      'EDGE-LC-2026-10-05-LTF-PREOPEN',
      'EDGE-MKT-LTF-X',
      'EDGE-AUCT-LTF-X'
    );
    assert.equal(result.ok,true);
    assert.equal(body.inputs.lifecycle_id,'EDGE-LC-2026-10-05-LTF-PREOPEN');
    assert.equal(body.inputs.market_snapshot_id,'EDGE-MKT-LTF-X');
    assert.equal(body.inputs.auction_snapshot_id,'EDGE-AUCT-LTF-X');
  } finally {
    globalThis.fetch = original;
  }
});

test('DATA and AUCTION dispatchers target separate read-only workflows', async () => {
  const original = globalThis.fetch;
  const urls:string[]=[];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(null,{status:204});
  };
  try {
    const data=await dispatchEdgeDataWorkflow('secret-token',{
      ticker:'LTF',lifecycle_id:'EDGE-LC-2026-10-05-LTF-PREOPEN',trigger_type:'SCHEDULED',target_session:'2026-10-05'
    });
    const auction=await dispatchEdgeAuctionWorkflow('secret-token',{
      ticker:'LTF',lifecycle_id:'EDGE-LC-2026-10-05-LTF-PREOPEN'
    });
    assert.equal(data.ok,true);
    assert.equal(auction.ok,true);
    assert.match(urls[0],/stock-data-snapshot\.yml\/dispatches$/);
    assert.match(urls[1],/stock-auction-snapshot\.yml\/dispatches$/);
  } finally {
    globalThis.fetch = original;
  }
});
