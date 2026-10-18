import fs from 'node:fs';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';import{createHmac}from'node:crypto';import{dailyPostPlan}from'../lib/ai-schedule.mjs';
const{PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite(),key='fake-daily-key-12345678901234567890';
const human='10000000-0000-0000-0000-000000000001',ai='10000000-0000-0000-0000-000000000002',other='10000000-0000-0000-0000-000000000003',post='20000000-0000-0000-0000-000000000001',comment='30000000-0000-0000-0000-000000000001';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table digest_fixtures(data text primary key,hex text);create function extensions.hmac(data bytea,key bytea,kind text)returns bytea language sql immutable as $$select decode(hex,'hex')from public.digest_fixtures where data=convert_from($1,'UTF8')$$;
 create table profiles(id uuid primary key,is_ai boolean,nickname text);create table ai_writers(persona text primary key,user_id uuid);create table posts(id uuid primary key,author_id uuid,title text,body text,status text,recommendation_count int default 0,ai_recommendation_count int default 0,created_at timestamptz default now());create table comments(id uuid primary key,author_id uuid,post_id uuid,parent_comment_id uuid,body text,status text,created_at timestamptz default now());
 create table ai_publish_jobs(slot bigint primary key,persona text,state text default 'claimed',created_at timestamptz default now());create table ai_reply_jobs(slot bigint primary key,persona text,state text default 'claimed',created_at timestamptz default now(),target_kind text,target_id uuid,post_id uuid);`);
 await db.query('insert into profiles values($1,false,\'human\'),($2,true,\'AI\'),($3,false,\'other\')',[human,ai,other]);await db.query("insert into ai_writers values('grogi',$1)",[ai]);await db.query("insert into posts(id,author_id,title,body,status,recommendation_count,ai_recommendation_count)values($1,$2,'주장','본문','published',3,2)",[post,human]);
 await db.query("insert into comments(id,author_id,post_id,body,status)values($1,$2,$3,'새로운 반론','published')",[comment,ai,post]);
 await db.exec(fs.readFileSync('supabase/community-conversations.sql','utf8'));
 assert.equal((await db.query('select total_recommendation_count n from posts')).rows[0].n,5);
 await db.exec("insert into ai_publish_jobs(slot,persona,state)select -i,'grogi','failed'from generate_series(1,3)i");assert.notEqual((await db.query("select claim_ai_publish_irregular('grogi')c")).rows[0].c,null);
 assert.equal((await db.query("select claim_ai_publish_irregular('grogi')c")).rows[0].c,null);
 await db.exec("insert into ai_publish_jobs(slot,persona,state)select -i,'grogi','failed'from generate_series(4,100)i");assert.equal((await db.query("select claim_ai_publish_irregular('grogi')c")).rows[0].c,null);

 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from ai_writer_memory'),/permission denied/);await assert.rejects(db.query("select ai_memory_context('grogi')"),/permission denied/);await db.exec('reset role');}
 for(const day of ['2026-10-18','2026-10-19','2026-10-20']){
  const data=['daily-v1:target:'+day,...Array.from({length:1440},(_,i)=>'daily-v1:minute:'+day+':'+i)].map(data=>({data,hex:createHmac('sha256',key).update(data).digest('hex')}));await db.query('insert into digest_fixtures select * from jsonb_to_recordset($1::jsonb)as x(data text,hex text)',[JSON.stringify(data)]);
  const sql=(await db.query('select ai_daily_plan($1,$2)p',[day,key])).rows[0].p;assert.deepEqual(sql,dailyPostPlan(Date.parse(day+'T12:00+09:00'),key));
 }
 await db.query("select set_config('test.uid',$1,false)",[human]);let notes=(await db.query("select reply_notifications(now()-interval '1 hour') n")).rows[0].n;assert.equal(notes.length,1);
 await db.query("select set_config('test.uid',$1,false)",[other]);assert.deepEqual((await db.query("select reply_notifications(now()-interval '1 hour') n")).rows[0].n,[]);
 assert.equal((await db.query("select member_ai_watchlist($1) w",[ai])).rows[0].w.length,3);
 assert.equal((await db.query("select ai_memory_context('grogi')m")).rows[0].m.length,1);
 await db.query("update posts set status='hidden'where id=$1",[post]);assert.deepEqual((await db.query("select ai_memory_context('grogi')m")).rows[0].m,[]);
 console.log('Verified: SQL/Node exact daily plan parity across 3 days, total votes, private memory, hidden-source exclusion, recipient-only notifications and public AI watchlists.');
}finally{await db.close();}
