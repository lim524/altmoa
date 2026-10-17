import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const first='00000000-0000-0000-0000-000000000001',second='00000000-0000-0000-0000-000000000002';
try{
 await db.exec('create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;');await db.exec(fs.readFileSync('supabase/technical-ranking.sql','utf8'));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select claim_technical_rank($1,$2)',['1h',first]),/permission denied/);await assert.rejects(db.query('select * from technical_rank_cache'),/permission denied/);await db.exec('reset role');}
 const claim=async token=>(await db.query('select claim_technical_rank($1,$2) ok',['1h',token])).rows[0].ok;
 const finish=async(token,snapshot)=>(await db.query('select finish_technical_rank($1,$2,$3) ok',['1h',token,snapshot])).rows[0].ok;
 assert.equal(await claim(first),true);assert.equal(await claim(second),false);
 const snapshot={interval:'1h',status:'ready',items:[{symbol:'SUI',scoring:{total:80}}]};assert.equal(await finish(second,snapshot),false);assert.equal(await finish(first,snapshot),true);assert.equal(await claim(second),false);
 await db.exec("update technical_rank_cache set computed_at=now()-interval '6 minutes',next_attempt_at='-infinity'");assert.equal(await claim(second),true);assert.equal(await finish(second,null),true);
 assert.deepEqual((await db.query('select snapshot from technical_rank_cache')).rows[0].snapshot,snapshot);assert.equal(await claim(first),false);
 await db.exec("update technical_rank_cache set next_attempt_at='-infinity'");assert.equal(await claim(first),true);await db.exec("update technical_rank_cache set lease_until=now()-interval '1 second'");assert.equal(await claim(second),true);assert.equal(await finish(first,snapshot),false);assert.equal(await finish(second,snapshot),true);
 await assert.rejects(db.query('select claim_technical_rank($1,$2)',['evil',first]),/invalid_rank_request/);
 console.log('Ranking DB passed: server-only access, shared lease, cache reuse, retry cooldown, previous snapshot preserved and expired-owner rejection.');
}finally{await db.close()}
