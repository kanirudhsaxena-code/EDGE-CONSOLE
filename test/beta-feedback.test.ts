import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBetaFeedbackInput} from '../src/beta-feedback';

test('valid beta feedback is bounded and normalized',()=>{
  const r=validateBetaFeedbackInput({engine:'5dr',category:'usability',rating:4,message:'Clear result',run_ref:'run_1'});
  assert.deepEqual(r.errors,[]);
  assert.deepEqual(r.value,{engine:'5DR',category:'USABILITY',rating:4,message:'Clear result',run_ref:'run_1'});
});

test('feedback rejects unknown engines, bad ratings and empty messages',()=>{
  const r=validateBetaFeedbackInput({engine:'OTHER_ENGINE',category:'BUG',rating:8,message:' '});
  assert.equal(r.value,undefined);
  assert.ok(r.errors.some(x=>x.includes('engine')));
  assert.ok(r.errors.some(x=>x.includes('rating')));
  assert.ok(r.errors.some(x=>x.includes('message')));
});

test('feedback governance input does not accept arbitrary categories',()=>{
  const r=validateBetaFeedbackInput({engine:'EDGE_IPO',category:'CHANGE_SCORING',message:'Try this'});
  assert.equal(r.value,undefined);
  assert.ok(r.errors.some(x=>x.includes('category')));
});
