import test from 'node:test';
import assert from 'node:assert/strict';
import {aiScheduleDue,aiWriterIndex} from '../lib/ai-schedule.mjs';
import {runAIPublisher} from '../lib/ai-publisher.mjs';
import {runAIReplies} from '../lib/ai-replies.mjs';
import {AI_WRITERS,generateWriterReply,generateWriterPost,estimateWriterInput} from '../lib/ai-writers.mjs';

test('independent random minutes allow quiet windows and bursts, with stable retries and no six-writer cycle',()=>{
 const secret='schedule-test-private-1234567890123456789',post=[],reply=[],writers=[];
 for(let minute=30000000;minute<30010000;minute++){
  const at=minute*60000,due=aiScheduleDue('post',at,secret);post.push(due);reply.push(aiScheduleDue('reply',at,secret));
  assert.equal(aiScheduleDue('post',at+59000,secret),due);
  const writer=aiWriterIndex('post',at,6,secret);assert.equal(aiWriterIndex('post',at+59000,6,secret),writer);if(due)writers.push(writer);
 }
 const events=post.flatMap((due,i)=>due?[i]:[]),gaps=events.slice(1).map((m,i)=>m-events[i]);
 assert.ok(events.length>400&&events.length<800);assert.ok(gaps.includes(1));assert.ok(gaps.some(n=>n>15));
 const windows=Array.from({length:2000},(_,i)=>post.slice(i*5,i*5+5).filter(Boolean).length);
 assert.ok(windows.includes(0));assert.ok(windows.some(n=>n>=2));assert.notDeepEqual(post,reply);
 assert.equal(new Set(writers).size,6);assert.ok(writers.some((w,i)=>i&&w===writers[i-1]));assert.ok(writers.some((w,i)=>i>=6&&w!==writers[i-6]));
});

test('early minute polls do not claim jobs, read the database or invoke models',async()=>{
 const saved={...process.env};let calls=0;
 Object.assign(process.env,{AI_WORKER_SECRET:'schedule-test-private-1234567890123456789',AI_AUTO_REPLY:'true',AI_AUTO_PUBLISH:'true',XAI_API_KEY:'test',XAI_MODEL:'test',OPENAI_API_KEY:'test',OPENAI_MODEL:'test',GEMINI_API_KEY:'test',GEMINI_MODEL:'test'});
 try{
  const req=new Request('https://altmoa.test/api/ai-reply',{headers:{'x-ai-worker-secret':process.env.AI_WORKER_SECRET}});
  for(const worker of [runAIPublisher,runAIReplies]){
   const result=await worker(req,{due:()=>false,admin:async()=>{calls++},generate:async()=>{calls++}});
   assert.equal((await result.json()).reason,'not_due');
  }
  assert.equal(calls,0);
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved)}
});

test('large candidate sets shrink before the paid call and all providers enforce separate post and reply output budgets',async()=>{
 const saved={...process.env},original=globalThis.fetch;
 Object.assign(process.env,{XAI_API_KEY:'test',XAI_MODEL:'grok-4.3',OPENAI_API_KEY:'test',OPENAI_MODEL:'gpt-5.4-mini',GEMINI_API_KEY:'test',GEMINI_MODEL:'gemini-3.1-flash-lite'});
 try{
  for(const provider of ['grok','openai','gemini']){
   let sent;
   globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);const text=JSON.stringify({target_key:'',body:'',skip:true,interest_score:0});return Response.json(provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]})};
   const context={candidates:Array.from({length:12},(_,i)=>({key:'post:'+i,body:'가'.repeat(400)}))};
   assert.equal(await generateWriterReply(AI_WRITERS.find(w=>w.provider===provider),context),null);
   const system=provider==='gemini'?sent.systemInstruction.parts[0].text:sent.input[0].content;
   const user=JSON.parse(provider==='gemini'?sent.contents[0].parts[0].text:sent.input[1].content);
   const schema=provider==='gemini'?sent.generationConfig.responseJsonSchema:sent.text.format.schema;
   assert.ok(user.candidates.length<context.candidates.length);
   assert.ok(estimateWriterInput(system,user,schema)<=5000);
   assert.equal(provider==='gemini'?sent.generationConfig.maxOutputTokens:sent.max_output_tokens,1200);
  }
  for(const provider of ['grok','openai','gemini']){
   let sent;const body='관찰할 조건을 먼저 따져보자는 이야기야. '.repeat(70);
   globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);const text=JSON.stringify({title:'서로 다른 해석',body,skip:false});return Response.json(provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]})};
   const result=await generateWriterPost(AI_WRITERS.find(w=>w.provider===provider),{kind:'casual',subject:'대화'});
   assert.ok(result.body.length>1000);
   assert.equal(provider==='gemini'?sent.generationConfig.maxOutputTokens:sent.max_output_tokens,2400);
  }
  let calls=0;globalThis.fetch=async()=>{calls++};
  await assert.rejects(generateWriterReply(AI_WRITERS[0],{candidates:[{key:'one',body:'가'.repeat(10000)}]}),/input_budget_exceeded/);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved)}
});
