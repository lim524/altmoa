'use strict';
let activityTab='posts',activityPage=0,activityRequest=0,badgeRetryAt=0;
const activityMembers=new Map(),badgePending=new Set();
const MEMBER_LEVELS=[{min:0,icon:'🌱',name:'새싹'},{min:20,icon:'🌿',name:'참여자'},{min:100,icon:'⭐',name:'단골'},{min:300,icon:'💎',name:'고수'},{min:1000,icon:'👑',name:'레전드'}];
function memberLevel(posts,comments){const score=Math.max(0,Number(posts)||0)*5+Math.max(0,Number(comments)||0);return {...[...MEMBER_LEVELS].reverse().find(level=>score>=level.min),score};}
function operatorBadge(){return '<span class="member-level operator-badge" title="알트모아 운영자"><svg viewBox="0 0 16 18" width="11" height="12" aria-hidden="true"><path fill="currentColor" d="M8 0 15 3v5c0 5-7 10-7 10S1 13 1 8V3L8 0Z"/><path fill="none" stroke="white" stroke-width="1.5" d="m4.5 8 2.2 2.2 4.8-4.8"/></svg> 운영자</span>';}
function badgeHTML(member){if(member.is_operator)return operatorBadge();if(member.is_ai)return '<span class="member-level ai-label" title="알트모아에서 운영하는 AI 작성자입니다.">AI</span>';const level=memberLevel(member.post_count,member.comment_count);return '<span class="member-level" title="'+level.name+' · 글 '+Number(member.post_count)+'개 / 댓글 '+Number(member.comment_count)+'개">'+level.icon+' '+level.name+'</span>';}
function memberBadge(id){return /^[a-f0-9-]{36}$/i.test(id||'')?'<span data-member-id="'+id+'">'+(activityMembers.has(id)?badgeHTML(activityMembers.get(id)):'')+'</span>':'';}
async function loadMemberBadges(ids){
 const unique=[...new Set(ids)].filter(id=>/^[a-f0-9-]{36}$/i.test(id||'')&&!badgePending.has(id));if(!unique.length||Date.now()<badgeRetryAt||!config?.communityReady)return;
 unique.forEach(id=>badgePending.add(id));
 try{const {data}=await db('member_activity?'+new URLSearchParams({select:'id,nickname,is_ai,post_count,comment_count,is_operator',id:'in.('+unique.join(',')+')'}));data.forEach(member=>activityMembers.set(member.id,member));document.querySelectorAll('[data-member-id]').forEach(node=>{const member=activityMembers.get(node.dataset.memberId);if(member)node.innerHTML=badgeHTML(member);});}catch{badgeRetryAt=Date.now()+60000;}finally{unique.forEach(id=>badgePending.delete(id));}
}
function openMyActivity(tab='posts'){$('dialog').close();activityTab=['comments','favorites'].includes(tab)?tab:'posts';activityPage=0;navigate('activity');}
function showAccount(){
 modal('<div class="eyebrow">MY ALTMOA</div><h2>내 계정</h2><p>'+escapeHTML(session.user.email)+'</p><div class="account-links"><button class="solid" onclick="openMyActivity(\'posts\')">내 글 보기</button><button class="solid" onclick="openMyActivity(\'comments\')">내 댓글 보기</button></div><p class="subtle">작성한 글·댓글과 활동 등급을 확인할 수 있어요.</p><button onclick="signOut()">로그아웃</button>'+(moderator?' <button onclick="showReports()">신고 관리</button> <button onclick="showSupport()">문의 관리</button> <button onclick="showAIStudio()">AI 캐릭터 관리</button>':''));
}
async function loadMyActivity(){
 const token=++activityRequest;loadActivityPrivacy();
 document.querySelectorAll('[data-history]').forEach(button=>{button.classList.toggle('on',button.dataset.history===activityTab);button.onclick=()=>{activityTab=button.dataset.history;activityPage=0;loadMyActivity();};});
 if(activityTab==='favorites'){renderActivityFavorites();return;}
 document.querySelectorAll('[data-history]').forEach(button=>{button.classList.toggle('on',button.dataset.history===activityTab);button.onclick=()=>{activityTab=button.dataset.history;activityPage=0;loadMyActivity();};});
 if(!session?.user||!config?.communityReady){$('activitystats').innerHTML='';$('activityitems').innerHTML='<div class="connection"><b>로그인 후 내 활동을 확인할 수 있어요.</b><button onclick="authModal()">로그인 →</button></div>';$('activitypagination').innerHTML='';return;}
 const id=session.user.id;$('activityitems').innerHTML='<p class="loading">내 활동을 불러오는 중입니다.</p>';
 try{
 const queries=['posts','comments'].map(table=>{const params=new URLSearchParams({select:table==='posts'?'id,title,category,created_at':'id,body,post_id,created_at,posts!inner(title,category,status)',author_id:'eq.'+id,status:'eq.published',order:'created_at.desc,id.desc',limit:table===activityTab?'10':'1',offset:table===activityTab?String(activityPage*10):'0'});if(table==='comments')params.set('posts.status','eq.published');return db(table+'?'+params,{headers:{Prefer:'count=exact'}});});
 const [postsResult,commentsResult]=await Promise.all(queries);if(token!==activityRequest||session?.user?.id!==id)return;
 const count=result=>{const n=Number(result.response.headers.get('content-range')?.split('/')[1]);return Number.isFinite(n)?n:result.data.length;};const postCount=count(postsResult),commentCount=count(commentsResult),level=memberLevel(postCount,commentCount);
 $('activitystats').innerHTML='<div><small>작성한 글</small><b>'+postCount+'</b></div><div><small>작성한 댓글</small><b>'+commentCount+'</b></div><div><small>활동 등급</small><b>'+level.icon+' '+level.name+'</b></div><p>공개 글 1개 = 5점 · 공개 댓글 1개 = 1점 · 현재 '+level.score+'점</p>';
 const result=activityTab==='posts'?postsResult:commentsResult,total=activityTab==='posts'?postCount:commentCount;
 if(activityPage>0&&activityPage*10>=total){activityPage=Math.max(0,Math.ceil(total/10)-1);return loadMyActivity();}
 $('activityitems').innerHTML=result.data.map(item=>'<button class="activity-item" onclick="openPost(\''+(activityTab==='posts'?item.id:item.post_id)+'\')"><span class="tag">'+escapeHTML(activityTab==='posts'?item.category:item.posts?.category||'댓글')+'</span><span><b>'+escapeHTML(activityTab==='posts'?item.title:item.body)+'</b>'+(activityTab==='comments'?'<small>원글: '+escapeHTML(item.posts?.title||'게시글')+'</small>':'')+'<small>'+time(item.created_at)+'</small></span><span>→</span></button>').join('')||'<p class="empty">아직 작성한 '+(activityTab==='posts'?'글':'댓글')+'이 없어요.</p>';
 $('activitypagination').innerHTML=(activityPage>0?'<button onclick="activityPage--;loadMyActivity()">← 이전</button>':'')+'<span>'+(activityPage+1)+' / '+Math.max(1,Math.ceil(total/10))+'</span>'+(activityPage*10+10<total?'<button onclick="activityPage++;loadMyActivity()">다음 →</button>':'');
 }catch(error){if(token===activityRequest){$('activityitems').innerHTML='<div class="connection">내 활동을 불러오지 못했어요.<button onclick="loadMyActivity()">다시 시도 →</button></div>';$('activitystats').innerHTML='';$('activitypagination').innerHTML='';}}
}
async function showAIStudio(){
 if(!moderator)return;
 modal('<h2>AI 캐릭터 관리</h2><p class="subtle">설정을 불러오는 중입니다.</p>');
 try{const {data}=await fetchJSON('/api/ai');if(!moderator)return;
 modal('<div class="eyebrow">AI DRAFT STUDIO</div><h2>AI 작성자 6명</h2><p class="subtle">Grok·GPT·Gemini 각 2명 · 불규칙한 간격 · 새 글 전체 하루 50~100개 무작위 작성 기회 · 댓글 최대 24회</p><div id="publishingstatus"></div><button class="solid" id="initializewriters">AI 계정 준비</button><p id="writerstatus" class="subtle" role="status"></p><h3>Grok 검토용 초안</h3><p class="subtle">아래 초안은 자동 게시되지 않습니다. 정기 발행은 별도 서버 설정으로 제어합니다.</p><div class="ai-character-list">'+data.characters.map(character=>'<div><b>'+character.icon+' AI · '+escapeHTML(character.name)+'</b><small>'+escapeHTML(character.role)+' · '+escapeHTML(character.style)+'</small></div>').join('')+'</div><form id="aiform"><label>캐릭터<select name="character">'+data.characters.map(character=>'<option value="'+character.id+'">AI · '+escapeHTML(character.name)+'</option>').join('')+'</select></label><label>거래소<select name="exchange">'+exchangeOptions.map(exchange=>'<option value="'+exchange[0]+'">'+exchange[1]+'</option>').join('')+'</select></label><label>코인 기호 (비우면 거래대금 상위 5개)<input name="symbol" maxlength="20" placeholder="SUI"></label><label>글 주제 또는 답글을 달 내용<textarea name="topic" minlength="2" maxlength="800" required placeholder="예: 최근 수이 변동을 차분하게 설명해줘"></textarea></label><p class="subtle">'+(data.enabled?'Grok 연결 준비됨 · 웹 검색 '+(data.webSearch?'켜짐':'꺼짐'):'Grok API 환경변수 연결 후 생성할 수 있습니다.')+'</p><button class="solid" id="aigenerate"'+(data.enabled?'':' disabled')+'>초안 생성</button><p id="aierror" class="subtle" role="alert"></p></form><div id="aidraft"></div>');
 $('publishingstatus').innerHTML='<p class="subtle">정기 발행 '+(data.publishing?.enabled?'설정 켜짐':'꺼짐')+' · 자동 답글 '+(data.publishing?.automaticComments?'켜짐':'꺼짐')+' · AI 추천 '+(data.publishing?.automaticRecommendations?'켜짐':'꺼짐')+' · '+(data.publishing?.providers||[]).map(p=>escapeHTML(p.label)+': '+(p.ready?'연결 설정됨':'키·모델 필요')).join(' / ')+'</p><div class="ai-character-list">'+(data.publishing?.writers||[]).map(w=>'<div><b>'+escapeHTML(w.name)+' <span class="member-level ai-label">AI</span></b><small>'+escapeHTML(w.role)+'</small></div>').join('')+'</div>';
 $('initializewriters').onclick=async()=>{const button=$('initializewriters');if(button.disabled)return;button.disabled=true;try{const token=await freshToken();const {data:result}=await fetchJSON('/api/ai-initialize',{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(90000)});$('writerstatus').textContent=result.initialized?'AI 작성자 6개 계정을 준비했습니다.':'계정 준비 상태를 확인하세요.';}catch(error){$('writerstatus').textContent=errorMessage(error);}finally{button.disabled=false;}};
 $('aiform').onsubmit=async event=>{event.preventDefault();const button=$('aigenerate');button.disabled=true;$('aierror').textContent='최신 시세를 조회하고 초안을 생성하고 있어요.';
 try{const form=new FormData(event.target),token=await freshToken();const {data}=await fetchJSON('/api/ai',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({character:form.get('character'),exchange:form.get('exchange'),symbol:form.get('symbol').trim().toUpperCase(),topic:form.get('topic')})});if(!$('aidraft'))return;$('aierror').textContent='초안 생성 완료 · 게시하지 않았습니다.';$('aidraft').innerHTML='<h3>운영자 검토용 초안</h3><div class="postbody">'+escapeHTML(data.text)+'</div><p class="subtle">시세 조회: '+escapeHTML(data.snapshot.exchange)+' · '+time(data.snapshot.fetchedAt)+' KST</p>'+data.sources.map(source=>'<p><a href="'+escapeHTML(source.url)+'" target="_blank" rel="noopener noreferrer">'+escapeHTML(source.title)+'</a></p>').join('');}
 catch(error){if($('aierror'))$('aierror').textContent=errorMessage(error);}finally{if(button.isConnected)button.disabled=false;}};
 }catch(error){info('AI 설정을 불러오지 못했어요',errorMessage(error));}
}

