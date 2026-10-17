import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveCoinLogo} from '../lib/coin-logos.mjs';
import {normalizeKorean,normalizeBinance} from '../lib/exchanges.mjs';
test('registered assets use their local image or official project image',()=>{
 assert.equal(resolveCoinLogo({symbol:'SUI'},'binance','SUI','sui'),'/assets/coins/SUI.svg');
 assert.match(resolveCoinLogo({symbol:'OP'},'upbit','','optimism'),/ethereum-optimism.*OP\/logo.png/);
});
test('unknown Korean assets require a matching name before sharing another asset logo',()=>{
 assert.equal(resolveCoinLogo({symbol:'SUI'},'bithumb','Unrelated token'),null);
 const rows=normalizeKorean([{market:'KRW-SUI',trade_price:1,signed_change_rate:0,acc_trade_price_24h:1}],[{market:'KRW-SUI',korean_name:'수이',english_name:'Sui'}],'bithumb');assert.equal(rows[0].logoUrl,'/assets/coins/SUI.svg');
 const data=normalizeBinance([{symbol:'BNBUSDT',lastPrice:'1',openPrice:'1',quoteVolume:'1'}],{symbols:[{symbol:'BNBUSDT',baseAsset:'BNB',quoteAsset:'USDT',status:'TRADING',isSpotTradingAllowed:true}]});assert.ok(data[0].logoUrl);assert.equal(data[0].assetId,null);
});
test('every bundled catalogue image exists and contains passive SVG artwork',()=>{
 const catalogue=globalThis.ALTMOA_LOGOS;assert.ok(Object.keys(catalogue.assets).length>=500);
 for(const asset of Object.values(catalogue.assets)){assert.match(asset.path,/^\/assets\/coins\/[A-Z0-9_-]+\.svg$/);const svg=fs.readFileSync(new URL('../dist'+asset.path,import.meta.url),'utf8');assert.match(svg,/^<svg/);assert.doesNotMatch(svg,/<script|<foreignObject|\bon\w+=|(?:href|src)\s*=/i);}
});
