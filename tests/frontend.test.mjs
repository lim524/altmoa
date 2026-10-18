import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const composerCode=fs.readFileSync(new URL('../dist/composer.js',import.meta.url),'utf8');
const autoInterestCode=fs.readFileSync(new URL('../dist/auto-interest.js',import.meta.url),'utf8');
const activityCode=fs.readFileSync(new URL('../dist/activity.js',import.meta.url),'utf8');
const marketActivityCode=fs.readFileSync(new URL('../dist/market-activity.js',import.meta.url),'utf8');
const communityCode=fs.readFileSync(new URL('../dist/community.js',import.meta.url),'utf8');
const code = fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/init\(\);\s*$/, '');
function fixture(handler) {
  const nodes = new Map(), data = new Map();
  const storage = { getItem:k=>data.get(k)||null, setItem:(k,v)=>data.set(k,v) };
  const element = id => { if (!nodes.has(id)) nodes.set(id,{id,textContent:'',innerHTML:'',value:'',style:{},isConnected:true,disabled:false,classList:{toggle(){},contains(){return false},add(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},scrollIntoView(){},setAttribute(){},insertAdjacentHTML(_,html){this.innerHTML+=html}});return nodes.get(id); };
  const views=[['homepage','home'],['boardpanel','board'],['marketpanel','market'],['rankpanel','rank'],['postpage','post'],['writepage','write']].map(([id,view])=>Object.assign(element(id),{dataset:{view},hidden:view!=='home'}));
  const context = vm.createContext({ document:{getElementById:element,querySelectorAll:selector=>selector==='[data-view]'?views:selector==='[data-poll-option]'?[...nodes.values()].filter(n=>n.dataset?.pollOption!==undefined):[],addEventListener(){},body:{dataset:{},classList:{toggle(){},contains(){return false},add(){}}}}, window:{scrollTo(){}}, localStorage:storage,sessionStorage:storage,setTimeout:()=>1,clearTimeout(){},clearInterval(){},setInterval(){},URL,URLSearchParams,AbortSignal,location:{origin:'https://altmoa.example',pathname:'/',search:'',hash:''},history:{replaceState(){},pushState(state,title,path){this.lastPath=path}},fetch:(url,options)=>String(url)==='/api/conversion'?Promise.resolve(Response.json({rate:1400,source:'업비트 USDT/KRW',fetchedAt:new Date().toISOString()})):handler(url,options),FormData:class{constructor(fields){this.fields=fields}get(k){return this.fields[k]}} });
  vm.runInContext(composerCode+'\n'+autoInterestCode+'\n'+activityCode+'\n'+marketActivityCode+'\n'+communityCode+'\n'+code,context);
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
  await f.run("loadMarket('upbit')");assert.match(f.node('coins').innerHTML,/수이/);fail=true;await f.run("loadMarket('upbit',{force:true})");assert.match(f.node('markettime').textContent,/이전 데이터/);assert.match(f.node('ticker').innerHTML,/갱신 지연/);
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
  const body=JSON.parse(requests[0].options.body);assert.equal(body.author_id,'user-123');assert.equal(body.title,'실제 제목');assert.deepEqual(body.tags,['USDT','BTC']);assert.match(f.node('writeerror').textContent,/권한/);assert.equal(f.node('writepage').hidden,false);assert.equal(f.node('dialog').open===true,false);assert.equal(f.node('writesubmit').disabled,false);
});

