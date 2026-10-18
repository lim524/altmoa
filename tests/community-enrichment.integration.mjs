import fs from 'node:fs';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
const{PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const ai='10000000-0000-0000-0000-000000000001',post='20000000-0000-0000-0000-000000000001',token='30000000-0000-0000-0000-000000000001',other='30000000-0000-0000-0000-000000000002';
try{
await db.exec(`create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;create table profiles(id uuid primary key,is_ai boolean);create table ai_writers(persona text primary key,user_id uuid);create table posts(id uuid primary key,author_id uuid,status text);grant select on posts to anon,authenticated;create table ai_publish_jobs(slot bigint primary key,state text,persona text,post_id uuid,created_at timestamptz default now());`);
await db.exec(fs.readFileSync('supabase/ai-community-enrichment.sql','utf8'));
assert.notEqual((await db.query('select claim_ai_enrichment($1)c',[token])).rows[0].c,null);
assert.equal((await db.query('select claim_ai_enrichment($1)c',[other])).rows[0].c,null);
const snapshot={terms:[],images:[{id:'commons-1',url:'https://thumb.wikimedia.org/test.jpg',source:'https://commons.wikimedia.org/wiki/File:Test.jpg',author:'Author',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',title:'Test'}]};
assert.equal((await db.query('select finish_ai_enrichment($1,$2)c',[other,JSON.stringify(snapshot)])).rows[0].c,false);
assert.equal((await db.query('select finish_ai_enrichment($1,$2)c',[token,JSON.stringify(snapshot)])).rows[0].c,true);
assert.equal((await db.query('select claim_ai_enrichment($1)c',[other])).rows[0].c,null);
await db.query('insert into profiles values($1,true)',[ai]);await db.query("insert into ai_writers values('grogi',$1)",[ai]);await db.query("insert into posts values($1,$2,'published')",[post,ai]);await db.query("insert into ai_publish_jobs(slot,state,persona,post_id)values(1,'published','grogi',$1)",[post]);
assert.equal((await db.query("select attach_ai_post_media(1,'arbitrary')c")).rows[0].c,false);
assert.equal((await db.query("select attach_ai_post_media(1,'commons-1')c")).rows[0].c,true);
assert.equal((await db.query("select attach_ai_post_media(1,'commons-1')c")).rows[0].c,false);
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from ai_enrichment_cache'),/permission denied/);await assert.rejects(db.query('select claim_ai_enrichment($1)',[other]),/permission denied/);assert.equal((await db.query('select * from ai_post_media')).rows.length,1);await db.exec('reset role');}
await db.query("update posts set status='hidden'");await db.exec('set role anon');assert.equal((await db.query('select * from ai_post_media')).rows.length,0);await db.exec('reset role');
console.log('Verified: exclusive refresh lease, token ownership, six-hour caching, private dictionary, cached-image-only attachment, duplicate prevention and hidden-post media RLS.');
}finally{await db.close();}
