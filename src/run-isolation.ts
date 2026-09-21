import type { AccessRole } from './access-identity';

export type StoredActor={id?:string;role?:AccessRole|string;authenticated?:boolean;email?:string};

export function storedActorFromMetadata(metadata:unknown):StoredActor|null{
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return null;
  const actor=(metadata as Record<string,unknown>).actor;
  if(!actor||typeof actor!=='object'||Array.isArray(actor))return null;
  return actor as StoredActor;
}

export function effectiveRunReleasePolicy(
  requestMetadata:unknown,
  requestedPublished:boolean,
  requestedLearningEligible:boolean
){
  const metadata=requestMetadata&&typeof requestMetadata==='object'&&!Array.isArray(requestMetadata)
    ?requestMetadata as Record<string,unknown>
    :{};
  const actor=storedActorFromMetadata(metadata);
  const sandboxRequested=metadata.sandbox_requested===true;
  const identityEnforced=metadata.identity_enforced===true;
  const testerSandbox=identityEnforced&&actor?.role==='TESTER';
  const sandbox=sandboxRequested||testerSandbox;
  return {
    sandbox,
    published:sandbox?false:requestedPublished,
    learning_eligible:sandbox?false:requestedLearningEligible,
    completion_status:sandbox?'SANDBOX':'PUBLISHED'
  } as const;
}

export function actorIdFromEvidenceRows(rows:Array<{metadata?:unknown}>):string|null{
  const ids=new Set<string>();
  for(const row of rows){
    const actor=storedActorFromMetadata(row.metadata);
    if(actor?.id)ids.add(String(actor.id));
  }
  return ids.size===1?[...ids][0]:null;
}