test('successful DB post submission reloads feed and opens the saved post',async()=>{
  const id='00000000-0000-0000-0000-000000000001';
  const f=fixture(async(url,options)=>{if(options.method==='POST')return Response.json([{id}]);if(String(url).includes('comments?'))return Response.json([]);return Response.json([{id,title:'저장된 제목',body:'저장된 본문',category:'자유',author_id:'user-123',created_at:'2026-10-17T08:00:00Z',profiles:{nickname:'작성자'},comments:[{count:0}]}],{headers:{'content-range':'0-0/1'}})});configure(f);f.run('writePost()');await f.node('writeform').onsubmit({preventDefault(){},target:{category:'자유',tags:'btc',title:'저장된 제목',body:'저장된 본문'}});await new Promise(r=>setImmediate(r));assert.match(f.node('posts').innerHTML,/저장된 제목/);assert.match(f.node('postpagecontent').innerHTML,/저장된 본문/);
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

test('home lists query each board by creation time and include posts without recommendations',async()=>{
 const requests=[];const f=fixture(async url=>{requests.push(new URL(url));return Response.json([{id:'00000000-0000-0000-0000-000000000001',title:'<svg onload=alert(1)>추천 글',category:'분석',recommendation_count:12,profiles:{nickname:'회원'},comments:[{count:99}]}]);});configure(f);await f.run('loadPopular()');
 assert.equal(requests.length,5);assert.deepEqual(requests.map(u=>u.searchParams.get('category')),[null,'eq.자유','eq.분석','eq.소식','eq.질문']);for(const u of requests){assert.equal(u.searchParams.get('order'),'created_at.desc,id.desc');assert.equal(u.searchParams.has('recommendation_count'),false);assert.equal(u.searchParams.get('limit'),'5');assert.equal(u.searchParams.has('offset'),false);}
 assert.match(f.node('popularall').innerHTML,/class="cell-votes"><b>12/);assert.doesNotMatch(f.node('popularall').innerHTML,/<svg/);
});
test('home latest lists remain usable when recommendation counts are unavailable',async()=>{
 const f=fixture(async url=>new URL(url).searchParams.get('select')?.includes('recommendation_count')?Response.json({message:'column posts.recommendation_count does not exist'},{status:400}):Response.json([{id:'00000000-0000-0000-0000-000000000001',title:'실제 최신 글',category:'자유',created_at:'2026-10-17T08:00:00Z'}]));configure(f);await f.run('loadPopular()');assert.match(f.node('popularall').innerHTML,/실제 최신 글/);assert.doesNotMatch(f.node('popularall').innerHTML,/NaN/);await f.run('loadPosts()');assert.match(f.node('posts').innerHTML,/실제 최신 글/);
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
 rows=rows.slice(0,7);await f.run("loadMarket('upbit',{force:true})");assert.equal(f.run('marketPage'),1);assert.match(f.node('marketpagination').innerHTML,/6–7 \/ 총 7개/);
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
 const urls=[];const f=fixture(async url=>{urls.push(new URL(url));const comment=String(url).includes('/comments?');return Response.json(comment?[{id:'c',body:'내 댓글',post_id:'p',created_at:'2026-10-17',posts:{title:'원글',category:'질문'}}]:[{id:'p',title:'내 글',category:'분석',created_at:'2026-10-17'}],{headers:{'content-range':comment?'0-0/3':'0-0/4'}})});configure(f);await f.run('loadMyActivity()');assert.ok(urls.filter(url=>!url.pathname.endsWith('/profiles')).every(url=>url.searchParams.get('author_id')==='eq.user-123'));assert.match(f.node('activitystats').innerHTML,/23점/);assert.match(f.node('activitystats').innerHTML,/참여자/);assert.match(f.node('activityitems').innerHTML,/내 글/);f.run("activityTab='comments'");await f.run('loadMyActivity()');assert.match(f.node('activityitems').innerHTML,/내 댓글/);assert.match(f.node('activityitems').innerHTML,/원글/);assert.equal(f.run('memberLevel(0,0).name'),'새싹');assert.equal(f.run('memberLevel(200,0).name'),'레전드');
});

test('post tags are mandatory, normalized and deduplicated before any write',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json([])});configure(f);f.run('writePost()');await f.node('writeform').onsubmit({preventDefault(){},target:{category:'자유',tags:'  ',title:'태그 검사',body:'필수 태그 검사'}});assert.equal(calls,0);assert.match(f.node('writeerror').textContent,/태그/);assert.deepEqual(Array.from(f.run("parseTags('#usdt btc,USDT 한글')")),['USDT','BTC','한글']);assert.throws(()=>f.run("parseTags('<script>')"));
});

test('missing post feature columns explain the required migration and retain the composer',async()=>{
 const f=fixture(async()=>Response.json({code:'PGRST204',message:"Could not find the 'images' column of 'posts' in the schema cache"},{status:400}));configure(f);f.run('writePost()');await f.node('writeform').onsubmit({preventDefault(){},target:{category:'자유',tags:'btc',title:'입력 유지 검사',body:'본문 유지 검사'}});assert.match(f.node('writeerror').textContent,/upgrade-community.sql/);assert.equal(f.node('writepage').hidden,false);assert.equal(f.node('dialog').open===true,false);assert.equal(f.node('writesubmit').disabled,false);
});

