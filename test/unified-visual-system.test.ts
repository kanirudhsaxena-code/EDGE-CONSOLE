import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('NIFTY and Stocks share one visual typography and colour system',()=>{
  const css=readFileSync('public/styles.css','utf8');
  assert.ok(css.includes('Unified EDGE Console visual system v5'));
  assert.ok(css.includes('--ui-section-title-size:20px'));
  assert.ok(css.includes('--ui-card-title-size:17px'));
  assert.ok(css.includes('--ui-copy-size:13px'));
  assert.ok(css.includes('.edge-user-head p,'));
  assert.ok(css.includes('.why-card p,'));
  assert.ok(css.includes('.score-pill,'));
  assert.ok(css.includes('.module-name::before'));
  assert.ok(css.includes('.module-tile[data-module="5DR"] .module-name::before'));
  assert.ok(css.includes('.module-tile[data-module="EDGE_STOCKS"] .module-name::before'));
});


test('direction and probability components are standardized across NIFTY and Stocks',()=>{
  const css=readFileSync('public/styles.css','utf8');
  assert.ok(css.includes('Unified direction + probability standard v6'));
  assert.ok(css.includes('--ui-direction-size:28px'));
  assert.ok(css.includes('--ui-prob-label-size:12px'));
  assert.ok(css.includes('--ui-prob-value-size:18px'));
  assert.ok(css.includes('--ui-prob-box-height:86px'));
  assert.ok(css.includes('.simple-result>h2,'));
  assert.ok(css.includes('.edge-highlight-card.direction strong'));
  assert.ok(css.includes('.probability-line,'));
  assert.ok(css.includes('.edge-user-probabilities'));
  assert.ok(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))!important'));
});
