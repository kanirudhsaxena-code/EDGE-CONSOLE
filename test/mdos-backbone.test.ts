import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MDOS_ENGINE_REGISTRY,
  MDOS_LEARNING_RUNTIME_CONTRACT,
  dispatchRegisteredEngine,
  parseMdosCommand,
} from '../src/mdos-backbone';

test('registers exactly the three MDOS engines without sharing methodology',()=>{
  assert.deepEqual(MDOS_ENGINE_REGISTRY.map(x=>x.engine),['5DR','EDGE_STOCKS','EDGE_IPO']);
  for(const engine of MDOS_ENGINE_REGISTRY){
    assert.equal(engine.methodology_boundary,'FROZEN_ENGINE_OWNED');
    assert.equal(engine.trading_enabled,false);
    assert.equal(engine.automatic_learning_adoption,false);
  }
});

test('parses shared MDOS commands without ambiguity',()=>{
  assert.deepEqual(parseMdosCommand('5dr'),{engine:'5DR',command:'5DR'});
  assert.deepEqual(parseMdosCommand('5DR NIFTY'),{engine:'5DR',command:'5DR NIFTY'});
  assert.deepEqual(parseMdosCommand('EDGE LTF'),{engine:'EDGE_STOCKS',command:'EDGE LTF',target:'LTF'});
  assert.deepEqual(parseMdosCommand('ipo edge'),{engine:'EDGE_IPO',command:'IPO EDGE'});
  assert.equal(parseMdosCommand('buy nifty'),null);
});

test('learning contract prohibits automatic adoption and trading',()=>{
  assert.equal(MDOS_LEARNING_RUNTIME_CONTRACT.automatic_adoption,false);
  assert.equal(MDOS_LEARNING_RUNTIME_CONTRACT.governance.trading_execution_prohibited,true);
  assert.equal(MDOS_LEARNING_RUNTIME_CONTRACT.governance.explicit_promotion_decision_required,true);
  assert.equal(MDOS_LEARNING_RUNTIME_CONTRACT.governance.historical_checkpoint_mutation_prohibited,true);
});

test('5DR shared dispatch targets the canonical prompt guard',async()=>{
  let captured:any;
  const result=await dispatchRegisteredEngine({
    token:'token',
    engine:'5DR',
    command:'5DR',
    requestId:'req-1',
    requestedAt:'2026-09-18T12:00:00Z',
    fetcher:async(input,init)=>{
      captured={input:String(input),init};
      return new Response(null,{status:204});
    }
  });
  assert.equal(result.ok,true);
  assert.match(captured.input,/5DR-V2\/actions\/workflows\/5dr-prompt-invocation\.yml\/dispatches$/);
  const body=JSON.parse(String(captured.init.body));
  assert.equal(body.inputs.command,'5DR');
  assert.equal(body.inputs.request_id,'req-1');
});

test('IPO shared dispatch targets approved live V1.1 runtime with no inputs',async()=>{
  let captured:any;
  const result=await dispatchRegisteredEngine({
    token:'token',
    engine:'EDGE_IPO',
    command:'IPO EDGE',
    requestId:'req-2',
    requestedAt:'2026-09-18T12:00:00Z',
    fetcher:async(input,init)=>{
      captured={input:String(input),init};
      return new Response(null,{status:204});
    }
  });
  assert.equal(result.ok,true);
  assert.match(captured.input,/IPO-EDGE\/actions\/workflows\/live_v11\.yml\/dispatches$/);
  const body=JSON.parse(String(captured.init.body));
  assert.equal(body.ref,'main');
  assert.equal('inputs' in body,false);
});

test('shared dispatch fails closed without credential',async()=>{
  const result=await dispatchRegisteredEngine({
    token:'',
    engine:'5DR',
    command:'5DR',
    requestId:'req-3',
    requestedAt:'2026-09-18T12:00:00Z',
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,503);
});
