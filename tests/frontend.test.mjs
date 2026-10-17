import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const composerCode=fs.readFileSync(new URL('../dist/composer.js',import.meta.url),'utf8');
const activityCode=fs.readFileSync(new URL('../dist/activity.js',import.meta.url),'utf8');
const communityCode=fs.readFileSync(new URL('../dist/community.js',import.meta.url),'utf8');
const code = fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/init\(\);\s*$/, '');
function fixture(handler) {
  const nodes = new Map(), data = new Map();
  const storage = { getItem:k=>data.get(k)||null, setItem:(k,v)=>data.set(k,v) };
  const element = id => { if (!nodes.has(id)) nodes.set(id,{id,textContent:'',innerHTML:'',value:'',style:{},isConnected:true,disabled:false,classList:{toggle(){},contains(){return false},add(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},scrollIntoView(){},setAttribute(){},insertAdjacentHTML(_,html){this.innerHTML+=html}});return nodes.get(id); };
  const views=[['homepage','home'],['boardpanel','board'],['marketpanel','market'],['rankpanel','rank']].map(([id,view])=>Object.assign(element(id),{dataset:{view},hidden:view!=='home'}));
  const context = vm.createContext({ document:{getElementById:element,querySelectorAll:selector=>selector==='[data-view]'?views:[],addEventListener(){},body:{classList:{toggle(){},contains(){return false},add(){}}}}, window:{scrollTo(){}}, localStorage:storage,sessionStorage:storage,setTimeout:()=>1,clearTimeout(){},setInterval(){},URL,URLSearchParams,AbortSignal,location:{origin:'https://altmoa.example',pathname:'/',search:'',hash:''},history:{replaceState(){},pushState(state,title,path){this.lastPath=path}},fetch:(url,options)=>String(url)==='/api/conversion'?Promise.resolve(Response.json({rate:1400,source:'업비트 USDT/KRW',fetchedAt:new Date().toISOString()})):handler(url,options),FormData:class{constructor(fields){this.fields=fields}get(k){return this.fields[k]}} });
  vm.runInContext(composerCode+'\n'+activityCode+'\n'+communityCode+'\n'+code,context);
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
  await submit({preventDefault(){},target:{category:'분석',tags:'usdt btc',title:'실제 제목',body:'실제 내용'}});
  const body=JSON.parse(requests[0].options.body);assert.equal(body.author_id,'user-123');assert.equal(body.title,'실제 제목');assert.deepEqual(body.tags,['USDT','BTC']);assert.match(f.node('writeerror').textContent,/권한/);assert.equal(f.node('dialog').open,true);assert.equal(f.node('writesubmit').disabled,false);
});

