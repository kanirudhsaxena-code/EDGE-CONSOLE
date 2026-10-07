import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrozenNiftyProviderInstrumentKey } from '../src/build-3-nifty-materializer';

const evidence={
  issuance_context:{
    automated_market_evidence:{
      observations:[{
        category:'EXECUTION_RISK',
        structured_data:{
          selected_expiry:'2026-10-08',
          sample_strikes:[
            {strike:24950,CE:{instrument_key:'NSE_FO|CE24950'},PE:{instrument_key:'NSE_FO|PE24950'}},
            {strike:25000,CE:{instrument_key:'NSE_FO|CE25000'},PE:{instrument_key:'NSE_FO|PE25000'}},
            {strike:25050,CE:{instrument_key:'NSE_FO|CE25050'},PE:{instrument_key:'NSE_FO|PE25050'}},
          ],
        },
      }],
    },
  },
};

test('resolves exact NIFTY option identity only from frozen issuance evidence',()=>{
  const key=resolveFrozenNiftyProviderInstrumentKey(evidence,{
    recommendation:'BUY_CE',
    execution_snapshot:{strike:25000,expiry:'2026-10-08'},
  });
  assert.equal(key,'NSE_FO|CE25000');
});

test('resolves PE side independently from the same frozen strike row',()=>{
  const key=resolveFrozenNiftyProviderInstrumentKey(evidence,{
    recommendation:'BUY_PE',
    execution_plan:{strike_price:25000,time_exit:'2026-10-08'},
  });
  assert.equal(key,'NSE_FO|PE25000');
});

test('never guesses a provider identity when strike or expiry evidence does not match',()=>{
  assert.equal(resolveFrozenNiftyProviderInstrumentKey(evidence,{
    recommendation:'BUY_CE',
    execution_snapshot:{strike:25100,expiry:'2026-10-08'},
  }),null);
  assert.equal(resolveFrozenNiftyProviderInstrumentKey(evidence,{
    recommendation:'BUY_CE',
    execution_snapshot:{strike:25000,expiry:'2026-10-15'},
  }),null);
});

test('explicit frozen producer identity takes precedence over derived matching',()=>{
  const key=resolveFrozenNiftyProviderInstrumentKey(evidence,{
    recommendation:'BUY_CE',
    execution_snapshot:{strike:25000,expiry:'2026-10-08',instrument_key:'NSE_FO|EXPLICIT'},
  });
  assert.equal(key,'NSE_FO|EXPLICIT');
});
