import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const ids=Array.from({length:5},(_,i)=>'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'));
async function user(id,sql,params=[]){await db.exec('set role authenticated');try{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);return await db.query(sql,params);}finally{await db.exec('reset role')}}
async function claim(persona){await db.exec('set role service_role');try{return(await db.query('select claim_ai_reply_irregular($1) data',[persona])).rows[0].data}finally{await db.exec('reset role')}}
async function finish(slot,kind,target){await db.exec('set role service_role');try{return(await db.query('select finish_ai_reply($1,$2,$3,$4) id',[slot,kind,target,'다른 관점에서 보면 해석이 달라질 수도 있어요. 한 가지 근거만 보고 바로 단정하기는 어렵다고 생각합니다.'])).rows[0].id}finally{await db.exec('reset role')}}
async function nextSlot(){await db.exec("update ai_reply_jobs set slot=slot-1000000,created_at=now()-interval '10 minutes';update comments set created_at=now()-interval '20 seconds'");}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;`);
 for(const file of ['schema.sql','activity.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));await db.exec("alter table posts add column tags text[] not null default '{}';grant insert(tags) on posts to authenticated");await db.exec(fs.readFileSync('supabase/ai-publishing.sql','utf8'));await db.exec(fs.readFileSync('supabase/ai-replies.sql','utf8'));await db.exec(fs.readFileSync('supabase/ai-body-cleanup.sql','utf8'));await db.exec(fs.readFileSync('supabase/ai-irregular-schedule.sql','utf8'));
 for(const id of ids)await db.query('insert into auth.users(id)values($1)',[id]);for(let i=1;i<=3;i++){await db.query('update profiles set is_ai=true where id=$1',[ids[i]]);await db.query('insert into ai_writers(persona,user_id)values($1,$2)',[['grogi','grokong','jipi'][i-1],ids[i]]);}
 const post=(await user(ids[0],"insert into posts(author_id,title,body,category,tags)values($1,'사람의 질문','다양한 의견이 궁금합니다.','질문',array['BTC'])returning id",[ids[0]])).rows[0].id;
 const other=(await user(ids[4],"insert into posts(author_id,title,body,category,tags)values($1,'다른 글','별도 글입니다.','자유',array['BTC'])returning id",[ids[4]])).rows[0].id;
 const root=(await user(ids[0],"insert into comments(author_id,post_id,body)values($1,$2,'원댓글입니다')returning id",[ids[0],post])).rows[0].id;await db.exec("update comments set created_at=now()-interval '20 seconds'");
 await assert.rejects(user(ids[0],"insert into comments(author_id,post_id,parent_comment_id,body)values($1,$2,$3,'다른 글에 부모를 연결할 수 없습니다')",[ids[0],other,root]),/답글 대상/);
 const child=(await user(ids[0],"insert into comments(author_id,post_id,parent_comment_id,body)values($1,$2,$3,'같은 글에 답글을 달아요')returning id",[ids[0],post,root])).rows[0].id;
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query("select claim_ai_reply_irregular('grogi')"),e=>e.code==='42501');await db.exec('reset role')}
 let job=await claim('grogi');assert.ok(Math.abs(Number(job.slot)-Math.floor(Date.now()/60000))<=1);assert.ok(job.candidates.some(c=>c.target_id===child));assert.equal(await claim('grokong'),null);const first=await finish(job.slot,'comment',child);assert.ok(first);assert.equal(await finish(job.slot,'comment',child),null);
 await nextSlot();job=await claim('grokong');assert.ok(job.candidates.some(c=>c.target_id===first&&c.author_is_ai));assert.equal(job.candidates.some(c=>c.target_id===child),false);const second=await finish(job.slot,'comment',first);assert.ok(second);
 await nextSlot();job=await claim('jipi');assert.equal(job.candidates.some(c=>c.target_id===second),false);assert.equal(await finish(job.slot,'comment',second),null);
 // Deletion/hiding between selection and commit must be rechecked server-side.
 await nextSlot();job=await claim('jipi');await db.query("update posts set status='hidden' where id=$1",[other]);assert.equal(await finish(job.slot,'post',other),null);
 await db.exec('set role anon');assert.equal((await db.query('select count(*)::int n from comments where post_id=$1',[other])).rows[0].n,0);await db.exec('reset role');
 // AI comments capped per thread even if new human targets are available.
 await db.query("insert into ai_reply_jobs(slot,persona,state,post_id,created_at)select g,'grogi','published',$1,now()-interval '1 minute' from generate_series(1,6)g",[post]);assert.equal((await db.query("select ai_reply_eligible('post',$1,$2) ok",[post,ids[3]])).rows[0].ok,false);
 console.log('AI reply PostgreSQL integration passed: parent ownership, service-only jobs, selective candidates, human/AI targets, duplicate prevention, two-AI-turn stop, hidden-target recheck and thread quota.');
}finally{await db.close()}
