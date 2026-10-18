import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createHmac} from 'node:crypto';import {aiScheduleDue} from '../lib/ai-schedule.mjs';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite(),key='test-schedule-secret-123456789012345678901';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;grant usage on schema public,extensions to anon,authenticated,service_role;create table digest_fixtures(data text,key text,hex text,primary key(data,key));grant select on digest_fixtures to service_role;create function extensions.hmac(data bytea,key bytea,kind text)returns bytea language sql immutable as $$select decode(hex,'hex') from public.digest_fixtures where data=convert_from($1,'UTF8') and key=convert_from($2,'UTF8')$$;`);
 const fixtures=new Map(),start=30000000;
 for(let m=start;m<start+1000;m++)for(const kind of ['post','reply'])for(const suffix of [kind+':activity:'+Math.floor(m/60),kind+':due:'+m]){const data='irregular-v2:'+suffix;fixtures.set(data,{data,key,hex:createHmac('sha256',key).update(data).digest('hex')});}
 await db.query('insert into digest_fixtures select * from jsonb_to_recordset($1::jsonb) as f(data text,key text,hex text)',[JSON.stringify([...fixtures.values()])]);await db.exec(fs.readFileSync('supabase/ai-economical-wakeup.sql','utf8'));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query("select ai_minute_due('post',now(),$1)",[key]),/permission denied/);await assert.rejects(db.query('select wake_ai_if_due()'),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');
 for(let m=start;m<start+1000;m++){const at=m*60000;const r=(await db.query("select ai_minute_due('post',$1,$2) p,ai_minute_due('reply',$1,$2) r",[new Date(at).toISOString(),key])).rows[0];// This test targets the legacy preflight migration; the daily replacement is tested in community-conversations.integration.mjs.
  const hour=Math.floor(at/3600000),minute=Math.floor(at/60000),h=s=>createHmac('sha256',key).update('irregular-v2:'+s).digest().readUInt32BE(0);assert.equal(r.p,h('post:due:'+minute)/4294967296<[.04,.06,.08][h('post:activity:'+hour)%3]);assert.equal(r.r,aiScheduleDue('reply',at,key));}
 assert.equal((await db.query("select ai_minute_due(null,now(),$1) d",[key])).rows[0].d,false);
 console.log('SQL/Node scheduling parity passed for 2,000 decisions, independent post/reply gates, unsigned digest parsing and server-only permissions.');
}finally{await db.close()}
