'use strict';
function interestStorageKey(){return 'altmoa-auto-interest-v1:'+(session?.user?.id||'guest');}
function readInterestState(){const s=read(interestStorageKey(),{});return {enabled:s?.enabled!==false,syncedAt:Number(s?.syncedAt)||0,signals:Array.isArray(s?.signals)?s.signals.filter(x=>x&&Array.isArray(x.symbols)&&Number.isFinite(x.at)&&x.at>Date.now()-30*86400000).slice(-300):[],blocked:Array.isArray(s?.blocked)?s.blocked.filter(x=>typeof x==='string').slice(-200):[]};}
function interestCoinIndex(){
 const logo=globalThis.ALTMOA_LOGOS||{},names=new Map();
 for(const a of Object.values(logo.assets||{}))if(/^[A-Z0-9]{1,20}$/.test(a.symbol))names.set(a.symbol,[a.name]);
 for(const [symbol,a]of Object.entries(logo.korean||{}))if(/^[A-Z0-9]{1,20}$/.test(symbol))names.set(symbol,[...(names.get(symbol)||[]),a.name]);
 for(const [symbol,name]of [['BTC','비트코인'],['ETH','이더리움'],['SOL','솔라나'],['SUI','수이'],['XRP','리플'],['DOGE','도지코인'],['USDT','테더']])names.set(symbol,[...(names.get(symbol)||[]),name]);
 return names;
}
function interestSymbols(post,kind){
 const index=interestCoinIndex(),result=new Set(),normalize=s=>String(s||'').normalize('NFKC').replace(/^#+/,'').replace(/\s/g,'').toLowerCase();
 const aliases=new Map();for(const[symbol,names]of index){aliases.set(normalize(symbol),symbol);for(const name of names)if(name)aliases.set(normalize(name),symbol);}
 for(const tag of [...(Array.isArray(post.tags)?post.tags:[]),post.coin||'']){const s=aliases.get(normalize(tag));if(s)result.add(s);}
 if(kind==='write'){
  let text=(String(post.title||'')+' '+String(post.body||'')).slice(0,2500).normalize('NFKC');
  const korean=[...index].flatMap(([s,names])=>names.filter(n=>/[가-힣]/.test(n||'')&&n.length>=2).map(n=>({s,n}))).sort((a,b)=>b.n.length-a.n.length);
  for(const {s,n}of korean)if(text.includes(n)){result.add(s);text=text.split(n).join(' ');}
  for(const symbol of index.keys()){if(symbol.length<3&&!['OP'].includes(symbol))continue;const major=['BTC','ETH','SOL','XRP','SUI','USDT'].includes(symbol);if(new RegExp('(^|[^A-Za-z0-9])'+symbol+'([^A-Za-z0-9]|$)',major?'i':'').test(text))result.add(symbol);}
 }
 return [...result].slice(0,10);
}
function recordCoinInterest(post,kind='read'){
 if(!post?.id)return;const state=readInterestState();if(!state.enabled)return;
 const symbols=interestSymbols(post,kind);if(!symbols.length||state.signals.some(x=>x.postId===post.id&&x.kind===kind))return;
 const at=kind==='write'&&Number.isFinite(Date.parse(post.created_at))?Date.parse(post.created_at):Date.now();if(at<Date.now()-30*86400000)return;state.signals.push({postId:post.id,kind,symbols,at});state.signals=state.signals.slice(-300);store(interestStorageKey(),state);
}
function automaticInterestCoins(){
 const state=readInterestState();if(!state.enabled)return [];const map=new Map();
 for(const event of state.signals){if(event.kind==='read'&&event.at<Date.now()-14*86400000)continue;
 for(const symbol of event.symbols){if(!/^[A-Z0-9]{1,20}$/.test(symbol)||state.blocked.includes(symbol))continue;const row=map.get(symbol)||{symbol,score:0,reads:0,writes:0};row.score+=event.kind==='write'?4:1;row[event.kind==='write'?'writes':'reads']++;map.set(symbol,row);}}
 return [...map.values()].filter(x=>x.writes>0||x.reads>=3).sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol)).slice(0,20);
}
function isAutomaticFavorite(symbol){return automaticInterestCoins().some(c=>c.symbol===symbol);}
function setInterestBlocked(symbol,blocked){const state=readInterestState();state.blocked=state.blocked.filter(s=>s!==symbol);if(blocked)state.blocked.push(symbol);store(interestStorageKey(),state);}
function favoriteSymbol(key){return String(key).split(':').pop().replace(/^(KRW-|USDT-)/,'').replace(/-?USDT$/,'');}
function activityInterestItems(){const rows=new Map();for(const key of favorites){const symbol=favoriteSymbol(key);if(/^[A-Z0-9]{1,20}$/.test(symbol))rows.set(symbol,{symbol,manual:true});}for(const row of automaticInterestCoins())rows.set(row.symbol,{...row,...(rows.get(row.symbol)||{})});return [...rows.values()];}
function removeInterestCoin(symbol){favorites=favorites.filter(k=>favoriteSymbol(k)!==symbol);store('altmoa-stars',favorites);setInterestBlocked(symbol,true);renderActivityFavorites();}
function toggleAutomaticInterest(){const state=readInterestState();state.enabled=!state.enabled;store(interestStorageKey(),state);renderActivityFavorites();}
let interestEpoch=0;
function clearAutomaticInterest(){interestEpoch++;const state=readInterestState();state.syncedAt=Date.now();state.signals=[];store(interestStorageKey(),state);renderActivityFavorites();}

let writtenInterestSync=null;
async function syncWrittenInterests(){
 const user=session?.user?.id,state=readInterestState(),epoch=interestEpoch;if(!user||!state.enabled||!config?.communityReady||Date.now()-state.syncedAt<3600000)return;
 if(writtenInterestSync)return writtenInterestSync;
 writtenInterestSync=(async()=>{try{const {data}=await db('posts?'+new URLSearchParams({select:'id,tags,title,body,created_at',author_id:'eq.'+user,status:'eq.published',created_at:'gte.'+new Date(Date.now()-30*86400000).toISOString(),order:'created_at.desc',limit:'50'}));if(session?.user?.id!==user||interestEpoch!==epoch)return;for(const post of data||[])recordCoinInterest(post,'write');const latest=readInterestState();latest.syncedAt=Date.now();store(interestStorageKey(),latest);}catch{}finally{writtenInterestSync=null;}})();return writtenInterestSync;
}

function observeCoinInterest(post,request){
 const viewer=session?.user?.id||'guest';
 if(session?.user?.id===post.author_id){recordCoinInterest(post,'write');return;}
 let visible=!document.hidden;const visibility=()=>{if(document.hidden)visible=false;};document.addEventListener('visibilitychange',visibility);
 setTimeout(()=>{document.removeEventListener?.('visibilitychange',visibility);if(visible&&!document.hidden&&activePostId===post.id&&postPageRequest===request&&(session?.user?.id||'guest')===viewer)recordCoinInterest(post,'read');},8000);
}
