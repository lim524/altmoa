'use strict';
const BOARDS=[{key:'자유',name:'자유게시판',description:'가볍게 나누는 코인 이야기'},{key:'분석',name:'분석·인사이트',description:'함께 살펴보는 시장과 프로젝트'},{key:'소식',name:'뉴스·정보',description:'놓치기 아쉬운 새로운 소식'},{key:'질문',name:'질문·답변',description:'궁금한 점을 묻고 답하는 공간'}];
let activeView='home',postSort='latest',popularRequest=0,summaryRequest=0,recommendationsReady=null,voteBusy=false;
const POPULAR_SELECT='id,author_id,title,category,created_at,view_count,ai_view_count,recommendation_count,ai_recommendation_count,profiles!posts_author_id_fkey(nickname),comments(count)';
function boardLabel(key){return BOARDS.find(b=>b.key===key)?.name||'전체 이야기';}
function renderPopularShell(){
 $('popularboards').innerHTML=BOARDS.map(board=>'<section class="panel popular-board"><div class="section-head"><div><h2>'+board.name+'</h2><p>'+board.description+'</p></div><button class="tiny-link" onclick="openBoard(\''+board.key+'\',\'latest\')">더보기 →</button></div><div id="popular-'+board.key+'" class="popular-list"><p class="loading">불러오는 중입니다.</p></div><button class="board-entry" onclick="openBoard(\''+board.key+'\')">게시판 둘러보기 →</button></section>').join('');
}
function popularRows(rows){
 return rows.map((post,index)=>'<div class="popular-post"><span class="popular-rank">'+(index+1)+'</span><span class="popular-post-copy"><a class="popular-title" href="/?view=post&amp;post='+post.id+'" onclick="return followPost(event,\''+post.id+'\')">'+escapeHTML(post.title)+'</a><small>'+escapeHTML(boardLabel(post.category))+' · '+memberLink(post.author_id,post.profiles?.nickname)+memberBadge(post.author_id)+' · '+time(post.created_at)+' · 조회 '+Number(post.view_count||0).toLocaleString()+' · 댓글 '+Number(post.comments?.[0]?.count||0)+'</small></span><span class="recommend-count">추천 <b>'+Number(post.recommendation_count||0)+'</b><small>AI '+Number(post.ai_recommendation_count||0)+'</small></span></div>').join('')||'<div class="popular-empty">아직 작성된 글이 없어요.<br>첫 이야기를 나눠보세요.</div>';
}
async function loadPopular(){
 const token=++popularRequest;
 if(!config?.communityReady){['popularall',...BOARDS.map(b=>'popular-'+b.key)].forEach(id=>$(id).innerHTML='<div class="popular-empty">커뮤니티 연결을 준비하고 있어요.</div>');return;}
 const groups=['전체',...BOARDS.map(b=>b.key)];
 const results=await Promise.allSettled(groups.map(async key=>{const params=new URLSearchParams({select:POPULAR_SELECT,status:'eq.published',order:'created_at.desc,id.desc',limit:'5'});if(key!=='전체')params.set('category','eq.'+key);try{const result=await db('posts?'+params);recommendationsReady=true;return result.data;}catch(error){if(!/recommendation_count/i.test(error.message||''))throw error;recommendationsReady=false;params.set('select',POPULAR_SELECT.split(',').filter(field=>!['recommendation_count','ai_recommendation_count'].includes(field)).join(','));return (await db('posts?'+params)).data;}}));
 if(token!==popularRequest)return;
 results.forEach((result,i)=>{const target=i===0?$('popularall'):$('popular-'+groups[i]);
 if(result.status==='fulfilled'){target.innerHTML=popularRows(result.value);loadMemberBadges(result.value.map(post=>post.author_id));}
 else {if(/recommendation_count|schema cache|does not exist/i.test(result.reason?.message||''))recommendationsReady=false;target.innerHTML='<div class="popular-empty">최신 글을 불러오지 못했어요.<br>잠시 후 다시 시도해 주세요.</div>';}
 });
}
async function loadAttentionSummary(){
 const token=++summaryRequest;
 try{const {data}=await fetchAttention(24);if(token!==summaryRequest)return;
 $('attentionsummary').innerHTML=(data.items||[]).slice(0,5).map((item,i)=>'<button class="summary-coin" onclick="navigate(\'rank\')"><span class="summary-rank">'+(i+1)+'</span>'+coinIcon(item.symbol)+'<span><b>'+escapeHTML(item.name)+'</b><small>'+escapeHTML(item.symbol)+'</small></span><strong>'+Number(item.mentions)+'건<small aria-label="최근 24시간 등락률">24h '+attentionChange(item.priceChange24h)+'</small></strong></button>').join('')||'<div class="summary-empty">아직 집계된 코인 언급이 없어요.<br>이야기가 쌓이면 관심도를 보여드려요.</div>';
 }catch{if(token===summaryRequest)$('attentionsummary').innerHTML='<p class="inline-status">관심도를 불러오지 못했어요.</p>';}
}
function validPostId(id){return typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);}
function followPost(event,id){if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return true;event.preventDefault();openPost(id);return false;}
function returnToCommunity(){if(history.state?.communityReturn){history.back();return;}openBoard(category);}
function navigate(view,options={}){
 if(!['home','board','market','rank','saved','activity','post','write','member'].includes(view))view='home';
 const previous=activeView;
 if(postSubmitting&&view!==activeView){toast('게시글 등록이 끝날 때까지 기다려주세요.');if(options.history===false)history.replaceState(history.state,'','/?view=write');return false;}
 if(view!=='post')activePostId=null;
 if(view!=='write'&&previous==='write')resetComposer();
 activeView=view;
 if($('dialog').open)$('dialog').close();
 if(view!==previous&&['market','saved'].includes(view))marketPage=0;
 if(view==='saved')savedOnly=true;else if(view==='market')savedOnly=false;
 if(view==='board'){
  if(options.category!==undefined)category=options.category;
  if(!['전체',...BOARDS.map(b=>b.key)].includes(category))category='전체';
  if(options.sort)postSort=options.sort==='popular'?'popular':'latest';
 }
 const panelView=view==='saved'?'market':view;
 document.querySelectorAll('[data-view]').forEach(node=>node.hidden=node.dataset.view!==panelView);
 document.querySelectorAll('[data-nav]').forEach(button=>{button.classList.toggle('active',button.dataset.nav===view);button.setAttribute('aria-current',button.dataset.nav===view?'page':'false');});
 document.querySelectorAll('[data-side]').forEach(button=>button.classList.toggle('selected',button.dataset.side===view));
 document.querySelectorAll('[data-board]').forEach(button=>button.classList.toggle('selected',view==='board'&&button.dataset.board===category));
 document.querySelectorAll('[data-post-sort]').forEach(button=>button.classList.toggle('on',button.dataset.postSort===postSort));
 const title=view==='post'?'게시글 — 알트모아':view==='write'?'글쓰기 — 알트모아':view==='home'?'알트모아 — 알트코인 커뮤니티':view==='board'?boardLabel(category)+' — 알트모아':view==='activity'?'내 활동 — 알트모아':view==='rank'?'알트 관심도 — 알트모아':view==='saved'?'관심 코인 — 알트모아':'알트코인 시세 — 알트모아';document.title=title;
 if(options.history!==false){const params=new URLSearchParams();if(view!=='home')params.set('view',view);if(view==='board'){if(category!=='전체')params.set('category',category);if(postSort==='popular')params.set('sort','popular');if(query)params.set('q',query);if(coinFilter)params.set('coin',coinFilter);}if(view==='board'&&page>0)params.set('page',String(page+1));if(view==='post')params.set('post',options.id||activePostId||'');if(view==='member')params.set('member',options.member||profileId||'');const destination='/'+(params.size?'?'+params:'');history.pushState({communityReturn:true},'',destination);}
 if(view==='home'){loadPopular();loadAttentionSummary();}
 if(view==='board'){ $('boardtitle').textContent=boardLabel(category);$('boarddescription').textContent=coinFilter?coinFilter+' 관련 이야기':'새로운 이야기를 나누는 알트모아 커뮤니티';loadPosts();}
 if(panelView==='market'){renderCoins();if(!coins.length)loadMarket();}
 if(view==='rank')loadAttention();
 if(view==='activity')loadMyActivity();
 if(view==='member')loadMemberProfile();
 if(options.scroll!==false&&previous!==view)window.scrollTo({top:0,behavior:'smooth'});
}
function openBoard(board='전체',sort='latest'){page=0;coinFilter='';query='';$('search').value='';navigate('board',{category:board,sort});}
function restoreCommunityRoute(){
 const params=new URLSearchParams(location.search);category=params.get('category')||'전체';postSort=params.get('sort')==='popular'?'popular':'latest';query=(params.get('q')||'').slice(0,100);coinFilter=/^[A-Z0-9]{1,20}$/.test(params.get('coin')||'')?params.get('coin'):'';$('search').value=query;const requestedPage=Number(params.get('page')||1);page=Number.isSafeInteger(requestedPage)&&requestedPage>=1&&requestedPage<=100000?requestedPage-1:0;const view=params.get('view');const id=params.get('post');if(id||view==='post'){if(config)openPost(id,{history:false,scroll:false});else navigate('post',{history:false,scroll:false});}else if(view==='member'){openMemberProfile(params.get('member'),{history:false,scroll:false});}else if(view==='write'){if(config)writePost({history:false,scroll:false});else navigate('write',{history:false,scroll:false});}else navigate(view||'home',{history:false,scroll:false});
}
async function loadPostRecommendation(id,authorId){
 const request=postPageRequest;
 if(activePostId!==id||request!==postPageRequest)return;
 try{
 const [postResult,mineResult]=await Promise.all([db('posts?'+new URLSearchParams({select:'recommendation_count,ai_recommendation_count',id:'eq.'+id,status:'eq.published'})),session?.user?db('post_recommendations?'+new URLSearchParams({select:'post_id',post_id:'eq.'+id,user_id:'eq.'+session.user.id})):Promise.resolve({data:[]})]);
 if(activePostId!==id||request!==postPageRequest)return;
 const post=postResult.data[0];if(!post||!Number.isInteger(post.recommendation_count))throw new Error('recommendation_count_missing');recommendationsReady=true;
 const selected=mineResult.data.length>0;const own=authorId===session?.user?.id;
 $('postrecommendation').innerHTML='<button class="recommend-button'+(selected?' recommended':'')+'" id="recommendbutton" aria-pressed="'+selected+'"'+(own?' disabled':'')+'><span>♡</span> 추천 '+post.recommendation_count+(selected?' · 취소':'')+'</button><p class="subtle">'+(own?'내 글에는 추천할 수 없어요.':session?.user?'회원당 한 번 추천할 수 있어요.':'로그인하면 좋은 글에 추천을 남길 수 있어요.')+'</p><p class="subtle ai-votes">AI 추천 '+Number(post.ai_recommendation_count||0)+' · 사람 추천과 별도로 집계합니다.</p><p class="subtle" id="recommenderror" role="alert"></p>';
 $('recommendbutton').onclick=()=>toggleRecommendation(id,authorId,selected);
 }catch{if(activePostId===id&&request===postPageRequest)$('postrecommendation').innerHTML='<p class="subtle">추천 기능을 준비하고 있어요.</p>';}
}
async function toggleRecommendation(id,authorId,selected){
 if(!session?.user)return authModal();if(voteBusy||activePostId!==id||authorId===session.user.id)return;
 voteBusy=true;const button=$('recommendbutton');if(button)button.disabled=true;
 try{
 if(selected)await db('post_recommendations?'+new URLSearchParams({post_id:'eq.'+id,user_id:'eq.'+session.user.id}),{method:'DELETE'});
 else await db('post_recommendations',{method:'POST',body:JSON.stringify({post_id:id,user_id:session.user.id})});
 await loadPostRecommendation(id,authorId);if(activeView==='home')loadPopular();if(activeView==='board')loadPosts();
 }catch(error){if(error.status===409)await loadPostRecommendation(id,authorId);else if(activePostId===id&&$('recommenderror'))$('recommenderror').textContent=errorMessage(error);}
 finally{voteBusy=false;if(button?.isConnected)button.disabled=false;}
}
