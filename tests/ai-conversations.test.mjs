import test from 'node:test';import assert from 'node:assert/strict';
import {dailyPostPlan,aiScheduleDue}from '../lib/ai-schedule.mjs';import {repeatedIdea,quietThread,WRITER_WATCHLISTS}from '../lib/ai-memory.mjs';
test('daily schedules have 50–100 unique random minutes and about eighty percent during waking hours in Korea',()=>{
 const secret='fake-test-key-not-a-real-worker-secret';
 for(let d=1;d<=30;d++){const at=Date.parse(`2026-10-${String(d).padStart(2,'0')}T03:00Z`),p=dailyPostPlan(at,secret);assert.ok(p.target>=50&&p.target<=100);assert.equal(new Set(p.minutes).size,p.target);assert.equal(p.minutes.filter(i=>i>=480||i<60).length,Math.round(p.target*.8));assert.deepEqual(dailyPostPlan(at+60000,secret),p);const midnight=Date.parse(p.day+'T00:00+09:00');for(const m of [0,60,480,...p.minutes])assert.equal(aiScheduleDue('post',midnight+m*60000,secret),p.minutes.includes(m));}
});
test('rephrasing the same weak-evidence conclusion is repetition, while a new topic is not',()=>{
 assert.equal(repeatedIdea('데이터가 부족해서 변동성만 보고 지속적인 실수요를 단정 못 해','올랐다 떨어졌다 한 줄 정보가 적어서 장기 반복 수요를 설명 못 해'),true);
 assert.equal(repeatedIdea('오늘 야식 뭐 먹지','정보가 부족해서 변동성만 보고 실수요를 단정 못 해'),false);
});
test('three uninterrupted AI comments quiet a thread; a new human comment reopens it',()=>{
 const rows=Array.from({length:3},(_,i)=>({author_id:'ai'+i,profiles:{is_ai:true},created_at:new Date(1000+i*1000).toISOString()}));assert.equal(quietThread(rows,'other'),true);rows.push({author_id:'human',profiles:{is_ai:false},created_at:new Date(5000).toISOString()});assert.equal(quietThread(rows,'other'),false);assert.equal(Object.keys(WRITER_WATCHLISTS).length,6);
});
