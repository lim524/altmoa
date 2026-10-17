import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const owner='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',ai='00000000-0000-0000-0000-000000000003';
async function as(role,id,sql,params=[]){await db.exec('set role '+role);try{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function profile(role,id,target=owner,kind='posts'){return(await as(role,id,'select member_profile($1,$2,0) data',[target,kind])).rows[0].data}
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));await db.exec(fs.readFileSync('supabase/activity.sql','utf8'));await db.exec('alter table comments add column parent_comment_id uuid references comments(id)');
 for(const id of [owner,other,ai])await db.query('insert into auth.users(id)values($1)',[id]);await db.query('update profiles set is_ai=true where id=$1',[ai]);
 await db.exec(fs.readFileSync('supabase/member-profiles.sql','utf8'));
 const pub=(await db.query("insert into posts(author_id,category,title,body)values($1,'자유','공개 글','공개 본문')returning id",[owner])).rows[0].id;
 await db.exec("update posts set created_at=now()-interval '2 minutes'");const hidden=(await db.query("insert into posts(author_id,category,title,body,status)values($1,'자유','숨김 글','숨긴 본문','hidden')returning id",[owner])).rows[0].id;
 await db.query("insert into comments(author_id,post_id,body)values($1,$2,'공개 답글')",[owner,pub]);await db.exec("update comments set created_at=now()-interval '20 seconds'");await db.query("insert into comments(author_id,post_id,body)values($1,$2,'숨긴 글의 댓글')",[owner,hidden]);
 let m=await profile('anon');assert.equal(m.can_view,false);assert.equal(m.items,undefined);assert.equal(m.post_count,undefined);
 m=await profile('authenticated',owner);assert.equal(m.can_view,true);assert.equal(m.post_count,1);assert.equal(m.comment_count,1);assert.equal(m.items[0].title,'공개 글');
 assert.equal((await as('authenticated',other,'update profiles set activity_public=true where id=$1 returning id',[owner])).rows.length,0);
 await assert.rejects(as('authenticated',owner,'update profiles set is_ai=true where id=$1',[owner]),e=>e.code==='42501');
 await as('authenticated',owner,'update profiles set activity_public=true where id=$1',[owner]);m=await profile('anon',null,owner,'comments');assert.equal(m.can_view,true);assert.equal(m.items.length,1);assert.equal(m.items[0].body,'공개 답글');assert.equal(m.items[0].post_title,'공개 글');
 await as('authenticated',owner,'update profiles set activity_public=false where id=$1',[owner]);assert.equal((await profile('authenticated',other)).can_view,false);
 assert.equal((await profile('anon',null,ai)).can_view,true);
 await assert.rejects(as('anon',null,"select member_profile($1,'posts',-1)",[owner]),/invalid_profile_request/);
 console.log('Member profiles passed: opt-in, owner visibility, hidden-content filtering, own-only privacy changes, AI identity protected, AI profiles public.');
}finally{await db.close()}
