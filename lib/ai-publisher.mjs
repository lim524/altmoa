import {postTopicForSlot} from './ai-topics.mjs';
import {aiScheduleDue,aiWriterIndex} from './ai-schedule.mjs';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {AI_WRITERS,PROVIDERS,generateWriterPost,similarPost} from './ai-writers.mjs';
import {fetchExchange,ASSETS} from './exchanges.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function authorized(request){const expected=process.env.AI_WORKER_SECRET||'',provided=request.headers.get('x-ai-worker-secret')||'';const a=Buffer.from(expected),b=Buffer.from(provided);return a.length>=32&&a.length===b.length&&timingSafeEqual(a,b);}
export async function aiAdmin(path,options={}){const origin=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin||'')||!key)throw Error('admin_not_configured');const r=await fetch(origin+'/'+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('database_http_'+r.status);return r.status===204?null:r.json();}
export async function provisionWriters(){
 const existing=await aiAdmin('rest/v1/ai_writers?select=persona,user_id');
 for(const writer of AI_WRITERS){if(existing.some(row=>row.persona===writer.id))continue;
  // Deterministic private auth identifier; no email is sent. Banned auth account,
  // random password; only the server worker can publish with this profile.
  const email='ai-'+writer.id+'@users.altmoa.invalid';let user;
  const result=await aiAdmin('auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password:randomUUID()+randomUUID(),email_confirm:true,ban_duration:'876000h',app_metadata:{altmoa_ai_persona:writer.id},user_metadata:{nickname:writer.name}})}).catch(error=>{if(!/database_http_422/.test(error.message))throw error;return null;});
  if(result)user=result.user||result;
  else{for(let page=1;page<=100;page++){const batch=await aiAdmin('auth/v1/admin/users?page='+page+'&per_page=100');user=batch.users?.find(u=>u.email===email&&u.app_metadata?.altmoa_ai_persona===writer.id);if(user||!batch.users?.length||batch.users.length<100)break;}if(!user)throw Error('ai_account_conflict');}
  await aiAdmin('rest/v1/profiles?id=eq.'+user.id,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({nickname:writer.name,is_ai:true})}).then(rows=>{if(!rows.length)throw Error('profile_missing');});
  await aiAdmin('rest/v1/ai_writers',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({persona:writer.id,user_id:user.id})});
 }
 if(!process.env.AI_WORKER_SECRET||process.env.AI_WORKER_SECRET.length<32)throw Error('worker_secret_not_configured');
 const scheduled=await aiAdmin('rest/v1/rpc/configure_ai_schedule',{method:'POST',body:JSON.stringify({p_secret:process.env.AI_WORKER_SECRET})});
 return {initialized:true,count:AI_WRITERS.length,scheduled};
}
export async function runAIPublisher(request,{now=()=>Date.now(),generate=generateWriterPost,market=fetchExchange,admin=aiAdmin,due=aiScheduleDue,pickTopic=postTopicForSlot}={}){
 if(!authorized(request))return json({error:'Unauthorized'},401);
 const init=new URL(request.url).searchParams.get('action')==='initialize';
 if(init){try{return json(await provisionWriters());}catch(error){return json({error:error.message},503);}}
 if(process.env.AI_AUTO_PUBLISH!=='true')return json({enabled:false,published:false});
 // All three providers must be explicitly configured. Do not silently switch
 // identities/models or spend one provider's quota on another's slots.
 if(Object.values(PROVIDERS).some(p=>!process.env[p.key]||!process.env[p.model]))return json({error:'provider_configuration_incomplete'},503);
 const scheduledAt=now();if(!due('post',scheduledAt))return json({published:false,reason:'not_due'});
 const slot=Math.floor(scheduledAt/60000),writer=AI_WRITERS[aiWriterIndex('post',scheduledAt,AI_WRITERS.length)];let claimed;
 try{
  claimed=await admin('rest/v1/rpc/claim_ai_publish_irregular',{method:'POST',body:JSON.stringify({p_persona:writer.id})});if(claimed===null)return json({published:false,reason:'already_claimed_or_limit'});
  const recent=await admin('rest/v1/posts?'+new URLSearchParams({select:'title,body',status:'eq.published',order:'created_at.desc',limit:'100'}));
  const topic=pickTopic(slot,writer);let context,tag;
  if(topic){context={kind:'casual',subject:topic.subject,recentTitles:recent.slice(0,12).map(p=>p.title.slice(0,60))};tag='일상';}
  else{
   const snapshot=await market('binance'),at=Date.parse(snapshot.fetchedAt);if(!Number.isFinite(at)||Math.abs(now()-at)>120000)throw Error('stale_market');
   const candidates=snapshot.coins.filter(c=>ASSETS.some(a=>a.symbol===c.symbol)&&Number.isFinite(c.price)&&c.price>0&&Number.isFinite(c.change)&&Number.isFinite(c.volume24h));if(!candidates.length)throw Error('no_verified_market');
   const coin=candidates[Math.floor(slot/6)%candidates.length],angle=['유동성과 거래대금 해석','변동성 해석의 한계','같은 시장에서 확인할 점','시세와 프로젝트 가치의 차이','가격 변동에 대한 다른 해석','관찰할 만한 질문'][Math.floor(slot/candidates.length)%6];
   context={coin:{symbol:coin.symbol,name:coin.name,price:coin.price,change:coin.change,volume24h:coin.volume24h},exchange:'Binance',quote:'USDT',fetchedAt:snapshot.fetchedAt,angle,recentTitles:recent.slice(0,12).map(p=>p.title.slice(0,60))};tag=coin.symbol;
  }
  const post=await generate(writer,context);if(!post)throw Error('model_skipped');if(recent.some(p=>similarPost(post.title,p.title)||similarPost(post.body,p.body.split('\n\n[시세 기준]')[0].split('\n\n알트모아 운영 AI 작성자')[0])))throw Error('similar_content');
  const body=post.body;
  const id=await admin('rest/v1/rpc/finish_ai_publish',{method:'POST',body:JSON.stringify({p_slot:claimed,p_title:post.title,p_body:body,p_tag:tag})});
  // Publishing already committed. Usage telemetry failure must not mark it failed.
  try{await admin('rest/v1/ai_publish_jobs?slot=eq.'+claimed,{method:'PATCH',body:JSON.stringify({usage:post.usage})});}catch{}
  return json({published:Boolean(id),postId:id,writer:writer.id});
 }catch(error){const code=/^(stale_market|no_verified_market|similar_content|model_skipped|provider_[a-z_0-9]+|unverified_[a-z_]+|input_budget_exceeded|invalid_generation|incomplete_generation)$/.test(error.message)?error.message:'generation_or_database_failed';if(claimed!==undefined&&claimed!==null)try{await admin('rest/v1/ai_publish_jobs?'+new URLSearchParams({slot:'eq.'+claimed,state:'eq.claimed'}),{method:'PATCH',body:JSON.stringify({state:['similar_content','model_skipped'].includes(code)?'skipped':'failed',error_code:code,usage:{...(error.usage||{}),...(error.validation?{validation:error.validation}:{})}})});}catch{}return json({published:false,reason:code},['similar_content','model_skipped'].includes(code)?200:503);}
}

export async function initializeAIWriters(request){
 const bearer=request.headers.get('authorization'),url=process.env.SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY;if(!url||!key||!/^Bearer [A-Za-z0-9._-]+$/.test(bearer||''))return json({error:'운영자 로그인이 필요합니다.'},401);
 try{const r=await fetch(url+'/rest/v1/rpc/is_moderator',{method:'POST',headers:{apikey:key,Authorization:bearer,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(6000)});if(!r.ok||await r.json()!==true)return json({error:'운영자만 계정을 준비할 수 있습니다.'},403);return json(await provisionWriters());}catch{return json({error:'AI 계정 구조와 서버 연결을 확인해 주세요.'},503);}
}
