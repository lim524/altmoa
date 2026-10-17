import {AI_CHARACTERS,AI_RULES} from './ai-personas.mjs';
import {EXCHANGES,fetchExchange} from './exchanges.mjs';
const cooldown=new Map();
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function aiConfiguration(){return {characters:AI_CHARACTERS.map(character=>({...character,displayName:'AI · '+character.name})),enabled:Boolean(process.env.XAI_API_KEY&&process.env.XAI_MODEL),webSearch:process.env.XAI_WEB_SEARCH==='true',draftOnly:true,accountConnected:false};}
export async function createAIDraft(request){
 const started=Date.now();
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY,bearer=request.headers.get('authorization');
 if(!url||!key||!/^Bearer [A-Za-z0-9._-]+$/.test(bearer||''))return json({error:'운영자 로그인이 필요합니다.'},401);
 try{
  const verified=await fetch(url+'/rest/v1/rpc/is_moderator',{method:'POST',headers:{apikey:key,Authorization:bearer,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(6000)});
  if(!verified.ok||await verified.json()!==true)return json({error:'운영자만 AI 초안을 생성할 수 있습니다.'},403);
 }catch{return json({error:'운영 권한을 확인하지 못했습니다.'},503);}
 if(!process.env.XAI_API_KEY||!process.env.XAI_MODEL)return json({error:'XAI_API_KEY와 XAI_MODEL을 서버 환경변수에 설정해 주세요.'},503);
 if(Number(request.headers.get('content-length'))>12000)return json({error:'입력이 너무 깁니다.'},413);
 let body;try{const raw=await request.text();if(raw.length>6000)return json({error:'입력이 너무 깁니다.'},413);body=JSON.parse(raw);}catch{return json({error:'입력 형식을 확인해 주세요.'},400);}
 const character=AI_CHARACTERS.find(item=>item.id===body.character),exchange=body.exchange||'binance';
 if(!character||!EXCHANGES[exchange]||typeof body.topic!=='string'||body.topic.trim().length<2||body.topic.length>800||body.symbol&&!/^[A-Z0-9]{1,20}$/.test(body.symbol))return json({error:'캐릭터·거래소·주제·코인 기호를 확인해 주세요.'},400);
 // Best-effort process-local cooldown; provider spending limits should also be configured.
 const identity=bearer.slice(-32);if(Date.now()-(cooldown.get(identity)||0)<30000)return json({error:'AI 초안은 30초 후 다시 생성할 수 있습니다.'},429);
 cooldown.set(identity,Date.now());if(cooldown.size>500)for(const [id,at] of cooldown)if(Date.now()-at>60000)cooldown.delete(id);
 let snapshot;try{snapshot=await fetchExchange(exchange);}catch{return json({error:'현재 시세를 확인하지 못해 초안을 생성하지 않았습니다.'},502);}
 const selected=body.symbol?snapshot.coins.filter(row=>row.symbol===body.symbol):snapshot.coins.slice(0,5);if(!selected.length)return json({error:'선택 거래소에서 해당 코인의 시세를 찾지 못했습니다.'},400);
 const context={exchange:snapshot.name,quote:snapshot.currency,fetchedAt:snapshot.fetchedAt,changeBasis:snapshot.changeLabel,coins:selected.map(({symbol,price,change,volume24h})=>({symbol,price,change,volume24h})),accountConnected:false,webSearch:process.env.XAI_WEB_SEARCH==='true'};
 try{
 const tools=context.webSearch?[{type:'web_search'}]:[];
 const response=await fetch('https://api.x.ai/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.XAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.XAI_MODEL,store:false,max_output_tokens:1200,input:[{role:'system',content:AI_RULES+'\n캐릭터명: '+character.name+'\n역할: '+character.role+'\n말투: '+character.style},{role:'user',content:JSON.stringify({topic:body.topic.trim(),marketSnapshot:context})}],...(tools.length?{tools}:{})}),signal:AbortSignal.timeout(Math.max(1000,Math.min(18000,26000-(Date.now()-started))))});
 if(!response.ok)return json({error:'Grok 응답 오류입니다. 모델명·API 사용 권한·결제 한도를 확인해 주세요.'},502);
 const result=await response.json(),texts=[],sources=[];
 for(const item of result.output||[])if(item.type==='message')for(const part of item.content||[])if(part.type==='output_text'){
 texts.push(part.text||'');for(const citation of part.annotations||[])if(citation.type==='url_citation'){try{const link=new URL(citation.url);if(link.protocol==='https:')sources.push({url:link.href,title:String(citation.title||link.hostname).slice(0,150)});}catch{}}
 }
 let text=texts.join('\n').trim();if(!text)return json({error:'AI 초안이 비어 있습니다.'},502);const label='[AI · '+character.name+']';if(!text.startsWith(label))text=label+'\n'+text;
 return json({text:text.slice(0,6000),character:{id:character.id,name:character.name},sources:sources.slice(0,10),snapshot:context,draftOnly:true,published:false,accountConnected:false});
 }catch{return json({error:'AI 초안 생성 시간이 초과되었거나 연결하지 못했습니다.'},502);}
}
