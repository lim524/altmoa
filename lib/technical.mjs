import {scoreTechnical} from './technical-score.mjs';
import {ASSETS} from './exchanges.mjs';
export const INTERVALS={'1h':3600000,'4h':14400000,'1d':86400000};
const failure=(code,status=502)=>Object.assign(Error(code),{status});
export function technicalSummary(raw,{interval='1h',now=Date.now()}={}){
 const duration=INTERVALS[interval];if(!duration||!Array.isArray(raw)||raw.length>250)throw failure('invalid_candles');
 const bars=raw.map(row=>{
  if(!Array.isArray(row)||row.length<7||[0,4,5,6].some(i=>row[i]===null||row[i]===''))throw failure('invalid_candles');
  const [open,close,volume,end]=[row[0],row[4],row[5],row[6]].map(Number);
  if(!Number.isSafeInteger(open)||!Number.isSafeInteger(end)||open<0||end-open!==duration-1||!Number.isFinite(close)||close<=0||!Number.isFinite(volume)||volume<0)throw failure('invalid_candles');
  return {open,close,volume,end};
 });
 if(bars.some((b,i)=>i&&b.open!==bars[i-1].open+duration))throw failure('incomplete_candles');
 const closed=bars.filter(b=>b.end<now),last=closed.at(-1);
 if(!last)return {status:'insufficient',closedCandles:0,message:'완료된 봉이 아직 없습니다.'};
 if(now-last.end>duration+120000)throw failure('stale_candles');
 if(closed.length<60)return {status:'insufficient',closedCandles:closed.length,message:'20·60봉 추세 비교를 위해 완료된 봉이 60개 이상 필요합니다.'};
 const average=rows=>rows.reduce((sum,b)=>sum+b.close,0)/rows.length;
 const sma20=average(closed.slice(-20)),sma60=average(closed.slice(-60));
 let gain=0,loss=0;for(let i=1;i<=14;i++){const change=closed[i].close-closed[i-1].close;gain+=Math.max(change,0)/14;loss+=Math.max(-change,0)/14;}
 for(let i=15;i<closed.length;i++){const change=closed[i].close-closed[i-1].close;gain=(gain*13+Math.max(change,0))/14;loss=(loss*13+Math.max(-change,0))/14;}
 const rsi14=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
 const prior=closed.slice(-21,-1),averageVolume=prior.reduce((sum,b)=>sum+b.volume,0)/20;
 const result={status:'ready',closedCandles:closed.length,closedAt:new Date(last.end).toISOString(),close:last.close,sma20,sma60,trend:last.close>sma20&&sma20>sma60?'up':last.close<sma20&&sma20<sma60?'down':'mixed',rsi14,volumeRatio:averageVolume>0?last.volume/averageVolume:null};
 return {...result,scoring:scoreTechnical(result)};
}
const cache=new Map(),pending=new Map();
export async function getTechnical(url,{fetcher=fetch,now=()=>Date.now()}={}){
 const symbol=url.searchParams.get('symbol')||'',interval=url.searchParams.get('interval')||'1h',exchange=url.searchParams.get('exchange')||'binance',assetId=url.searchParams.get('asset')||'';
 if(!/^[A-Z0-9]{1,20}$/.test(symbol)||!INTERVALS[interval]||!['binance','upbit','bithumb','bitget','okx'].includes(exchange))throw failure('invalid_request',400);
 // Cross-exchange symbols require the explicit identity registry, never a ticker-only guess.
 if(exchange!=='binance'&&!ASSETS.some(a=>a.id===assetId&&a.symbol===symbol))return {status:'unsupported',symbol,interval,message:'바이낸스 자산 연결을 확인한 코인만 지표를 제공합니다.'};
 const key=symbol+':'+interval,at=now(),saved=cache.get(key);if(fetcher===fetch&&saved&&at-saved.at<60000)return saved.data;
 if(fetcher===fetch&&pending.has(key))return pending.get(key);
 if(pending.size>=20)throw failure('busy',503);
 const load=async()=>{
  const params=new URLSearchParams({symbol:symbol+'USDT',interval,limit:'250'});
  const response=await fetcher('https://data-api.binance.vision/api/v3/klines?'+params,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});
  if(response.status===400){const error=await response.json();if(error.code===-1121)return {status:'unlisted',symbol,interval,message:'바이낸스 USDT 현물 페어가 없습니다.'};throw failure('upstream_unavailable');}
  if(!response.ok)throw failure('upstream_unavailable');
  const data={symbol,interval,source:'Binance 현물 / USDT',fetchedAt:new Date(now()).toISOString(),...technicalSummary(await response.json(),{interval,now:now()})};
  if(fetcher===fetch){if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,{at:now(),data});}return data;
 };
 if(fetcher!==fetch)return load();const task=load().finally(()=>pending.delete(key));pending.set(key,task);return task;
}
