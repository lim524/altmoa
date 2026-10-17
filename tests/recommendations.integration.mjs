// Optional PostgreSQL integration check. Point PGLITE_MODULE at @electric-sql/pglite's ESM entry.
// Never connects to the production database or uses real accounts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
if(!process.env.PGLITE_MODULE)throw new Error('Set PGLITE_MODULE to an installed @electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));
const db=new PGlite();
const users=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
const post='10000000-0000-0000-0000-000000000001';
const schema=fs.readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/recommendations.sql',import.meta.url),'utf8');
async function asUser(user,sql,params=[]){
 await db.exec('set role authenticated');
 try{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);return await db.query(sql,params);}finally{await db.exec('reset role');}
}
async function count(expected){const result=await db.query('select recommendation_count from public.posts where id=$1',[post]);assert.equal(result.rows[0].recommendation_count,expected);}
try{
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth,public to anon,authenticated;`);
 await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,delete on storage.objects to anon,authenticated;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
 await db.exec(schema);await db.exec(migration);await db.exec(fs.readFileSync(new URL('../supabase/activity.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/community-features.sql',import.meta.url),'utf8'));await db.exec(fs.readFileSync(new URL('../supabase/support.sql',import.meta.url),'utf8'));
 for(const id of users)await db.query('insert into auth.users(id) values($1)',[id]);
 await db.query("insert into public.posts(id,author_id,category,title,body,tags) values($1,$2,'분석','실제 추천 검사','추천 집계와 권한을 검사하는 글',array['SUI'])",[post,users[0]]);
 await asUser(users[1],"insert into public.comments(post_id,author_id,body) values($1,$2,'활동 집계용 댓글')",[post,users[1]]);
 const commentActivity=await asUser(users[1],'select comment_count from public.member_activity where id=$1',[users[1]]);assert.equal(commentActivity.rows[0].comment_count,1);
 const activity=await asUser(users[1],'select post_count,comment_count from public.member_activity where id=$1',[users[0]]);assert.equal(activity.rows[0].post_count,1);assert.equal(activity.rows[0].comment_count,0);
 await assert.rejects(asUser(users[1],'update public.profiles set is_ai=true where id=$1',[users[1]]),error=>error.code==='42501');
 await assert.rejects(asUser(users[0],'insert into public.post_recommendations(post_id,user_id) values($1,$2)',[post,users[0]]),error=>error.code==='42501');
 await assert.rejects(asUser(users[1],'insert into public.post_recommendations(post_id,user_id) values($1,$2)',[post,users[2]]),error=>error.code==='42501');
 await asUser(users[1],'insert into public.post_recommendations(post_id,user_id) values($1,$2)',[post,users[1]]);await count(1);
 await assert.rejects(asUser(users[1],'insert into public.post_recommendations(post_id,user_id) values($1,$2)',[post,users[1]]),error=>error.code==='23505');await count(1);
 await asUser(users[2],'insert into public.post_recommendations(post_id,user_id) values($1,$2)',[post,users[2]]);await count(2);
 const visible=await asUser(users[1],'select user_id from public.post_recommendations where post_id=$1',[post]);assert.deepEqual(visible.rows.map(row=>row.user_id),[users[1]]);
 await asUser(users[1],'delete from public.post_recommendations where post_id=$1 and user_id=$2',[post,users[2]]);await count(2);
 await assert.rejects(asUser(users[1],'update public.posts set recommendation_count=999 where id=$1',[post]),error=>error.code==='42501');await count(2);
 await db.exec(migration);await count(2);
 await asUser(users[1],'delete from public.post_recommendations where post_id=$1 and user_id=$2',[post,users[1]]);await count(1);
 await db.query("update public.posts set status='hidden' where id=$1",[post]);
 await assert.rejects(asUser(users[1],'insert into public.post_recommendations(post_id,user_id) values($1,$2)',[post,users[1]]),error=>error.code==='42501');
 await db.exec('set role anon');const publicRows=await db.query('select id from public.posts');assert.equal(publicRows.rows.length,0);const hiddenActivity=await db.query('select post_count from public.member_activity where id=$1',[users[0]]);assert.equal(hiddenActivity.rows[0].post_count,0);const hiddenCommentActivity=await db.query('select comment_count from public.member_activity where id=$1',[users[1]]);assert.equal(hiddenCommentActivity.rows[0].comment_count,0);await assert.rejects(db.query('select * from public.post_recommendations'),error=>error.code==='42501');await db.exec('reset role');
 await db.query('delete from auth.users where id=$1',[users[2]]);await count(0);

 // New features: tags and attachments validated in PostgreSQL; one private vote per account.
 let pollPost;const imagePath=users[1]+'/20000000-0000-0000-0000-000000000001.jpg';
 await assert.rejects(asUser(users[1],"insert into posts(author_id,category,title,body) values($1,'자유','태그 누락','입력 검사')",[users[1]]),/태그/);
 await assert.rejects(asUser(users[1],"insert into posts(author_id,category,title,body,tags,images) values($1,'자유','사진 위조','입력 검사',array['btc'],array['other/path.jpg'])",[users[1]]),/사진/);
 await asUser(users[1],"insert into storage.objects(bucket_id,name) values('post-images',$1)",[imagePath]);
 await db.exec("set role anon;select set_config('request.jwt.claim.sub','',false)");assert.equal((await db.query('select * from storage.objects')).rows.length,0);await db.exec('reset role');
 pollPost=(await asUser(users[1],"insert into posts(author_id,category,title,body,tags,images,poll_question,poll_options) values($1,'자유','투표 검사','입력 검사',array['btc','BTC','usdt'],array[$2],'어느 쪽인가요?',array['선택 A','선택 B']) returning id",[users[1],imagePath])).rows[0].id;
 assert.deepEqual((await db.query('select tags from posts where id=$1',[pollPost])).rows[0].tags,['BTC','USDT']);
 await db.exec("set role anon;select set_config('request.jwt.claim.sub','',false)");assert.equal((await db.query('select * from storage.objects')).rows.length,1);await assert.rejects(db.query('select * from support_tickets'),e=>e.code==='42501');await db.query("select public.submit_support('guest@example.com','권리침해 문의','이것은 문의 권한 확인용 내용입니다.')");await assert.rejects(db.query("select public.submit_support('guest@example.com','중복 문의','이것은 중복 접수 검사 내용입니다.')"),/5분/);await db.exec('reset role');
 await asUser(users[0],'insert into poll_votes(post_id,user_id,option_index) values($1,$2,0)',[pollPost,users[0]]);
 await assert.rejects(asUser(users[0],'insert into poll_votes(post_id,user_id,option_index) values($1,$2,1)',[pollPost,users[0]]),e=>e.code==='23505');
 await assert.rejects(asUser(users[1],'insert into poll_votes(post_id,user_id,option_index) values($1,$2,2)',[pollPost,users[1]]),e=>e.code==='42501');
 await assert.rejects(asUser(users[1],'insert into poll_votes(post_id,user_id,option_index) values($1,$2,0)',[pollPost,users[0]]),e=>e.code==='42501');
 assert.equal((await asUser(users[1],'select * from poll_votes')).rows.length,0);assert.equal((await asUser(users[1],'select * from support_tickets')).rows.length,0);
 await db.query('insert into moderators(user_id) values($1)',[users[1]]);assert.equal((await asUser(users[1],'select * from support_tickets')).rows.length,1);await asUser(users[1],'delete from support_tickets');assert.equal((await db.query('select * from support_tickets')).rows.length,0);
 await db.query("update posts set status='hidden' where id=$1",[pollPost]);await db.exec("set role anon;select set_config('request.jwt.claim.sub','',false)");assert.equal((await db.query('select * from poll_results($1)',[pollPost])).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);await db.exec('reset role');
 console.log('PostgreSQL integration passed: recommendations, activity, required normalized tags, image ownership/private visibility, duplicate/invalid/forged votes, hidden result exclusion, guest support throttling and operator-only inbox.');
}finally{await db.close();}