test('post lists, popular lists, details and comments explicitly select the author relationship',async()=>{
 const requests=[];const f=fixture(async url=>{const u=new URL(url);requests.push(u);const select=u.searchParams.get('select')||'';if(select.includes('profiles(nickname)'))return Response.json({code:'PGRST201',message:'More than one relationship'},{status:300});if(u.pathname.endsWith('/posts')&&select.startsWith('*'))return Response.json([{id:'00000000-0000-0000-0000-000000000001',title:'작성자 관계 검사',body:'추천자와 작성자는 별개입니다.',category:'분석',author_id:'user-123',created_at:new Date().toISOString(),profiles:{nickname:'작성자'}}]);return Response.json([]);});configure(f);await f.run('loadPosts()');await f.run('loadPopular()');await f.run("openPost('00000000-0000-0000-0000-000000000001')");
 const authorQueries=requests.filter(u=>u.searchParams.get('select')?.includes('profiles'));
 assert.ok(authorQueries.length>=8);for(const u of authorQueries)assert.match(u.searchParams.get('select'),u.pathname.endsWith('/comments')?/profiles!comments_author_id_fkey\(nickname\)/:/profiles!posts_author_id_fkey\(nickname\)/);assert.match(f.node('postpagecontent').innerHTML,/작성자 관계 검사/);
});

test('post cooldown and an in-flight submission prevent extra writes before reaching the database',async()=>{
 let calls=0,complete;const f=fixture(async()=>{calls++;return new Promise(resolve=>complete=resolve)});configure(f);f.run('writePost()');const event={preventDefault(){},target:{category:'자유',tags:'btc',title:'반복 요청 검사',body:'중복 요청을 보내지 않습니다.'}};
 f.run('rememberPostCooldown()');await f.node('writeform').onsubmit(event);assert.equal(calls,0);assert.match(f.node('writesubmit').textContent,/초 후/);f.run("store('altmoa-post-cooldown:user-123',0)");const first=f.node('writeform').onsubmit(event);await new Promise(resolve=>setImmediate(resolve));await f.node('writeform').onsubmit(event);assert.equal(calls,1);complete(Response.json({message:'게시글은 60초에 한 번 작성할 수 있습니다.'},{status:400}));await first;await f.node('writeform').onsubmit(event);assert.equal(calls,1);assert.equal(f.node('writesubmit').disabled,true);
});

test('post and composer have dedicated shareable pages and dialogs do not invalidate the post',async()=>{
 const id='00000000-0000-0000-0000-000000000001';const f=fixture(async url=>Response.json(String(url).includes('select=*')?[{id,title:'독립 화면',body:'본문',author_id:'other',category:'자유'}]:[]));configure(f);
 await f.run(`openPost('${id}')`);assert.equal(f.run('activeView'),'post');assert.equal(f.node('postpage').hidden,false);assert.equal(f.node('boardpanel').hidden,true);assert.notEqual(f.node('dialog').open,true);assert.match(f.run('history.lastPath'),/view=post&post=/);
 f.run("info('안내','본문 위 안내')");assert.equal(f.run('activePostId'),id);assert.match(f.node('postpagecontent').innerHTML,/독립 화면/);
 f.run('writePost()');assert.equal(f.run('activeView'),'write');assert.equal(f.node('postpage').hidden,true);assert.match(f.run('history.lastPath'),/view=write/);assert.notEqual(f.node('dialog').open,true);
 f.run(`location.search='?view=post&post=${id}';restoreCommunityRoute()`);await new Promise(r=>setImmediate(r));assert.equal(f.run('activePostId'),id);assert.equal(f.run('activeView'),'post');
});

test('invalid IDs and content targets never make data requests; non-moderators cannot request hiding',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json([])});configure(f);
 await f.run("openPost('not-a-uuid&status=eq.hidden')");f.run("deleteItem('profiles','00000000-0000-0000-0000-000000000001')");f.run("reportItem('posts','malformed')");await f.run("hideItem('posts','00000000-0000-0000-0000-000000000001')");
 // An invalid post falls back to the board, whose ordinary list read is allowed.
 assert.equal(calls,1);assert.equal(f.run('activePostId'),null);
});

