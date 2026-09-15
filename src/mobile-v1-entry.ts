import router from './router';
import { uploadCategorizedEvidence } from './categorized-evidence-upload';

type Env={ASSETS:Fetcher;EVIDENCE_BUCKET:R2Bucket;DATABASE_URL?:string;APP_ENV:string;OUTPUT_CONTRACT_VERSION:string;AI:unknown};

export default {async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname==='/api/evidence/upload'&&request.method==='POST')return uploadCategorizedEvidence(request,env);
  return router.fetch(request,env as any);
}};
