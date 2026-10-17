import {normalizeMarket} from './market.mjs';
import {resolveCoinLogo} from './coin-logos.mjs';
// Explicit cross-exchange identity registry. Unlisted symbols are never merged
// merely because their ticker text matches.
const assets=[['bitcoin','BTC','비트코인'],['ethereum','ETH','이더리움'],['ripple','XRP','리플'],['solana','SOL','솔라나'],['sui','SUI','수이'],['dogecoin','DOGE','도지코인'],['pepe','PEPE','페페'],['sei','SEI','세이'],['ondo-finance','ONDO','온도파이낸스'],['cardano','ADA','에이다'],['avalanche','AVAX','아발란체'],['chainlink','LINK','체인링크'],['polkadot','DOT','폴카닷'],['aptos','APT','앱토스'],['arbitrum','ARB','아비트럼'],['optimism','OP','옵티미즘'],['near','NEAR','니어프로토콜'],['uniswap','UNI','유니스왑'],['aave','AAVE','에이브'],['injective','INJ','인젝티브'],['ethena','ENA','에테나'],['worldcoin','WLD','월드코인'],['shiba-inu','SHIB','시바이누'],['tron','TRX','트론'],['bitcoin-cash','BCH','비트코인캐시'],['ethereum-classic','ETC','이더리움클래식'],['stellar','XLM','스텔라루멘'],['hedera','HBAR','헤데라']];
export const ASSETS=assets.map(([id,symbol,name])=>({id,symbol,name,markets:{upbit:'KRW-'+symbol,bithumb:'KRW-'+symbol,binance:symbol+'USDT'}}));
export const EXCHANGES={upbit:{id:'upbit',name:'업비트',region:'kr',quote:'KRW',changeLabel:'전일 종가 대비 (UTC)',source:'Upbit'},bithumb:{id:'bithumb',name:'빗썸',region:'kr',quote:'KRW',changeLabel:'거래소 제공 전일 종가 대비',source:'Bithumb'},binance:{id:'binance',name:'바이낸스',region:'global',quote:'USDT',changeLabel:'최근 24시간 대비',source:'Binance'}};
function enrich(rows,exchange,markets=[]){return rows.map(row=>{const asset=ASSETS.find(a=>a.markets[exchange]===row.market);return {...row,logoUrl:resolveCoinLogo(row,exchange,markets.find(m=>m.market===row.market)?.english_name||row.name,asset?.id),name:row.name===row.symbol&&asset?asset.name:row.name,exchange,quote:EXCHANGES[exchange].quote,assetId:asset?.id||null,iconSymbol:exchange==='upbit'?row.symbol:asset?.symbol||null}})}
export function normalizeKorean(tickers,markets,exchange='upbit'){return enrich(normalizeMarket(tickers,markets),exchange,markets)}
export function normalizeBinance(tickers,info){
 if(!Array.isArray(tickers)||!Array.isArray(info?.symbols))throw new Error('invalid_binance_format');
 const pairs=new Map(info.symbols.filter(p=>p.quoteAsset==='USDT'&&p.status==='TRADING'&&p.isSpotTradingAllowed===true&&/^[A-Z0-9]{1,20}$/.test(p.baseAsset)).map(p=>[p.symbol,p]));
 return enrich(tickers.flatMap(t=>{const p=pairs.get(t.symbol);const price=Number(t.lastPrice),open=Number(t.openPrice),vol=Number(t.quoteVolume);if(!p||!Number.isFinite(price)||price<=0||!Number.isFinite(open)||open<=0||!Number.isFinite(vol)||vol<0)return [];
 return [{symbol:p.baseAsset,name:p.baseAsset,market:t.symbol,price,change:(price/open-1)*100,volume24h:vol,tradedAt:Number.isFinite(t.closeTime)?new Date(t.closeTime).toISOString():null}]}),'binance').sort((a,b)=>b.volume24h-a.volume24h);
}
async function readJSON(url,signal){
 const r=await fetch(url,{headers:{Accept:'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
 if(!r.ok){const e=new Error('upstream_status');e.status=r.status;throw e}
 const type=r.headers.get('content-type')||'';if(!type.includes('json'))throw new Error('upstream_non_json');return r.json();
}
export async function fetchExchange(id){
 if(!EXCHANGES[id])throw new Error('invalid_exchange');let rows;const signal=AbortSignal.timeout(9000);const read=url=>readJSON(url,signal);
 if(id==='upbit'){
  const [ticks,names]=await Promise.all([read('https://api.upbit.com/v1/ticker/all?quote_currencies=KRW'),read('https://api.upbit.com/v1/market/all?is_details=false')]);rows=normalizeKorean(ticks,names,'upbit');
 }else if(id==='bithumb'){
  const markets=await read('https://api.bithumb.com/v1/market/all?isDetails=false');
  if(!Array.isArray(markets))throw new Error('invalid_bithumb_format');
  const names=markets.filter(m=>/^KRW-[A-Z0-9]+$/.test(m.market));
  if(names.length>1200)throw new Error('unexpected_market_count');
  // API accepts at most 200 markets per request. Smaller batches keep URLs short.
  const batches=[];for(let i=0;i<names.length;i+=100)batches.push(names.slice(i,i+100).map(m=>m.market));
  const ticks=[];for(const group of batches){const part=await read('https://api.bithumb.com/v1/ticker?markets='+encodeURIComponent(group.join(',')));if(!Array.isArray(part)||part.length!==group.length)throw new Error('partial_bithumb_tickers');ticks.push(...part)}
  rows=normalizeKorean(ticks,markets,'bithumb');
 }else{
  const [ticks,info]=await Promise.all([read('https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI'),read('https://data-api.binance.vision/api/v3/exchangeInfo?permissions=SPOT')]);rows=normalizeBinance(ticks,info);
 }
 if(!rows.length)throw new Error('empty_market');return {...EXCHANGES[id],source:EXCHANGES[id].source,currency:EXCHANGES[id].quote,fetchedAt:new Date().toISOString(),coins:rows};
}
export async function compareAsset(assetId){
 const asset=ASSETS.find(a=>a.id===assetId);if(!asset)return null;
 const ids=Object.keys(EXCHANGES);const results=await Promise.allSettled(ids.map(id=>fetchExchange(id)));
 const rateResult=results[0];const upbit=rateResult.status==='fulfilled'?rateResult.value:null;
 const usdt=upbit?.coins.find(c=>c.symbol==='USDT');const conversion=usdt?{rate:usdt.price,source:'업비트 USDT/KRW',fetchedAt:upbit.fetchedAt}:null;
 return {assetId,symbol:asset.symbol,name:asset.name,conversion,comparisons:results.map((result,i)=>{
  const id=ids[i];if(result.status==='rejected')return {...EXCHANGES[id],status:'unavailable'};
  const row=result.value.coins.find(c=>c.market===asset.markets[id]);if(!row)return {...EXCHANGES[id],status:'unlisted',fetchedAt:result.value.fetchedAt};
  return {...row,exchangeName:EXCHANGES[id].name,status:'ready',changeLabel:EXCHANGES[id].changeLabel,fetchedAt:result.value.fetchedAt,convertedKrw:row.quote==='KRW'?row.price:conversion?row.price*conversion.rate:null};
 })};
}
