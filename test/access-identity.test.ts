import test from 'node:test';
import assert from 'node:assert/strict';
import {actorCanAccessStored,actorCanUseCanonicalEdge,actorMetadata,isAccessIdentityEnforced,resolveAccessActor,shouldScopeHistoryToActor} from '../src/access-identity';

test('anonymous remains allowed only while identity mode is audit',async()=>{
  const req=new Request('https://console.test/');
  const actor=await resolveAccessActor(req,{ACCESS_IDENTITY_MODE:'AUDIT'});
  assert.equal(actor.authenticated,false);
  assert.equal(actor.role,'ANONYMOUS');
  assert.equal(actorCanAccessStored(actor,null,{ACCESS_IDENTITY_MODE:'AUDIT'}),true);
  assert.equal(actorCanAccessStored(actor,null,{ACCESS_IDENTITY_MODE:'ENFORCE'}),false);
});

test('Cloudflare Access email becomes stable pseudonymous tester id',async()=>{
  const req=new Request('https://console.test/',{headers:{'Cf-Access-Authenticated-User-Email':'Tester@Example.com'}});
  const a=await resolveAccessActor(req,{ACCESS_IDENTITY_MODE:'ENFORCE'});
  const b=await resolveAccessActor(req,{ACCESS_IDENTITY_MODE:'ENFORCE'});
  assert.equal(a.authenticated,true);
  assert.equal(a.role,'TESTER');
  assert.equal(a.id,b.id);
  assert.match(a.id,/^usr_[0-9a-f]{32}$/);
  assert.deepEqual(actorMetadata(a),{id:a.id,role:'TESTER',authenticated:true});
});

test('owner allowlist is case-insensitive and owner is not history-scoped',async()=>{
  const req=new Request('https://console.test/',{headers:{'Cf-Access-Authenticated-User-Email':'Owner@Example.com'}});
  const env={ACCESS_IDENTITY_MODE:'ENFORCE',OWNER_EMAILS:'owner@example.com'};
  const actor=await resolveAccessActor(req,env);
  assert.equal(actor.role,'OWNER');
  assert.equal(shouldScopeHistoryToActor(actor,env),false);
  assert.equal(actorCanAccessStored(actor,{id:'someone-else'},env),true);
});

test('tester can access only matching stored actor when enforcement is on',async()=>{
  const req=new Request('https://console.test/',{headers:{'Cf-Access-Authenticated-User-Email':'tester@example.com'}});
  const env={ACCESS_IDENTITY_MODE:'ENFORCE'};
  const actor=await resolveAccessActor(req,env);
  assert.equal(isAccessIdentityEnforced(env),true);
  assert.equal(shouldScopeHistoryToActor(actor,env),true);
  assert.equal(actorCanAccessStored(actor,{id:actor.id},env),true);
  assert.equal(actorCanAccessStored(actor,{id:'usr_other'},env),false);
  assert.equal(actorCanAccessStored(actor,null,env),false);
});


test('canonical EDGE access is owner-only once identity enforcement is enabled',async()=>{
  const ownerReq=new Request('https://console.test/',{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.com'}});
  const testerReq=new Request('https://console.test/',{headers:{'Cf-Access-Authenticated-User-Email':'tester@example.com'}});
  const env={ACCESS_IDENTITY_MODE:'ENFORCE',OWNER_EMAILS:'owner@example.com'};
  const owner=await resolveAccessActor(ownerReq,env);
  const tester=await resolveAccessActor(testerReq,env);
  assert.equal(actorCanUseCanonicalEdge(owner,env),true);
  assert.equal(actorCanUseCanonicalEdge(tester,env),false);
  assert.equal(actorCanUseCanonicalEdge(tester,{ACCESS_IDENTITY_MODE:'AUDIT'}),true);
});
