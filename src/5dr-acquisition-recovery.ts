import { neon } from '@neondatabase/serverless';
import { assessAutomatedMarketEvidence } from './automated-market-evidence';
import { sync5drAcquisitionResult } from './engine-result-sync';
import type { EngineDispatchEnv } from './engine-dispatch';

type RecoveryEnv = EngineDispatchEnv & { DATABASE_URL?: string };
type JsonRecord = Record<string, unknown>;

const isObject = (value: unknown): value is JsonRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export type BlockedAcquisitionRecovery = {
  recovered: boolean;
  status: string;
  detail?: string;
  workflow_run_id?: number;
};

/**
 * Repair a 5DR request that was marked AUTOMATED_MARKET_DATA_BLOCKED by an
 * earlier acquisition attempt when a later governed GitHub retry has already
 * produced valid READY evidence.
 *
 * This deliberately reuses the existing immutable evidence marker emitted by
 * the pinned acquisition workflow and the same automated-evidence validator.
 * It does not synthesize, reinterpret, or modify market evidence.
 */
export async function recoverBlocked5drAcquisition(
  env: RecoveryEnv,
  requestId: string,
): Promise<BlockedAcquisitionRecovery> {
  if (!env.DATABASE_URL || !requestId.trim()) {
    return { recovered: false, status: 'NOT_CONFIGURED' };
  }

  const sync = await sync5drAcquisitionResult(env, requestId);
  if (sync.status !== 'SUCCEEDED' || !sync.evidence) {
    return {
      recovered: false,
      status: sync.status,
      detail: sync.detail,
      workflow_run_id: sync.workflow_run_id,
    };
  }

  const gate = assessAutomatedMarketEvidence(sync.evidence, requestId);
  if (gate.errors.length) {
    return {
      recovered: false,
      status: 'VALIDATION_BLOCKED',
      detail: gate.errors.join('; '),
      workflow_run_id: sync.workflow_run_id,
    };
  }
  if (!gate.ready) {
    return {
      recovered: false,
      status: gate.blocked ? 'STILL_BLOCKED' : 'NOT_READY',
      workflow_run_id: sync.workflow_run_id,
    };
  }

  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select status,metadata
      from analysis_requests
     where request_id=${requestId} and engine='5DR'
     limit 1
  `;
  if (!rows.length) return { recovered: false, status: 'REQUEST_NOT_FOUND' };

  const status = String(rows[0].status ?? '');
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return { recovered: false, status: 'REQUEST_FINALIZED' };
  }

  const metadata = isObject(rows[0].metadata) ? rows[0].metadata : {};
  if (String(metadata.adapter_stage ?? '') !== 'AUTOMATED_MARKET_DATA_BLOCKED') {
    return { recovered: false, status: 'STAGE_ALREADY_ADVANCED' };
  }

  const recoveredAt = new Date().toISOString();
  const envelope = {
    ...sync.evidence,
    received_at: recoveredAt,
  };
  const next = {
    ...metadata,
    automated_market_evidence: envelope,
    freshness_at: isObject(sync.evidence) ? sync.evidence.captured_at ?? null : null,
    adapter_stage: 'AUTOMATED_MARKET_DATA_READY',
    acquisition_sync: {
      ok: true,
      status: 'SUCCEEDED',
      repository: sync.repository,
      workflow: sync.workflow,
      workflow_run_id: sync.workflow_run_id ?? null,
      recovered_at: recoveredAt,
      recovery_mode: 'CONSOLE_GITHUB_LOG_SYNC',
    },
  };

  await sql`
    update analysis_requests
       set status='READY_FOR_ENGINE',
           metadata=${JSON.stringify(next)}::jsonb,
           error=null,
           updated_at=now()
     where request_id=${requestId} and engine='5DR'
  `;

  return {
    recovered: true,
    status: 'AUTOMATED_MARKET_DATA_READY',
    workflow_run_id: sync.workflow_run_id,
  };
}
