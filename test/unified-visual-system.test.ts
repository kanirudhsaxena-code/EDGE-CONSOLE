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

test('decision headings and probability tiles use one standard geometry',()=>{
  const css=readFileSync('public/styles.css','utf8');
  assert.ok(css.includes('--ui-decision-value-size:22px'));
  assert.ok(css.includes('--ui-probability-label-size:12px'));
  assert.ok(css.includes('--ui-probability-value-size:17px'));
  assert.ok(css.includes('--ui-probability-tile-height:88px'));
  assert.ok(css.includes('.simple-result>h2,'));
  assert.ok(css.includes('.edge-highlight-card.range strong'));
  assert.ok(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))!important'));
  assert.ok(css.includes('min-height:var(--ui-probability-tile-height)!important'));
});


test('NIFTY exposes user-friendly decision metrics in the main market view',()=>{
  const app=readFileSync('public/app.js','utf8');
  assert.ok(app.includes('Direction strength'));
  assert.ok(app.includes('Evidence confidence'));
  assert.ok(app.includes('Trade setup strength'));
  assert.ok(app.includes('nifty-signal-grid'));
  assert.ok(!app.includes("<span>DES5</span>"));
  assert.ok(!app.includes("<span>Market Trust</span>"));
  assert.ok(!app.includes("<span>Execution Edge</span>"));
});

test('Stocks direction and five-day range use the same compact visual geometry',()=>{
  const css=readFileSync('public/styles.css','utf8');
  assert.ok(css.includes('NIFTY market metrics + Stocks paired highlights v7'));
  assert.ok(css.includes('.edge-decision-highlights .edge-highlight-card strong,'));
  assert.ok(css.includes('.edge-decision-highlights .edge-highlight-card.range strong'));
  assert.ok(css.includes('font-size:16px!important'));
  assert.ok(css.includes('min-height:0!important'));
  assert.ok(css.includes('white-space:nowrap!important'));
  assert.ok(css.includes('.edge-user-probabilities{'));
  assert.ok(css.includes('margin:8px 0 10px!important'));
});
