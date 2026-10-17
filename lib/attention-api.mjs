import {SOURCE_CATALOG,COINS,rankInternal} from './attention.mjs';
function publicConfig(){
 const url=(process.env.SUPABASE_URL||'').trim().replace(/\/$/,''); const key=(process.env.SUPABASE_ANON_KEY||'').trim();
 let safe=/^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
 try{if(key.split('.').length===3)safe=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon'}catch{safe=false}
 return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)&&safe?{url,key}:null;
}
export async function getAttention(url){
 const scope=url.searchParams.get('scope')==='internal'?'internal':'external';
 const hours=url.searchParams.get('hours')==='1'?1:24;
 const region=['kr','global'].includes(url.searchParams.get('region'))?url.searchParams.get('region'):'all';
 const source=url.searchParams.get('source')||'all';
 const catalog=SOURCE_CATALOG.filter(s=>(region==='all'||s.region===region)&&(source==='all'||s.id===source));
 const base={scope,hours,region,items:[],sources:scope==='internal'?[{id:'altmoa',name:'알트모아',region:'kr',status:'not_connected',note:'내부 게시글 제목·코인 태그 기준'}]:catalog,method:'관측된 게시글 기준 · 같은 코인의 동일 제목 중복 제외 · 댓글 제외',fetchedAt:new Date().toISOString(),connectedSources:0};
 if(scope==='internal'&&region==='global')return {...base,status:'not_available',sources:[],message:'알트모아 내부 집계는 국내 범위에서 제공합니다.'};
 const config=publicConfig();if(!config)return {...base,status:'not_connected',message:'저장 서버 연결이 필요합니다.'};
 const read=async(path,options={},withTotal=false)=>{
  const response=await fetch(config.url+'/rest/v1/'+path,{...options,headers:{apikey:config.key,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
  const data=await response.json();if(!response.ok){const e=new Error('attention_backend');e.code=data.code;e.status=response.status;throw e}return withTotal?{data,total:Number(response.headers.get('content-range')?.split('/')[1])||data.length}:data;
 };
 try{
  if(scope==='internal'){
   const params=new URLSearchParams({select:'id,title,coin,created_at',status:'eq.published',created_at:'gte.'+new Date(Date.now()-hours*3600000).toISOString(),order:'created_at.desc',limit:'2000'});
   const {data:docs,total}=await read('posts?'+params,{headers:{Prefer:'count=exact'}},true);const limited=total>docs.length;const items=rankInternal(docs,{hours});
   return {...base,status:items.length?'ready':'collecting',items:items.slice(0,20),sources:[{...base.sources[0],status:'collecting',lastSuccessAt:base.fetchedAt}],connectedSources:1,sampled:limited,sampleSize:docs.length,message:limited?'최근 '+docs.length+'개 게시글 표본입니다.':'외부 통계와 분리한 알트모아 내부 관심도입니다.'};
  }
  const rows=await read('attention_sources?select=id,name,region,status,last_attempt_at,last_success_at,policy_note&order=id');
  base.sources=catalog.map(s=>{const row=rows.find(r=>r.id===s.id);return row?{...s,status:row.status,lastAttemptAt:row.last_attempt_at,lastSuccessAt:row.last_success_at,note:row.policy_note||s.note}:s});
  const active=base.sources.filter(s=>s.status==='collecting'&&s.lastSuccessAt&&Date.now()-Date.parse(s.lastSuccessAt)<20*60000);
  base.sources=base.sources.map(s=>s.status==='collecting'&&!active.includes(s)?{...s,status:'stale',note:'20분 이상 갱신되지 않아 집계에서 제외'}:s);
  base.connectedSources=active.length;
  if(!active.length)return {...base,status:'not_connected',message:'현재 연결된 외부 출처가 없습니다. 출처별 연결 상태를 확인해 주세요.'};
  const items=await read('rpc/attention_rank',{method:'POST',body:JSON.stringify({p_hours:hours,p_sources:active.map(s=>s.id)})});
  return {...base,status:items.length?'ready':'collecting',items:items.map(i=>({...i,name:COINS.find(c=>c.symbol===i.symbol)?.name||i.symbol})),message:'허가된 연결 출처의 관측치입니다. 급증 배수는 충분한 연속 수집 이력이 있을 때만 표시됩니다.'};
 }catch(error){
  if(['42P01','PGRST202','PGRST205'].includes(error.code))return {...base,status:'setup_required',message:'관심도 저장 구조의 설정을 마무리하고 있습니다.'};
  console.error('attention_read_failed',error.code||error.name);return {...base,status:'error',message:'관심도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'};
 }
}
