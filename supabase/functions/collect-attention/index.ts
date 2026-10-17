// Run on Supabase Edge Functions. This accepts only approved, host-allowlisted
// licensed JSON feeds. It does not scrape DCInside, Coinpan, X, or Reddit.
import { matchCoins, normalizeText } from '../../../lib/attention.mjs';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const dbUrl=Deno.env.get('SUPABASE_URL')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
async function db(path:string,options:RequestInit={}){
 const r=await fetch(dbUrl+'/rest/v1/'+path,{...options,headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error('database_request_failed');return r.status===204?null:r.json();
}
async function constantTimeEqual(a:string,b:string){
 const enc=new TextEncoder();const [aa,bb]=await Promise.all([a,b].map(x=>crypto.subtle.digest('SHA-256',enc.encode(x))));
 const x=new Uint8Array(aa),y=new Uint8Array(bb);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
Deno.serve(async request=>{
 const secret=Deno.env.get('ATTENTION_COLLECTOR_SECRET');
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(!secret||!await constantTimeEqual(request.headers.get('x-collector-secret')||'',secret))return json({error:'Unauthorized'},401);
 const hosts=(Deno.env.get('ATTENTION_FEED_HOSTS')||'').split(',').map(x=>x.trim()).filter(Boolean);
 try{
  const sources=await db('attention_sources?select=*&approved=eq.true&feed_url=not.is.null&status=neq.paused&limit=5');
  const outcomes=[];
  for(const source of sources){
   const url=new URL(source.feed_url);
   if(url.protocol!=='https:'||url.username||url.password||!hosts.includes(url.hostname)||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)){
    outcomes.push({source:source.id,status:'host_not_allowed'});continue;
   }
   if(source.last_attempt_at&&Date.now()-Date.parse(source.last_attempt_at)<9*60000){outcomes.push({source:source.id,status:'cooldown'});continue;}
   try{
    url.searchParams.set('limit','200');if(source.cursor_value)url.searchParams.set('cursor',source.cursor_value);
    const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'AltmoaAttention/0.1 (+https://altmoa.vercel.app)'},redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error('feed_request_failed');
    const raw=await r.text();if(raw.length>1000000)throw new Error('feed_too_large');
    const feed=JSON.parse(raw);
    if(!Array.isArray(feed.items)||feed.items.length>200||typeof feed.complete!=='boolean'||(feed.nextCursor!=null&&(typeof feed.nextCursor!=='string'||feed.nextCursor.length>1000)))throw new Error('invalid_feed');
    const docs=[];
    for(const item of feed.items){
     if(typeof item.id!=='string'||!item.id||item.id.length>256)throw new Error('invalid_id');
     if(item.deleted===true){docs.push({id:item.id,deleted:true});continue;}
     if(typeof item.title!=='string'||!item.title.trim()||item.title.length>500)throw new Error('invalid_title');
     const text=item.title; // Title-only matching; never send source material to AI.
     const ts=Date.parse(item.publishedAt);if(!Number.isFinite(ts)||ts>Date.now()+300000||ts<Date.now()-8*86400000)throw new Error('invalid_date');
     const link=new URL(item.url);if(link.protocol!=='https:'||link.username||link.password||!link.href.startsWith(source.link_prefix))throw new Error('invalid_link');
     const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeText(text))));
     const fingerprint=[...hash].map(n=>n.toString(16).padStart(2,'0')).join('');
     docs.push({id:item.id,url:link.href,publishedAt:new Date(ts).toISOString(),fingerprint,symbols:matchCoins(text)});
    }
    await db('rpc/ingest_attention_batch',{method:'POST',body:JSON.stringify({p_source:source.id,p_documents:docs,p_complete:feed.complete,p_cursor:feed.nextCursor||null})});
    outcomes.push({source:source.id,status:feed.complete?'collected':'partial',count:docs.length});
   }catch{
    await db('attention_sources?id=eq.'+encodeURIComponent(source.id),{method:'PATCH',body:JSON.stringify({status:'error',last_attempt_at:new Date().toISOString()})});
    await db('attention_runs',{method:'POST',body:JSON.stringify({source_id:source.id,success:false,complete:false})});
    outcomes.push({source:source.id,status:'error'});
   }
  }
  return json({outcomes});
 }catch{console.error('attention_collection_failed');return json({error:'Collection failed'},502);}
});
