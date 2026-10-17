import '../dist/coin-logos.js';
const catalogue=globalThis.ALTMOA_LOGOS;
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function resolveCoinLogo(row,exchange,englishName='',assetId=null){
 const symbol=row.symbol;
 if(assetId&&catalogue.official[assetId])return catalogue.official[assetId];
 const known=assetId&&catalogue.assets[assetId];
 if(known&&known.symbol===symbol)return known.path;
 const ids=catalogue.symbols[symbol]||[];
 if(assetId&&ids.length===1)return catalogue.assets[ids[0]].path;
 const korean=catalogue.korean?.[symbol];
 if(korean&&row.name&&row.name===korean.name)return korean.path;
 // A name match is required for unregistered assets. Never merge by ticker alone.
 const match=ids.map(id=>catalogue.assets[id]).find(a=>normalize(a.name)===normalize(englishName));
 if(match)return match.path;
 const official=catalogue.binance[symbol];
 if(official&&(exchange==='binance'||normalize(official.name)===normalize(englishName)))return official.path;
 if(exchange==='upbit'&&/^[A-Z0-9]{1,20}$/.test(symbol))return 'https://static.upbit.com/logos/'+symbol+'.png';
 return null;
}
