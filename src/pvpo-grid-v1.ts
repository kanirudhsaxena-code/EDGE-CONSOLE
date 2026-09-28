import { createHash } from 'node:crypto';

export const PVPO_GRID_VERSION = 'PVPO_GRID_V1' as const;
export const PVPO_VERIFICATION_STATES = ['VERIFIED','NOT_VERIFIED','NOT_AVAILABLE'] as const;
type VerificationState = typeof PVPO_VERIFICATION_STATES[number];
type Side = 'CE'|'PE';

export type PvpoLeg = {
  side: Side;
  expiry: string;
  strike: number;
  underlying_price: number;
  underlying_change_pct: number;
  volume: number;
  premium: number;
  premium_change_pct: number;
  open_interest: number;
  oi_change: number;
  verification_state: VerificationState;
  source_ref: string;
  observed_at: string;
};

const finite=(v:number)=>Number.isFinite(v);
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

function validateLeg(row:PvpoLeg){
  if(!['CE','PE'].includes(row.side)) throw new Error('PVPO_SIDE_INVALID');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.expiry)) throw new Error('PVPO_EXPIRY_INVALID');
  for(const v of [row.strike,row.underlying_price,row.underlying_change_pct,row.volume,row.premium,row.premium_change_pct,row.open_interest,row.oi_change]) if(!finite(v)) throw new Error('PVPO_NUMERIC_INVALID');
  if(row.strike<=0||row.underlying_price<=0||row.volume<0||row.premium<0||row.open_interest<0) throw new Error('PVPO_RANGE_INVALID');
  if(!PVPO_VERIFICATION_STATES.includes(row.verification_state)) throw new Error('PVPO_VERIFICATION_INVALID');
  if(!row.source_ref||!row.observed_at||Number.isNaN(Date.parse(row.observed_at))) throw new Error('PVPO_LINEAGE_INCOMPLETE');
}

function interpretation(row:PvpoLeg){
  if(row.verification_state!=='VERIFIED') return 'UNVERIFIED_NO_INTERPRETATION';
  const priceUp=row.underlying_change_pct>0, premiumUp=row.premium_change_pct>0, oiUp=row.oi_change>0;
  if(priceUp&&premiumUp&&oiUp) return 'PRICE_PREMIUM_OI_EXPANSION';
  if(!priceUp&&!premiumUp&&oiUp) return 'PRICE_PREMIUM_DOWN_OI_BUILD';
  if(priceUp&&premiumUp&&!oiUp) return 'PRICE_PREMIUM_UP_OI_UNWIND';
  if(!priceUp&&!premiumUp&&!oiUp) return 'PRICE_PREMIUM_OI_CONTRACTION';
  return 'MIXED_PVPO';
}

/** G7 explanatory/read-model only. It never changes frozen PV/PVPO scoring or trading decisions. */
export function buildPvpoGridV1(input:{run_id:string;engine:string;contract_version:string;legs:PvpoLeg[]}){
  if(!input.run_id||!input.engine||!input.contract_version) throw new Error('PVPO_LINEAGE_INCOMPLETE');
  if(!input.legs.length) throw new Error('PVPO_LEGS_REQUIRED');
  const rows=input.legs.map(row=>{validateLeg(row);return Object.freeze({...row,interpretation:interpretation(row)});});
  const payload_hash=hash({version:PVPO_GRID_VERSION,run_id:input.run_id,engine:input.engine,contract_version:input.contract_version,rows});
  return Object.freeze({version:PVPO_GRID_VERSION,run_id:input.run_id,engine:input.engine,contract_version:input.contract_version,payload_hash,rows,production_scoring_changed:false,canonical_selection_changed:false,trading_changed:false});
}
