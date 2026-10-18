const COOKIE='__Host-altmoa-refresh';
const cookie=(token='')=>COOKIE+'='+encodeURIComponent(token)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+(token?2592000:0);
const reply=(body,status=200,token)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...(token!==undefined?{'Set-Cookie':cookie(token)}:{})}});
function cookieToken(request){try{return decodeURIComponent((request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'');}catch{return '';}}
export async function authSession(request,{fetcher=fetch}={}){
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'JSON required'},415);
 let input;try{if(Number(request.headers.get('content-length'))>16384)return reply({error:'Request too large'},413);const raw=await request.text();if(raw.length>16384)return reply({error:'Request too large'},413);input=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url||'')||!key)return reply({error:'회원 서버 연결 지연'},503);
 const headers={apikey:key,'Content-Type':'application/json'};
 if(input.action==='logout'){
  const bearer=request.headers.get('authorization');
  if(/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(bearer||''))try{await fetcher(url+'/auth/v1/logout',{method:'POST',headers:{...headers,Authorization:bearer},signal:AbortSignal.timeout(8000)});}catch{}
  return reply({signedOut:true},200,'');
 }
 let payload,grant;
 if(input.action==='login'){
  if(typeof input.email!=='string'||input.email.length>320||typeof input.password!=='string'||input.password.length>128)return reply({error:'Invalid login credentials'},400);
  payload={email:input.email,password:input.password};grant='password';
 }else if(input.action==='refresh'||input.action==='exchange'){
  const token=input.action==='exchange'?input.refresh_token:cookieToken(request);
  if(typeof token!=='string'||!/^[A-Za-z0-9._~-]{1,4096}$/.test(token))return reply({error:'로그인이 필요합니다.'},401,input.action==='refresh'?'':undefined);
  payload={refresh_token:token};grant='refresh_token';
 }else return reply({error:'Invalid action'},400);
 try{
  const r=await fetcher(url+'/auth/v1/token?grant_type='+grant,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
  if(!r.ok){const invalid=[400,401,403].includes(r.status);return reply({error:grant==='password'?'이메일 또는 비밀번호와 이메일 인증 상태를 확인해 주세요.':'로그인을 다시 해 주세요.'},invalid?(grant==='password'?400:401):503,invalid&&input.action==='refresh'?'':undefined);}
  const data=await r.json();if(!data.access_token||!data.refresh_token||!data.user?.id)return reply({error:'회원 서버 응답 오류'},502);
  // Refresh credentials remain in an HttpOnly cookie, never in response JSON.
  return reply({access_token:data.access_token,expires_at:data.expires_at||Math.floor(Date.now()/1000)+Number(data.expires_in||3600),user:{id:data.user.id,email:data.user.email,user_metadata:data.user.user_metadata||{}}},200,data.refresh_token);
 }catch{return reply({error:'회원 서버 연결 지연'},503);}
}