test('whitespace, oversized text and forged boards are rejected before uploading or posting',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json([])});configure(f);f.run('writePost()');
 for(const target of [{category:'관리자',title:'제목',body:'본문'},{category:'자유',title:'  ',body:'본문'},{category:'자유',title:'제목',body:'x'.repeat(10001)}])await f.node('writeform').onsubmit({preventDefault(){},target:{tags:'btc',...target}});
 assert.equal(calls,0);assert.match(f.node('writeerror').textContent,/제목/);assert.equal(f.node('writesubmit').disabled,false);
});

test('late post responses cannot replace a newer page or reopen a dialog',async()=>{
 const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';let resolveA;
 const f=fixture(async url=>{const u=new URL(url);if(u.searchParams.get('select')?.startsWith('*')){if(u.searchParams.get('id')==='eq.'+a)return new Promise(resolve=>resolveA=resolve);return Response.json([{id:b,title:'다음 글',body:'새 본문',author_id:'other',category:'자유'}]);}return Response.json([])});configure(f);
 const pending=f.run(`openPost('${a}')`);await f.run(`openPost('${b}')`);resolveA(Response.json([{id:a,title:'늦은 글',body:'이전 본문',category:'자유'}]));await pending;
 assert.match(f.node('postpagecontent').innerHTML,/새 본문/);assert.doesNotMatch(f.node('postpagecontent').innerHTML,/이전 본문/);assert.notEqual(f.node('dialog').open,true);
});

test('comment and report in-flight guards reject repeated submissions',async()=>{
 const id='00000000-0000-0000-0000-000000000001';let writes=0,complete;
 const f=fixture(async(url,options)=>{if(String(url).includes('/api/post-view'))return Response.json({view_count:1,ai_view_count:0});if(options.method==='POST'){writes++;return new Promise(resolve=>complete=resolve);}return Response.json(new URL(url).searchParams.get('select')?.startsWith('*')?[{id,title:'댓글 검사',body:'본문',category:'자유',author_id:'other'}]:[])});configure(f);await f.run(`openPost('${id}')`);
 const submit=f.node('commentform').onsubmit,event={preventDefault(){},target:{body:'반복 댓글'}};const first=submit(event);await new Promise(r=>setImmediate(r));await submit(event);assert.equal(writes,1);complete(new Response(null,{status:201}));await first;
 f.run(`reportItem('posts','${id}')`);const report=f.node('reportform').onsubmit,reportEvent={preventDefault(){},target:{reason:'반복 신고 검사'}};const next=report(reportEvent);await new Promise(r=>setImmediate(r));await report(reportEvent);assert.equal(writes,2);complete(new Response(null,{status:201}));await next;
});

test('a zero-row deletion never claims success and account changes abort an unsent post',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json([])});configure(f);f.run("deleteItem('posts','00000000-0000-0000-0000-000000000001')");await f.node('confirmdelete').onclick({target:f.node('confirmdelete')});assert.equal(calls,1);assert.doesNotMatch(f.node('toast').textContent,/삭제했어요/);assert.match(f.node('deleteerror').textContent,/권한|요청/);
 f.run('writePost();uploadComposerImages=async()=>{setSession(null);return []}');await f.node('writeform').onsubmit({preventDefault(){},target:{category:'자유',tags:'btc',title:'계정 검사',body:'변경된 계정으로 저장 금지'}});assert.equal(calls,1);assert.match(f.node('writeerror').textContent,/계정/);
});

test('photo processing is discarded after leaving the composer',async()=>{
 const f=fixture(async()=>Response.json([]));configure(f);f.run('writePost();preparePhoto=()=>new Promise(resolve=>globalThis.finishPhoto=resolve)');const pending=f.run("selectPhotos([{type:'image/jpeg'}])");f.run("navigate('board')");f.run("finishPhoto({size:100})");await pending;assert.equal(f.run('composerImages.length'),0);assert.equal(f.run('activeView'),'board');f.run('removeComposerImage(-1)');
});


test('rapid clicks on different poll options send only one vote',async()=>{
 const id='00000000-0000-0000-0000-000000000001';let calls=0,complete;const f=fixture(async(url,options)=>{if(String(url).endsWith('/poll_votes')){calls++;return new Promise(resolve=>complete=resolve);}return Response.json([])});configure(f);f.node('poll0').dataset={pollOption:'0'};f.node('poll1').dataset={pollOption:'1'};f.run(`activePostId='${id}';activeView='post'`);await f.run(`loadPoll({id:'${id}',poll_question:'어떤 선택?',poll_options:['첫째','둘째']})`);
 const first=f.node('poll0').onclick();await new Promise(r=>setImmediate(r));await f.node('poll1').onclick();assert.equal(calls,1);assert.equal(f.node('poll1').disabled,true);complete(new Response(null,{status:201}));await first;
});

