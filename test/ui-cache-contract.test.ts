import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Console HTML forces the approved EDGE UI v2 assets',()=>{
  const html=readFileSync('public/index.html','utf8');
  assert.ok(html.includes('styles.css?v=edge-ui-v2-20260920'));
  assert.ok(html.includes('edge-live.js?v=edge-ui-v2-20260920'));
  assert.ok(!html.includes('automated-5dr-v1-20260919'));
  assert.ok(html.includes('EDGE IPO</span><span class="module-desc">IPO decision support</span><span class="module-status">In progress</span>'));
});

test('static Console assets are served no-store to prevent stale mobile UI',()=>{
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(source.includes("headers.set('cache-control','no-store, max-age=0')"));
  assert.ok(source.includes("headers.set('pragma','no-cache')"));
});
