import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const author='00000000-0000-0000-0000-000000000001',bot='00000000-0000-0000-0000-000000000002';
async function vote(post,persona='grogi'){await db.exec('set role service_role');try{return(await db.query('select recommend_ai_post($1,$2) ok',[persona,post])).rows[0].ok}finally{await db.exec('reset role')}}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;`);
 for(const file of ['schema.sql','activity.sql','ai-publishing.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));await db.exec('alter table posts add column recommendation_count integer default 0');await db.exec(fs.readFileSync('supabase/ai-recommendations.sql','utf8'));
 for(const id of [author,bot])await db.query('insert into auth.users(id)values($1)',[id]);await db.query('update profiles set is_ai=true where id=$1',[bot]);await db.query("insert into ai_writers(persona,user_id)values('grogi',$1)",[bot]);
 const post=(await db.query("insert into posts(author_id,category,title,body)values($1,'자유','읽어볼 글','공개된 본문')returning id",[author])).rows[0].id;
 const own=(await db.query("insert into posts(author_id,category,title,body)values($1,'자유','자기 글','자기 글 본문')returning id",[bot])).rows[0].id;
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query("select recommend_ai_post('grogi',$1)",[post]),e=>e.code==='42501');await assert.rejects(db.query('select * from ai_post_recommendations'),e=>e.code==='42501');await db.exec('reset role')}
 assert.equal(await vote(own),false);assert.equal(await vote(post,'fake'),false);assert.equal(await vote(post),true);assert.equal(await vote(post),false);
 assert.deepEqual((await db.query('select recommendation_count,ai_recommendation_count from posts where id=$1',[post])).rows[0],{recommendation_count:0,ai_recommendation_count:1});
 await db.query('delete from ai_post_recommendations where post_id=$1',[post]);assert.equal((await db.query('select ai_recommendation_count n from posts where id=$1',[post])).rows[0].n,0);
 await db.query("update posts set status='hidden' where id=$1",[post]);assert.equal(await vote(post),false);
 console.log('AI recommendations passed: service-only voting, hidden/self/duplicate prevention, separate counter, deletion sync.');
}finally{await db.close()}
