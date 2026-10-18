import test from 'node:test';import assert from 'node:assert/strict';
import {scoreTechnical,rankTechnicals} from '../lib/technical-score.mjs';
import {buildTechnicalRanking,getTechnicalRanking} from '../lib/technical-ranking.mjs';
const base={status:'ready',close:110,sma20:100,sma60:90,rsi14:60,volumeRatio:3};
test('transparent scores are bounded, reward non-overheated momentum, and do not reward downtrend volume',()=>{
 assert.deepEqual(scoreTechnical(base),{version:'v1',total:100,trend:50,rsi:30,volume:20});
 assert.equal(scoreTechnical({...base,rsi14:80}).rsi,0);assert.equal(scoreTechnical({...base,rsi14:70}).rsi,20);assert.equal(scoreTechnical({...base,rsi14:40}).rsi,0);assert.equal(scoreTechnical({...base,rsi14:50}).rsi,20);
 const down=scoreTechnical({...base,close:80,sma20:90,sma60:100,volumeRatio:100});assert.equal(down.trend,0);assert.equal(down.volume,0);
 assert.equal(scoreTechnical({...base,volumeRatio:null}),null);
 for(let rsi=0;rsi<=100;rsi++)for(const ratio of [0,0.5,1,1.25,2,3,20]){const score=scoreTechnical({...base,rsi14:rsi,volumeRatio:ratio});assert.ok(score.total>=0&&score.total<=100);assert.ok(Math.abs(score.total-score.trend-score.rsi-score.volume)<1e-8);}
});
test('full-universe ranking sorts before pagination, has stable tie breaks and excludes missing scores',async()=>{
 const coins=Array.from({length:25},(_,i)=>({symbol:'T'+String(i).padStart(2,'0'),name:'테스트',volume24h:100-i}));let active=0,max=0;
 const data=await buildTechnicalRanking('1h',{market:async()=>({coins:[{symbol:'BTC'},...coins]}),technical:async url=>{active++;max=Math.max(max,active);await Promise.resolve();active--;const index=Number(url.searchParams.get('symbol').slice(1));return {...base,scoring:scoreTechnical({...base,volumeRatio:index===24?3:1})};}});
 assert.equal(data.totalUniverse,25);assert.equal(data.items[0].symbol,'T24');assert.equal(data.items[1].symbol,'T00');assert.equal(data.items.length,25);assert.ok(max<=6);
 const ties=rankTechnicals([{symbol:'ZZ',volume24h:1,scoring:{total:20}},{symbol:'AA',volume24h:1,scoring:{total:20}},{symbol:'MISS',scoring:null}]);assert.deepEqual(ties.map(x=>x.symbol),['AA','ZZ']);
});
test('shared snapshots prevent visitors repeating scans and preserve the previous snapshot on failure',async()=>{
 const data={interval:'1h',items:[],status:'ready',scopeVersion:'volume100-v1'};let scans=0,claims=0;const current=Date.now();
 const cached=await getTechnicalRanking(new URL('https://test/api/technical-rank'),{admin:async()=>[{snapshot:data,computed_at:new Date(current).toISOString()}],build:async()=>{scans++;},now:()=>current});assert.equal(cached.stale,false);assert.equal(scans,0);
 const admin=async(path)=>{if(path.includes('technical_rank_cache?'))return [];if(path.includes('claim_')){claims++;return claims===1;}return true;};
 const first=await getTechnicalRanking(new URL('https://test/api/technical-rank'),{admin,build:async()=>{scans++;return data;}});assert.equal(first.stale,false);assert.equal(scans,1);
 const pending=await getTechnicalRanking(new URL('https://test/api/technical-rank'),{admin,build:async()=>{scans++;return data;}});assert.equal(pending.status,'building');assert.equal(scans,1);
 const staleAdmin=async path=>path.includes('technical_rank_cache?')?[{snapshot:data,computed_at:'2020-01-01T00:00:00Z'}]:true;
 const stale=await getTechnicalRanking(new URL('https://test/api/technical-rank'),{admin:staleAdmin,build:async()=>{throw Error('offline');}});assert.equal(stale.stale,true);
});
test('only the 100 most traded candidates request candles even when lower-volume coins could score higher',async()=>{
 const coins=Array.from({length:500},(_,i)=>({symbol:'T'+String(i).padStart(3,'0'),volume24h:500-i})).reverse(),calls=[];
 const result=await buildTechnicalRanking('1h',{market:async()=>({coins}),technical:async url=>{calls.push(url.searchParams.get('symbol'));return {...base,scoring:scoreTechnical(base)};}});
 assert.equal(calls.length,100);assert.equal(new Set(calls).size,100);assert.ok(calls.includes('T000'));assert.ok(calls.includes('T099'));assert.ok(!calls.includes('T100'));assert.equal(result.items.length,100);assert.equal(result.totalAvailable,500);assert.equal(result.totalUniverse,100);assert.equal(result.scopeVersion,'volume100-v1');
});
test('legacy unlimited snapshots are never served as the capped ranking while a refresh is pending',async()=>{
 const old={status:'ready',items:Array.from({length:500},()=>({}))};
 const result=await getTechnicalRanking(new URL('https://test/api/technical-rank'),{admin:async path=>path.includes('technical_rank_cache?')?[{snapshot:old,computed_at:new Date().toISOString()}]:false});assert.equal(result.status,'building');assert.equal(result.items,undefined);
});
