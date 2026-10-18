import {refreshCommunityEnrichment}from './community-enrichment.mjs';
import {aiAdmin}from './ai-publisher.mjs';
import {authorized,runAIPublisher} from './ai-publisher.mjs';
import {runAIReplies} from './ai-replies.mjs';
export async function runAITick(request,{publish=runAIPublisher,reply=runAIReplies,enrich=()=>refreshCommunityEnrichment(aiAdmin)}={}){
 const headers={'Cache-Control':'no-store'};
 if(!authorized(request))return Response.json({error:'Unauthorized'},{status:401,headers});
 // Separate worker gates and DB claims still decide whether either paid call runs.
 const [results]=await Promise.all([Promise.allSettled([publish(request),reply(request)]),enrich().catch(()=>null)]);
 const statuses=results.map(r=>r.status==='fulfilled'?r.value.status:503);
 return Response.json({postStatus:statuses[0],replyStatus:statuses[1]},{status:statuses.some(s=>s>=500)?503:200,headers});
}
