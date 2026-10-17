import { normalizeMarket } from '../lib/market.mjs';
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
  if (route === 'attention') return json({ status: 'not_connected', sources: [], items: [], message: '외부 관심도 수집 준비 중입니다. 수집된 원문이 없는 순위는 표시하지 않습니다.' }, 200, 'public, max-age=0, s-maxage=300');
  if (route !== 'market') return json({ error: 'Not found' }, 404);
  try {
    const options = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) };
    const [ticks, names] = await Promise.all([
      fetch('https://api.upbit.com/v1/ticker/all?quote_currencies=KRW', options),
      fetch('https://api.upbit.com/v1/market/all?is_details=false', options)
    ]);
    if (!ticks.ok || !names.ok) throw new Error('upstream_status');
    const coins = normalizeMarket(await ticks.json(), await names.json());
    if (!coins.length) throw new Error('empty_market');
    return json({ source: 'Upbit', currency: 'KRW', fetchedAt: new Date().toISOString(), coins }, 200, 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  } catch (error) {
    console.error('market_fetch_failed', error.name);
    return json({ error: '시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502);
  }
}