test('comment threads preserve reply parents, escape content and tolerate missing parents',()=>{
 const f=fixture(async()=>Response.json([]));configure(f);
 const html=f.run(`renderCommentThread([{id:'child',author_id:'other',parent_comment_id:'root',body:'<img src=x>',profiles:{nickname:'<svg>'}},{id:'root',author_id:'other',body:'원댓글'},{id:'orphan',parent_comment_id:'deleted',body:'남은 답글'}],'post')`);
 assert.ok(html.indexOf('원댓글')<html.indexOf('&lt;img'));assert.doesNotMatch(html,/<img|<svg/);assert.match(html,/comment-reply/);assert.match(html,/원댓글이 삭제/);assert.match(html,/replyToComment/);
});

test('human reply submission includes selected parent and clears reply mode only after saving',async()=>{
 const id='00000000-0000-0000-0000-000000000001',parent='00000000-0000-0000-0000-000000000002';let sent;
 const f=fixture(async(url,options)=>{if(options.method==='POST'){sent=JSON.parse(options.body);return new Response(null,{status:201});}const u=new URL(url);return Response.json(u.searchParams.get('select')?.startsWith('*')?[{id,title:'대댓글 검사',body:'본문',category:'자유',author_id:'other'}]:u.pathname.endsWith('/comments')?[{id:parent,body:'원댓글',author_id:'other',profiles:{nickname:'작성자'}}]:[])});configure(f);await f.run(`openPost('${id}')`);f.run(`replyToComment('${parent}')`);assert.equal(f.node('replytarget').hidden,false);await f.node('commentform').onsubmit({preventDefault(){},target:{body:'사람이 작성한 답글'}});assert.equal(sent.parent_comment_id,parent);assert.equal(f.run('replyTargetId'),null);
});

test('only moderators can edit posts and saving preserves the target with bounded input',async()=>{
 const id='00000000-0000-0000-0000-000000000001';let calls=0,sent;
 const f=fixture(async(url,options)=>{calls++;if(String(url).includes('moderator_edit_post')){sent=JSON.parse(options.body);return Response.json(id);}return Response.json([{id,title:'원래 제목',body:'원래 본문'}])});configure(f);
 await f.run(`editPost('${id}')`);assert.equal(calls,0);
 f.run(`moderator=true;activePostId='${id}'`);await f.run(`editPost('${id}')`);assert.match(f.node('modalcontent').innerHTML,/운영자 글 수정/);
 await f.node('editpostform').onsubmit({preventDefault(){},target:{title:' ',body:'본문'}});assert.equal(sent,undefined);
 f.run('openPost=async()=>{};loadPosts=()=>{};loadAttention=()=>{}');
 await f.node('editpostform').onsubmit({preventDefault(){},target:{title:'수정 제목',body:'수정한 본문입니다'}});
 assert.equal(sent.p_id,id);assert.equal(sent.p_title,'수정 제목');assert.equal(sent.p_body,'수정한 본문입니다');assert.equal(Object.keys(sent).length,3);
});

test('member profiles render private responses without requesting author history directly',async()=>{
 const id='00000000-0000-0000-0000-000000000001';const calls=[];
 const f=fixture(async(url,options)=>{calls.push(String(url));return Response.json({id,nickname:'<svg>회원',is_ai:false,can_view:false,activity_public:false})});configure(f);await f.run(`openMemberProfile('${id}')`);await new Promise(r=>setImmediate(r));
 assert.equal(f.run('activeView'),'member');assert.match(f.node('membercontent').innerHTML,/비공개/);assert.doesNotMatch(f.node('membercontent').innerHTML,/<svg>/);assert.equal(calls.length,1);assert.match(calls[0],/rpc\/member_profile/);assert.match(f.run('history.lastPath'),/view=member/);
});

test('nickname links are escaped and invalid profile identifiers never fetch',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json(null)});configure(f);
 f.run("openMemberProfile('invalid')");assert.equal(calls,0);
 const html=f.run("memberLink('00000000-0000-0000-0000-000000000001','<img src=x>')");assert.match(html,/view=member/);assert.doesNotMatch(html,/<img/);
});

