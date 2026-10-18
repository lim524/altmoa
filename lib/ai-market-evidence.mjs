import{ASSETS}from'./exchanges.mjs';import{getTechnical,INTERVALS}from'./technical.mjs';
const cache=new Map(),pending=new Map(),TTL=300000;
export function conversationSymbols(candidates){let text=candidates.map(c=>[c.title,c.body,c.post_body,...(c.tags||[])].join(' ')).join('\n').normalize('NFKC');for(const a of [...ASSETS].sort((a,b)=>b.name.length-a.name.length))text=text.split(a.name).join(' '+a.symbol+' ');return ASSETS.filter(a=>new RegExp('(^|[^a-zA-Z0-9])'+a.symbol+'([^a-zA-Z0-9]|$)','i').test(text)).map(a=>a.symbol).slice(0,2);}
export function compactEvidence(data,symbol,interval,at){
 const fetched=Date.parse(data?.fetchedAt),closed=Date.parse(data?.closedAt),duration=INTERVALS[interval];
 if(!duration||data?.symbol!==symbol||data?.interval!==interval||data?.status!=='ready'||![fetched,closed,data.close,data.sma20,data.sma60,data.rsi14].every(Number.isFinite)||fetched>at+30000||at-fetched>TTL||closed>=at||at-closed>duration+TTL||Math.min(data.close,data.sma20,data.sma60)<=0||data.rsi14<0||data.rsi14>100||!['up','down','mixed'].includes(data.trend))return null;
 const result={interval,fetched_at:data.fetchedAt,closed_at:data.closedAt,close:data.close,sma20:data.sma20,sma60:data.sma60,rsi14:data.rsi14,volume_ratio:Number.isFinite(data.volumeRatio)&&data.volumeRatio>=0?data.volumeRatio:null,trend:data.trend};
 const p=data.priceAction,c=p?.lastCandle;if(c&&[c.open,c.high,c.low,c.close,p.prior20High,p.prior20Low,p.change3BarsPct].every(Number.isFinite)&&c.close===data.close&&c.low>0&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close)&&p.prior20Low>0&&p.prior20High>=p.prior20Low){result.last_candle=c;result.prior20_high=p.prior20High;result.prior20_low=p.prior20Low;result.change3_bars_pct=p.change3BarsPct;}
 return result;
}
export async function writerMarketEvidence(symbols,{admin,technical=getTechnical,now=()=>Date.now()}={}){
 const selected=[...new Set(symbols)].filter(s=>ASSETS.some(a=>a.symbol===s)).slice(0,2);if(!selected.length)return [];
 let shared=[];try{const rows=await admin('rest/v1/rpc/ai_cached_technicals',{method:'POST',body:JSON.stringify({p_symbols:selected})});if(Array.isArray(rows))shared=rows;}catch{}
 return Promise.all(selected.map(async symbol=>{
  const frames=await Promise.all(['1h','4h'].map(async interval=>{
   const at=now(),key=symbol+':'+interval,rank=shared.find(r=>r.symbol===symbol&&r.interval===interval),verified=compactEvidence(rank,symbol,interval,at);if(verified)return verified;
   const saved=cache.get(key);if(saved&&at-saved.at<TTL){const frame=compactEvidence(saved.data,symbol,interval,at);if(frame)return frame;}
   const load=async()=>{try{const data=await technical(new URL('https://www.altmoa.com/api/technical?'+new URLSearchParams({symbol,interval})),{now});const frame=compactEvidence(data,symbol,interval,now());if(frame&&technical===getTechnical){if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,{at:now(),data});}return frame;}catch{return null;}};
   if(technical!==getTechnical)return load();if(pending.has(key))return pending.get(key);const task=load().finally(()=>pending.delete(key));pending.set(key,task);return task;
  }));
  return{symbol,source:'Binance spot / USDT',source_url:'https://data-api.binance.vision/api/v3/klines?symbol='+symbol+'USDT',as_of:new Date(now()).toISOString(),frames:frames.filter(Boolean),unavailable_intervals:['1h','4h'].filter((_,i)=>!frames[i])};
 }));
}
export function evidenceAudit(evidence){return(evidence||[]).map(e=>({symbol:e.symbol,source:e.source,as_of:e.as_of,frames:e.frames.map(f=>({interval:f.interval,fetched_at:f.fetched_at,closed_at:f.closed_at})),unavailable_intervals:e.unavailable_intervals}));}
