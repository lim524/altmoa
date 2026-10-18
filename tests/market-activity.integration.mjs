import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const one='00000000-0000-0000-0000-000000000001',two='00000000-0000-0000-0000-000000000002';
try{
 await db.exec('create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;');await db.exec(fs.readFileSync('supabase/market-activity.sql','utf8'));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const sql of ['select * from market_activity_history','select * from market_activity_cache',`select market_activity_context(now(),true)`,`select claim_market_activity('${one}')`])await assert.rejects(db.query(sql),/permission denied/);await db.exec('reset role');}
 const claim=async token=>(await db.query('select claim_market_activity($1) v',[token])).rows[0].v,finish=async(token,data)=>(await db.query('select finish_market_activity($1,$2) v',[token,data])).rows[0].v;
 assert.equal(await claim(one),true);assert.equal(await claim(two),false);const snapshot={version:'v1',status:'collecting',asOf:new Date().toISOString(),score:null,coins:[]};assert.equal(await finish(two,snapshot),false);assert.equal(await finish(one,snapshot),true);assert.equal(await claim(two),false);
 const context=(await db.query('select market_activity_context(now(),false) c')).rows[0].c;assert.equal(context.chart.length,1);assert.deepEqual(context.baseline,[]);
 await db.exec("update market_activity_cache set computed_at=now()-interval '11 minutes',next_attempt_at='-infinity'");assert.equal(await claim(two),true);assert.equal(await finish(two,null),true);assert.deepEqual((await db.query('select snapshot from market_activity_cache')).rows[0].snapshot,snapshot);assert.equal(await claim(one),false);
 for(let i=1;i<=7;i++)await db.query("insert into market_activity_history values(now()-$1*interval '1 day',jsonb_build_object('version','v1','asOf',now()-$1*interval '1 day','score',50,'coins','[]'::jsonb))",[i]);
 const baseline=(await db.query('select market_activity_context(now(),true) c')).rows[0].c;assert.equal(baseline.baseline.length,7);assert.equal(baseline.chart.length,2);
 console.log('Activity database verified: private tables/RPCs, shared claims, old snapshot preservation, seven daily samples, thin chart context.');
}finally{await db.close()}