async function showSupport(){
 if(!moderator)return;modal('<h2>문의 관리</h2><p class="subtle">불러오는 중입니다.</p>');
 try{const {data}=await db('support_tickets?select=*&order=created_at.desc&limit=50');modal('<h2>문의 관리</h2><p class="subtle">최근 50건 · 처리 완료 후 개인정보가 남지 않도록 삭제하세요. 답변은 이메일로 직접 회신해 주세요.</p>'+data.map(ticket=>'<div class="comment"><small>'+escapeHTML(ticket.email)+' · '+time(ticket.created_at)+'</small><h3>'+escapeHTML(ticket.subject)+'</h3><p class="support-body">'+escapeHTML(ticket.body)+'</p><button class="danger" data-support-delete="'+ticket.id+'">처리 완료 · 삭제</button></div>').join(''));document.querySelectorAll('[data-support-delete]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await db('support_tickets?id=eq.'+button.dataset.supportDelete,{method:'DELETE'});await showSupport();}catch{toast('삭제하지 못했어요.');button.disabled=false;}});}catch{info('문의를 불러오지 못했어요','문의 저장 구조와 운영자 권한을 확인해 주세요.');}
}

let profileId=null,profileTab='posts',profilePage=0,profileRequest=0,privacyRequest=0;
function memberLink(id,nickname){const name=escapeHTML(nickname||'알트모아 회원');return /^[a-f0-9-]{36}$/i.test(id||'')?'<a class="member-link" href="/?view=member&amp;member='+id+'" onclick="return followMember(event,\''+id+'\')">'+name+'</a>':name;}
function followMember(event,id){if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return true;event.preventDefault();event.stopPropagation?.();openMemberProfile(id);return false;}
function openMemberProfile(id,options={}){if(!/^[a-f0-9-]{36}$/i.test(id||''))return;profileId=id;profileTab='posts';profilePage=0;navigate('member',{...options,member:id});}
async function loadMemberProfile(){
 const request=++profileRequest,id=profileId,user=session?.user?.id;
 $('membercontent').innerHTML='<p class="loading">회원 활동을 불러오는 중입니다.</p>';
 try{
  const {data:m}=await db('rpc/member_profile',{method:'POST',body:JSON.stringify({p_member:id,p_kind:profileTab,p_page:profilePage})});
  if(request!==profileRequest||activeView!=='member'||profileId!==id||session?.user?.id!==user)return;
  if(!m){$('membercontent').innerHTML='<p class="empty">회원을 찾을 수 없습니다.</p>';return;}
  document.title=m.nickname+' — 회원 활동 — 알트모아';
  let watchlist=[];if(m.is_ai)try{watchlist=(await db('rpc/member_ai_watchlist',{method:'POST',body:JSON.stringify({p_member:id})})).data||[];}catch{}
  if(request!==profileRequest||profileId!==id||activeView!=='member'||session?.user?.id!==user)return;
  const heading='<h2>'+escapeHTML(m.nickname)+(m.is_operator?' '+operatorBadge():'')+(m.is_ai?' <span class="member-level ai-label">AI</span>':'')+'</h2>'+(watchlist.length?'<p class="subtle">관심종목 · '+watchlist.map(s=>escapeHTML(s)).join(' · ')+'</p>':'');
  if(!m.can_view){$('membercontent').innerHTML=heading+'<p class="empty">이 회원은 활동 목록을 비공개로 설정했어요.</p>';return;}
  const total=profileTab==='posts'?m.post_count:m.comment_count;
  if(profilePage>0&&profilePage*10>=total){profilePage=Math.max(0,Math.ceil(total/10)-1);return loadMemberProfile();}
  $('membercontent').innerHTML=heading+(m.id===user?'<p class="subtle">내 활동 목록 · '+(m.activity_public?'공개':'비공개 — 나에게만 보여요')+' · <button onclick="openMyActivity()">공개 설정 변경</button></p>':'')+'<div class="board-tabs"><button class="'+(profileTab==='posts'?'on':'')+'" onclick="changeProfileTab(\'posts\')">작성 글 '+Number(m.post_count)+'</button><button class="'+(profileTab==='comments'?'on':'')+'" onclick="changeProfileTab(\'comments\')">댓글·답글 '+Number(m.comment_count)+'</button></div><div>'+m.items.map(item=>'<a class="activity-item" href="/?view=post&amp;post='+(profileTab==='posts'?item.id:item.post_id)+'" onclick="return followPost(event,\''+(profileTab==='posts'?item.id:item.post_id)+'\')"><span class="tag">'+escapeHTML(item.category)+'</span><span><b>'+escapeHTML(profileTab==='posts'?item.title:item.body)+'</b><small>'+escapeHTML(profileTab==='posts'?item.body:'원글: '+item.post_title)+'</small><small>'+time(item.created_at)+'</small></span><span>→</span></a>').join('')+'</div>'+(!m.items.length?'<p class="empty">아직 공개된 '+(profileTab==='posts'?'글':'댓글·답글')+'이 없어요.</p>':'')+'<div class="pagination">'+(profilePage>0?'<button onclick="changeProfilePage(-1)">← 이전</button>':'')+'<span>'+(profilePage+1)+' / '+Math.max(1,Math.ceil(total/10))+'</span>'+(profilePage*10+10<total?'<button onclick="changeProfilePage(1)">다음 →</button>':'')+'</div>';
 }catch{if(request===profileRequest&&activeView==='member')$('membercontent').innerHTML='<p class="empty">회원 활동을 불러오지 못했어요.</p><button onclick="loadMemberProfile()">다시 시도</button>';}
}
function changeProfileTab(tab){profileTab=tab==='comments'?'comments':'posts';profilePage=0;loadMemberProfile();}
function changeProfilePage(step){profilePage=Math.max(0,profilePage+step);loadMemberProfile();}
async function loadActivityPrivacy(){
 const request=++privacyRequest,user=session?.user?.id;if(!user){$('activityprivacy').innerHTML='';return;}
 try{const {data}=await db('profiles?'+new URLSearchParams({select:'activity_public',id:'eq.'+user}));if(request!==privacyRequest||session?.user?.id!==user||activeView!=='activity')return;if(!data.length)throw Error('profile_missing');const enabled=data[0]?.activity_public===true;
 $('activityprivacy').innerHTML='<div class="privacy-setting"><div><b>내 활동 목록 '+(enabled?'공개':'비공개')+'</b><p class="subtle">닉네임을 눌렀을 때 글·댓글 목록을 볼 수 있는지 설정해요. 비공개여도 게시판에 공개한 글·댓글은 원래 위치에 보여요.</p></div><button id="privacytoggle" class="solid">'+(enabled?'비공개로 변경':'공개로 변경')+'</button><p id="privacyerror" role="alert"></p></div>';
 $('privacytoggle').onclick=async event=>{const button=event.target;if(button.disabled||session?.user?.id!==user)return;button.disabled=true;try{const {data:updated}=await db('profiles?id=eq.'+user+'&select=id,activity_public',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({activity_public:!enabled})});if(!updated?.length)throw Error('설정을 저장하지 못했어요.');profileRequest++;if(activeView==='activity'&&session?.user?.id===user){toast('활동 목록을 '+(!enabled?'공개':'비공개')+'로 변경했어요.');await loadActivityPrivacy();}}catch(error){if($('privacyerror'))$('privacyerror').textContent=errorMessage(error);}finally{if(button.isConnected)button.disabled=false;}};
 }catch{if(request===privacyRequest&&session?.user?.id===user&&activeView==='activity')$('activityprivacy').innerHTML='<p class="subtle">활동 공개 설정을 불러오지 못했어요.</p>';}
}

async function renderActivityFavorites(){
 const viewer=session?.user?.id||'guest';await syncWrittenInterests();if((session?.user?.id||'guest')!==viewer||activeView!=='activity'||activityTab!=='favorites')return;
 $('activitystats').innerHTML='';$('activitypagination').innerHTML='';
 const rows=activityInterestItems(),enabled=readInterestState().enabled;
 $('activityitems').innerHTML='<div class="activity-favorites"><h3>내 관심종목</h3><p class="subtle">직접 쓴 글의 코인은 바로 반영하고, 읽은 글은 8초 이상 본 서로 다른 글 3개부터 자동으로 모아요. 읽기는 최근 14일, 작성은 최근 30일 기준 · 자동 최대 20개 · 이 브라우저에서 계정별로 저장합니다.</p><button class="favorite-chip" onclick="toggleAutomaticInterest()" aria-pressed="'+enabled+'">자동 추가 '+(enabled?'켜짐':'꺼짐')+'</button><button class="favorite-chip" onclick="clearAutomaticInterest()">자동 관심 기록 초기화</button><div>'+rows.map(c=>'<div class="interest-item"><button class="favorite-chip" onclick="lounge(\''+c.symbol+'\')">☆ '+escapeHTML(c.symbol)+'</button><small>'+((c.manual?'직접 저장':'자동 추가')+(c.writes?' · 작성 '+c.writes+'개':'')+(c.reads?' · 읽은 글 '+c.reads+'개':''))+'</small><button class="tiny-link" onclick="removeInterestCoin(\''+c.symbol+'\')">해제</button></div>').join('')+(!rows.length?'<p class="empty">아직 모인 관심종목이 없어요. 글을 읽거나 작성하면 자동으로 반영돼요.</p>':'')+'</div><button class="board-entry" onclick="showSaved()">관심종목 시세 보기 →</button></div>';
 document.querySelectorAll('[data-history]').forEach(button=>{button.classList.toggle('on',button.dataset.history==='favorites');button.onclick=()=>{activityTab=button.dataset.history;activityPage=0;loadMyActivity();};});
}
