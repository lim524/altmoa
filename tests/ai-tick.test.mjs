import test from 'node:test';import assert from 'node:assert/strict';import {runAITick} from '../lib/ai-tick.mjs';
test('combined wake-up is authenticated and keeps post/reply results independent',async()=>{
 process.env.AI_WORKER_SECRET='tick-test-secret-123456789012345678901234';let post=0,reply=0;
 try{
  const deps={publish:async()=>{post++;return Response.json({published:false});},reply:async()=>{reply++;return Response.json({replied:false});}};
  const bad=await runAITick(new Request('https://altmoa.test/api/ai-tick'),deps);assert.equal(bad.status,401);assert.equal(post+reply,0);
  const request=new Request('https://altmoa.test/api/ai-tick',{headers:{'x-ai-worker-secret':process.env.AI_WORKER_SECRET}});
  const good=await runAITick(request,deps);assert.equal(good.status,200);assert.equal(post,1);assert.equal(reply,1);
  const partial=await runAITick(request,{...deps,publish:async()=>{throw Error('failed');}});assert.equal(partial.status,503);assert.equal(reply,2);assert.equal(partial.headers.get('Cache-Control'),'no-store');
 }finally{delete process.env.AI_WORKER_SECRET;}
});
