import {fetchExchange} from './exchanges.mjs';
let cached=null,pending=null;
export async function attachAttentionPrices(items,{market=fetchExchange,now=()=>Date.now()}={}){
 if(!items.length)return {items,priceSource:'Binance 현물 / USDT',priceFetchedAt:null};
 let snapshot;
 try{
  if(market!==fetchExchange)snapshot=await market('binance');
  else{
   if(!cached||now()-cached.at>=60000){pending??=fetchExchange('binance').then(data=>{cached={at:now(),data};return data;}).finally(()=>{pending=null;});snapshot=await pending;}else snapshot=cached.data;
  }
  const prices=new Map(snapshot.coins.map(c=>[c.symbol,c]));
  return {items:items.map(item=>({...item,priceChange24h:Number.isFinite(prices.get(item.symbol)?.change)?prices.get(item.symbol).change:null})),priceSource:'Binance 현물 / USDT',priceFetchedAt:snapshot.fetchedAt};
 }catch{return {items:items.map(item=>({...item,priceChange24h:null})),priceSource:'Binance 현물 / USDT',priceFetchedAt:null};}
}
