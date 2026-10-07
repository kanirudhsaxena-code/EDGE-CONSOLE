import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script=path.resolve('scripts/render-nifty-chat-output.mjs');

function fixture(){
  const day=(hit:number,zone:number)=>({status:'SCORABLE',hit_rate_pct:hit,zone_hit_rate_pct:zone,coverage_pct:100,avg_directional_margin_points:10,avg_zone_error_points:5});
  const slots=(direction:string,bull:number,range:number,bear:number,lo:number,hi:number)=>({direction,probabilities:{BULL:bull,RANGE:range,BEAR:bear},zone_low:lo,zone_high:hi,basis:'governed'});
  return {
    request:{request_id:'5drreq_test',status:'COMPLETED',run_id:'5drrun_test',framework_version:'5DR_V2_1',output_contract_version:'5DR_V2_1_2'},
    run:{
      run_id:'5drrun_test',published:true,framework_version:'5DR_V2_1',contract_version:'5DR_V2_1_2',
      result:{
        des5:-40,regime:'TRANSITION',tradeable:false,expected_rr:0,market_trust:45,market_trust_band:'LOW',execution_edge:44,
        probabilities:{BULL:8,RANGE:37,BEAR:55},recommendation:'NO_TRADE',definitive_forecast:'BEARISH',
        event_shock:{level:'MODERATE',transmission:'BEARISH',kill_switch:false,convexity_warranted:false},
        expected_nifty_zone:{low:22500,high:22900},
        horizon_slots:{
          'D+1':slots('BEARISH',15,25,60,22450,22650),
          'D+2':slots('BEARISH',10,30,60,22350,22600),
          'D+3':slots('RANGE',20,50,30,22300,22700),
          'D+4':slots('RANGE',25,55,20,22350,22750),
          'D+5':slots('BULLISH',40,40,20,22500,22900),
        },
        engine_diagnostics:{component_scores:{PRICE_STRUCTURE:-40,PVPO:-25,PARTICIPATION:-77.5,MACRO_CATALYSTS:-30}},
        tradeability_blockers:['MARKET_TRUST_LT_50','EXECUTION_EDGE_LT_65','RR_LT_2'],
        forecast_assessment:'UNCHANGED — BEAR.',
        recommendation_assessment:'REJECTED — NO_TRADE.',
        assessment_snapshot_complete:true,
        recommendation_ledger_complete:true,
        assessment_snapshot:{
          headline:'22/36 scorable checkpoints directionally correct.',
          metrics:{
            assessment_snapshot_complete:true,recommendation_ledger_complete:true,
            day_metrics:{D:day(75,75),'D+1':day(85.71,71.43),'D+2':day(71.43,42.86),'D+3':day(57.14,28.57),'D+4':day(14.29,28.57)},
            recommendation_ledger:[{lifecycle:{latest_event:'T2_HIT'}},{lifecycle:{latest_event:'NO_TRADE'}}],
            recommendation_metrics:{hit_rate_pct:50,hit_rate_fraction:'1/2',average_resolved_r:1.3},
            return_metrics:{cumulative_resolved_pnl_pct:45.4},
          }
        }
      }
    }
  };
}

function run(payload:any){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nifty-chat-output-'));
  const input=path.join(dir,'final.json'),out=path.join(dir,'output.md'),manifest=path.join(dir,'manifest.json');
  fs.writeFileSync(input,JSON.stringify(payload));
  const proc=spawnSync(process.execPath,[script,input,out,manifest],{encoding:'utf8'});
  return {proc,out,manifest};
}

test('renders exactly the locked two-table NIFTY user output from the exact run',()=>{
  const {proc,out,manifest}=run(fixture());
  assert.equal(proc.status,0,proc.stderr);
  const md=fs.readFileSync(out,'utf8');
  assert.equal((md.match(/^## TABLE /gm)||[]).length,2);
  assert.match(md,/## TABLE 1 — 5DR ASSESSMENT & EFFICACY/);
  assert.match(md,/## TABLE 2 — CURRENT 5DR RUN/);
  assert.match(md,/\| D \|/);
  assert.match(md,/\| D\+4 \|/);
  assert.match(md,/D\+4 22500–22900/);
  assert.match(md,/NO TRADE · expected R:R 0\.00/);
  for(const forbidden of ['WHAT WE SAW','WHAT IT MEANS','WHY IT MATTERS NOW','Advanced details','Future performance scorecard']){
    assert.equal(md.includes(forbidden),false);
  }
  const m=JSON.parse(fs.readFileSync(manifest,'utf8'));
  assert.equal(m.request_id,'5drreq_test');
  assert.equal(m.run_id,'5drrun_test');
  assert.deepEqual(m.display_horizons,['D','D+1','D+2','D+3','D+4']);
  assert.equal(m.sections.length,2);
  assert.match(m.output_sha256,/^[0-9a-f]{64}$/);
});

test('fails closed when any governed five-session slot is missing',()=>{
  const payload:any=fixture();
  delete payload.run.result.horizon_slots['D+5'];
  const {proc}=run(payload);
  assert.notEqual(proc.status,0);
  assert.match(proc.stderr,/NIFTY_CHAT_OUTPUT_BLOCKED: D\+5 forecast slot missing/);
});

test('fails closed when the request does not identify the exact published run',()=>{
  const payload:any=fixture();
  payload.request.run_id='5drrun_other';
  const {proc}=run(payload);
  assert.notEqual(proc.status,0);
  assert.match(proc.stderr,/request\/run identity mismatch/);
});
