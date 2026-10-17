import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const communityCode=fs.readFileSync(new URL('../dist/community.js',import.meta.url),'utf8');
const code = fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/init\(\);\s*$/, '');
function fixture(handler) {
  const nodes = new Map(), data = new Map();
  const storage = { getItem:k=>data.get(k)||null, setItem:(k,v)=>data.set(k,v) };
  const element = id => { if (!nodes.has(id)) nodes.set(id,{id,textContent:'',innerHTML:'',value:'',style:{},isConnected:true,disabled:false,classList:{toggle(){},contains(){return false},add(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},scrollIntoView(){},setAttribute(){},insertAdjacentHTML(_,html){this.innerHTML+=html}});return nodes.get(id); };
  const views=[['homepage','home'],['boardpanel','board'],['marketpanel','market'],['rankpanel','rank']].map(([id,view])=>Object.assign(element(id),{dataset:{view},hidden:view!=='home'}));
  const context = vm.createContext({ document:{getElementById:element,querySelectorAll:selector=>selector==='[data-view]'?views:[],addEventListener(){},body:{classList:{toggle(){},contains(){return false},add(){}}}}, window:{scrollTo(){}}, localStorage:storage,sessionStorage:storage,setTimeout:()=>1,clearTimeout(){},setInterval(){},URLSearchParams,AbortSignal,location:{origin:'https://altmoa.example',pathname:'/',search:'',hash:''},history:{replaceState(){},pushState(state,title,path){this.lastPath=path}},fetch:handler,FormData:class{constructor(fields){this.fields=fields}get(k){return this.fields[k]}} });
  vm.runInContext(communityCode+'\n'+code,context);
  return { run:source=>vm.runInContext(source,context),node:element,data };
}
const market = { id:'upbit',name:'업비트',source:'Upbit',currency:'KRW', fetchedAt:'2026-10-17T08:00:00Z',coins:[{symbol:'SUI',market:'KRW-SUI',exchange:'upbit',quote:'KRW',name:'수이',price:100,change:-2,volume24h:1000000000}] };
const configure = f => f.run("config={communityReady:true,supabaseUrl:'https://test.supabase.co',supabaseKey:'sb_publishable_example'};setSession({access_token:'token',refresh_token:'refresh',expires_at:Date.now()/1000+3600,user:{id:'user-123'}})");

test('unconnected community never displays demo posts or fake login', async()=>{
  const f=fixture(async()=>Response.json({}));await f.run('loadPosts()');f.run('authModal()');
  assert.match(f.node('posts').innerHTML,/준비/);assert.match(f.node('modalcontent').innerHTML,/아직 회원 서버가 연결되지/);assert.doesNotMatch(f.node('posts').innerHTML,/수이관찰자|예시 게시글/);
});

test('market failure after a successful response explicitly labels old data',async()=>{
  let fail=false;const f=fixture(async()=>{if(fail)throw new Error('network');return Response.json(market)});
  await f.run("loadMarket('upbit')");assert.match(f.node('coins').innerHTML,/수이/);fail=true;await f.run("loadMarket('upbit')");assert.match(f.node('markettime').textContent,/이전 데이터/);assert.match(f.node('ticker').innerHTML,/갱신 지연/);
});

test('favorites persist and nonmatching search does not show fabricated results',async()=>{
  const f=fixture(async()=>Response.json(market));await f.run("loadMarket('upbit')");f.run("star('SUI');showSaved()");assert.match(f.data.get('altmoa-stars'),/SUI/);f.run("query='no-such-coin';savedOnly=false;renderCoins()");assert.match(f.node('coins').innerHTML,/검색 결과가 없습니다/);
});

test('untrusted post titles and nicknames are escaped',async()=>{
  const f=fixture(async()=>Response.json([{id:'00000000-0000-0000-0000-000000000001',title:'<img src=x onerror=alert(1)>',category:'자유',profiles:{nickname:'<svg onload=alert(1)>'},created_at:'2026-10-17T08:00:00Z',comments:[{count:0}]}],{headers:{'content-range':'0-0/1'}}));configure(f);await f.run('loadPosts()');assert.doesNotMatch(f.node('posts').innerHTML,/<img|<svg/);assert.match(f.node('posts').innerHTML,/&lt;img/);
});

test('post submission sends signed-in author and does not fake success on DB failure',async()=>{
  const requests=[];const f=fixture(async(url,options)=>{requests.push({url,options});return Response.json({message:'permission denied'},{status:403})});configure(f);f.run('writePost()');const submit=f.node('writeform').onsubmit;
  await submit({preventDefault(){},target:{category:'분석',coin:'SUI',title:'실제 제목',body:'실제 내용'}});
  const body=JSON.parse(requests[0].options.body);assert.equal(body.author_id,'user-123');assert.equal(body.title,'실제 제목');assert.match(f.node('writeerror').textContent,/권한/);assert.equal(f.node('dialog').open,true);assert.equal(f.node('writesubmit').disabled,false);
});

test('successful DB post submission reloads feed and opens the saved post',async()=>{
  const id='00000000-0000-0000-0000-000000000001';
  const f=fixture(async(url,options)=>{if(options.method==='POST')return Response.json([{id}]);if(String(url).includes('comments?'))return Response.json([]);return Response.json([{id,title:'저장된 제목',body:'저장된 본문',category:'자유',author_id:'user-123',created_at:'2026-10-17T08:00:00Z',profiles:{nickname:'작성자'},comments:[{count:0}]}],{headers:{'content-range':'0-0/1'}})});configure(f);f.run('writePost()');await f.node('writeform').onsubmit({preventDefault(){},target:{category:'자유',coin:'',title:'저장된 제목',body:'저장된 본문'}});await new Promise(r=>setImmediate(r));assert.match(f.node('posts').innerHTML,/저장된 제목/);assert.match(f.node('modalcontent').innerHTML,/저장된 본문/);
});


test('switching exchanges clears old prices and ignores a late response',async()=>{
  let resolveFirst;const f=fixture(url=>String(url).includes('binance')?Promise.resolve(Response.json({...market,id:'binance',source:'Binance',currency:'USDT',coins:[{...market.coins[0],market:'SUIUSDT',exchange:'binance',quote:'USDT',price:2}]})):new Promise(resolve=>{resolveFirst=resolve}));
  const first=f.run("loadMarket('upbit')");await f.run("loadMarket('binance')");resolveFirst(Response.json(market));await first;
  assert.match(f.node('coins').innerHTML,/2 USDT/);assert.equal(f.run('selectedExchange'),'binance');
  const next=f.run("loadMarket('bithumb')");assert.doesNotMatch(f.node('coins').innerHTML,/2 USDT/);resolveFirst(Response.json({error:'unavailable'},{status:502}));await next;assert.match(f.node('coins').innerHTML,/연결하지 못했습니다/);
});

test('coin images escape URLs and stop after all fallback images fail',()=>{
 const f=fixture(async()=>Response.json({}));assert.doesNotMatch(f.run(`coinIcon('', 'BAD', 'javascript:alert(1)')`),/<img/);
 assert.match(f.run(`coinIcon('', 'BNB', '/assets/coins/BNB.svg')`),/BNB.svg/);
 assert.doesNotMatch(f.run(`coinIcon('', 'BAD', 'https://evil.example/logo.png')`),/<img/);
 f.run(`testImage={dataset:{fallback:JSON.stringify(['https://static.upbit.com/logos/SUI.png'])},parentElement:{classList:{remove(){}}},getAttribute(){return this.src},src:'/assets/coins/SUI.svg',remove(){this.removed=true}};coinImageError(testImage);coinImageError(testImage)`);
 assert.equal(f.run('testImage.removed'),true);assert.equal(f.run('failedCoinImages.size'),2);
});

test('home rankings query each complete board by recommendation count, not recent-page comments',async()=>{
 const requests=[];const f=fixture(async url=>{requests.push(new URL(url));return Response.json([{id:'00000000-0000-0000-0000-000000000001',title:'<svg onload=alert(1)>추천 글',category:'분석',recommendation_count:12,profiles:{nickname:'회원'},comments:[{count:99}]}]);});configure(f);await f.run('loadPopular()');
 assert.equal(requests.length,5);assert.deepEqual(requests.map(u=>u.searchParams.get('category')),[null,'eq.자유','eq.분석','eq.소식','eq.질문']);for(const u of requests){assert.equal(u.searchParams.get('order'),'recommendation_count.desc,created_at.desc,id.desc');assert.equal(u.searchParams.get('recommendation_count'),'gt.0');assert.equal(u.searchParams.get('limit'),'5');assert.equal(u.searchParams.has('offset'),false);}
 assert.match(f.node('popularall').innerHTML,/추천 <b>12/);assert.doesNotMatch(f.node('popularall').innerHTML,/<svg/);
});
test('a missing recommendation migration keeps latest posts usable and never fabricates popular ranks',async()=>{
 const f=fixture(async url=>new URL(url).searchParams.get('select')?.includes('recommendation_count')?Response.json({message:'column posts.recommendation_count does not exist'},{status:400}):Response.json([{id:'00000000-0000-0000-0000-000000000001',title:'실제 최신 글',category:'자유',created_at:'2026-10-17T08:00:00Z'}]));configure(f);await f.run('loadPopular()');assert.match(f.node('popularall').innerHTML,/인기글을 준비/);assert.doesNotMatch(f.node('popularall').innerHTML,/실제 최신 글/);await f.run('loadPosts()');assert.match(f.node('posts').innerHTML,/실제 최신 글/);
});
test('recommendation writes use the signed-in user and persist a toggle before refreshing counts',async()=>{
 const id='00000000-0000-0000-0000-000000000001';let count=0;let selected=false;const mutations=[];
 const f=fixture(async(url,options)=>{if(options.method==='POST'){mutations.push(JSON.parse(options.body));count++;selected=true;return new Response(null,{status:201});}if(options.method==='DELETE'){mutations.push(String(url));count--;selected=false;return new Response(null,{status:204});}if(String(url).includes('post_recommendations?'))return Response.json(selected?[{post_id:id}]:[]);return Response.json([{recommendation_count:count}]);});configure(f);f.run(`activeView='rank';activePostId='${id}';document.getElementById('dialog').showModal()`);
 await f.run(`loadPostRecommendation('${id}','other-author')`);await f.run(`toggleRecommendation('${id}','other-author',false)`);assert.equal(mutations[0].user_id,'user-123');assert.equal(mutations[0].post_id,id);assert.match(f.node('postrecommendation').innerHTML,/추천 1 · 취소/);await f.run(`toggleRecommendation('${id}','other-author',true)`);assert.match(mutations[1],/user_id=eq.user-123/);assert.equal(count,0);
});
test('view navigation separates boards, market and interest and retains shareable board state',async()=>{
 const f=fixture(async()=>Response.json([]));configure(f);f.run("openBoard('분석','popular')");await new Promise(r=>setImmediate(r));assert.equal(f.run('activeView'),'board');assert.equal(f.run('postSort'),'popular');assert.equal(f.node('boardtitle').textContent,'분석·인사이트');assert.equal(f.run('category'),'분석');assert.equal(f.node('boardpanel').hidden,false);assert.equal(f.node('homepage').hidden,true);assert.match(f.run('history.lastPath'),/view=board/);f.run("coins=[{symbol:'SUI',name:'수이',price:1,change:0,volume24h:1}];navigate('market')");assert.equal(f.run('activeView'),'market');assert.equal(f.node('marketpanel').hidden,false);assert.equal(f.node('boardpanel').hidden,true);f.run("location.search='?view=board&category=질문&sort=popular';restoreCommunityRoute()");assert.equal(f.run('category'),'질문');assert.equal(f.run('postSort'),'popular');
});
