// Conservative starter dictionary. Ambiguous tickers require a cashtag/pair or a
// matching Korean coin name; ordinary English words are never bare matches.
export const COINS = [
 ['ETH','이더리움',['이더리움','이더']],['XRP','리플',['리플']],['SOL','솔라나',['솔라나']],['SUI','수이',['수이']],
 ['DOGE','도지코인',['도지코인','도지']],['PEPE','페페',['페페']],['SEI','세이',['세이']],['ONDO','온도파이낸스',['온도파이낸스']],
 ['ADA','에이다',['에이다']],['AVAX','아발란체',['아발란체']],['LINK','체인링크',['체인링크']],['DOT','폴카닷',['폴카닷']],
 ['APT','앱토스',['앱토스']],['ARB','아비트럼',['아비트럼']],['OP','옵티미즘',['옵티미즘']],['NEAR','니어프로토콜',['니어프로토콜']],
 ['ATOM','코스모스',['코스모스코인']],['UNI','유니스왑',['유니스왑']],['AAVE','에이브',['에이브']],['INJ','인젝티브',['인젝티브']],
 ['RENDER','렌더토큰',['렌더토큰','렌더코인']],['FET','페치',['페치코인','페치에이아이']],['ENA','에테나',['에테나']],['WLD','월드코인',['월드코인']],
 ['SHIB','시바이누',['시바이누']],['TRX','트론',['트론']],['BCH','비트코인캐시',['비트코인캐시']],['ETC','이더리움클래식',['이더리움클래식','이클']],
 ['XLM','스텔라루멘',['스텔라루멘']],['HBAR','헤데라',['헤데라']],['W','웜홀',['웜홀']],['GAS','가스',['가스코인']],['MOVE','무브먼트',['무브먼트']]
].map(([symbol,name,aliases])=>({symbol,name,aliases}));
const ambiguous = new Set(['ONDO','OP','NEAR','ATOM','LINK','W','GAS','MOVE']);
export const SOURCE_CATALOG = [
 {id:'dc_chart',name:'디시 차트갤러리',region:'kr',status:'permission_required',policyUrl:'https://nstatic.dcinside.com/dc/w/policy/policy_index.html',note:'사전 서면 동의 확보 전 자동 수집 보류'},
 {id:'dc_bitcoin',name:'디시 비트코인 갤러리',region:'kr',status:'permission_required',policyUrl:'https://nstatic.dcinside.com/dc/w/policy/policy_index.html',note:'사전 서면 동의 확보 전 자동 수집 보류'},
 {id:'coinpan',name:'코인판',region:'kr',status:'permission_required',policyUrl:'https://coinpan.com/index.php?act=dispMemberSignUpForm&mid=index',note:'영리 이용 승낙 확보 전 자동 수집 보류'},
 {id:'x',name:'X',region:'global',status:'api_required',policyUrl:'https://docs.x.com/x-api/posts/search/introduction',note:'API 이용 권한·연결 필요'},
 {id:'reddit',name:'Reddit',region:'global',status:'api_required',policyUrl:'https://redditinc.com/policies/data-api-terms',note:'상업적 이용 조건·API 연결 필요'}
];
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function matchCoins(text, taggedCoin = null) {
 const clean=String(text||'').normalize('NFKC');
 const found=new Set();
 if(COINS.some(c=>c.symbol===taggedCoin))found.add(taggedCoin);
 for(const c of COINS){
  const explicit=new RegExp('(?:\\$'+c.symbol+'(?![A-Za-z0-9_])|\\b'+c.symbol+'(?:USDT|KRW)\\b)','i').test(clean);
  const ticker=!ambiguous.has(c.symbol)&&new RegExp('(?<![A-Za-z0-9_])'+c.symbol+'(?![A-Za-z0-9_])','i').test(clean);
  const alias=c.aliases.some(a=>new RegExp('(?<![가-힣A-Za-z0-9])'+reEscape(a)+'(?=$|[^가-힣A-Za-z0-9]|(?:코인|토큰|은|는|이|가|을|를|의|도|만|에|와|과|랑|로))').test(clean));
  if(explicit||ticker||alias)found.add(c.symbol);
 }
 // Longest Korean coin names win: Ethereum Classic is not also Ethereum.
 if(/이더리움클래식/.test(clean)&&!/(?:\bETH\b|\$ETH|이더리움(?!클래식)|(?<![가-힣])이더(?=$|[^가-힣]))/i.test(clean)&&taggedCoin!=='ETH')found.delete('ETH');
 return [...found].sort();
}
export function normalizeText(text){return String(text||'').normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
export function rankInternal(posts,{hours=24,now=Date.now()}={}){
 const cutoff=now-hours*3600000;const seen=new Map();const groups=new Map();
 for(const p of posts){const ts=Date.parse(p.created_at);if(!Number.isFinite(ts)||ts<cutoff||ts>now)continue;
  const symbols=matchCoins(p.title,p.coin);const fingerprint=normalizeText(p.title);
  for(const symbol of symbols){let keys=seen.get(symbol);if(!keys){keys=new Set();seen.set(symbol,keys)}if(keys.has(fingerprint))continue;keys.add(fingerprint);
   if(!groups.has(symbol))groups.set(symbol,{symbol,name:COINS.find(c=>c.symbol===symbol)?.name||symbol,mentions:0,sourceCount:1,growth:null,links:[]});
   const item=groups.get(symbol);item.mentions++;if(item.links.length<5)item.links.push({postId:p.id,publishedAt:p.created_at,sourceName:'알트모아'});
  }
 }
 return [...groups.values()].sort((a,b)=>b.mentions-a.mentions||a.symbol.localeCompare(b.symbol));
}
