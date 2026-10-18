import test from'node:test';import assert from'node:assert/strict';import{technicalSummary}from'../lib/technical.mjs';import{writerMarketEvidence,conversationSymbols,compactEvidence}from'../lib/ai-market-evidence.mjs';
const now=1800000000000,duration=3600000;const data=(symbol='SUI',interval='1h')=>({symbol,interval,status:'ready',fetchedAt:new Date(now).toISOString(),closedAt:new Date(now-1).toISOString(),close:10,sma20:9,sma60:8,rsi14:60,volumeRatio:2,trend:'up'});
test('closed OHLC and preceding high/low exclude the open candle and current candle from comparison',()=>{
 const rows=Array.from({length:100},(_,i)=>{const time=now-(100-i)*duration,p=i+1;return[time,p,p+2,p-.5,p+1,10,time+duration-1]});const result=technicalSummary(rows,{now});assert.deepEqual(result.priceAction.lastCandle,{open:100,high:102,low:99.5,close:101});assert.equal(result.priceAction.prior20High,101);assert.equal(result.priceAction.prior20Low,79.5);assert.ok(result.priceAction.change3BarsPct>0);
 rows.push([now,500,1000,1,900,999,now+duration-1]);assert.deepEqual(technicalSummary(rows,{now}),result);
});
test('reply coin detection uses verified symbols, Korean names and parent tags without mixing Bitcoin Cash with BTC',()=>{
 assert.deepEqual(conversationSymbols([{title:'비트코인캐시는 어떰',tags:[]}]),['BCH']);assert.deepEqual(conversationSymbols([{title:'이 흐름 어떻게 봄',tags:['SUI']}]),['SUI']);assert.deepEqual(conversationSymbols([{body:'그냥 커피 얘기 ㅋㅋ'}]),[]);
});
test('fresh shared ranking summaries avoid all additional candle requests',async()=>{
 let calls=0;const frames=[data(),data('SUI','4h')];const rows=await writerMarketEvidence(['SUI','SUI','UNVERIFIED'],{admin:async()=>frames,technical:async()=>{calls++;throw Error('must not fetch')},now:()=>now});assert.equal(calls,0);assert.equal(rows.length,1);assert.deepEqual(rows[0].frames.map(f=>f.interval),['1h','4h']);
});
test('stale cached summaries fall back to a bounded two-symbol/two-interval fetch, and failures never become fake metrics',async()=>{
 let calls=0;const r=await writerMarketEvidence(['BTC','ETH','SUI'],{admin:async()=>[{...data('BTC'),fetchedAt:new Date(now-400000).toISOString()}],now:()=>now,technical:async url=>{calls++;const s=url.searchParams.get('symbol'),i=url.searchParams.get('interval');if(s==='ETH')throw Error('offline');return data(s,i);}});assert.equal(calls,4);assert.equal(r.length,2);assert.equal(r[0].frames.length,2);assert.equal(r[1].frames.length,0);assert.deepEqual(r[1].unavailable_intervals,['1h','4h']);assert.equal(compactEvidence({...data(),closedAt:new Date(now+1).toISOString()},'SUI','1h',now),null);
});
test('all six writers retain real chart frames while trimming optional context to the existing input target',async()=>{
 const{AI_WRITERS,generateWriterReply,estimateWriterInput}=await import('../lib/ai-writers.mjs');const oldFetch=globalThis.fetch,env={...process.env};Object.assign(process.env,{XAI_API_KEY:'test',XAI_MODEL:'test',OPENAI_API_KEY:'test',OPENAI_MODEL:'test',GEMINI_API_KEY:'test',GEMINI_MODEL:'test'});
 const e=await writerMarketEvidence(['SUI','BTC'],{admin:async()=>[],technical:async u=>data(u.searchParams.get('symbol'),u.searchParams.get('interval')),now:()=>now});
 try{for(const writer of AI_WRITERS){let sent;globalThis.fetch=async(_,o)=>{sent=JSON.parse(o.body);const text=JSON.stringify({skip:true,interest_score:0});return Response.json(writer.provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});};
 await generateWriterReply(writer,{market_evidence:e,memory:[{body:'가'.repeat(160)}],candidates:Array.from({length:3},(_,i)=>({key:'post:'+i,body:'나'.repeat(260),post_body:'다'.repeat(180),thread:Array.from({length:8},()=>({body:'라'.repeat(180)}))}))});
 const gemini=writer.provider==='gemini',system=gemini?sent.systemInstruction.parts[0].text:sent.input[0].content,user=JSON.parse(gemini?sent.contents[0].parts[0].text:sent.input[1].content),schema=gemini?sent.generationConfig.responseJsonSchema:sent.text.format.schema;assert.ok(estimateWriterInput(system,user,schema)<=5000);assert.equal(user.market_evidence[0].frames.length,2);
 }}finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
