import {authSession}from '../lib/auth-session.mjs';
import {refreshCommunityEnrichment}from '../lib/community-enrichment.mjs';
import {aiAdmin,authorized}from '../lib/ai-publisher.mjs';
import {getMarketActivity} from '../lib/market-activity.mjs';
import {runAITick} from '../lib/ai-tick.mjs';
import {getTechnicalRanking} from '../lib/technical-ranking.mjs';
import {getTechnical} from '../lib/technical.mjs';
import {recordHumanView} from '../lib/post-views.mjs';
import {runAIReplies} from '../lib/ai-replies.mjs';
import {runAIPublisher,initializeAIWriters} from '../lib/ai-publisher.mjs';
import {publicCommunity} from '../lib/public-community.mjs';
import { EXCHANGES,fetchExchange,compareAsset,fetchConversion } from '../lib/exchanges.mjs';
import {aiConfiguration,createAIDraft} from '../lib/ai-drafts.mjs';
import { getAttention } from '../lib/attention-api.mjs';
// Owner-requested pause. Resume only with an explicit AI_FEATURES_PAUSED=false.
const aiPaused=()=>process.env.AI_FEATURES_PAUSED!=='false';
const pausedAI=()=>json({paused:true,enabled:false,published:false,replied:false,recommended:false,reason:'ai_paused'});
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
  if(route==='ai-enrichment'&&aiPaused())return pausedAI();
  if(route==='ai-enrichment'){try{const rows=await aiAdmin('rest/v1/ai_enrichment_cache?select=snapshot,computed_at&id=eq.1'),r=rows?.[0],s=r?.snapshot;return json({enabled:process.env.AI_ENRICHMENT_ENABLED!=='false',updatedAt:r?.computed_at||null,terms:s?.terms?.length||0,observedTerms:s?.terms?.filter(t=>t.kind==='observed').length||0,images:s?.images?.length||0,sources:s?.sources||[],learner:s?.learner||'waiting'},200,'public, max-age=0, s-maxage=60');}catch{return json({status:'preparing'},503);}}
  if(route==='ai'){const data=aiConfiguration();return json(aiPaused()?{...data,paused:true,enabled:false,webSearch:false,publishing:{...data.publishing,enabled:false,automaticComments:false,automaticRecommendations:false}}:data);}
  if(route==='technical-rank'){try{const data=await getTechnicalRanking(u);return json(data,data.status==='building'?202:200,data.status==='ready'&&!data.stale?'public, max-age=0, s-maxage=30':'no-store');}catch(error){return json({error:error.status===400?'올바른 봉 주기를 선택해 주세요.':'기술지표 랭킹을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},error.status||503);}}
  if(route==='technical'){try{return json(await getTechnical(u),200,'public, max-age=0, s-maxage=60');}catch(error){return json({error:error.status===400?'올바른 코인과 봉 주기를 선택해 주세요.':'차트 지표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},error.status||502);}}
  if(route==='market-activity'){try{const data=await getMarketActivity();return json(data,data.status==='building'?202:200,data.stale||data.status==='building'?'no-store':'public, max-age=0, s-maxage=60');}catch{return json({error:'시장 활성도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);}}
  if(route==='attention'){const data=await getAttention(u);return json(data,200,['ready','collecting'].includes(data.status)?'public, max-age=0, s-maxage=60':'no-store');}
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
    const snapshot=await fetchExchange(exchange),eligible=snapshot.coins.filter(c=>c.symbol!=='BTC');
    return json({...snapshot,coins:eligible.slice(0,50),limit:50,totalAvailable:eligible.length},200,'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  } catch (error) {
    console.error('market_fetch_failed',exchange,error.status||error.name);
    return json({ exchange, source:EXCHANGES[exchange].source, error:EXCHANGES[exchange].name+' 시세를 불러오지 못했습니다. 다른 거래소를 선택하거나 잠시 후 다시 시도해 주세요.' }, 502);
  }
}

export async function POST(request){const url=new URL(request.url),route=url.searchParams.get('route')||url.pathname.replace(/^\/api\/?/,'');if((route==='ai'||route.startsWith('ai-'))&&aiPaused())return pausedAI();if(route==='auth-session')return authSession(request);if(route==='ai-enrichment'){if(!authorized(request))return json({error:'Unauthorized'},401);return json(await refreshCommunityEnrichment(aiAdmin));}if(route==='ai-tick')return runAITick(request);if(route==='post-view')return recordHumanView(request);if(route==='ai-reply')return runAIReplies(request);if(route==='ai-initialize')return initializeAIWriters(request);if(route==='ai-publish')return runAIPublisher(request);if(route==='ai')return createAIDraft(request);return json({error:'Not found'},404);}
