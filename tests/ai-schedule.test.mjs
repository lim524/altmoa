import test from 'node:test';
import assert from 'node:assert/strict';
import {aiScheduleDue} from '../lib/ai-schedule.mjs';
import {runAIPublisher} from '../lib/ai-publisher.mjs';
import {runAIReplies} from '../lib/ai-replies.mjs';
import {AI_WRITERS,generateWriterReply,estimateWriterInput} from '../lib/ai-writers.mjs';

test('randomized wake-up is stable across retries, varies by slot and does not fix all actions to five-minute marks',()=>{
 const secret='schedule-test-private-1234567890123456789',offsets=[],replyOffsets=[];
 for(let slot=6000000;slot<6000100;slot++){
  const due=kind=>Array.from({length:5},(_,minute)=>minute).find(minute=>aiScheduleDue(kind,slot*300000+minute*60000,secret));
  const minute=due('post');offsets.push(minute);replyOffsets.push(due('reply'));
  assert.equal(aiScheduleDue('post',slot*300000+minute*60000,secret),true);
  if(minute)assert.equal(aiScheduleDue('post',slot*300000+minute*60000-1,secret),false);
 }
 assert.equal(new Set(offsets).size,5);assert.notDeepEqual(offsets,replyOffsets);
 const gaps=offsets.slice(1).map((offset,i)=>5+offset-offsets[i]);assert.ok(new Set(gaps).size>3);
 assert.ok(gaps.every(gap=>gap>=1&&gap<=9));
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

test('large candidate sets shrink before the paid call and all providers enforce 500 output tokens',async()=>{
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
   assert.equal(provider==='gemini'?sent.generationConfig.maxOutputTokens:sent.max_output_tokens,500);
  }
  let calls=0;globalThis.fetch=async()=>{calls++};
  await assert.rejects(generateWriterReply(AI_WRITERS[0],{candidates:[{key:'one',body:'가'.repeat(10000)}]}),/input_budget_exceeded/);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved)}
});
