import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBinance,fetchExchange,compareAsset} from '../lib/exchanges.mjs';
const pair=(symbol,extra={})=>({symbol:symbol+'USDT',baseAsset:symbol,quoteAsset:'USDT',status:'TRADING',isSpotTradingAllowed:true,...extra});
const tick=(symbol,extra={})=>({symbol:symbol+'USDT',lastPrice:'2',openPrice:'1',quoteVolume:'100',...extra});
test('Binance uses active spot USDT pairs and rolling change; unknown ticker identity stays unlinked',()=>{
 const rows=normalizeBinance(['SUI','UNKNOWN','HALT','OTHER'].map(s=>tick(s)),{symbols:[pair('SUI'),pair('UNKNOWN'),pair('HALT',{status:'BREAK'}),pair('OTHER',{quoteAsset:'BTC'})]});
 assert.equal(rows.length,2);assert.equal(rows[0].change,100);assert.equal(rows[0].assetId,'sui');assert.equal(rows[0].quote,'USDT');assert.equal(rows[1].assetId,null);assert.equal(rows[1].iconSymbol,null);
});
test('Bithumb batches markets and rejects partial or HTML responses',async()=>{
 const original=globalThis.fetch;const names=Array.from({length:101},(_,i)=>({market:'KRW-T'+i}));const groups=[];let partial=false;
 globalThis.fetch=async url=>{if(String(url).includes('/market/all'))return Response.json(names);const markets=new URL(url).searchParams.get('markets').split(',');groups.push(markets.length);return Response.json(markets.slice(partial?1:0).map(market=>({market,trade_price:1,signed_change_rate:0,acc_trade_price_24h:1})));};
 try{const data=await fetchExchange('bithumb');assert.equal(data.coins.length,101);assert.deepEqual(groups,[100,1]);partial=true;await assert.rejects(fetchExchange('bithumb'),/partial_bithumb/);globalThis.fetch=async()=>new Response('<html>unavailable</html>',{headers:{'content-type':'text/html'}});await assert.rejects(fetchExchange('bithumb'),/non_json/);}finally{globalThis.fetch=original;}
});
test('comparison preserves available exchanges when a source fails and labels USDT conversion',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{url=String(url);if(url.includes('bithumb'))throw new Error('offline');if(url.includes('exchangeInfo'))return Response.json({symbols:[pair('SUI')]});if(url.includes('binance.vision'))return Response.json([tick('SUI')]);if(url.includes('/market/all'))return Response.json([{market:'KRW-SUI'},{market:'KRW-USDT'}]);return Response.json([{market:'KRW-SUI',trade_price:3000,signed_change_rate:0,acc_trade_price_24h:100},{market:'KRW-USDT',trade_price:1400,signed_change_rate:0,acc_trade_price_24h:100}]);};
 try{assert.equal(await compareAsset('unknown'),null);const result=await compareAsset('sui');assert.deepEqual(result.comparisons.map(c=>c.status),['ready','unavailable','ready','unavailable','unavailable']);assert.equal(result.comparisons[2].convertedKrw,2800);assert.equal(result.conversion.source,'업비트 USDT/KRW');}finally{globalThis.fetch=original;}
});

test('Bitget and OKX normalize only online USDT spot pairs and use quote turnover',async()=>{
 const {normalizeInternational,fetchConversion}=await import('../lib/exchanges.mjs');
 const b=normalizeInternational({code:'00000',data:[{symbol:'SUIUSDT',lastPr:'2',open:'4',quoteVolume:'99',ts:'1700000000000'},{symbol:'OFFUSDT',lastPr:'1',open:'1',quoteVolume:'1'}]},{code:'00000',data:[{symbol:'SUIUSDT',baseCoin:'SUI',quoteCoin:'USDT',status:'online'},{symbol:'OFFUSDT',baseCoin:'OFF',quoteCoin:'USDT',status:'offline'}]},'bitget');assert.equal(b.length,1);assert.equal(b[0].change,-50);assert.equal(b[0].volume24h,99);assert.equal(b[0].assetId,'sui');
 const o=normalizeInternational({code:'0',data:[{instId:'SUI-USDT',last:'2',open24h:'1',volCcy24h:'100',vol24h:'999',ts:'1700000000000'}]},{code:'0',data:[{instId:'SUI-USDT',baseCcy:'SUI',quoteCcy:'USDT',state:'live',instType:'SPOT'}]},'okx');assert.equal(o[0].change,100);assert.equal(o[0].volume24h,100);
 const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json([{market:'KRW-USDT',trade_price:1400}]);assert.equal((await fetchConversion()).rate,1400);globalThis.fetch=async()=>Response.json([{market:'KRW-USDT',trade_price:0}]);await assert.rejects(fetchConversion(),/invalid_conversion/);}finally{globalThis.fetch=original;}
});
