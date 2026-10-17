import { EXCHANGES,fetchExchange,compareAsset } from '../lib/exchanges.mjs';
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
  if (route === 'attention') return json(await getAttention(u));
  if (route !== 'market') return json({ error: 'Not found' }, 404);
  const asset=u.searchParams.get('asset');
  if(asset){
    const comparison=await compareAsset(asset);
    return comparison?json(comparison,200,'public, max-age=0, s-maxage=30, stale-while-revalidate=60'):json({error:'Unknown asset'},400);
  }
  const exchange=u.searchParams.get('exchange')||'upbit';
  if(!EXCHANGES[exchange])return json({error:'지원하지 않는 거래소입니다.'},400);
  try {
    return json(await fetchExchange(exchange),200,'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  } catch (error) {
    console.error('market_fetch_failed',exchange,error.status||error.name);
    return json({ exchange, source:EXCHANGES[exchange].source, error:EXCHANGES[exchange].name+' 시세를 불러오지 못했습니다. 다른 거래소를 선택하거나 잠시 후 다시 시도해 주세요.' }, 502);
  }
}
