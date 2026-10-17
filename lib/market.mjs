export function normalizeMarket(tickers, markets) {
  if (!Array.isArray(tickers) || !Array.isArray(markets)) throw new Error('Invalid upstream format');
  const names = new Map(markets.map(m => [m.market, m.korean_name]));
  return tickers.filter(t => /^KRW-[A-Z0-9]+$/.test(t.market) && Number.isFinite(t.trade_price) && t.trade_price > 0 && Number.isFinite(t.signed_change_rate) && Number.isFinite(t.acc_trade_price_24h)).map(t => ({
    symbol: t.market.slice(4), name: names.get(t.market) || t.market.slice(4), market: t.market,
    price: t.trade_price, change: t.signed_change_rate * 100, volume24h: t.acc_trade_price_24h,
    tradedAt: Number.isFinite(t.timestamp) ? new Date(t.timestamp).toISOString() : null
  })).sort((a, b) => b.volume24h - a.volume24h);
}
