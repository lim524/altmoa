import test from 'node:test';import assert from 'node:assert/strict';
import {recordHumanView,recordAIViews,viewerIdentity} from '../lib/post-views.mjs';
const id='10000000-0000-0000-0000-000000000001';
const request=(body={postId:id},headers={})=>new Request('https://www.altmoa.com/api/post-view',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('signed viewer cookie survives refresh, cannot be forged, and raw ID is not sent to DB',()=>{
 process.env.SUPABASE_SECRET_KEY='test-view-secret';try{const first=viewerIdentity(request());const cookie=first.cookie.split(';')[0];const next=viewerIdentity(request({}, {cookie}));assert.equal(next.viewer,first.viewer);assert.equal(next.cookie,null);assert.notEqual(next.viewer,cookie.split('=')[1].split('.')[0]);assert.notEqual(viewerIdentity(request({}, {cookie:cookie.slice(0,-1)+'z'})).viewer,first.viewer);assert.doesNotThrow(()=>viewerIdentity(request({}, {cookie:cookie.split('.')[0]+'.'+'é'.repeat(64)})));}finally{delete process.env.SUPABASE_SECRET_KEY;}
});
test('view endpoint rejects cross-site and invalid requests without writes and returns server counters',async()=>{
 process.env.SUPABASE_SECRET_KEY='test-view-secret';try{let calls=0;const admin=async(path,options)=>{calls++;assert.match(path,/record_post_views/);const body=JSON.parse(options.body);assert.deepEqual(body.p_posts,[id]);assert.equal(body.p_is_ai,false);assert.match(body.p_viewer,/^[a-f0-9]{64}$/);return [{post_id:id,view_count:4,ai_view_count:2}];};
 assert.equal((await recordHumanView(request({}, {origin:'https://evil.test'}),{admin})).status,403);assert.equal((await recordHumanView(request({postId:'bad'}),{admin})).status,400);assert.equal(calls,0);
 const response=await recordHumanView(request(),{admin});assert.equal((await response.json()).view_count,4);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.equal(calls,1);
 }finally{delete process.env.SUPABASE_SECRET_KEY;}
});
test('AI reads are recorded once per parent post even for comment candidates, and failure cannot break replies',async()=>{
 const calls=[];await recordAIViews('grogi',[{post_id:id},{post_id:id},{post_id:'bad'}],async(path,options)=>calls.push(JSON.parse(options.body)));
 assert.deepEqual(calls,[{p_posts:[id],p_viewer:'ai:grogi',p_is_ai:true}]);await recordAIViews('grogi',[{post_id:id}],async()=>{throw Error('db');});
});
