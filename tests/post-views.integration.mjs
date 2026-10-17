import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const owner='00000000-0000-0000-0000-000000000001';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));await db.exec(`create table ai_writers(persona text primary key,user_id uuid);insert into ai_writers values('grogi','${owner}');insert into auth.users values('${owner}','{}');`);
 await db.exec(fs.readFileSync('supabase/post-views.sql','utf8'));
 const id=(await db.query("insert into posts(author_id,category,title,body)values($1,'자유','조회 테스트','조회 본문')returning id",[owner])).rows[0].id;
 const record=async(viewer,ai=false)=>(await db.query('select * from record_post_views($1,$2,$3)',[[id],viewer,ai])).rows[0];
 assert.equal((await record('browser-one')).view_count,1);assert.equal((await record('browser-one')).view_count,1);assert.equal((await record('browser-two')).view_count,2);
 let result=await record('ai:grogi',true);assert.equal(result.view_count,3);assert.equal(result.ai_view_count,1);assert.equal((await record('ai:grogi',true)).view_count,3);
 await assert.rejects(record('ai:unknown',true),/invalid_ai_viewer/);
 await db.exec("update post_view_readers set view_day=view_day-1");assert.equal((await record('browser-one')).view_count,4);
 await db.exec('set role anon');await assert.rejects(db.query('select * from record_post_views($1,$2,false)',[[id],'forged']),/permission denied/);await assert.rejects(db.query('select * from post_view_readers'),/permission denied/);await db.exec('reset role');
 await db.exec('set role authenticated');await assert.rejects(db.query('update posts set view_count=1000 where id=$1',[id]),/permission denied/);await db.exec('reset role');
 await db.query("update posts set status='hidden' where id=$1",[id]);assert.equal((await db.query('select * from record_post_views($1,$2,false)',[[id],'browser-three'])).rows.length,0);
 console.log('Views passed: atomic daily dedup, separate AI subtotal, next day, hidden posts, no client writes or reader disclosure.');
}finally{await db.close()}
