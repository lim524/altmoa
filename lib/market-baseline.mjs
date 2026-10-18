const DAY=86400000;
export function completedDailyVolumes(raw,midnight){
 if(!Array.isArray(raw))throw Error('invalid_daily_klines');
 const result=new Map();
 for(const c of raw){const open=Number(c[0]),close=Number(c[6]),volume=Number(c[7]);
  if(!Number.isSafeInteger(open)||open%DAY!==0||close!==open+DAY-1||close>=midnight||open<midnight-7*DAY||!Number.isFinite(volume)||volume<0)continue;
  if(result.has(open+DAY))throw Error('duplicate_daily_candle');result.set(open+DAY,volume);
 }
 return result;
}
export async function buildDailyBaseline(coins,{at=Date.now(),fetcher=fetch,progress=()=>{}}={}){
 const midnight=Math.floor(at/DAY)*DAY,snapshots=Array.from({length:7},(_,i)=>({version:'v2',status:'baseline',kind:'daily_kline',asOf:new Date(midnight-i*DAY).toISOString(),source:'Binance completed UTC 1d quote asset volume',score:null,coins:[]}));
 let cursor=0,failed=0,completed=0;
 await Promise.all(Array.from({length:6},async()=>{while(cursor<coins.length){const coin=coins[cursor++];
  try{const url='https://data-api.binance.vision/api/v3/klines?'+new URLSearchParams({symbol:coin.symbol+'USDT',interval:'1d',startTime:String(midnight-7*DAY),endTime:String(midnight-1),limit:'7'});
   const response=await fetcher(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('daily_http_'+response.status);
   const volumes=completedDailyVolumes(await response.json(),midnight);
   for(const snapshot of snapshots){const volume=volumes.get(Date.parse(snapshot.asOf));if(Number.isFinite(volume)&&volume>0)snapshot.coins.push({symbol:coin.symbol,volume24h:volume});}
  }catch{failed++;}
  completed++;progress({completed,total:coins.length,failed});
 }}));
 const maps=snapshots.map(s=>new Set(s.coins.map(c=>c.symbol))),common=coins.filter(c=>maps.every(m=>m.has(c.symbol))).length;
 if(common<Math.ceil(coins.length*.9))throw Error('daily_baseline_coverage_'+common+'_of_'+coins.length);
 return {snapshots,common,total:coins.length,failed};
}
