import {randomUUID} from 'node:crypto';
import {fetchExchange} from './exchanges.mjs';
import {getTechnical,INTERVALS} from './technical.mjs';
import {rankTechnicals} from './technical-score.mjs';
import {aiAdmin} from './ai-publisher.mjs';
export const TECHNICAL_UNIVERSE_LIMIT=100;
const SCOPE_VERSION='volume100-v1';
export async function buildTechnicalRanking(interval,{market=fetchExchange,technical=getTechnical,now=()=>Date.now(),timeout=90000}={}){
 const asOf=now(),deadline=AbortSignal.timeout(timeout),snapshot=await market('binance');
 const eligible=snapshot.coins.filter(c=>c.symbol!=='BTC').sort((a,b)=>b.volume24h-a.volume24h||a.symbol.localeCompare(b.symbol));
 const universe=eligible.slice(0,TECHNICAL_UNIVERSE_LIMIT);if(!universe.length||eligible.length>2000)throw Error('invalid_rank_universe');
 const items=[];let cursor=0,failed=0,insufficient=0;
 // Six bounded workers, regardless of the number of visitors or listed coins.
 const fetcher=(url,options)=>fetch(url,{...options,signal:AbortSignal.any([options.signal,deadline])});
 await Promise.all(Array.from({length:Math.min(6,universe.length)},async()=>{
  while(cursor<universe.length){if(deadline.aborted)throw Error('ranking_timeout');const coin=universe[cursor++];
   try{const data=await technical(new URL('https://www.altmoa.com/api/technical?'+new URLSearchParams({symbol:coin.symbol,interval})),{now:()=>asOf,fetcher});
    if(data.status!=='ready'||!data.scoring){insufficient++;continue;}
    items.push({...data,symbol:coin.symbol,name:coin.name,logoUrl:coin.logoUrl,price:coin.price,change:coin.change,volume24h:coin.volume24h});
   }catch{failed++;}
  }
 }));
 // Keep the previous complete snapshot during broad provider failures.
 if(failed>Math.max(2,universe.length*0.2))throw Error('ranking_upstream_failure');
 return {status:'ready',interval,source:'Binance 현물 / USDT',scoreVersion:'v1',scopeVersion:SCOPE_VERSION,universeLimit:TECHNICAL_UNIVERSE_LIMIT,totalAvailable:eligible.length,asOf:new Date(asOf).toISOString(),completedAt:new Date(now()).toISOString(),totalUniverse:universe.length,failed,insufficient,items:rankTechnicals(items)};
}
export async function getTechnicalRanking(url,{admin=aiAdmin,build=buildTechnicalRanking,now=()=>Date.now()}={}){
 const interval=url.searchParams.get('interval')||'1h';if(!INTERVALS[interval])throw Object.assign(Error('invalid_interval'),{status:400});
 const rows=await admin('rest/v1/technical_rank_cache?'+new URLSearchParams({select:'snapshot,computed_at,lease_until,next_attempt_at',interval:'eq.'+interval,limit:'1'}));
 const row=rows?.[0],usable=row?.snapshot?.scopeVersion===SCOPE_VERSION,age=row?.computed_at?now()-Date.parse(row.computed_at):Infinity;
 if(usable&&age<300000)return {...row.snapshot,stale:false};
 const token=randomUUID();const claim=await admin('rest/v1/rpc/claim_technical_rank',{method:'POST',body:JSON.stringify({p_interval:interval,p_token:token})});
 if(!claim)return usable?{...row.snapshot,stale:true}:{status:'building',interval,retryAfter:5,message:'거래대금 상위 최대 100개 코인을 같은 기준으로 계산하고 있습니다. 첫 집계에는 시간이 걸릴 수 있습니다.'};
 try{
  const data=await build(interval);const saved=await admin('rest/v1/rpc/finish_technical_rank',{method:'POST',body:JSON.stringify({p_interval:interval,p_token:token,p_snapshot:data})});
  if(!saved)throw Error('rank_lease_expired');return {...data,stale:false};
 }catch(error){
  try{await admin('rest/v1/rpc/finish_technical_rank',{method:'POST',body:JSON.stringify({p_interval:interval,p_token:token,p_snapshot:null})});}catch{}
  console.error('technical_ranking_failed',error.message);
  if(usable)return {...row.snapshot,stale:true};throw Object.assign(Error('ranking_unavailable'),{status:503});
 }
}
