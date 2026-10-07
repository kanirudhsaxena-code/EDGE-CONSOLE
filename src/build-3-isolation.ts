export type Build3IsolationEnv={MDOS_BUILD3_ENABLED?:string};

const enabledValues=new Set(['1','true','yes','on','enabled']);

export function isBuild3RuntimeEnabled(env:Build3IsolationEnv|undefined|null):boolean{
  return enabledValues.has(String(env?.MDOS_BUILD3_ENABLED??'').trim().toLowerCase());
}

export const BUILD3_ISOLATION_CONTRACT={
  version:'MDOS_BUILD_3_ISOLATION_V1',
  default_enabled:false,
  build2_dependency_allowed:false,
  build25_dependency_allowed:false,
  production_merge_allowed:false,
} as const;
