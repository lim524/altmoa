// Only public discussion excerpts become memories; no extra model call is used.
export const WRITER_WATCHLISTS={grogi:['BTC','SOL','SUI'],grokong:['DOGE','PEPE','SHIB'],jipi:['BTC','ETH','LINK'],pitikong:['BTC','AAVE','ENA'],jemi:['ETH','LINK','NEAR'],jemikong:['SOL','DOGE','UNI']};
export function ideaTokens(text){
 const s=String(text).normalize('NFKC').toLowerCase();const ideas=[];
 for(const [key,re] of Object.entries({insufficient:/정보.{0,8}(부족|적|없)|데이터.{0,8}(부족|쌓|없)|재료.{0,8}(부족|적|없)|단정.{0,6}(못|안|성급)/,demand:/실수요|실제.{0,5}수요|반복.{0,5}수요|사줄.{0,5}사람|자금.{0,4}유입|매수세/,lasting:/지속|장기|살아남|남아|남는/,volatile:/변동성|급등락|올랐다|떨어졌다|폭죽|불꽃놀이/,observe:/관망|지켜보|관찰|타임프레임/,narrative:/서사|이벤트성|반짝|세력/}))if(re.test(s))ideas.push(key);
 return ideas;
}
export function repeatedIdea(a,b){const x=new Set(ideaTokens(a)),y=new Set(ideaTokens(b));const overlap=[...x].filter(k=>y.has(k)).length;return overlap>=3&&overlap/Math.max(x.size,y.size)>=.75;}
export function quietThread(rows,writerId){
 const sorted=[...rows].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));let aiTurns=0;
 for(const r of sorted){if(!r.profiles?.is_ai)break;aiTurns++;}
 return aiTurns>=3||Boolean(writerId&&sorted.filter(r=>r.author_id===writerId).length>=2);
}
function cleanMemory(text){return String(text||'').replace(/\b(?:sk-|xai-)[A-Za-z0-9_-]{12,}\b|\bAIza[A-Za-z0-9_-]{20,}\b/g,'[키 삭제]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[이메일 삭제]').replace(/(?:\+82[- ]?|0)1[016789][- ]?\d{3,4}[- ]?\d{4}/g,'[전화번호 삭제]');}
export async function loadWriterMemory(admin,persona){try{const rows=await admin('rest/v1/rpc/ai_memory_context',{method:'POST',body:JSON.stringify({p_persona:persona})});return Array.isArray(rows)?rows.map(m=>({...m,excerpt:cleanMemory(m.excerpt)})):[];}catch{return [];}}
export async function rememberWriter(admin,persona,postId,commentId,body){try{await admin('rest/v1/rpc/remember_ai_interaction',{method:'POST',body:JSON.stringify({p_persona:persona,p_post:postId,p_comment:commentId||null,p_excerpt:String(body).slice(0,500),p_ideas:ideaTokens(body)})});}catch{console.error('ai_memory_save_failed');}}

export async function updateWriterWatchlist(admin,persona,symbols){for(const symbol of symbols||[])try{await admin('rest/v1/rpc/add_ai_watchlist',{method:'POST',body:JSON.stringify({p_persona:persona,p_symbol:symbol})});}catch{}}
