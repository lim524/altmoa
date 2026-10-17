import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const author='00000000-0000-0000-0000-000000000001',operator='00000000-0000-0000-0000-000000000002';
async function asUser(id,sql,params=[]){await db.exec('set role authenticated');try{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);return await db.query(sql,params)}finally{await db.exec('reset role')}}
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));await db.exec(fs.readFileSync('supabase/moderator-edit.sql','utf8'));
 for(const id of [author,operator])await db.query('insert into auth.users(id)values($1)',[id]);
 const post=(await asUser(author,"insert into posts(author_id,category,title,body)values($1,'자유','원래 제목','원래 본문')returning id",[author])).rows[0].id;
 await assert.rejects(asUser(author,"select moderator_edit_post($1,'수정 제목','수정 본문')",[post]),e=>e.code==='42501');
 await db.query('insert into moderators(user_id)values($1)',[operator]);
 await asUser(operator,"select moderator_edit_post($1,'수정 제목','수정 본문')",[post]);
 const saved=(await db.query('select author_id,title,body from posts where id=$1',[post])).rows[0];assert.deepEqual(saved,{author_id:author,title:'수정 제목',body:'수정 본문'});
 await assert.rejects(asUser(operator,"select moderator_edit_post($1,' ','수정 본문')",[post]),/길이/);
 await db.exec('set role anon');await assert.rejects(db.query("select moderator_edit_post($1,'수정 제목','수정 본문')",[post]),e=>e.code==='42501');await db.exec('reset role');
 await asUser(operator,'delete from posts where id=$1',[post]);assert.equal((await db.query('select count(*)::int n from posts')).rows[0].n,0);
 console.log('Moderator integration passed: ordinary/anonymous edits denied, operator edit and delete allowed, original author preserved.');
}finally{await db.close()}