test('operator badge comes from server role metadata and includes a shield label',()=>{
 const f=fixture(async()=>Response.json([]));configure(f);
 assert.match(f.run("badgeHTML({is_operator:true,post_count:0,comment_count:0})"),/operator-badge/);
 assert.match(f.run("badgeHTML({is_operator:true})"),/운영자/);
 assert.doesNotMatch(f.run("badgeHTML({is_operator:false,is_ai:false,post_count:0,comment_count:0})"),/operator-badge/);
});

test('signing out discards a late owner-only profile response',async()=>{
 const id='00000000-0000-0000-0000-000000000001';let finish,calls=0;
 const f=fixture(async()=>{calls++;if(calls===1)return new Promise(resolve=>finish=resolve);return Response.json({id,nickname:'회원',can_view:false,activity_public:false})});configure(f);f.run(`session.user.id='${id}';openMemberProfile('${id}')`);await new Promise(r=>setImmediate(r));
 f.run('setSession(null)');await new Promise(r=>setImmediate(r));finish(Response.json({id,nickname:'회원',can_view:true,activity_public:false,post_count:1,comment_count:0,items:[{id,title:'소유자 전용 목록',body:'내용'}]}));await new Promise(r=>setImmediate(r));
 assert.match(f.node('membercontent').innerHTML,/비공개/);assert.doesNotMatch(f.node('membercontent').innerHTML,/소유자 전용 목록/);
});

test('ranking timeframe changes discard late snapshots and pagination uses the globally sorted result',async()=>{
 let release;const score={version:'v1',total:80,trend:50,rsi:20,volume:10};
 const item={symbol:'SUI',name:'수이',status:'ready',trend:'up',rsi14:65.2,volumeRatio:2.4,closedAt:'2026-10-17T15:59:59Z',scoring:score};
 const snapshot={status:'ready',interval:'4h',items:Array.from({length:23},(_,i)=>({...item,symbol:'T'+i,scoring:{...score,total:90-i}})),totalUniverse:25,insufficient:1,failed:1,asOf:'2026-10-17T16:00:00Z'};
 const f=fixture(async url=>{const u=new URL(url,'https://altmoa.example');return u.searchParams.get('interval')==='1h'?new Promise(r=>release=r):Response.json(snapshot);});
 f.run("activeView='market';");const first=f.run('loadPageTechnicals()');await f.run("technicalInterval='4h';loadPageTechnicals()");release(Response.json({...snapshot,interval:'1h',items:[]}));await first;
 assert.match(f.node('technicalrows').innerHTML,/>T0</);assert.match(f.node('technicalpagination').innerHTML,/1–10 \/ 23개/);f.run('goTechnicalRankPage(2)');assert.match(f.node('technicalrows').innerHTML,/>T20</);assert.doesNotMatch(f.node('technicalrows').innerHTML,/>T0</);assert.match(f.node('technicalpagination').innerHTML,/21–23 \/ 23개/);
 assert.match(f.node('technicalrankstatus').textContent,/4시간봉/);assert.match(f.node('technicalrankstatus').textContent,/데이터 부족 1개/);
});

test('market refresh is throttled, manual refresh bypasses it and idle/hidden tabs do not poll',async()=>{
 let marketCalls=0;const f=fixture(async()=>{marketCalls++;return Response.json(market)});
 await f.run("loadMarket('upbit')");await f.run("loadMarket('upbit')");assert.equal(marketCalls,1);await f.run("loadMarket('upbit',{force:true})");assert.equal(marketCalls,2);
 f.run("activeView='market';lastInteractionAt=Date.now()-300001;loadPageTechnicals=()=>{};refreshVisiblePage()");assert.equal(marketCalls,2);assert.match(f.node('autorefreshstatus').textContent,/일시정지/);
 f.run("document.hidden=true;lastInteractionAt=Date.now();marketAttemptAt=0;refreshVisiblePage()");assert.equal(marketCalls,2);
 f.run("document.hidden=false;lastInteractionAt=Date.now()-300001;registerInteraction()");await new Promise(r=>setImmediate(r));assert.equal(marketCalls,3);
});
test('attention sidebar and full ranking share one request and five-minute browser cache',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json({status:'ready',items:[]})});
 await Promise.all([f.run('fetchAttention(24)'),f.run('fetchAttention(24)')]);await f.run('fetchAttention(24)');assert.equal(calls,1);await f.run('fetchAttention(24,true)');assert.equal(calls,2);
});

