import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/init\(\);\s*$/, '');
function fixture(handler) {
  const nodes = new Map(), data = new Map();
  const storage = { getItem:k=>data.get(k)||null, setItem:(k,v)=>data.set(k,v) };
  const element = id => { if (!nodes.has(id)) nodes.set(id,{id,textContent:'',innerHTML:'',value:'',style:{},isConnected:true,disabled:false,classList:{toggle(){},contains(){return false},add(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},scrollIntoView(){},insertAdjacentHTML(_,html){this.innerHTML+=html}});return nodes.get(id); };
  const context = vm.createContext({ document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},body:{classList:{toggle(){},contains(){return false},add(){}}}}, window:{scrollTo(){}}, localStorage:storage,sessionStorage:storage,setTimeout:()=>1,clearTimeout(){},setInterval(){},URLSearchParams,AbortSignal,location:{origin:'https://altmoa.example',pathname:'/',search:'',hash:''},history:{replaceState(){}},fetch:handler,FormData:class{constructor(fields){this.fields=fields}get(k){return this.fields[k]}} });
  vm.runInContext(code,context);
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
