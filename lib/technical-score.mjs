const round=n=>Math.round(n*10)/10;
export function scoreTechnical(data){
 const {close,sma20,sma60,rsi14,volumeRatio}=data;
 if(data.status!=='ready'||![close,sma20,sma60,rsi14,volumeRatio].every(Number.isFinite)||Math.min(close,sma20,sma60)<=0||rsi14<0||rsi14>100||volumeRatio<0)return null;
 const trend=(close>sma20?20:0)+(sma20>sma60?20:0)+(close>sma60?10:0);
 const rsi=round(rsi14<=40||rsi14>=80?0:rsi14<55?(rsi14-40)*2:rsi14<=65?30:(80-rsi14)*2);
 const volume=round(close>sma20?Math.min(20,Math.max(0,(volumeRatio-1)*10)):0);
 return {version:'v1',total:round(trend+rsi+volume),trend,rsi,volume};
}
export function rankTechnicals(items){return items.filter(item=>item.scoring).sort((a,b)=>b.scoring.total-a.scoring.total||b.volume24h-a.volume24h||a.symbol.localeCompare(b.symbol));}
