import test from'node:test';import assert from'node:assert/strict';import{authSession}from'../lib/auth-session.mjs';
const origin='https://www.altmoa.com';
const request=(body,headers={})=>new Request(origin+'/api/auth-session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const setup=()=>{process.env.SUPABASE_URL='https://project.supabase.co';process.env.SUPABASE_ANON_KEY='test-public-key';};
const session={access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:'member',email:'member@example.test'}};
test('login stores refresh credentials in a secure HttpOnly cookie without returning them to JavaScript',async()=>{
 setup();let sent;const r=await authSession(request({action:'login',email:'member@example.test',password:'test-password'}),{fetcher:async(url,o)=>{sent={url,body:JSON.parse(o.body)};return Response.json(session);}});
 assert.equal(r.status,200);assert.match(sent.url,/grant_type=password$/);assert.equal(sent.body.email,'member@example.test');assert.equal(r.headers.get('cache-control'),'private, no-store');const cookie=r.headers.get('set-cookie');for(const attribute of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=2592000'])assert.ok(cookie.includes(attribute));const data=await r.json();assert.equal(data.refresh_token,undefined);assert.equal(data.access_token,'test-access');assert.equal(JSON.stringify(data).includes('test-refresh'),false);
});
test('reopening a tab restores from the cookie and rotates it; revoked cookies expire while temporary errors preserve them',async()=>{
 setup();let payload;const req=()=>request({action:'refresh'},{Cookie:'__Host-altmoa-refresh=old-refresh'});
 const r=await authSession(req(),{fetcher:async(_,o)=>{payload=JSON.parse(o.body);return Response.json(session);}});assert.equal(payload.refresh_token,'old-refresh');assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/test-refresh/);
 const revoked=await authSession(req(),{fetcher:async()=>Response.json({},{status:400})});assert.equal(revoked.status,401);assert.match(revoked.headers.get('set-cookie'),/Max-Age=0/);
 const unavailable=await authSession(req(),{fetcher:async()=>{throw Error('network')}});assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('set-cookie'),null);
});
test('cross-site requests and malformed input do not reach the provider; logout clears cookies',async()=>{
 setup();let calls=0;const fetcher=async()=>{calls++;return Response.json({})};
 assert.equal((await authSession(request({action:'refresh'},{Origin:'https://evil.example'}),{fetcher})).status,403);
 assert.equal((await authSession(request({action:'exchange',refresh_token:'not a token'}),{fetcher})).status,401);assert.equal(calls,0);
 const logout=await authSession(request({action:'logout'}),{fetcher});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});
