import {randomUUID} from 'node:crypto';
import {fetchExchange} from './exchanges.mjs';
import {aiAdmin} from './ai-publisher.mjs';
const DAY=86400000,TTL=600000;
export const EXCLUDED_ASSETS=['BTC','ETH','USDT','USDC','FDUSD','TUSD','USDP','DAI','USDD','USD1','USDE','USDJ','PYUSD','RLUSD','USDS','BUSD','AEUR','EURI','EUR','EURC','PAXG','XAUT','WBTC','WBETH','WETH','BTCB','CBETH','BETH','STETH','WSTETH','WEETH','EZETH','RETH','SUSDE','USDF','USDG','BFUSD','BTCUP','BTCDOWN','ETHUP','ETHDOWN','BNBUP','BNBDOWN'];
const excluded=new Set(EXCLUDED_ASSETS),round=n=>Math.round(n*10)/10;
export function activityUniverse(coins){
 const seen=new Set();return coins.filter(c=>!excluded.has(c.symbol)&&/^[A-Z0-9]{1,20}$/.test(c.symbol)&&!seen.has(c.symbol)&&Number.isFinite(c.change)&&Number.isFinite(c.volume24h)&&c.volume24h>0&&seen.add(c.symbol)).map(c=>({symbol:c.symbol,change:c.change,volume24h:c.volume24h}));
}
export function calculateActivity(market,history=[],at=Date.now()){
 const btc=market.coins.find(c=>c.symbol==='BTC'),coins=activityUniverse(market.coins);
 if(!coins.length||!Number.isFinite(btc?.change))throw Error('invalid_activity_market');
 const up=coins.filter(c=>c.change>0).length,strong=coins.filter(c=>c.change>btc.change).length;
 const daily=[];for(let day=1;day<=7;day++){
  const target=at-day*DAY;const nearest=history.filter(h=>Math.abs(Date.parse(h.asOf)-target)<=20*60000).sort((a,b)=>Math.abs(Date.parse(a.asOf)-target)-Math.abs(Date.parse(b.asOf)-target))[0];
  if(nearest)daily.push(nearest);
 }
 let ratio=null,volumeScore=null,comparisonCount=0;
 if(daily.length===7){
  const maps=daily.map(h=>new Map((h.coins||[]).map(c=>[c.symbol,c.volume24h])));
  const common=coins.filter(c=>maps.every(m=>Number.isFinite(m.get(c.symbol))&&m.get(c.symbol)>0));comparisonCount=common.length;
  if(common.length>=Math.ceil(coins.length*.9)){
   const current=common.reduce((s,c)=>s+c.volume24h,0),average=maps.reduce((s,m)=>s+common.reduce((n,c)=>n+m.get(c.symbol),0),0)/7;
   ratio=current/average;volumeScore=round(Math.min(40,Math.max(0,20+20*Math.log2(ratio))));
  }
 }
 const breadth=round(30*up/coins.length),strength=round(30*strong/coins.length);
 return {version:'v1',status:volumeScore===null?'collecting':'ready',asOf:new Date(at).toISOString(),source:'Binance USDT 현물',coins,excludedAssets:EXCLUDED_ASSETS,count:coins.length,upCount:up,strongCount:strong,upPercent:round(up/coins.length*100),strongPercent:round(strong/coins.length*100),btcChange:btc.change,turnover:coins.reduce((s,c)=>s+c.volume24h,0),baselineDays:daily.length,comparisonCount,volumeRatio:ratio,parts:{volume:volumeScore,breadth,strength},score:volumeScore===null?null:round(volumeScore+breadth+strength)};
}
export function activityPublic(snapshot,history=[],{stale=false}={}){
 const {coins,...data}=snapshot;
 const previous=history.filter(h=>h.version===snapshot.version&&Number.isFinite(h.score)&&Math.abs(Date.parse(h.asOf)-(Date.parse(snapshot.asOf)-DAY))<=20*60000).sort((a,b)=>Math.abs(Date.parse(a.asOf)-(Date.parse(snapshot.asOf)-DAY))-Math.abs(Date.parse(b.asOf)-(Date.parse(snapshot.asOf)-DAY)))[0];
 return {...data,stale,dayChange:Number.isFinite(snapshot.score)&&previous?round(snapshot.score-previous.score):null,history:history.filter(h=>h.version===snapshot.version&&Number.isFinite(h.score)&&Date.parse(h.asOf)>=Date.parse(snapshot.asOf)-DAY&&Date.parse(h.asOf)<=Date.parse(snapshot.asOf)).map(h=>({at:h.asOf,score:h.score})).concat(Number.isFinite(snapshot.score)?[{at:snapshot.asOf,score:snapshot.score}]:[]).filter((p,i,a)=>a.findIndex(q=>q.at===p.at)===i).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))};
}
export async function getMarketActivity({admin=aiAdmin,market=fetchExchange,now=()=>Date.now()}={}){
 const at=now(),rows=await admin('rest/v1/market_activity_cache?id=eq.1&select=snapshot,computed_at'),row=rows?.[0];
 // Thin snapshots every ten minutes; all visitors reuse the same result.
 const fresh=row?.snapshot&&at-Date.parse(row.computed_at)<TTL;
 const context=await admin('rest/v1/rpc/market_activity_context',{method:'POST',body:JSON.stringify({p_at:new Date(at).toISOString(),p_baseline:!fresh})});
 const snapshots=context?.baseline||[],chart=context?.chart||[];
 if(fresh)return activityPublic(row.snapshot,chart);
 const token=randomUUID(),claimed=await admin('rest/v1/rpc/claim_market_activity',{method:'POST',body:JSON.stringify({p_token:token})});
 if(!claimed)return row?.snapshot?activityPublic(row.snapshot,chart,{stale:true}):{status:'building',history:[],message:'첫 시장 데이터를 집계하고 있습니다.'};
 try{
  const result=await market('binance'),data=calculateActivity(result,snapshots,at);
  if(!await admin('rest/v1/rpc/finish_market_activity',{method:'POST',body:JSON.stringify({p_token:token,p_snapshot:data})}))throw Error('activity_lease_expired');
  return activityPublic(data,chart);
 }catch(error){
  try{await admin('rest/v1/rpc/finish_market_activity',{method:'POST',body:JSON.stringify({p_token:token,p_snapshot:null})});}catch{}
  if(row?.snapshot)return activityPublic(row.snapshot,chart,{stale:true});throw error;
 }
}
