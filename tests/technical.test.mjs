import test from 'node:test';import assert from 'node:assert/strict';
import {technicalSummary,getTechnical} from '../lib/technical.mjs';import {GET} from '../api/index.mjs';
const duration=3600000,now=250*duration;
function bars(prices=Array.from({length:100},(_,i)=>i+1),volumes=[]){return prices.map((p,i)=>{const open=now-(prices.length-i)*duration;return [open,'1','1','1',String(p),String(volumes[i]??10),open+duration-1];});}
test('closed candles produce SMA20/60 alignment, Wilder RSI and volume against preceding twenty only',()=>{
 const rows=bars(),last=rows.at(-1);last[5]='30';const result=technicalSummary(rows,{now});assert.equal(result.status,'ready');assert.equal(result.sma20,90.5);assert.equal(result.sma60,70.5);assert.equal(result.trend,'up');assert.equal(result.rsi14,100);assert.equal(result.volumeRatio,3);
 const down=technicalSummary(bars(Array.from({length:100},(_,i)=>100-i)),{now});assert.equal(down.trend,'down');assert.equal(down.rsi14,0);
 const flat=technicalSummary(bars(Array(100).fill(5),Array(100).fill(0)),{now});assert.equal(flat.rsi14,50);assert.equal(flat.trend,'mixed');assert.equal(flat.volumeRatio,null);
});
test('Wilder RSI uses the initial fourteen-change mean then recursive smoothing',()=>{
 const prices=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64,46.21];
 // Prefix flat prices so the fourteen-change seed is zero, then use an independent
 // recurrence on the full sequence to check mixed positive/negative changes.
 const all=[...Array(60).fill(prices[0]),...prices.slice(1)];let gain=0,loss=0;
 for(let i=1;i<all.length;i++){const delta=all[i]-all[i-1];gain+=(Math.max(0,delta)-gain)/14;loss+=(Math.max(0,-delta)-loss)/14;}
 const expected=100-100/(1+gain/loss);assert.ok(Math.abs(technicalSummary(bars(all),{now}).rsi14-expected)<1e-10);
});
test('open bars cannot alter indicators; short, stale, invalid and gapped histories are explicit',()=>{
 const rows=bars(),expected=technicalSummary(rows,{now});rows.push([now,'1','1','1','999999','999999',now+duration-1]);assert.deepEqual(technicalSummary(rows,{now}),expected);
 assert.equal(technicalSummary(bars([1,2,3]),{now}).status,'insufficient');assert.throws(()=>technicalSummary(rows,{now:now+3*duration}),/stale/);
 const missing=bars();missing.splice(40,1);assert.throws(()=>technicalSummary(missing,{now}),/incomplete/);
 const invalid=bars();invalid[2][4]='NaN';assert.throws(()=>technicalSummary(invalid,{now}),/invalid/);
});
test('only fixed public Binance candle requests are made and foreign assets require identity mapping',async()=>{
 let calls=0;const fetcher=async(url)=>{calls++;const u=new URL(url);assert.equal(u.hostname,'data-api.binance.vision');assert.equal(u.searchParams.get('symbol'),'SUIUSDT');assert.equal(u.searchParams.get('limit'),'250');return Response.json(bars());};
 const data=await getTechnical(new URL('https://altmoa.test/api/technical?symbol=SUI'),{fetcher,now:()=>now});assert.equal(data.status,'ready');assert.equal(calls,1);
 const unknown=await getTechnical(new URL('https://altmoa.test/api/technical?symbol=SUI&exchange=upbit'),{fetcher});assert.equal(unknown.status,'unsupported');assert.equal(calls,1);
 const mapped=await getTechnical(new URL('https://altmoa.test/api/technical?symbol=SUI&exchange=upbit&asset=sui'),{fetcher,now:()=>now});assert.equal(mapped.status,'ready');assert.equal(calls,2);
 assert.equal((await GET(new Request('https://altmoa.test/api/technical?symbol=BTC&interval=evil'))).status,400);
});
test('missing pairs, upstream failures and shared request caching have distinct behavior',async()=>{
 const request=new URL('https://altmoa.test/api/technical?symbol=ETH');
 assert.equal((await getTechnical(request,{fetcher:async()=>Response.json({code:-1121},{status:400})})).status,'unlisted');
 await assert.rejects(getTechnical(request,{fetcher:async()=>Response.json({code:-1100},{status:400})}),/upstream_unavailable/);
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(bars());};
 try{const [a,b]=await Promise.all([getTechnical(request,{now:()=>now}),getTechnical(request,{now:()=>now})]);assert.equal(a.status,'ready');assert.deepEqual(a,b);await getTechnical(request,{now:()=>now+1000});assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
