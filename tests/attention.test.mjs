import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCoins,rankInternal,normalizeText} from '../lib/attention.mjs';
import {getAttention} from '../lib/attention-api.mjs';
test('aliases, particles, cashtags and market pairs identify each coin once',()=>{
 assert.deepEqual(matchCoins('수이는 SUI $SUI 오늘 SOLUSDT와 솔라나 이야기'),['SOL','SUI']);
 assert.deepEqual(matchCoins('수익이 늘었다. 수이퍼 히어로'),[]);
 assert.deepEqual(matchCoins('리플과 도지코인은 어떨까'),['DOGE','XRP']);
});
test('ambiguous English words and ordinary temperature are not coin mentions',()=>{
 assert.deepEqual(matchCoins('move near the gas station. 온도가 높다. 링크 확인'),[]);
 assert.deepEqual(matchCoins('$MOVE $GAS $W 온도파이낸스'),['GAS','MOVE','ONDO','W']);
 assert.deepEqual(matchCoins('다들 어떻게 생각하나요','SUI'),['SUI']);
});
test('Ethereum Classic is not also counted as Ethereum',()=>{
 assert.deepEqual(matchCoins('이더리움클래식 이야기'),['ETC']);
 assert.deepEqual(matchCoins('이더리움클래식 vs ETH'),['ETC','ETH']);
});
test('ranking deduplicates titles, rejects out-of-window posts and keeps references',()=>{
 const now=Date.parse('2026-10-17T08:00:00Z');
 const posts=[{id:'a',title:'SUI 올라간다!',created_at:'2026-10-17T07:45:00Z'},{id:'b',title:'sui 올라간다',created_at:'2026-10-17T07:40:00Z'},{id:'c',title:'SOL 수이 비교',created_at:'2026-10-17T07:30:00Z'},{id:'old',title:'PEPE',created_at:'2026-10-16T01:00:00Z'},{id:'future',title:'DOGE',created_at:'2026-10-18T01:00:00Z'}];
 const rows=rankInternal(posts,{hours:1,now});assert.equal(rows[0].symbol,'SUI');assert.equal(rows[0].mentions,2);assert.equal(rows[0].growth,null);assert.equal(rows.length,2);assert.deepEqual(rows[0].links.map(l=>l.postId),['a','c']);
 assert.equal(normalizeText('SUI!!  올라간다'),'sui 올라간다');
});
function config(){process.env.SUPABASE_URL='https://test-project.supabase.co';process.env.SUPABASE_ANON_KEY='sb_publishable_test'}
function clear(){delete process.env.SUPABASE_URL;delete process.env.SUPABASE_ANON_KEY}
test('external candidates never trigger a crawl and remain disconnected without approved feeds',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected fetch')};
 try{clear();const r=await getAttention(new URL('https://example.com/api/attention'));assert.equal(calls,0);assert.equal(r.connectedSources,0);assert.equal(r.sources.length,1);assert.equal(r.status,'not_connected')}
 finally{globalThis.fetch=original;clear()}
});
test('internal attention uses visible posts only and never shares body/author data',async()=>{
 const original=globalThis.fetch;let called='';config();globalThis.fetch=async url=>{if(String(url).includes('rest/v1/posts'))called=String(url);return Response.json([{id:'a',title:'SUI',coin:'SUI',created_at:new Date().toISOString()}])};
 try{const r=await getAttention(new URL('https://example.com/api/attention?scope=internal&hours=1'));assert.equal(r.status,'ready');assert.equal(r.items[0].symbol,'SUI');assert.equal(r.items[0].mentions,1);assert.match(called,/status=eq.published/);assert.doesNotMatch(called,/author_id|body/);assert.equal(r.sources[0].id,'altmoa')}
 finally{globalThis.fetch=original;clear()}
});
test('missing migration is reported without fabricated external rankings',async()=>{
 const original=globalThis.fetch;config();globalThis.fetch=async()=>Response.json({code:'PGRST205'},{status:404});
 try{const r=await getAttention(new URL('https://example.com/api/attention'));assert.equal(r.status,'setup_required');assert.deepEqual(r.items,[]);assert.equal(r.connectedSources,0)}finally{globalThis.fetch=original;clear()}
});
test('legacy scope and region parameters always resolve to internal unified posts',async()=>{
 const original=globalThis.fetch;config();const calls=[];globalThis.fetch=async url=>{calls.push(String(url));return Response.json([{id:'a',title:'태그 테스트',tags:['BTC','USDT'],created_at:new Date().toISOString()}]);};
 try{const r=await getAttention(new URL('https://example.com/api/attention?scope=external&region=global'));assert.equal(r.scope,'internal');assert.equal(r.region,undefined);assert.deepEqual(r.items.map(i=>i.symbol),['BTC','USDT']);assert.equal(calls.filter(u=>u.includes('rest/v1/')).length,2);assert.match(calls[0],/rest\/v1\/posts/);assert.doesNotMatch(calls[0],/attention_sources|rpc/);}finally{globalThis.fetch=original;clear();}
});
test('interest adds replies on old coin posts and direct mentions, with per-author duplicate comment protection',()=>{
 const now=Date.parse('2026-10-18T02:00Z'),created_at=new Date(now-60000).toISOString();const parent={id:'old',title:'수이 이야기',tags:['SUI'],status:'published',created_at:'2026-10-01'};
 const comments=[{id:'a',post_id:'old',author_id:'one',body:'ㅇㅈ',posts:parent,created_at},{id:'b',post_id:'old',author_id:'one',body:'ㅇㅈ',posts:parent,created_at},{id:'c',post_id:'old',author_id:'two',body:'ㅇㅈ',posts:parent,created_at},{id:'d',post_id:'old',author_id:'two',body:'SOL도 비교해보자',posts:parent,created_at},{id:'hidden',post_id:'old',author_id:'two',body:'PEPE',posts:{...parent,status:'hidden'},created_at}];
 const rows=rankInternal([],{now,hours:1,comments});const sui=rows.find(r=>r.symbol==='SUI'),sol=rows.find(r=>r.symbol==='SOL');assert.equal(sui.mentions,3);assert.equal(sui.postMentions,0);assert.equal(sui.commentMentions,3);assert.equal(sol.commentMentions,1);assert.equal(sui.links.length,1);assert.ok(!rows.some(r=>r.symbol==='PEPE'));
});
test('public attention includes comment totals but does not return comment text or authors',async()=>{
 const original=globalThis.fetch;config();const created_at=new Date().toISOString();globalThis.fetch=async url=>String(url).includes('rest/v1/comments')?Response.json([{id:'c',post_id:'p',author_id:'private-author-id',body:'SUI 댓글 원문',created_at,posts:{id:'p',title:'SUI 글',tags:['SUI'],status:'published'}}]):String(url).includes('rest/v1/posts')?Response.json([{id:'p',title:'SUI 글',tags:['SUI'],created_at}]):Response.json([]);
 try{const r=await getAttention(new URL('https://example.com/api/attention'));assert.equal(r.items[0].mentions,2);assert.equal(r.items[0].postMentions,1);assert.equal(r.items[0].commentMentions,1);assert.doesNotMatch(JSON.stringify(r),/private-author-id|댓글 원문/);}finally{globalThis.fetch=original;clear()}
});
