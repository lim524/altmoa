import test from 'node:test';import assert from 'node:assert/strict';
import {calculateActivity,activityUniverse,activityPublic,getMarketActivity} from '../lib/market-activity.mjs';
const at=Date.parse('2026-10-18T01:00:00Z'),day=86400000;
const market={coins:[{symbol:'BTC',change:2,volume24h:100},{symbol:'ETH',change:3,volume24h:100},{symbol:'USDC',change:0,volume24h:1000},{symbol:'WBETH',change:3,volume24h:20},{symbol:'JUP',change:4,volume24h:100},{symbol:'SUI',change:1,volume24h:100}]};
const history=Array.from({length:7},(_,i)=>({asOf:new Date(Math.floor(at/day)*day-i*day).toISOString(),coins:[{symbol:'JUP',volume24h:100},{symbol:'SUI',volume24h:100}]}));
test('activity uses eligible unique assets and preserves real tickers ending in UP',()=>{assert.deepEqual(activityUniverse([...market.coins,market.coins.at(-1),{symbol:'BAD',change:NaN,volume24h:1}]).map(c=>c.symbol),['JUP','SUI']);});
test('seven daily observations and common assets are required; never substitute missing history with zero',()=>{
 const partial=calculateActivity(market,history.slice(1),at);assert.equal(partial.score,null);assert.equal(partial.parts.volume,null);assert.equal(partial.baselineDays,6);assert.equal(partial.parts.breadth,30);assert.equal(partial.parts.strength,15);
 const ready=calculateActivity(market,history,at);assert.equal(ready.volumeRatio,1);assert.equal(ready.parts.volume,20);assert.equal(ready.score,65);assert.equal(ready.comparisonCount,2);
 const incomplete=structuredClone(history);incomplete[0].coins.pop();assert.equal(calculateActivity(market,incomplete,at).score,null);
 const gap=structuredClone(history);gap[0].asOf=new Date(Math.floor(at/day)*day-21*60000).toISOString();assert.equal(calculateActivity(market,gap,at).baselineDays,6);
});
test('volume scoring is bounded and relative strength can increase while alt prices fall',()=>{
 for(const [multiplier,score] of [[.5,0],[1,20],[2,40],[10,40]]){const m=structuredClone(market);m.coins.forEach(c=>c.volume24h*=multiplier);assert.equal(calculateActivity(m,history,at).parts.volume,score);}
 const m=structuredClone(market);m.coins.find(c=>c.symbol==='BTC').change=-5;m.coins.find(c=>c.symbol==='JUP').change=-2;m.coins.find(c=>c.symbol==='SUI').change=-3;const r=calculateActivity(m,history,at);assert.equal(r.parts.breadth,0);assert.equal(r.parts.strength,30);
});
test('public snapshots omit bulk coin data and only compare valid previous-day scores',()=>{
 const ready=calculateActivity(market,history,at),previous={asOf:new Date(at-day).toISOString(),score:60,version:'v2'};const data=activityPublic(ready,[previous]);assert.equal(data.coins,undefined);assert.equal(data.dayChange,5);assert.equal(data.history.length,2);assert.equal(activityPublic(ready,[{...previous,version:'v0'}]).dayChange,null);
});
test('shared cache skips market fetch, pending claims preserve old results, failures retain old timestamps',async()=>{
 const snapshot=calculateActivity(market,history,at);let scans=0;
 const admin=async path=>path.includes('market_activity_cache?')?[{snapshot,computed_at:new Date(at).toISOString()}]:{baseline:history,chart:[]};
 const cached=await getMarketActivity({now:()=>at,admin,market:async()=>{scans++;return market;}});assert.equal(scans,0);assert.equal(cached.stale,false);
 const staleAdmin=async path=>path.includes('market_activity_cache?')?[{snapshot,computed_at:new Date(at-700000).toISOString()}]:path.includes('context')?{baseline:history,chart:[]}:false;
 assert.equal((await getMarketActivity({now:()=>at,admin:staleAdmin,market:async()=>{scans++;}})).stale,true);assert.equal(scans,0);
 const failing=async path=>path.includes('claim_')?true:staleAdmin(path);const old=await getMarketActivity({now:()=>at,admin:failing,market:async()=>{throw Error('offline')}});assert.equal(old.asOf,snapshot.asOf);assert.equal(old.stale,true);
});
