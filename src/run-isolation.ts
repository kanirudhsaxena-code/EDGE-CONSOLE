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
  const actor=storedActorFromMetadata(requestMetadata);
  const tester=actor?.role==='TESTER';
  return {
    sandbox:tester,
    published:tester?false:requestedPublished,
    learning_eligible:tester?false:requestedLearningEligible,
    completion_status:tester?'SANDBOX':'PUBLISHED'
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
