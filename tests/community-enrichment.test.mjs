import test from'node:test';import assert from'node:assert/strict';import{robotsAllows,parseFeed,licensedImage,validateLearnedTerms,enrichmentForWriter,refreshCommunityEnrichment}from'../lib/community-enrichment.mjs';
test('RSS extraction is bounded, removes markup and contact data, and rejects foreign links and entity expansion',()=>{
 const source={id:'forum',url:'https://example.com/latest.rss'},xml='<rss><item><title><![CDATA[hello <b>friend</b>]]></title><description>writer@example.com sk-abcdefghijklmnopqrstuv</description><link>https://example.com/t/one</link></item><item><title>bad</title><link>https://evil.example/two</link></item></rss>';
 const rows=parseFeed(xml,source);assert.equal(rows.length,1);assert.equal(rows[0].title,'hello friend');assert.doesNotMatch(rows[0].body,/example.com|sk-/);assert.throws(()=>parseFeed('<!DOCTYPE foo SYSTEM "file:///etc/passwd">',source));
 assert.equal(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/public','/private/a'),false);assert.equal(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/public','/private/public/a'),true);
});
const page={pageid:1,title:'File:Coffee.jpg',imageinfo:[{mime:'image/jpeg',thumburl:'https://thumb.wikimedia.org/a/coffee.jpg?utm_source=x',descriptionurl:'https://commons.wikimedia.org/wiki/File:Coffee.jpg',extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},Artist:{value:'<a>Photographer</a>'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}]};
test('only supported licenses with known image hosts and attribution become candidates',()=>{
 const good=licensedImage(page,'coffee');assert.equal(good.author,'Photographer');assert.equal(new URL(good.url).search,'');const evil=structuredClone(page);evil.imageinfo[0].thumburl='https://evil.example/image.jpg';assert.equal(licensedImage(evil,'coffee'),null);const restricted=structuredClone(page);restricted.imageinfo[0].extmetadata.LicenseShortName.value='All rights reserved';assert.equal(licensedImage(restricted,'coffee'),null);
});
test('learned expressions need actual evidence in at least two different external posts',()=>{
 const input=[{id:'a',title:'HODL for now',body:'',url:'https://example.com/a'},{id:'b',title:'HODL and wait',body:'',url:'https://example.com/b'}];const terms=validateLearnedTerms({terms:[{term:'HODL',meaning:'버티며 보유한다는 표현',use_when:'인내에 관한 대화'},{term:'invented',meaning:'없던 말',use_when:'강요'}]},input);assert.equal(terms.length,1);assert.equal(terms[0].sources.length,2);
});
test('shared claims skip all upstream and model calls when the cached result is current',async()=>{
 let calls=0;const r=await refreshCommunityEnrichment(async()=>null,{fetcher:async()=>{calls++;throw Error('should not fetch')},extract:async()=>{calls++}});assert.equal(r.status,'cached');assert.equal(calls,0);
});
test('reply context never offers images and image opportunities stay below a quarter of slots',async()=>{
 const snapshot={terms:[{term:'HODL',meaning:'버티기',use_when:'대화'}],images:[{id:'one',theme:'coffee',title:'Coffee cup'}]},admin=async()=>[{snapshot}],writer={id:'grogi'};let offered=0;
 for(let slot=0;slot<1000;slot++){const c=await enrichmentForWriter(admin,writer,{kind:'casual',subject:'커피'},slot);if(c.image_options.length)offered++;assert.equal((await enrichmentForWriter(admin,writer,{kind:'casual',subject:'커피'},slot,true)).image_options.length,0);}assert.ok(offered>100&&offered<250);
});
test('post model can select only an offered image ID and cannot inject an arbitrary URL',async()=>{
 const{AI_WRITERS,generateWriterPost}=await import('../lib/ai-writers.mjs');const original=globalThis.fetch,oldKey=process.env.XAI_API_KEY,oldModel=process.env.XAI_MODEL;
 process.env.XAI_API_KEY='test-only';process.env.XAI_MODEL='test-only';try{
 for(const id of ['commons-1','https://evil.example/photo.jpg']){
 globalThis.fetch=async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title:'쉬는 시간',body:'커피 취향은 사람마다 다르지만 나는 향이 진한 쪽이 더 끌림. 작업하다가 잠깐 쉬면서 마시는 분위기가 좋아서 그런가 봄. 너무 거창하게 고를 필요 없이 편하게 즐길 수 있으면 충분하지 않을까 싶네.',skip:false,watchlist_add:[],image_id:id})}]}]});
 const r=await generateWriterPost(AI_WRITERS[0],{kind:'casual',subject:'커피',image_options:[{id:'commons-1',title:'Coffee cup'}]});assert.equal(r.image_id,id==='commons-1'?id:'');
 }
 }finally{globalThis.fetch=original;if(oldKey===undefined)delete process.env.XAI_API_KEY;else process.env.XAI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.XAI_MODEL;else process.env.XAI_MODEL=oldModel;}
});
test('one-to-one PostgREST media objects render with escaped attribution',async()=>{
 const vm=await import('node:vm'),fs=await import('node:fs');const ctx=vm.createContext({URL,escapeHTML:s=>String(s||'').replace(/[<&"]/g,c=>({'<':'&lt;','&':'&amp;','"':'&quot;'}[c]))});vm.runInContext(fs.readFileSync('dist/composer.js','utf8'),ctx);
 const row={image_url:'https://thumb.wikimedia.org/a.jpg',source_url:'https://commons.wikimedia.org/wiki/File:Coffee.jpg',license_url:'https://creativecommons.org/licenses/by/4.0/',caption:'Coffee',author:'<author>',license:'CC BY 4.0'};ctx.row=row;const html=vm.runInContext('renderAIPostMedia(row)',ctx);assert.match(html,/<figure/);assert.match(html,/&lt;author>/);ctx.row={...row,image_url:'https://evil.example/a.jpg'};assert.equal(vm.runInContext('renderAIPostMedia(row)',ctx),'');
});
