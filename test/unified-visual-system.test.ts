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
