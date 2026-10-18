import fs from'node:fs';import assert from'node:assert/strict';import{pathToFileURL}from'node:url';
const{PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();try{
await db.exec("create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;create table technical_rank_cache(interval text,snapshot jsonb,computed_at timestamptz);");await db.exec(fs.readFileSync('supabase/ai-technical-context.sql','utf8'));
for(const interval of ['1h','4h','1d'])await db.query('insert into technical_rank_cache values($1,$2,now())',[interval,JSON.stringify({scopeVersion:'volume100-v1',items:[{symbol:'SUI'},{symbol:'BTC'},{symbol:'ETH'}]})]);
const rows=(await db.query("select ai_cached_technicals(array['SUI','BTC','ETH'])x")).rows[0].x;assert.equal(rows.length,4);assert.ok(rows.every(r=>r.symbol!=='ETH'&&r.interval!=='1d'));
await db.exec("update technical_rank_cache set computed_at=now()-interval '6 minutes'");assert.deepEqual((await db.query("select ai_cached_technicals(array['SUI'])x")).rows[0].x,[]);
await db.exec('set role anon');await assert.rejects(db.query("select ai_cached_technicals(array['SUI'])"),/permission denied/);await db.exec('reset role');console.log('Verified: bounded symbol filtering, interval scope, freshness and server-only execution.');
}finally{await db.close();}
