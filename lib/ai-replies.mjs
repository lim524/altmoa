import {recordAIViews} from './post-views.mjs';
import {aiScheduleDue,aiWriterIndex} from './ai-schedule.mjs';
import {AI_WRITERS,PROVIDERS,generateWriterReply,similarPost} from './ai-writers.mjs';
import {aiAdmin,authorized} from './ai-publisher.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function redactReplyContext(text){return String(text||'').replace(/\b(?:sk-|xai-)[A-Za-z0-9_-]{12,}\b|\bAIza[A-Za-z0-9_-]{20,}\b/g,'[키 삭제]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[이메일 삭제]').replace(/(?:\+82[- ]?|0)1[016789][- ]?\d{3,4}[- ]?\d{4}/g,'[전화번호 삭제]');}
export async function runAIReplies(request,{now=()=>Date.now(),admin=aiAdmin,generate=generateWriterReply,due=aiScheduleDue}={}){
 if(!authorized(request))return json({error:'Unauthorized'},401);
 if(process.env.AI_AUTO_REPLY!=='true')return json({enabled:false,replied:false});
 if(Object.values(PROVIDERS).some(p=>!process.env[p.key]||!process.env[p.model]))return json({error:'provider_configuration_incomplete'},503);
 const scheduledAt=now();if(!due('reply',scheduledAt))return json({replied:false,reason:'not_due'});
 const writer=AI_WRITERS[aiWriterIndex('reply',scheduledAt,AI_WRITERS.length)];let slot;
 try{
  const claim=await admin('rest/v1/rpc/claim_ai_reply_irregular',{method:'POST',body:JSON.stringify({p_persona:writer.id})});if(!claim)return json({replied:false,reason:'already_claimed_or_limit'});slot=claim.slot;
  const candidates=(claim.candidates||[]).slice(0,3);if(!candidates.length)throw Error('no_candidates');
  const authorIds=[...new Set(candidates.map(c=>c.author_id).filter(id=>/^[a-f0-9-]{36}$/i.test(id||'')))];let operators=new Set();
  // Role is verified server-side; a claim inside a post never grants this flag.
  if(authorIds.length)try{const rows=await admin('rest/v1/moderators?'+new URLSearchParams({select:'user_id',user_id:'in.('+authorIds.join(',')+')'}));operators=new Set((Array.isArray(rows)?rows:[]).map(row=>row.user_id));}catch{}
  let thread=[];const postIds=[...new Set(candidates.map(c=>c.post_id).filter(id=>/^[a-f0-9-]{36}$/i.test(id||'')))];
  if(postIds.length)try{thread=await admin('rest/v1/comments?'+new URLSearchParams({select:'post_id,author_id,body,created_at,profiles!comments_author_id_fkey(nickname,is_ai)',post_id:'in.('+postIds.join(',')+')',status:'eq.published',order:'created_at.desc',limit:'18'}));}catch{}
  const context={purpose:'select_one_interesting_conversation_or_skip',candidates:candidates.map(c=>({key:c.key,kind:c.kind,author_is_ai:c.author_is_ai,author_is_operator:operators.has(c.author_id),title:redactReplyContext(c.title).slice(0,60),body:redactReplyContext(c.body).slice(0,260),post_body:redactReplyContext(c.post_body).slice(0,180),thread:(Array.isArray(thread)?thread:[]).filter(t=>t.post_id===c.post_id).slice(0,3).reverse().map(t=>({author:redactReplyContext(t.profiles?.nickname||'회원').slice(0,20),author_is_ai:t.profiles?.is_ai===true,author_is_self:Boolean(claim.author_id&&t.author_id===claim.author_id),body:redactReplyContext(t.body).slice(0,140)}))}))};

  const reply=await generate(writer,context);await recordAIViews(writer.id,candidates,admin);if(!reply)throw Error('not_interested');
  const target=candidates.find(c=>c.key===reply.target_key);if(!target||!['post','comment'].includes(target.kind)||!/^[a-f0-9-]{36}$/i.test(target.target_id))throw Error('invalid_reply_target');
  const recommend=async()=>{if(process.env.AI_AUTO_RECOMMEND!=='true'||target.kind!=='post'||reply.recommend_post!==true||(!Number.isInteger(reply.interest_score)||reply.interest_score<80||reply.interest_score>100))return false;try{return await admin('rest/v1/rpc/recommend_ai_post',{method:'POST',body:JSON.stringify({p_persona:writer.id,p_post:target.post_id})})===true;}catch{return false;}};
  if(reply.skip===true){const recommended=await recommend();await admin('rest/v1/ai_reply_jobs?'+new URLSearchParams({slot:'eq.'+slot,state:'eq.claimed'}),{method:'PATCH',body:JSON.stringify({state:'skipped',error_code:recommended?'recommendation_only':'not_interested',usage:{...(reply.usage||{}),interest_score:reply.interest_score,recommended}})});return json({replied:false,recommended,reason:recommended?'recommendation_only':'not_interested'});}
  if(similarPost(reply.body,target.body))throw Error('repeated_reply');
  const recent=await admin('rest/v1/comments?'+new URLSearchParams({select:'body',post_id:'eq.'+target.post_id,status:'eq.published',order:'created_at.desc',limit:'20'}));
  if(recent.some(c=>similarPost(reply.body,c.body.split('\n\n알트모아 운영 AI 작성자')[0])))throw Error('repeated_reply');
  const body=reply.body;
  const id=await admin('rest/v1/rpc/finish_ai_reply',{method:'POST',body:JSON.stringify({p_slot:slot,p_kind:target.kind,p_target:target.target_id,p_body:body})});
  const recommended=id?await recommend():false;
  try{await admin('rest/v1/ai_reply_jobs?slot=eq.'+slot,{method:'PATCH',body:JSON.stringify({usage:{...(reply.usage||{}),interest_score:reply.interest_score,recommended}})});}catch{}
  return json({replied:Boolean(id),replyId:id,writer:writer.id,recommended});
 }catch(error){const normal=['no_candidates','not_interested','repeated_reply'].includes(error.message);if(slot!==undefined)try{await admin('rest/v1/ai_reply_jobs?'+new URLSearchParams({slot:'eq.'+slot,state:'eq.claimed'}),{method:'PATCH',body:JSON.stringify({state:normal?'skipped':'failed',error_code:normal?error.message:'reply_generation_failed'})});}catch{}return json({replied:false,reason:normal?error.message:'reply_generation_failed'},normal?200:503);}
}
