import test from 'node:test';import assert from 'node:assert/strict';import {attachAttentionPrices} from '../lib/attention-prices.mjs';
test('24h price changes preserve internal-interest order and distinguish unavailable prices from zero',async()=>{
 const items=[{symbol:'SOL',mentions:8},{symbol:'BTC',mentions:4},{symbol:'UNKNOWN',mentions:2},{symbol:'ETH',mentions:1}];
 const result=await attachAttentionPrices(items,{market:async()=>({fetchedAt:'2026-10-17T16:00:00Z',coins:[{symbol:'BTC',change:-2},{symbol:'SOL',change:3.125},{symbol:'ETH',change:0}]})});
 assert.deepEqual(result.items.map(i=>i.symbol),items.map(i=>i.symbol));assert.deepEqual(result.items.map(i=>i.priceChange24h),[3.125,-2,null,0]);assert.match(result.priceSource,/Binance/);
 const unavailable=await attachAttentionPrices(items,{market:async()=>{throw Error('upstream');}});assert.equal(unavailable.items.length,4);assert.equal(unavailable.items[0].mentions,8);assert.ok(unavailable.items.every(i=>i.priceChange24h===null));assert.equal(unavailable.priceFetchedAt,null);
});
