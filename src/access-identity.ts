export type AccessRole='OWNER'|'TESTER'|'ANONYMOUS';
export type AccessActor={
  id:string;
  role:AccessRole;
  authenticated:boolean;
  email?:string;
};

export type AccessIdentityEnv={
  ACCESS_IDENTITY_MODE?:string;
  OWNER_EMAILS?:string;
};

const normalizedMode=(env:AccessIdentityEnv)=>String(env.ACCESS_IDENTITY_MODE??'AUDIT').trim().toUpperCase();
export const isAccessIdentityEnforced=(env:AccessIdentityEnv)=>normalizedMode(env)==='ENFORCE';

const ownerSet=(env:AccessIdentityEnv)=>new Set(
  String(env.OWNER_EMAILS??'')
    .split(',')
    .map(x=>x.trim().toLowerCase())
    .filter(Boolean)
);

const digest=async(value:string)=>{
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');
};

export async function resolveAccessActor(request:Request,env:AccessIdentityEnv):Promise<AccessActor>{
  const email=String(request.headers.get('Cf-Access-Authenticated-User-Email')??'').trim().toLowerCase();
  if(!email)return {id:'anonymous',role:'ANONYMOUS',authenticated:false};
  const hash=await digest(email);
  return {
    id:`usr_${hash.slice(0,32)}`,
    role:ownerSet(env).has(email)?'OWNER':'TESTER',
    authenticated:true,
    email
  };
}

export const actorMetadata=(actor:AccessActor)=>({
  id:actor.id,
  role:actor.role,
  authenticated:actor.authenticated
});

export function actorCanAccessStored(
  actor:AccessActor,
  storedActor:unknown,
  env:AccessIdentityEnv
):boolean{
  if(!isAccessIdentityEnforced(env))return true;
  if(!actor.authenticated)return false;
  if(actor.role==='OWNER')return true;
  if(!storedActor||typeof storedActor!=='object'||Array.isArray(storedActor))return false;
  return String((storedActor as Record<string,unknown>).id??'')===actor.id;
}

export const shouldScopeHistoryToActor=(actor:AccessActor,env:AccessIdentityEnv)=>
  isAccessIdentityEnforced(env)&&actor.role!=='OWNER';
