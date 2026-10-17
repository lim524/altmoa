import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {GET} from '../api/index.mjs';
import {renderPage,publisherId,siteOrigin,guides} from '../lib/site-pages.mjs';
const original=globalThis.fetch;
function setup(){process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_ANON_KEY='sb_publishable_test';}
function cleanup(){globalThis.fetch=original;delete process.env.SUPABASE_URL;delete process.env.SUPABASE_ANON_KEY;}
test('public post is escaped HTML, anonymously fetched and disappears with 404 when hidden',async()=>{
 setup();const id='10000000-0000-0000-0000-000000000001';let hidden=false;globalThis.fetch=async(url,options)=>{assert.match(String(url),/status=eq.published/);assert.equal(options.headers.Authorization,undefined);return Response.json(hidden?[]:[{id,title:'<script>bad</script>',body:'<img onerror=bad>\n원본 내용',category:'분석',created_at:new Date().toISOString(),profiles:{nickname:'<svg>'},tags:['BTC']}]);};
 try{const response=await GET(new Request('https://altmoa.example/api/index?route=public-post&id='+id)),html=await response.text();assert.equal(response.status,200);assert.match(html,/&lt;script&gt;bad/);assert.doesNotMatch(html,/<img onerror|<svg>|adsbygoogle/);assert.match(html,/rel="canonical"/);assert.equal(response.headers.get('Cache-Control'),'no-store');hidden=true;assert.equal((await GET(new Request('https://altmoa.example/api/index?route=public-post&id='+id))).status,404);}finally{cleanup();}
});
test('public community has ordinary crawlable post links and upstream errors are 503',async()=>{
 setup();globalThis.fetch=async()=>Response.json([{id:'10000000-0000-0000-0000-000000000001',title:'공개 제목',category:'자유'}]);try{const response=await GET(new Request('https://altmoa.example/api/public-community'));assert.match(await response.text(),/href="\/posts\/10000000/);globalThis.fetch=async()=>new Response('',{status:500});assert.equal((await GET(new Request('https://altmoa.example/api/public-community'))).status,503);}finally{cleanup();}
});
test('publisher verification rejects placeholders and canonical cannot be request-host poisoned',()=>{
 process.env.ADSENSE_PUBLISHER_ID='ca-pub-000';assert.equal(publisherId(),'');process.env.ADSENSE_PUBLISHER_ID='ca-pub-1234567890123456';assert.match(renderPage({title:'test',description:'test',body:'test'}),/google-adsense-account/);delete process.env.ADSENSE_PUBLISHER_ID;process.env.SITE_URL='javascript:alert(1)';assert.equal(siteOrigin(),'https://www.altmoa.com');delete process.env.SITE_URL;
});
test('build is idempotent with real guides, policies, sitemap and no fake ad inventory',()=>{
 execFileSync(process.execPath,['scripts/build.mjs']);const first=fs.readFileSync('dist/index.html','utf8');execFileSync(process.execPath,['scripts/build.mjs']);assert.equal(fs.readFileSync('dist/index.html','utf8'),first);assert.equal((first.match(/GUIDES:START/g)||[]).length,0);assert.match(first,/<footer[\s\S]*href="\/guides"/);assert.doesNotMatch(first.split('<footer')[0],/href="\/guides/);assert.doesNotMatch(first,/class="adslot|adsbygoogle|data-attention-scope|attentionregion/);assert.equal(fs.existsSync('dist/ads.txt'),false);for(const guide of guides){const html=fs.readFileSync('dist/guides/'+guide.slug+'/index.html','utf8');assert.match(html,/<h1>/);assert.ok(guide.body.length>1000);assert.doesNotMatch(first,new RegExp('/guides/'+guide.slug));}const sitemap=fs.readFileSync('dist/sitemap.xml','utf8');assert.match(sitemap,/\/community/);assert.doesNotMatch(sitemap,/\/contact|view=activity|view=saved/);
});
