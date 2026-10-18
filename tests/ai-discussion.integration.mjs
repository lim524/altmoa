import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const ai1='10000000-0000-0000-0000-000000000001',ai2='10000000-0000-0000-0000-000000000002',human='10000000-0000-0000-0000-000000000003',post='20000000-0000-0000-0000-000000000001';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;
 create table profiles(id uuid primary key,is_ai boolean);create table ai_writers(persona text primary key,user_id uuid);create table posts(id uuid primary key,author_id uuid,title text,body text,status text,created_at timestamptz default now());create table comments(id uuid primary key,author_id uuid,post_id uuid,parent_comment_id uuid,body text,status text,created_at timestamptz default now());
 create table ai_publish_jobs(slot bigint primary key,persona text,state text default 'claimed',created_at timestamptz default now());create table ai_reply_jobs(slot bigint primary key,persona text,state text default 'claimed',created_at timestamptz default now(),target_kind text,target_id uuid,post_id uuid);
 create unique index one_ai_reply_per_target on ai_reply_jobs(target_kind,target_id)where state='published';`);
 await db.exec(fs.readFileSync('supabase/ai-discussion.sql','utf8'));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query("select claim_ai_publish_irregular('grogi')"),/permission denied/);await assert.rejects(db.query("select claim_ai_reply_irregular('grogi')"),/permission denied/);await db.exec('reset role');}
 await db.query('insert into profiles values($1,true),($2,true),($3,false)',[ai1,ai2,human]);await db.query("insert into ai_writers values('grogi',$1),('jipi',$2)",[ai1,ai2]);await db.query("insert into posts(id,author_id,title,body,status) values($1,$2,'주장','본문','published')",[post,human]);
 for(let i=0;i<3;i++)await db.query("insert into ai_publish_jobs values($1,'grogi',$2,now()-interval '2 minutes')",[i,['published','failed','skipped'][i]]);
 assert.equal((await db.query("select claim_ai_publish_irregular('grogi') c")).rows[0].c,null);
 await db.exec("update ai_publish_jobs set created_at=now()-interval '2 hours'");assert.notEqual((await db.query("select claim_ai_publish_irregular('grogi') c")).rows[0].c,null);assert.equal((await db.query("select claim_ai_publish('jipi') c")).rows[0].c,null);
 for(let i=0;i<24;i++)await db.query("insert into ai_reply_jobs(slot,persona,state) values($1,'grogi',$2)",[i,['published','failed','skipped'][i%3]]);
 assert.equal((await db.query("select claim_ai_reply_irregular('grogi') c")).rows[0].c,null);await db.exec("update ai_reply_jobs set created_at=now()-interval '2 hours'");assert.ok((await db.query("select claim_ai_reply_irregular('grogi') c")).rows[0].c);
 await db.query("insert into ai_reply_jobs(slot,persona,state,target_kind,target_id,post_id)values(100,'grogi','published','post',$1,$1)",[post]);
 assert.equal((await db.query("select ai_reply_eligible('post',$1,$2) ok",[post,ai1])).rows[0].ok,false);assert.equal((await db.query("select ai_reply_eligible('post',$1,$2) ok",[post,ai2])).rows[0].ok,true);
 await db.query("insert into ai_reply_jobs(slot,persona,state,target_kind,target_id,post_id)values(101,'jipi','published','post',$1,$1)",[post]);
 const chain=[];for(let i=0;i<5;i++){const id='30000000-0000-0000-0000-'+String(i+1).padStart(12,'0');chain.push(id);await db.query("insert into comments(id,author_id,post_id,parent_comment_id,body,status)values($1,$2,$3,$4,'논점','published')",[id,i%2?ai2:ai1,post,i?chain[i-1]:null]);}
 assert.equal((await db.query("select ai_reply_eligible('comment',$1,$2) ok",[chain[2],ai2])).rows[0].ok,true);assert.equal((await db.query("select ai_reply_eligible('comment',$1,$2) ok",[chain[3],ai1])).rows[0].ok,false);
 console.log('Discussion DB verified: rolling 3/24 attempts, legacy entry points share caps, per-writer target uniqueness, four-AI-turn bound and private functions.');
}finally{await db.close()}
