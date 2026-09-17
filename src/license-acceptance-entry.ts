const MODEL='@cf/meta/llama-3.2-11b-vision-instruct';
type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type Env={AI:AiBinding;APP_ENV?:string};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

export default {
  async fetch(_request:Request,env:Env):Promise<Response>{
    if(env.APP_ENV!=='development')return json({ok:false,error:'License acceptance endpoint is disabled outside development'},403);
    if(!env.AI||typeof env.AI.run!=='function')return json({ok:false,error:'Workers AI binding is not configured'},503);
    try{
      await env.AI.run(MODEL,{prompt:'agree'});
      return json({ok:true,status:'LICENSE_ACCEPTANCE_SUBMITTED',model:MODEL});
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      return json({ok:false,status:'LICENSE_ACCEPTANCE_FAILED',model:MODEL,error:message.slice(0,500)},503);
    }
  }
};
