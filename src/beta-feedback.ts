import { actorMetadata, isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';

export type BetaFeedbackEnv=AccessIdentityEnv&{EVIDENCE_BUCKET:R2Bucket};

const ENGINES=new Set(['5DR','EDGE_STOCKS','EDGE_IPO']);
const CATEGORIES=new Set(['BUG','USABILITY','OUTPUT_QUALITY','DATA_ISSUE','OTHER']);

export type BetaFeedbackInput={
  engine:string;
  category:string;
  rating:number|null;
  message:string;
  run_ref:string|null;
};

export function validateBetaFeedbackInput(body:unknown):{value?:BetaFeedbackInput;errors:string[]}{
  const errors:string[]=[];
  if(!body||typeof body!=='object'||Array.isArray(body))return {errors:['feedback body must be an object']};
  const obj=body as Record<string,unknown>;
  const engine=String(obj.engine??'').trim().toUpperCase();
  const category=String(obj.category??'').trim().toUpperCase();
  const message=String(obj.message??'').trim();
  const runRef=String(obj.run_ref??'').trim();
  const ratingRaw=obj.rating;
  const rating=ratingRaw===null||ratingRaw===undefined||ratingRaw===''?null:Number(ratingRaw);
  if(!ENGINES.has(engine))errors.push('engine is invalid');
  if(!CATEGORIES.has(category))errors.push('category is invalid');
  if(message.length<2||message.length>2000)errors.push('message must be between 2 and 2000 characters');
  if(runRef.length>200)errors.push('run_ref must be 200 characters or fewer');
  if(rating!==null&&(!Number.isInteger(rating)||rating<1||rating>5))errors.push('rating must be an integer from 1 to 5');
  return errors.length?{errors}:{value:{engine,category,rating,message,run_ref:runRef||null},errors:[]};
}

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data,null,2),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}
});

export async function submitBetaFeedback(request:Request,env:BetaFeedbackEnv):Promise<Response>{
  const actor=await resolveAccessActor(request,env);
  if(isAccessIdentityEnforced(env)&&!actor.authenticated)return json({error:'Authenticated Console identity is required'},401);
  let body:unknown;try{body=await request.json()}catch{return json({error:'Invalid JSON body'},400)}
  const assessed=validateBetaFeedbackInput(body);
  if(!assessed.value)return json({error:'Feedback validation failed',details:assessed.errors},422);
  const id=crypto.randomUUID(),now=new Date(),stamp=now.toISOString();
  const key=`beta-feedback/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${String(now.getUTCDate()).padStart(2,'0')}/${id}.json`;
  const record={
    feedback_id:id,
    created_at:stamp,
    actor:actorMetadata(actor),
    ...assessed.value,
    governance:{
      evidence_eligible:false,
      efficacy_eligible:false,
      learning_eligible:false,
      recommendation_eligible:false
    }
  };
  await env.EVIDENCE_BUCKET.put(key,JSON.stringify(record),{
    httpMetadata:{contentType:'application/json'},
    customMetadata:{feedback_id:id,engine:assessed.value.engine,category:assessed.value.category,actor_id:actor.id}
  });
  return json({ok:true,feedback_id:id,stored:true,governance:record.governance},201);
}

export async function listBetaFeedback(request:Request,env:BetaFeedbackEnv):Promise<Response>{
  const actor=await resolveAccessActor(request,env);
  if(!actor.authenticated||actor.role!=='OWNER')return json({error:'OWNER access is required'},403);
  const listed=await env.EVIDENCE_BUCKET.list({prefix:'beta-feedback/',limit:100});
  const objects=[...listed.objects].sort((a,b)=>String(b.uploaded??'').localeCompare(String(a.uploaded??''))).slice(0,50);
  const feedback=[];
  for(const item of objects){
    const object=await env.EVIDENCE_BUCKET.get(item.key);
    if(!object)continue;
    try{
      const parsed=JSON.parse(await object.text());
      if(parsed&&typeof parsed==='object')feedback.push(parsed);
    }catch{}
  }
  return json({feedback,truncated:listed.truncated,total_returned:feedback.length});
}
