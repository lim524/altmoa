import test from 'node:test';import assert from 'node:assert/strict';import {completedDailyVolumes,buildDailyBaseline} from '../lib/market-baseline.mjs';
const day=86400000,midnight=Date.parse('2026-10-18T00:00Z');const candle=(open,volume)=>[open,'1','1','1','1','999999',open+day-1,String(volume),1];
test('completed UTC daily baseline uses quote turnover, discards open/invalid candles and never manufactures missing days',async()=>{
 const raw=Array.from({length:7},(_,i)=>candle(midnight-(i+1)*day,100+i));raw.push(candle(midnight,999),candle(midnight-8*day,888),candle(midnight-2*day,-1));
 const map=completedDailyVolumes(raw,midnight);assert.equal(map.size,7);assert.equal(map.get(midnight),100);assert.equal(map.has(midnight+day),false);
 const result=await buildDailyBaseline([{symbol:'SUI'}],{at:midnight+2*3600000,fetcher:async url=>{assert.equal(new URL(url).searchParams.get('interval'),'1d');return Response.json(raw)}});assert.equal(result.common,1);assert.equal(result.snapshots.length,7);assert.equal(result.snapshots[0].coins[0].volume24h,100);assert.ok(result.snapshots.every(s=>s.score===null));
 await assert.rejects(buildDailyBaseline([{symbol:'SUI'}],{at:midnight,fetcher:async()=>Response.json(raw.slice(0,6))}),/coverage/);
});
