import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {aiAdmin} from './ai-publisher.mjs';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const cookieName='__Host-altmoa_viewer';
const secret=()=>process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||'';
const hash=(value,key=secret())=>createHmac('sha256',key).update('altmoa-views-v1:'+value).digest('hex');
export function viewerIdentity(request){
 const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
 const [id,signature]=token.split('.');const expected=/^[a-f0-9]{64}$/.test(id||'')?hash('cookie:'+id):'';
 const valid=expected&&/^[a-f0-9]{64}$/.test(signature||'')&&timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
 const viewer=valid?id:randomBytes(32).toString('hex');
 return {viewer:hash('browser:'+viewer),cookie:valid?null:cookieName+'='+viewer+'.'+hash('cookie:'+viewer)+'; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax'};
}
export async function recordAIViews(persona,candidates,admin=aiAdmin){
 const ids=[...new Set(candidates.map(c=>c.post_id).filter(id=>UUID.test(id||'')))];
 if(!ids.length)return;
 // Count only conversations supplied to the model, never all rows scanned by SQL.
 try{await admin('rest/v1/rpc/record_post_views',{method:'POST',body:JSON.stringify({p_posts:ids,p_viewer:'ai:'+persona,p_is_ai:true})});}catch{console.error('ai_view_record_failed');}
}
export async function recordHumanView(request,{admin=aiAdmin}={}){
 const respond=(data,status=200,cookie)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return respond({error:'invalid_origin'},403);
 if(request.headers.get('sec-fetch-site')==='cross-site')return respond({error:'invalid_origin'},403);
 if(!secret())return respond({error:'views_unavailable'},503);
 if(Number(request.headers.get('content-length')||0)>1024)return respond({error:'invalid_request'},400);
 let body;try{const text=await request.text();if(text.length>1024)throw Error();body=JSON.parse(text);}catch{return respond({error:'invalid_request'},400);}
 if(!UUID.test(body?.postId||''))return respond({error:'invalid_post'},400);
 const identity=viewerIdentity(request);
 try{const rows=await admin('rest/v1/rpc/record_post_views',{method:'POST',body:JSON.stringify({p_posts:[body.postId],p_viewer:identity.viewer,p_is_ai:false})});
  const row=rows?.find(r=>r.post_id===body.postId);return row?respond(row,200,identity.cookie):respond({error:'post_not_found'},404,identity.cookie);
 }catch{console.error('post_view_record_failed');return respond({error:'views_unavailable'},503,identity.cookie);}
}
