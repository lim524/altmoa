import {attachAttentionPrices} from './attention-prices.mjs';
import {rankInternal} from './attention.mjs';
function publicConfig(){
 const url=(process.env.SUPABASE_URL||'').trim().replace(/\/$/,''); const key=(process.env.SUPABASE_ANON_KEY||'').trim();
 let safe=/^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
 try{if(key.split('.').length===3)safe=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon'}catch{safe=false}
 return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)&&safe?{url,key}:null;
}
export async function getAttention(url){
 const hours=url.searchParams.get('hours')==='1'?1:24;
 const base={scope:'internal',hours,items:[],sources:[{id:'altmoa',name:'알트모아',status:'not_connected',note:'공개 게시글 제목·코인 태그 기준'}],method:'알트모아 공개 게시글 기준 · 같은 코인의 동일 제목 중복 제외 · 댓글 제외',fetchedAt:new Date().toISOString(),connectedSources:0};
 const config=publicConfig();if(!config)return {...base,status:'not_connected',message:'저장 서버 연결이 필요합니다.'};
 const read=async(path,options={},withTotal=false)=>{
  const response=await fetch(config.url+'/rest/v1/'+path,{...options,headers:{apikey:config.key,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
  const data=await response.json();if(!response.ok){const e=new Error('attention_backend');e.code=data.code;e.status=response.status;throw e}return withTotal?{data,total:Number(response.headers.get('content-range')?.split('/')[1])||data.length}:data;
 };
 try{
  {
   const params=new URLSearchParams({select:'id,title,coin,tags,created_at',status:'eq.published',created_at:'gte.'+new Date(Date.now()-hours*3600000).toISOString(),order:'created_at.desc',limit:'2000'});
   let result;try{result=await read('posts?'+params,{headers:{Prefer:'count=exact'}},true);}catch(error){if(error.code!=='42703'&&error.code!=='PGRST204')throw error;params.set('select','id,title,coin,created_at');result=await read('posts?'+params,{headers:{Prefer:'count=exact'}},true);}const {data:docs,total}=result;const limited=total>docs.length;const items=rankInternal(docs,{hours});
   return {...base,status:items.length?'ready':'collecting',...await attachAttentionPrices(items.slice(0,20)),sources:[{...base.sources[0],status:'collecting',lastSuccessAt:base.fetchedAt}],connectedSources:1,sampled:limited,sampleSize:docs.length,message:limited?'최근 '+docs.length+'개 게시글 표본입니다.':'알트모아 공개 게시글만 통합한 내부 관심도입니다.'};
  }
 }catch(error){
  if(['42P01','PGRST202','PGRST205'].includes(error.code))return {...base,status:'setup_required',message:'관심도 저장 구조의 설정을 마무리하고 있습니다.'};
  console.error('attention_read_failed',error.code||error.name);return {...base,status:'error',message:'관심도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'};
 }
}