test('successful DB post submission reloads feed and opens the saved post',async()=>{
  const id='00000000-0000-0000-0000-000000000001';
  const f=fixture(async(url,options)=>{if(options.method==='POST')return Response.json([{id}]);if(String(url).includes('comments?'))return Response.json([]);return Response.json([{id,title:'저장된 제목',body:'저장된 본문',category:'자유',author_id:'user-123',created_at:'2026-10-17T08:00:00Z',profiles:{nickname:'작성자'},comments:[{count:0}]}],{headers:{'content-range':'0-0/1'}})});configure(f);f.run('writePost()');await f.node('writeform').onsubmit({preventDefault(){},target:{category:'자유',tags:'btc',title:'저장된 제목',body:'저장된 본문'}});await new Promise(r=>setImmediate(r));assert.match(f.node('posts').innerHTML,/저장된 제목/);assert.match(f.node('modalcontent').innerHTML,/저장된 본문/);
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

test('spot market pagination reaches every coin and clamps after refreshed or filtered results shrink',async()=>{
 let rows=Array.from({length:12},(_,i)=>({...market.coins[0],symbol:'T'+i,market:'KRW-T'+i,name:'검사코인'+i,volume24h:100-i}));
 const f=fixture(async()=>Response.json({...market,coins:rows}));await f.run("loadMarket('upbit')");assert.equal((f.node('coins').innerHTML.match(/<tr>/g)||[]).length,5);assert.match(f.node('marketpagination').innerHTML,/1–5 \/ 총 12개/);
 f.run('goMarketPage(1)');assert.match(f.node('coins').innerHTML,/<td class="rank">6<\/td>/);assert.doesNotMatch(f.node('coins').innerHTML,/>T0</);await f.run("loadMarket('upbit')");assert.equal(f.run('marketPage'),1);
 f.run('goMarketPage(2)');assert.equal((f.node('coins').innerHTML.match(/<tr>/g)||[]).length,2);assert.match(f.node('marketpagination').innerHTML,/11–12 \/ 총 12개/);
 rows=rows.slice(0,7);await f.run("loadMarket('upbit')");assert.equal(f.run('marketPage'),1);assert.match(f.node('marketpagination').innerHTML,/6–7 \/ 총 7개/);
 f.run("query='검사코인0';renderCoins()");assert.equal(f.run('marketPage'),0);assert.match(f.node('marketpagination').innerHTML,/1–1 \/ 총 1개/);f.run("query='없는코인';renderCoins()");assert.equal(f.node('marketpagination').innerHTML,'');
});

test('currency conversion changes both displayed prices and turnover without mutating source quotes',async()=>{
 const f=fixture(async()=>Response.json(market));await f.run("loadMarket('upbit')");assert.equal(f.run("marketValue(coins[0],'price')"),100/1400);assert.match(f.node('coins').innerHTML,/0.07142857 USDT/);await f.run('toggleMarketCurrency()');assert.match(f.node('coins').innerHTML,/₩100/);assert.equal(f.run('coins[0].price'),100);assert.equal(f.run('displayCurrency'),'KRW');assert.equal(f.data.get('altmoa-display-currency'),'"KRW"');
 f.run("displayCurrency='USDT';conversion=null;renderCoins()");assert.match(f.node('coins').innerHTML,/<td>—<\/td>/);assert.match(f.node('marketfxnote').textContent,/확인할 수 없어/);
});
test('sorting toggles volume and signed price change in both directions',()=>{
 const f=fixture(async()=>Response.json({}));f.run("coins=[{symbol:'A',name:'A',price:1,change:-3,volume24h:100},{symbol:'B',name:'B',price:1,change:5,volume24h:2}];setMarketSort('volume')");assert.equal(f.run('sortDirection'),'asc');assert.ok(f.node('coins').innerHTML.indexOf('>B<')<f.node('coins').innerHTML.indexOf('>A<'));f.run("setMarketSort('change');setMarketSort('change')");assert.equal(f.run('sortDirection'),'asc');assert.ok(f.node('coins').innerHTML.indexOf('>A<')<f.node('coins').innerHTML.indexOf('>B<'));
});
test('my activity queries only the signed-in author and computes grade from exact counts',async()=>{
 const urls=[];const f=fixture(async url=>{urls.push(new URL(url));const comment=String(url).includes('/comments?');return Response.json(comment?[{id:'c',body:'내 댓글',post_id:'p',created_at:'2026-10-17',posts:{title:'원글',category:'질문'}}]:[{id:'p',title:'내 글',category:'분석',created_at:'2026-10-17'}],{headers:{'content-range':comment?'0-0/3':'0-0/4'}})});configure(f);await f.run('loadMyActivity()');assert.ok(urls.every(url=>url.searchParams.get('author_id')==='eq.user-123'));assert.match(f.node('activitystats').innerHTML,/23점/);assert.match(f.node('activitystats').innerHTML,/참여자/);assert.match(f.node('activityitems').innerHTML,/내 글/);f.run("activityTab='comments'");await f.run('loadMyActivity()');assert.match(f.node('activityitems').innerHTML,/내 댓글/);assert.match(f.node('activityitems').innerHTML,/원글/);assert.equal(f.run('memberLevel(0,0).name'),'새싹');assert.equal(f.run('memberLevel(200,0).name'),'레전드');
});

test('post tags are mandatory, normalized and deduplicated before any write',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json([])});configure(f);f.run('writePost()');await f.node('writeform').onsubmit({preventDefault(){},target:{category:'자유',tags:'  ',title:'태그 검사',body:'필수 태그 검사'}});assert.equal(calls,0);assert.match(f.node('writeerror').textContent,/태그/);assert.deepEqual(Array.from(f.run("parseTags('#usdt btc,USDT 한글')")),['USDT','BTC','한글']);assert.throws(()=>f.run("parseTags('<script>')"));
});

test('missing post feature columns explain the required migration and retain the composer',async()=>{
 const f=fixture(async()=>Response.json({code:'PGRST204',message:"Could not find the 'images' column of 'posts' in the schema cache"},{status:400}));configure(f);f.run('writePost()');await f.node('writeform').onsubmit({preventDefault(){},target:{category:'자유',tags:'btc',title:'입력 유지 검사',body:'본문 유지 검사'}});assert.match(f.node('writeerror').textContent,/upgrade-community.sql/);assert.equal(f.node('dialog').open,true);assert.equal(f.node('writesubmit').disabled,false);
});

test('post lists, popular lists, details and comments explicitly select the author relationship',async()=>{
 const requests=[];const f=fixture(async url=>{const u=new URL(url);requests.push(u);const select=u.searchParams.get('select')||'';if(select.includes('profiles(nickname)'))return Response.json({code:'PGRST201',message:'More than one relationship'},{status:300});if(u.pathname.endsWith('/posts')&&select.startsWith('*'))return Response.json([{id:'00000000-0000-0000-0000-000000000001',title:'작성자 관계 검사',body:'추천자와 작성자는 별개입니다.',category:'분석',author_id:'user-123',created_at:new Date().toISOString(),profiles:{nickname:'작성자'}}]);return Response.json([]);});configure(f);await f.run('loadPosts()');await f.run('loadPopular()');await f.run("openPost('00000000-0000-0000-0000-000000000001')");
 const authorQueries=requests.filter(u=>u.searchParams.get('select')?.includes('profiles'));
 assert.ok(authorQueries.length>=8);for(const u of authorQueries)assert.match(u.searchParams.get('select'),u.pathname.endsWith('/comments')?/profiles!comments_author_id_fkey\(nickname\)/:/profiles!posts_author_id_fkey\(nickname\)/);assert.match(f.node('modalcontent').innerHTML,/작성자 관계 검사/);
});
