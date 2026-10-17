import test from 'node:test';import assert from 'node:assert/strict';import {AI_WRITERS} from '../lib/ai-writers.mjs';import {postTopicForSlot} from '../lib/ai-topics.mjs';
test('casual topics are stable, occasional, and match each persona interests',()=>{
 let count=0;for(let i=0;i<2000;i++){const writer=AI_WRITERS[i%6],topic=postTopicForSlot(i,writer,'test-topic-secret');assert.deepEqual(topic,postTopicForSlot(i,writer,'test-topic-secret'));if(topic){count++;assert.equal(topic.tag,'일상');assert.ok(writer.interests.includes(topic.subject));}}
 assert.ok(count>200&&count<400);
});
