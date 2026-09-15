import test from 'node:test';import assert from 'node:assert/strict';import {validateVisionObservation,VISION_MODEL} from '../src/vision-producer';

test('accepts governed verified screenshot extraction',()=>{const r=validateVisionObservation({category:'PRICE_TECHNICALS',verification:'VERIFIED',findings:[{label:'visible_last_price',value:25100,confidence:.94}],limitations:[]},'PRICE_TECHNICALS');assert.equal(r?.verification,'VERIFIED');assert.equal(r?.model,VISION_MODEL)});
test('rejects wrong screenshot category',()=>{assert.equal(validateVisionObservation({category:'DERIVATIVES_OI',verification:'VERIFIED',findings:[{label:'x',value:1,confidence:.9}],limitations:[]},'PRICE_TECHNICALS'),null)});
test('rejects confidence outside governed range',()=>{assert.equal(validateVisionObservation({category:'PRICE_TECHNICALS',verification:'VERIFIED',findings:[{label:'x',value:1,confidence:2}],limitations:[]},'PRICE_TECHNICALS'),null)});
test('verified extraction cannot be empty',()=>{assert.equal(validateVisionObservation({category:'PRICE_TECHNICALS',verification:'VERIFIED',findings:[],limitations:[]},'PRICE_TECHNICALS'),null)});
test('unavailable extraction may be empty with limitation',()=>{const r=validateVisionObservation({category:'DERIVATIVES_OI',verification:'UNAVAILABLE',findings:[],limitations:['not legible']},'DERIVATIVES_OI');assert.equal(r?.verification,'UNAVAILABLE')});
