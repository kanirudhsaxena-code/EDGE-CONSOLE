import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBuild3CoreZones, validateBuild3CoreZoneOutput } from '../public/build3-core-zone.js';

const rows=['D','D+1','D+2','D+3','D+4'].map((horizon,index)=>({
  horizon,
  target_session:['2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13'][index],
  expected_centre:25000+index*25,
  core_zone:{low:24900+index*25,high:25100+index*25},
  outer_zone:{low:24600+index*20,high:25400+index*30},
  core_width_points:200,
  core_width_percent:0.8,
  outer_width_points:800+index*10,
  outer_width_percent:3.2,
  calibration_version:'NIFTY_CORE_ZONE_V0_1_SHADOW',
  calibration_state:'CALIBRATED_SHADOW',
  normalization_basis:'EXPECTED_CENTRE_PERCENT',
}));
const output={
  version:'MDOS_BUILD_3_CORE_ZONE_OUTPUT_V1',
  engine:'5DR',
  instrument:'NIFTY',
  source_id:'req-1',
  horizon_count:5,
  shadow_only:true,
  production_methodology_changed:false,
  rows,
};

test('Build 3.0 Core Zone renderer exposes all five persisted horizons',()=>{
  assert.equal(validateBuild3CoreZoneOutput(output,'5DR'),output);
  const html=renderBuild3CoreZones(output,{title:'NIFTY Core Zones · D through D+4',instrument:'NIFTY'});
  assert.equal((html.match(/data-build3-core-row=/g)||[]).length,5);
  assert.ok(html.includes('BUILD 3.0 PRECISION · SHADOW'));
  assert.ok(html.includes('NIFTY Core Zones · D through D+4'));
  assert.ok(html.includes('Core 24,900 – 25,100'));
  assert.ok(html.includes('NIFTY_CORE_ZONE_V0_1_SHADOW'));
  assert.ok(html.includes('does not alter the production recommendation'));
});

test('Build 3.0 Core Zone renderer fails closed when Core escapes outer zone',()=>{
  const bad=structuredClone(output);
  bad.rows[2].core_zone.low=24000;
  assert.throws(()=>validateBuild3CoreZoneOutput(bad,'5DR'),/must remain inside outer zone/);
});

test('legacy NIFTY output never fabricates a Core Zone',()=>{
  const html=renderBuild3CoreZones(null,{title:'NIFTY Core Zones · D through D+4',instrument:'NIFTY'});
  assert.ok(html.includes('LEGACY RUN'));
  assert.ok(html.includes('no Core Zone is claimed retrospectively'));
});