test('market activity coalesces requests, keeps absent scores blank and safely renders live metrics',async()=>{
 let count=0;const data={status:'collecting',count:100,upCount:40,strongCount:60,upPercent:40,strongPercent:60,btcChange:-2,baselineDays:0,parts:{volume:null,breadth:12,strength:18},score:null,asOf:new Date().toISOString(),source:'Binance',history:[]};
 const f=fixture(async()=>{count++;return Response.json(data)});await Promise.all([f.run('loadMarketActivity()'),f.run('loadMarketActivity()')]);assert.equal(count,1);assert.match(f.node('marketactivity').innerHTML,/0\/7개 확보/);assert.doesNotMatch(f.node('activitysummary').innerHTML,/<strong>0/);assert.match(f.node('marketactivity').innerHTML,/40개/);await f.run('loadMarketActivity()');assert.equal(count,1);
 f.run("renderMarketActivity({...activityData,score:72,dayChange:3,status:'ready',parts:{volume:30,breadth:21,strength:21},history:[{at:'2026-10-18T01:00Z',score:71},{at:'2026-10-18T02:00Z',score:72}]})");assert.match(f.node('marketactivity').innerHTML,/72.0/);assert.match(f.node('marketactivity').innerHTML,/\+3.0점/);assert.match(f.node('marketactivity').innerHTML,/<svg/);const path=f.node('marketactivity').innerHTML.match(/class="chart-line" d="([^"]+)"/)[1];assert.equal((path.match(/M/g)||[]).length,2);
});
test('community table uses column headers and independently links authors and posts',()=>{
 const f=fixture(async()=>Response.json([]));const html=f.run(`communityTable([{id:'00000000-0000-0000-0000-000000000001',author_id:'00000000-0000-0000-0000-000000000002',title:'<b>제목</b>',category:'자유',profiles:{nickname:'사용자'},created_at:'2026-10-18T01:00Z',recommendation_count:7,ai_recommendation_count:2,view_count:20}])`);
 assert.match(html,/<table class="community-table/);assert.match(html,/scope="col" class="cell-author">글쓴이/);assert.match(html,/&lt;b&gt;제목/);assert.doesNotMatch(html,/<b>제목/);assert.match(html,/<b>9<\/b>/);assert.doesNotMatch(html,/AI 2/);assert.match(html,/followPost/);assert.match(html,/followMember/);
});

test('price results stop at ten pages and technical reverse sorting stays inside its 100 candidates without requests',()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json({})});
 f.run("coins=Array.from({length:120},(_,i)=>({symbol:'P'+i,name:'코인'+i,price:1,change:i,volume24h:120-i}));renderCoins();goMarketPage(99)");assert.equal(f.run('marketPage'),9);assert.match(f.node('marketpagination').innerHTML,/총 50개/);assert.match(f.node('coins').innerHTML,/>P49</);assert.doesNotMatch(f.node('coins').innerHTML,/>P50</);
 f.run("technicalRankData={interval:'1h',totalUniverse:100,insufficient:0,failed:0,asOf:new Date().toISOString(),items:Array.from({length:120},(_,i)=>({symbol:'R'+i,name:'코인',scoring:{total:100-i/2,trend:30,rsi:20,volume:10},status:'ready',rsi14:60,volumeRatio:1,closedAt:new Date().toISOString()}))};renderTechnicalRanking();goTechnicalRankPage(9)");assert.match(f.node('technicalpagination').innerHTML,/91–100 \/ 100개/);assert.match(f.node('technicalrows').innerHTML,/>R99</);f.run('goTechnicalRankPage(10)');assert.equal(f.run('technicalRankPage'),9);
 f.run("setTechnicalSort('asc')");assert.equal(f.run('technicalRankPage'),0);assert.match(f.node('technicalrows').innerHTML,/>R99</);assert.doesNotMatch(f.node('technicalrows').innerHTML,/>R0</);assert.match(f.node('technicalrankstatus').textContent,/낮은 순/);assert.equal(calls,0);
});
test('activity detail shortcut opens the actual methodology section even when already on the rank page',()=>{
 const f=fixture(async()=>Response.json({status:'collecting',items:[]}));f.run("activeView='rank';activityData={status:'building'};activityAt=Date.now();showActivityDetails()");assert.equal(f.run('activeView'),'rank');assert.equal(f.node('activitymethod').open,true);
});
