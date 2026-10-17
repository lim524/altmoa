import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../api/index.mjs';
import { normalizeMarket } from '../lib/market.mjs';
const req = route => new Request('https://altmoa.example/api/' + route);
const jwt = role => 'e30.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.signature';

test('public config never exposes service-role, secret, or malformed keys', async () => {
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  for (const key of ['sb_secret_abc', jwt('service_role'), jwt('authenticated'), 'bad.key.data', 'arbitrary']) {
    process.env.SUPABASE_ANON_KEY = key;
    const body = await (await GET(req('config'))).json();
    assert.equal(body.communityReady, false);
    assert.equal(body.supabaseKey, '');
  }
  for (const key of [jwt('anon'), 'sb_publishable_abc-123']) {
    process.env.SUPABASE_ANON_KEY = key;
    const response = await GET(req('config')); const body = await response.json();
    assert.equal(body.communityReady, true); assert.equal(body.supabaseKey, key);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
});

test('market maps Korean names and preserves signed previous-close change', () => {
  const rows = normalizeMarket([
    { market: 'KRW-SUI', trade_price: 2500, signed_change_rate: -.03, acc_trade_price_24h: 900, timestamp: 1700000000000 },
    { market: 'KRW-SOL', trade_price: 250000, signed_change_rate: .04, acc_trade_price_24h: 2000 },
    { market: 'BTC-XRP', trade_price: 2, signed_change_rate: 1, acc_trade_price_24h: 1 },
    { market: 'KRW-BAD', trade_price: NaN, signed_change_rate: 1, acc_trade_price_24h: 1 }
  ], [{ market: 'KRW-SUI', korean_name: '수이' }]);
  assert.deepEqual(rows.map(r => r.symbol), ['SOL','SUI']); assert.equal(rows[1].name, '수이'); assert.equal(rows[1].change,-3);
});

test('upstream failure never becomes fabricated market data', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  try { const response = await GET(req('market')); assert.equal(response.status,502); const data = await response.json(); assert.equal(data.coins,undefined); assert.equal(response.headers.get('Cache-Control'),'no-store'); }
  finally { globalThis.fetch = original; }
});

test('market success has shared CDN cache and source timestamp', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => Response.json(String(url).includes('/ticker/') ? [{market:'KRW-SUI',trade_price:100,signed_change_rate:.12,acc_trade_price_24h:123}] : [{market:'KRW-SUI',korean_name:'수이'}]);
  try { const response = await GET(new Request('https://altmoa.example/api/index?route=market&exchange=upbit')); const data = await response.json(); assert.equal(data.source,'Upbit'); assert.equal(data.coins[0].name,'수이'); assert.equal(data.coins[0].change,12); assert.match(response.headers.get('Cache-Control'),/s-maxage=30/); assert.ok(Date.parse(data.fetchedAt)); }
  finally { globalThis.fetch = original; }
});

test('attention reports zero connected sources; unknown routes are 404', async () => {
  const body = await (await GET(req('attention'))).json(); assert.equal(body.status,'not_connected'); assert.equal(body.sources.length,5); assert.ok(body.sources.every(s=>['permission_required','api_required'].includes(s.status))); assert.deepEqual(body.items,[]);
  assert.equal((await GET(req('nope'))).status,404);
});
