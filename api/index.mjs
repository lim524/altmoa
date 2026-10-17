import {getTechnicalRanking} from '../lib/technical-ranking.mjs';
import {getTechnical} from '../lib/technical.mjs';
import {recordHumanView} from '../lib/post-views.mjs';
import {runAIReplies} from '../lib/ai-replies.mjs';
import {runAIPublisher,initializeAIWriters} from '../lib/ai-publisher.mjs';
import {publicCommunity} from '../lib/public-community.mjs';
import { EXCHANGES,fetchExchange,compareAsset,fetchConversion } from '../lib/exchanges.mjs';
import {aiConfiguration,createAIDraft} from '../lib/ai-drafts.mjs';
import { getAttention } from '../lib/attention-api.mjs';
const json = (body, status = 200, cache = 'no-store') => Response.json(body, { status, headers: { 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } });
export async function GET(request) {
  const u = new URL(request.url);
  const route = u.searchParams.get('route') || u.pathname.replace(/^\/api\/?/, '');
  if (route === 'config') {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_ANON_KEY || '';
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
    try {
      if (key.split('.').length === 3) publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon';
    } catch { publicKey = false; }
    const ready = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && publicKey;
    // Only a validated public anon/publishable key is sent to clients.
    return json({ communityReady: ready, supabaseUrl: ready ? url : '', supabaseKey: ready ? key : '' });
  }
  if(route==='public-community'||route==='public-post')return publicCommunity(u,route==='public-post');
  if(route==='ai')return json(aiConfiguration());
  if(route==='technical-rank'){try{const data=await getTechnicalRanking(u);return json(data,data.status==='building'?202:200,data.status==='ready'&&!data.stale?'public, max-age=0, s-maxage=30':'no-store');}catch(error){return json({error:error.status===400?'올바른 봉 주기를 선택해 주세요.':'기술지표 랭킹을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},error.status||503);}}
  if(route==='technical'){try{return json(await getTechnical(u),200,'public, max-age=0, s-maxage=60');}catch(error){return json({error:error.status===400?'올바른 코인과 봉 주기를 선택해 주세요.':'차트 지표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},error.status||502);}}
  if (route === 'attention') return json(await getAttention(u));
  if(route==='conversion'){try{return json(await fetchConversion(),200,'public, max-age=0, s-maxage=30, stale-while-revalidate=60');}catch{return json({error:'USDT/KRW 환산 시세 연결 지연'},502);}}
  if (route !== 'market') return json({ error: 'Not found' }, 404);
  const asset=u.searchParams.get('asset');
  if(asset){
    const comparison=await compareAsset(asset);
    return comparison?json(comparison,200,'public, max-age=0, s-maxage=30, stale-while-revalidate=60'):json({error:'Unknown asset'},400);
  }
  const exchange=u.searchParams.get('exchange')||'binance';
  if(!EXCHANGES[exchange])return json({error:'지원하지 않는 거래소입니다.'},400);
  try {
    return json(await fetchExchange(exchange),200,'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  } catch (error) {
    console.error('market_fetch_failed',exchange,error.status||error.name);
    return json({ exchange, source:EXCHANGES[exchange].source, error:EXCHANGES[exchange].name+' 시세를 불러오지 못했습니다. 다른 거래소를 선택하거나 잠시 후 다시 시도해 주세요.' }, 502);
  }
}

export async function POST(request){const url=new URL(request.url),route=url.searchParams.get('route')||url.pathname.replace(/^\/api\/?/,'');if(route==='post-view')return recordHumanView(request);if(route==='ai-reply')return runAIReplies(request);if(route==='ai-initialize')return initializeAIWriters(request);if(route==='ai-publish')return runAIPublisher(request);if(route==='ai')return createAIDraft(request);return json({error:'Not found'},404);}
