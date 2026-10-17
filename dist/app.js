'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (key, fallback, storage = localStorage) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value, storage = localStorage) => { try { storage.setItem(key, JSON.stringify(value)); } catch { toast('브라우저 저장 공간을 사용할 수 없어요.'); } };
let config = null, session = read('altmoa-session', null, sessionStorage), refreshPromise = null;
let coins = [], posts = [], favorites = read('altmoa-stars', []), sort = 'volume', sortDirection='desc', query = '', category = '전체', coinFilter = '', savedOnly = false;
let page = 0, total = 0, feedRequest = 0, marketBusy = false, activePostId = null, moderator = false;
let lastFetchedAt = null, marketFailed = false, marketPage = 0;
const MARKET_PAGE_SIZE=5;
let displayCurrency=read('altmoa-display-currency','USDT');
if(!['KRW','USDT'].includes(displayCurrency))displayCurrency='USDT';
let conversion=null,conversionPromise=null;
let selectedExchange='binance',loadingExchange=null,marketRequest=0,detailRequest=0;
let marketInfo={id:'binance',name:'바이낸스',quote:'USDT',source:'Binance',changeLabel:'최근 24시간 대비'};
const exchangeOptions=[['upbit','업비트','kr','KRW'],['bithumb','빗썸','kr','KRW'],['binance','바이낸스','global','USDT'],['bitget','비트겟','global','USDT'],['okx','OKX','global','USDT']];
const priceLabel=(n,quote='KRW')=>quote==='KRW'?won(n):new Intl.NumberFormat('en-US',{maximumFractionDigits:n<1?8:4}).format(n)+' '+quote;
const favoriteKey=c=>(c.exchange||selectedExchange)+':'+c.market;
const isFavorite=c=>favorites.includes(favoriteKey(c))||((c.exchange||selectedExchange)==='upbit'&&favorites.includes(c.symbol));
const PAGE_SIZE = 20;
const time = value => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
const won = n => '₩' + new Intl.NumberFormat('ko-KR', { maximumFractionDigits: n < 1 ? 5 : n < 100 ? 2 : 0 }).format(n);
const volume = n => n >= 1e12 ? (n / 1e12).toFixed(2) + '조' : n >= 1e8 ? (n / 1e8).toFixed(1) + '억' : n>=1e4?(n / 1e4).toFixed(0) + '만':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n);
async function loadConversion(){
 if(conversionPromise)return conversionPromise;
 conversionPromise=(async()=>{try{const {data}=await fetchJSON('/api/conversion');if(!Number.isFinite(data.rate)||data.rate<=0||!Number.isFinite(Date.parse(data.fetchedAt)))throw new Error('invalid_rate');conversion=data;}catch{conversion=null;}finally{conversionPromise=null;}})();return conversionPromise;
}
function marketValue(coin,key){
 const quote=coin.quote||marketInfo.quote,value=coin[key];if(quote===displayCurrency)return value;
 if(!conversion||!Number.isFinite(conversion.rate)||conversion.rate<=0||Date.now()-Date.parse(conversion.fetchedAt)>180000)return null;
 return displayCurrency==='KRW'?value*conversion.rate:value/conversion.rate;
}
function displayCoinPrice(coin){const value=marketValue(coin,'price');return value===null?'—':priceLabel(value,displayCurrency);}
function displayCoinVolume(coin){const value=marketValue(coin,'volume24h');return value===null?'—':volume(value)+(displayCurrency==='KRW'?'원':' USDT');}
function renderCurrencyControls(){
 $('currencytoggle').textContent=displayCurrency+' ⇄ '+(displayCurrency==='KRW'?'USDT':'KRW');$('currencytoggle').setAttribute('aria-label',displayCurrency+' 표시 중, '+(displayCurrency==='KRW'?'USDT':'KRW')+'로 전환');
 $('marketdescription').textContent=marketInfo.name+' · '+marketInfo.quote+' 현물 · '+displayCurrency+(marketInfo.quote!==displayCurrency?' 환산':' 표시')+' · 5개씩 보기';
 $('marketfxnote').textContent=marketInfo.quote===displayCurrency?'거래소 원래 표시 통화 · 등락률은 거래소 기준':conversion&&Date.now()-Date.parse(conversion.fetchedAt)<=180000?'환산: 1 USDT = '+won(conversion.rate)+' · '+conversion.source+' · '+time(conversion.fetchedAt)+' KST · 법정 USD 환율과 다릅니다.':'환산 시세를 확인할 수 없어 환산 가격은 —로 표시합니다.';
}
async function toggleMarketCurrency(){displayCurrency=displayCurrency==='KRW'?'USDT':'KRW';store('altmoa-display-currency',displayCurrency);renderCoins();renderMarketTicker();if(displayCurrency!==marketInfo.quote){await loadConversion();renderCoins();renderMarketTicker();}}
function setMarketSort(key){if(!['volume','change'].includes(key))return;if(sort===key)sortDirection=sortDirection==='desc'?'asc':'desc';else{sort=key;sortDirection='desc';}marketPage=0;renderCoins();}
function renderMarketTicker(){
 if(marketFailed)return;
 $('ticker').innerHTML='<span style="color:var(--accent);font-weight:700">'+escapeHTML(marketInfo.source.toUpperCase())+' · '+displayCurrency+'</span>'+['BTC','ETH','SOL','XRP'].map(symbol=>{const coin=coins.find(row=>row.symbol===symbol);return coin?'<span class="ticker-coin">'+coinIcon(coin.iconSymbol===null?'':coin.iconSymbol||symbol,symbol,coin.logoUrl)+'<b>'+symbol+'</b>'+displayCoinPrice(coin)+' <span class="'+(coin.change>=0?'up':'down')+'">'+(coin.change>=0?'+':'')+coin.change.toFixed(2)+'%</span></span>':''}).join('')+'<span class="inline-status">'+escapeHTML(marketInfo.changeLabel)+'</span>';
}
const failedCoinImages = new Set();
function coinImageError(img) {
  failedCoinImages.add(img.getAttribute('src'));
  const remaining=JSON.parse(img.dataset.fallback||'[]').filter(url=>!failedCoinImages.has(url));
  img.parentElement.classList.remove('loaded');
  if(remaining.length){img.dataset.fallback=JSON.stringify(remaining.slice(1));img.src=remaining[0];}
  else {img.onerror=null;img.remove();}
}
function coinIcon(symbol, fallbackSymbol = symbol, logoUrl = '') {
  const safe = /^[A-Z0-9]{1,20}$/.test(symbol) ? symbol : '';
  const fallback = escapeHTML(String(fallbackSymbol || '').slice(0, 1) || '?');
  const catalogue=globalThis.ALTMOA_LOGOS;
  const ids=catalogue?.symbols[safe]||[];
  const local=ids.length===1?catalogue.assets[ids[0]].path:'';
  const allowed=url=>/^\/assets\/coins\/[A-Z0-9_-]+\.svg$/.test(url)||/^https:\/\/(static\.upbit\.com|bin\.bnbstatic\.com|raw\.githubusercontent\.com)\//.test(url);
  const sources=[logoUrl,local,safe?'https://static.upbit.com/logos/'+safe+'.png':''].filter((url,i,a)=>url&&allowed(url)&&!failedCoinImages.has(url)&&a.indexOf(url)===i);
  const opening='<span class="coinicon coin-avatar" aria-hidden="true"><span class="coin-fallback">'+fallback+'</span>';
  if(!sources.length)return opening+'</span>';
  return opening+'<img src="'+escapeHTML(sources[0])+'" data-fallback="'+escapeHTML(JSON.stringify(sources.slice(1)))+'" alt="" width="29" height="29" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.parentElement.classList.add(\'loaded\')" onerror="coinImageError(this)"></span>';
}

function toast(message) { $('toast').textContent = message; $('toast').style.display = 'block'; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => $('toast').style.display = 'none', 2800); }
function modal(html, postId = null) { activePostId = postId; $('modalcontent').innerHTML = html; if (!$('dialog').open) $('dialog').showModal(); }
function info(title, body) { modal('<div class="eyebrow">ALTMOA</div><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(body) + '</p>'); }
function method() { info('관심도 집계 안내', '알트모아의 공개 게시글 제목과 코인 태그만 통합 집계합니다. 지역 구분과 외부 데이터 수집은 없습니다. 최근 1시간 또는 24시간 중 선택하며, 같은 코인의 동일 제목은 한 번만 셉니다. 댓글·추천 수는 포함하지 않고 사전에 등록된 코인만 인식합니다. 최대 최근 2,000개 글을 분석하고 초과 시 표본이라고 표시합니다. 관심도는 회원의 대화량이며 매수 신호가 아닙니다.'); }
function rules() { info('함께 지켜요', '홍보 도배, 사칭, 수익 보장, 개인정보 공개, 불법·음란 콘텐츠는 게시할 수 없습니다. 문제가 있는 글·댓글은 신고해 주세요. 작성자는 자신의 글·댓글을 삭제할 수 있고 운영자는 신고 내용을 확인해 숨김 처리할 수 있습니다. 사진은 본인에게 게시 권한이 있는 자료만 첨부해 주세요. 외부 원문은 수집하지 않습니다. 관심 코인은 이 브라우저에 저장됩니다.'); }
function errorMessage(error) { const m = error.message || ''; if (['PGRST204','42703'].includes(error.code) || /Could not find the '(tags|images|poll_question|poll_options)' column|column posts\.(tags|images|poll_question|poll_options) does not exist/i.test(m)) return '글쓰기 DB 업데이트가 아직 적용되지 않았어요. 운영자는 Supabase SQL Editor에서 upgrade-community.sql을 실행해 주세요. 입력한 내용은 이 창에 남아 있습니다.'; if (/60초|10초/.test(m)) return m; if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호를 확인해 주세요.'; if (/email not confirmed/i.test(m)) return '이메일 인증을 완료한 뒤 로그인해 주세요.'; if (/already registered/i.test(m)) return '이미 가입된 이메일입니다.'; if (/rate limit|too many/i.test(m)) return '요청이 많아요. 잠시 후 다시 시도해 주세요.'; if (/duplicate key|23505/.test(m)) return '이미 신고한 항목입니다.'; if (/JWT|token|로그인/.test(m)) return '다시 로그인해 주세요.'; if (/schema cache|does not exist/i.test(m)) return '게시판 연결을 준비하고 있습니다.'; if (/fetch|network|timeout|abort/i.test(m)) return '연결하지 못했어요. 잠시 후 다시 시도해 주세요.'; if (error.status === 401 || error.status === 403) return '접근 권한을 확인해 주세요.'; return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'; }
async function fetchJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(data?.msg || data?.error_description || data?.message || data?.error || 'Request failed'); error.status = response.status; error.code = data?.code; throw error; }
  return { data, response };
}
function setSession(value) { session = value; store('altmoa-session', value, sessionStorage); updateAuth(); }
function updateAuth() { const label = session?.user ? '내 계정' : '로그인'; $('authbutton').textContent = label; $('mobileauth').textContent = label; }
async function freshToken() {
  if (!session?.access_token) return null;
  if (session.expires_at > Date.now() / 1000 + 60) return session.access_token;
  if (!refreshPromise) refreshPromise = (async () => {
    try {
      const { data } = await fetchJSON(config.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      setSession({ ...data, expires_at: data.expires_at || Date.now() / 1000 + data.expires_in });
      return data.access_token;
    } catch (error) { if ([400, 401, 403].includes(error.status)) setSession(null); throw error; }
    finally { refreshPromise = null; }
  })();
  return refreshPromise;
}
async function db(path, options = {}) {
  if (!config?.communityReady) throw new Error('게시판 연결 준비 중');
  const token = await freshToken();
  return fetchJSON(config.supabaseUrl + '/rest/v1/' + path, { ...options, headers: { apikey: config.supabaseKey, ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json', ...options.headers } });
}
async function refreshModerator() { moderator = false; if (!session?.user) return; try { const { data } = await db('rpc/is_moderator', { method: 'POST', body: '{}' }); moderator = data === true; } catch {} }
function authModal(mode = 'login') {
  if (!config?.communityReady) return info('회원 기능을 준비하고 있어요', '아직 회원 서버가 연결되지 않았습니다. 시세 조회와 관심 코인 저장은 바로 이용할 수 있어요.');
  if(session?.user)return showAccount();
  const signup = mode === 'signup';
  modal('<div class="eyebrow">WELCOME TO ALTMOA</div><h2>' + (signup ? '알트모아에 가입하기' : '다시 만나 반가워요') + '</h2><form id="authform">' + (signup ? '<label>닉네임<input name="nickname" minlength="2" maxlength="20" required autocomplete="nickname"></label>' : '') + '<label>이메일<input name="email" type="email" required autocomplete="email"></label><label>비밀번호<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></label><p class="subtle">' + (signup ? '이메일 인증 후 이용할 수 있습니다. 가입 전 아래 약관과 개인정보처리방침을 확인해 주세요.' : '이메일로 가입한 계정으로 로그인하세요.') + '</p><p class="subtle"><a href="/terms" target="_blank" rel="noopener">이용약관</a> · <a href="/privacy" target="_blank" rel="noopener">개인정보처리방침</a></p><button class="solid wide" id="authsubmit">' + (signup ? '가입하기' : '로그인') + '</button><p id="autherror" role="alert" class="subtle"></p></form><button onclick="authModal(\'' + (signup ? 'login' : 'signup') + '\')">' + (signup ? '이미 계정이 있어요 → 로그인' : '아직 계정이 없어요 → 회원가입') + '</button>' + (!signup ? '<button style="float:right" onclick="resetPassword()">비밀번호 재설정</button>' : ''));
  $('authform').onsubmit = async event => {
    event.preventDefault(); const form = new FormData(event.target); const submit = $('authsubmit'); submit.disabled = true; $('autherror').textContent = '';
    try {
      const path = signup ? '/signup' : '/token?grant_type=password';
      const body = { email: form.get('email').trim(), password: form.get('password') };
      if (signup) body.data = { nickname: form.get('nickname').trim() };
      const { data } = await fetchJSON(config.supabaseUrl + '/auth/v1' + path, { method: 'POST', headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (data.access_token) { setSession({ ...data, expires_at: data.expires_at || Date.now() / 1000 + data.expires_in }); await refreshModerator(); $('dialog').close(); toast('로그인했어요.'); if(activeView==='activity')await loadMyActivity();else await loadPosts(); }
      else info('인증 메일을 확인해 주세요', '받은 메일에서 인증을 완료한 뒤 로그인해 주세요. 메일이 없다면 스팸함도 확인해 주세요.');
    } catch (error) { if ($('autherror')) $('autherror').textContent = errorMessage(error); }
    finally { if (submit.isConnected) submit.disabled = false; }
  };
}
async function signOut() { try { const token = await freshToken(); if (token) await fetchJSON(config.supabaseUrl + '/auth/v1/logout', { method: 'POST', headers: { apikey: config.supabaseKey, Authorization: 'Bearer ' + token } }); } catch {} setSession(null); moderator = false; $('dialog').close(); toast('로그아웃했어요.'); if(activeView==='activity')await loadMyActivity();else await loadPosts(); }
function resetPassword() {
  modal('<div class="eyebrow">ACCOUNT RECOVERY</div><h2>비밀번호 재설정</h2><form id="recoverform"><label>가입한 이메일<input name="email" type="email" required autocomplete="email"></label><button class="solid wide">재설정 메일 받기</button><p id="recoverstatus" role="status"></p></form>');
  $('recoverform').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; try { await fetchJSON(config.supabaseUrl + '/auth/v1/recover?redirect_to=' + encodeURIComponent(location.origin + '/'), { method: 'POST', headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: new FormData(event.target).get('email').trim() }) }); info('메일을 확인해 주세요', '등록된 계정이 있다면 비밀번호 재설정 메일이 발송됩니다.'); } catch (error) { if ($('recoverstatus')) $('recoverstatus').textContent = errorMessage(error); } finally { if (button.isConnected) button.disabled = false; } };
}
function passwordModal() {
  modal('<h2>새 비밀번호 설정</h2><form id="passwordform"><label>새 비밀번호<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label><button class="solid wide">비밀번호 변경</button><p id="passwordstatus" role="alert"></p></form>');
  $('passwordform').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; try { const token = await freshToken(); await fetchJSON(config.supabaseUrl + '/auth/v1/user', { method: 'PUT', headers: { apikey: config.supabaseKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: new FormData(event.target).get('password') }) }); $('dialog').close(); toast('비밀번호를 변경했어요.'); } catch (error) { if ($('passwordstatus')) $('passwordstatus').textContent = errorMessage(error); } finally { if (button.isConnected) button.disabled = false; } };
}
let attentionRequest = 0, attentionRows = [];
const attentionStatus = {permission_required:'동의 필요',api_required:'API 연결 필요',collecting:'수집 중',paused:'일시 중지',error:'연결 오류',partial:'일부 수집',stale:'갱신 지연',not_connected:'미연결'};
async function loadAttention() {
 const requestId=++attentionRequest;
 attentionRows=[]; $('attentioncontent').className='connection'; $('attentioncontent').textContent='관심도를 불러오는 중입니다.';
 const params=new URLSearchParams({hours:$('attentionperiod').value});
 try {
  const {data}=await fetchJSON('/api/attention?'+params);if(requestId!==attentionRequest)return;
  attentionRows=data.items||[];
  $('attentionbadge').textContent='내부 통합 집계';
  $('attentioncontent').className=attentionRows.length?'tablebox':'connection';
  $('attentioncontent').innerHTML=attentionRows.length?'<table><thead><tr><th>순위</th><th>코인</th><th>언급 글</th></tr></thead><tbody>'+attentionRows.map((c,i)=>'<tr><td class="rank">'+(i+1)+'</td><td><button class="coinline" onclick="attentionDetail(\''+c.symbol+'\')">'+coinIcon(c.symbol)+'<span><b>'+escapeHTML(c.symbol)+'</b><small>'+escapeHTML(c.name)+'</small></span></button></td><td>'+Number(c.mentions).toLocaleString()+'건</td></tr>').join('')+'</tbody></table>':'<b>아직 집계된 코인 언급이 없어요.</b><span>'+escapeHTML(data.message||'공개 게시글의 코인 언급을 집계합니다.')+'</span>';
  $('attentionnote').textContent='알트모아 공개 글 제목·코인 태그 · 동일 제목 중복 제외 · '+time(data.fetchedAt)+' KST 조회'+(data.sampled?' · 최근 '+Number(data.sampleSize)+'개 표본':'');

 } catch {
  if(requestId!==attentionRequest)return;$('attentionbadge').textContent='연결 지연';$('attentioncontent').className='connection';$('attentioncontent').innerHTML='<b>관심도를 불러오지 못했어요.</b><button onclick="loadAttention()">다시 시도 →</button>';
 }
}
function attentionDetail(symbol){
 const item=attentionRows.find(c=>c.symbol===symbol);if(!item)return;
 const links=(item.links||[]).map((link,i)=>{
  if(link.postId&&/^[a-f0-9-]{36}$/i.test(link.postId))return '<li><button onclick="openPost(\''+link.postId+'\')">알트모아 관련 글 '+(i+1)+' →</button></li>';
  try{const u=new URL(link.url);if(u.protocol!=='https:')return '';return '<li><a href="'+escapeHTML(u.href)+'" target="_blank" rel="noopener noreferrer">'+escapeHTML(link.sourceName)+' 원문 '+(i+1)+' ↗</a></li>'}catch{return ''}
 }).join('');
 modal('<div class="eyebrow">'+'ALTMOA COMMUNITY'+'</div><h2 class="coin-detail-heading">'+coinIcon(symbol)+escapeHTML(item.name)+' <span class="subtle">'+escapeHTML(symbol)+'</span></h2><p>선택한 기간에 '+Number(item.mentions)+'개의 중복 제외 언급 글이 관측됐어요.</p><p class="subtle">'+'내부 게시글의 언급 수이며, 댓글과 추천 수는 포함하지 않습니다.'+'</p><ul class="attention-links">'+links+'</ul>');
}
async function loadMarket(exchange=selectedExchange) {
  if(!exchangeOptions.some(e=>e[0]===exchange))return;
  document.querySelectorAll('[data-exchange]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.exchange===exchange)));
  if(marketBusy&&loadingExchange===exchange)return;
  const requestId=++marketRequest;marketBusy=true;loadingExchange=exchange;
  if(selectedExchange!==exchange){selectedExchange=exchange;marketPage=0;$('marketpagination').innerHTML='';coins=[];lastFetchedAt=null;marketFailed=false;$('coins').innerHTML='<tr><td colspan="6" class="loading">선택한 거래소 시세를 불러오고 있어요.</td></tr>';$('ticker').innerHTML='<span class="inline-status">시세 연결 중...</span>';$('marketbadge').textContent='연결 중';$('markettime').textContent='연결 중';}
  try {
    const [{data}]=await Promise.all([fetchJSON('/api/market?exchange='+encodeURIComponent(exchange)),loadConversion()]);if(requestId!==marketRequest)return;
    if(!Array.isArray(data.coins)||!data.coins.length||(data.id&&data.id!==exchange))throw new Error('invalid_market');
    coins=data.coins;lastFetchedAt=data.fetchedAt;marketFailed=false;
    const meta=exchangeOptions.find(e=>e[0]===exchange);
    marketInfo={id:exchange,name:data.name||meta[1],quote:data.currency||meta[3],source:data.source||exchange,changeLabel:data.changeLabel||'전일 종가 대비 (UTC)'};
    $('marketbadge').textContent=marketInfo.source.toUpperCase();$('marketdescription').textContent=marketInfo.name+' · '+marketInfo.quote+' 현물 · 5개씩 보기';
    $('changebasis').textContent=marketInfo.changeLabel;$('changehead').textContent=marketInfo.quote==='USDT'?'24h 등락률':'전일 대비';
    $('markettime').textContent=marketInfo.name+' · '+time(data.fetchedAt)+' KST 조회 · 60초마다 갱신';
    $('globalstatus').textContent='함께 나누는 알트코인 커뮤니티';
    renderMarketTicker();
    renderCoins();
  } catch {
    if(requestId!==marketRequest)return;marketFailed=true;$('marketbadge').textContent='연결 지연';
    $('markettime').textContent=coins.length?'갱신 실패 · 마지막 성공: '+time(lastFetchedAt)+' KST (이전 데이터)':'선택한 거래소에 연결하지 못했어요. 다른 거래소를 선택하거나 새로고침해 주세요.';
    if(!coins.length){$('marketpagination').innerHTML='';$('coins').innerHTML='<tr><td colspan="6" class="empty">선택한 거래소에 연결하지 못했습니다.</td></tr>';$('ticker').innerHTML='<span class="inline-status">선택한 거래소 시세 연결 지연</span>';}
    else $('ticker').innerHTML='<span class="inline-status">시세 갱신 지연 · 마지막 조회 '+escapeHTML(time(lastFetchedAt))+' KST</span>';
  } finally {if(requestId===marketRequest){marketBusy=false;loadingExchange=null;}}
}
function renderCoins() {
  const list = coins.filter(c => c.symbol !== 'BTC' && (!savedOnly || isFavorite(c)) && (!query || (c.name + ' ' + c.symbol).toLowerCase().includes(query.toLowerCase()))).sort((a, b) => (sortDirection==='desc'?-1:1)*((sort==='change'?a.change-b.change:a.volume24h-b.volume24h)||a.symbol.localeCompare(b.symbol)));
  renderCurrencyControls();
  document.querySelectorAll('[data-sort]').forEach(button=>{const current=button.dataset.sort===sort;button.classList.toggle('on',current);button.setAttribute('aria-pressed',String(current));button.textContent=button.dataset.sort==='volume'?'거래대금 '+(current&&sortDirection==='asc'?'↑':'↓'):current&&sortDirection==='asc'?'하락률 ↑':'상승률 ↓';});
  const pages=Math.max(1,Math.ceil(list.length/MARKET_PAGE_SIZE));
  marketPage=Math.max(0,Math.min(marketPage,pages-1));
  const offset=marketPage*MARKET_PAGE_SIZE;
  $('ranktitle').textContent = savedOnly ? '나의 관심 코인 · 선택 거래소' : '알트코인 시세';
  $('coins').innerHTML = list.slice(offset, offset+MARKET_PAGE_SIZE).map((c, i) => '<tr><td class="rank">' + (offset+i+1) + '</td><td><button class="coinline" onclick="detail(\'' + c.symbol + '\')">' + coinIcon(c.iconSymbol === null ? '' : c.iconSymbol || c.symbol, c.symbol,c.logoUrl) + '<span><b>' + escapeHTML(c.symbol) + '</b><small>' + escapeHTML(c.name) + '</small></span></button></td><td>' + displayCoinPrice(c) + '</td><td class="' + (c.change >= 0 ? 'up' : 'down') + '">' + (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + '%</td><td>' + displayCoinVolume(c) + '</td><td><button class="star ' + (isFavorite(c) ? 'saved' : '') + '" onclick="star(\'' + c.symbol + '\')" aria-label="' + c.symbol + ' 관심 ' + (isFavorite(c) ? '해제' : '저장') + '">' + (isFavorite(c) ? '★' : '☆') + '</button></td></tr>').join('') || '<tr><td colspan="6" class="empty">' + (savedOnly ? '저장한 관심 코인이 없어요. ☆로 코인을 모아보세요.' : '검색 결과가 없습니다.') + '</td></tr>';
  if(!list.length){$('marketpagination').innerHTML='';return;}
  const start=Math.max(0,Math.min(marketPage-2,pages-5));
  const numbers=Array.from({length:Math.min(5,pages)},(_,i)=>start+i);
  $('marketpagination').innerHTML='<div class="market-page-count">'+(offset+1)+'–'+Math.min(offset+MARKET_PAGE_SIZE,list.length)+' / 총 '+list.length+'개 · '+(marketPage+1)+' / '+pages+' 페이지</div><div class="market-page-buttons"><button type="button" onclick="goMarketPage('+(marketPage-1)+')"'+(marketPage===0?' disabled':'')+' aria-label="시세 이전 페이지">← 이전</button>'+numbers.map(index=>'<button type="button" onclick="goMarketPage('+index+')"'+(index===marketPage?' class="on" aria-current="page"':'')+' aria-label="시세 '+(index+1)+' 페이지">'+(index+1)+'</button>').join('')+'<button type="button" onclick="goMarketPage('+(marketPage+1)+')"'+(marketPage===pages-1?' disabled':'')+' aria-label="시세 다음 페이지">다음 →</button></div>';
}
function goMarketPage(index){if(!Number.isInteger(index)||marketBusy)return;marketPage=index;renderCoins();}

function star(symbol){const c=coins.find(x=>x.symbol===symbol);if(!c)return;const key=favoriteKey(c);favorites=isFavorite(c)?favorites.filter(x=>x!==key&&!(selectedExchange==='upbit'&&x===symbol)):[...favorites,key];store('altmoa-stars',favorites);renderCoins();}
function detail(symbol){
 const c=coins.find(x=>x.symbol===symbol);if(!c)return;const token=++detailRequest;
 modal('<div class="eyebrow">'+escapeHTML(marketInfo.name)+' · '+escapeHTML(c.quote||marketInfo.quote)+' 현물'+(marketFailed?' · 이전 데이터':'')+'</div><h2 class="coin-detail-heading">'+coinIcon(c.iconSymbol===null?'':c.iconSymbol||symbol,symbol,c.logoUrl)+escapeHTML(c.name)+' <span class="subtle">'+escapeHTML(symbol)+'</span></h2><div class="detail-stats"><div><small>현재가</small><b style="font-size:15px">'+displayCoinPrice(c)+'</b></div><div><small>'+escapeHTML(marketInfo.changeLabel)+'</small><b style="font-size:16px">'+(c.change>=0?'+':'')+c.change.toFixed(2)+'%</b></div><div><small>24h 거래대금</small><b style="font-size:15px">'+displayCoinVolume(c)+'</b></div></div><p class="subtle">조회 '+escapeHTML(time(lastFetchedAt))+' KST</p><div id="exchangecomparison"><p class="subtle">'+(c.assetId?'다른 거래소 시세를 불러오고 있어요.':'이 코인은 거래소 간 자산 연결을 아직 확인하지 않았습니다. 현재 거래소 시세만 표시합니다.')+'</p></div><button class="solid" onclick="document.getElementById(\'dialog\').close();lounge(\''+symbol+'\')">'+symbol+' 이야기 보기 →</button>');
 if(c.assetId)loadComparison(c.assetId,token);
}
async function loadComparison(assetId,token){
 try{
  const {data}=await fetchJSON('/api/market?asset='+encodeURIComponent(assetId));if(token!==detailRequest||!$('exchangecomparison')||!$('dialog').open)return;
  $('exchangecomparison').innerHTML='<h3 style="font-size:14px;margin-top:22px">거래소별 현물 시세</h3><div class="tablebox"><table><thead><tr><th>거래소</th><th>가격</th><th>원화 환산</th></tr></thead><tbody>'+data.comparisons.map(row=>'<tr><td>'+escapeHTML(row.exchangeName||row.name)+'</td><td>'+(row.status==='ready'?priceLabel(row.price,row.quote):row.status==='unlisted'?'거래 페어 없음':'연결 실패')+'</td><td>'+(row.status==='ready'&&Number.isFinite(row.convertedKrw)?won(row.convertedKrw):'—')+'</td></tr>').join('')+'</tbody></table></div><p class="subtle">'+(data.conversion?'USDT는 '+escapeHTML(data.conversion.source)+' '+won(data.conversion.rate)+' 기준 환산 · '+time(data.conversion.fetchedAt)+' KST. 법정 USD 환율과 다릅니다.':'USDT/KRW 환산 시세가 없어 원화 환산을 생략합니다.')+' 거래소별 조회 시점은 다를 수 있습니다.</p>';
 }catch{if(token===detailRequest&&$('exchangecomparison'))$('exchangecomparison').innerHTML='<p class="subtle">거래소별 비교 시세를 불러오지 못했어요.</p>';}
}
async function loadPosts() {
  const requestId=++feedRequest;
  if(!config?.communityReady){$('posts').innerHTML='<div class="connection"><b>커뮤니티를 준비하고 있어요.</b>회원 서버가 연결되면 실제 이야기를 나눌 수 있어요.</div>';$('boardstatus').textContent='회원·게시판 서버 미연결';$('pagination').innerHTML='';return;}
  $('boardstatus').textContent='게시글을 불러오는 중입니다.';
  $('posts').innerHTML='<div class="loading">이야기를 불러오는 중입니다.</div>';
  const baseSelect='id,author_id,title,category,coin,created_at,profiles(nickname),comments(count)';
  const params=new URLSearchParams({select:baseSelect+(recommendationsReady===false?'':',recommendation_count'),status:'eq.published',order:postSort==='popular'?'recommendation_count.desc,created_at.desc,id.desc':'created_at.desc,id.desc',limit:String(PAGE_SIZE),offset:String(page*PAGE_SIZE)});
  if(category!=='전체')params.set('category','eq.'+category);
  if(postSort==='popular')params.set('recommendation_count','gt.0');
  if(coinFilter)params.set('tags','cs.{'+coinFilter+'}');
  if(query)params.set('title','ilike.*'+query.replace(/[\\%_*]/g,'\\$&')+'*');
  try{
    let result;
    try{result=await db('posts?'+params,{headers:{Prefer:'count=exact'}});}
    catch(error){if(postSort==='latest'&&/recommendation_count|schema cache|does not exist/i.test(error.message||'')){recommendationsReady=false;params.set('select',baseSelect);result=await db('posts?'+params,{headers:{Prefer:'count=exact'}});}else throw error;}
    if(requestId!==feedRequest)return;
    const {data,response}=result;posts=data;total=Number(response.headers.get('content-range')?.split('/')[1])||data.length;
    $('posts').innerHTML=posts.map(post=>'<button class="post" onclick="openPost(\''+post.id+'\')"><span class="tag">'+escapeHTML(post.category)+'</span><span class="post-title">'+escapeHTML(post.title)+'<span class="comments">['+Number(post.comments?.[0]?.count||0)+']</span></span>'+(Number.isInteger(post.recommendation_count)?'<span class="post-votes">추천 '+post.recommendation_count+'</span>':'')+'<small>'+escapeHTML(post.profiles?.nickname||'알트모아 회원')+memberBadge(post.author_id)+'<br>'+time(post.created_at)+'</small></button>').join('')||'<div class="empty">'+(postSort==='popular'?'아직 추천받은 글이 없어요.':query||coinFilter?'조건에 맞는 이야기가 없어요.':'아직 이야기가 없어요. 첫 글을 남겨보세요.')+'</div>';
    loadMemberBadges(posts.map(post=>post.author_id));
    $('boardstatus').textContent=(coinFilter?coinFilter+' · ':'')+(postSort==='popular'?'누적 추천 순 · ':'최신순 · ')+'총 '+total+'개 이야기';
    $('pagination').innerHTML=(page>0?'<button onclick="changePage(-1)">← 이전</button>':'')+'<span>'+(page+1)+'</span>'+((page+1)*PAGE_SIZE<total?'<button onclick="changePage(1)">다음 →</button>':'');
  }catch(error){if(requestId!==feedRequest)return;$('posts').innerHTML='<div class="connection"><b>'+(postSort==='popular'?'추천 인기글을 준비하고 있어요.':'게시글을 불러오지 못했어요.')+'</b><button onclick="openBoard(\''+category+'\')">최신 이야기 보기 →</button></div>';$('boardstatus').textContent=postSort==='popular'?'추천 기능 연결 후 순위를 표시합니다.':errorMessage(error);$('pagination').innerHTML='';}
  document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('on',button.dataset.tab===category));
}
function changePage(delta) { page = Math.max(0, page + delta); loadPosts(); $('boardpanel').scrollIntoView({ behavior: 'smooth' }); }
async function openPost(id) {
  modal('<p class="loading">이야기를 불러오고 있어요.</p>', id);
  try {
    const { data } = await db('posts?' + new URLSearchParams({ select: '*,profiles(nickname)', id: 'eq.' + id, status: 'eq.published' }));
    if (activePostId !== id || !$('dialog').open) return;
    const p = data[0]; if (!p) return info('이야기를 찾을 수 없어요', '삭제되었거나 숨김 처리된 게시글입니다.');
    modal('<div class="eyebrow">' + escapeHTML(p.category) + (p.coin ? ' · ' + escapeHTML(p.coin) : '') + '</div><h2>' + escapeHTML(p.title) + '</h2><p class="subtle">' + escapeHTML(p.profiles?.nickname || '알트모아 회원') + memberBadge(p.author_id) + ' · ' + time(p.created_at) + '</p><div class="postbody">' + escapeHTML(p.body) + '</div><div class="post-tags">'+renderTags(p.tags)+'</div><div id="postphotosview" class="post-photos"></div><section id="postpoll" class="post-poll"></section><div id="postrecommendation" class="post-recommendation"><p class="subtle">추천을 불러오는 중입니다.</p></div><div class="row-actions"><button onclick="reportItem(\'posts\',\'' + id + '\')">신고</button>' + (session?.user?.id === p.author_id ? '<button class="danger" onclick="deleteItem(\'posts\',\'' + id + '\')">내 글 삭제</button>' : '') + (moderator ? '<button class="danger" onclick="hideItem(\'posts\',\'' + id + '\')">운영자 숨김</button>' : '') + '</div><h3 style="font-size:14px;margin-top:26px">댓글</h3><div id="comments"><p class="subtle">불러오는 중...</p></div><form id="commentform"><label class="subtle" for="commentbody">함께 나눌 이야기</label><textarea id="commentbody" name="body" maxlength="2000" required style="height:80px" placeholder="' + (session?.user ? '댓글을 입력하세요' : '로그인 후 댓글을 남길 수 있어요') + '"></textarea><button class="solid" id="commentsubmit">댓글 등록</button><p id="commenterror" class="subtle" role="alert"></p></form>', id);
    $('commentform').onsubmit = async event => {
      event.preventDefault(); if (!session?.user) return authModal();
      const button = $('commentsubmit'); button.disabled = true;
      try { await db('comments', { method: 'POST', body: JSON.stringify({ post_id: id, author_id: session.user.id, body: new FormData(event.target).get('body').trim() }) }); if (activePostId === id) { $('commentbody').value = ''; await loadComments(id); } loadPosts(); }
      catch (error) { if ($('commenterror')) $('commenterror').textContent = errorMessage(error); }
      finally { if (button.isConnected) button.disabled = false; }
    };
    loadMemberBadges([p.author_id]);
    await Promise.all([loadComments(id),loadPostRecommendation(id,p.author_id),loadPostPhotos(p.images,id),loadPoll(p)]);
  } catch (error) { if (activePostId === id) info('이야기를 불러오지 못했어요', errorMessage(error)); }
}
async function loadComments(id) {
  try {
    const { data } = await db('comments?' + new URLSearchParams({ select: 'id,author_id,body,created_at,profiles(nickname)', post_id: 'eq.' + id, status: 'eq.published', order: 'created_at.asc', limit: '200' }));
    if (activePostId !== id || !$('comments')) return;
    $('comments').innerHTML = data.map(c => '<div class="comment"><small>' + escapeHTML(c.profiles?.nickname || '알트모아 회원') + memberBadge(c.author_id) + ' · ' + time(c.created_at) + '</small><p>' + escapeHTML(c.body) + '</p><div class="row-actions"><button onclick="reportItem(\'comments\',\'' + c.id + '\')">신고</button>' + (session?.user?.id === c.author_id ? '<button onclick="deleteItem(\'comments\',\'' + c.id + '\',\'' + id + '\')">삭제</button>' : '') + (moderator ? '<button onclick="hideItem(\'comments\',\'' + c.id + '\',\'' + id + '\')">숨김</button>' : '') + '</div></div>').join('') || '<p class="subtle">첫 댓글을 남겨보세요.</p>';
    loadMemberBadges(data.map(comment=>comment.author_id));
    if (data.length === 200) $('comments').insertAdjacentHTML('beforeend', '<p class="subtle">댓글은 먼저 작성된 200개까지 표시합니다.</p>');
  } catch (error) { if (activePostId === id && $('comments')) $('comments').textContent = errorMessage(error); }
}
function writePost() {
  if (!config?.communityReady || !session?.user) return authModal();
  composerImages.forEach(image=>URL.revokeObjectURL(image.preview));composerImages=[];
  modal('<div class="eyebrow">NEW CONVERSATION</div><h2>어떤 이야기를 나눠볼까요?</h2><form id="writeform"><label>게시판<select name="category">'+BOARDS.map(board=>'<option'+(category===board.key?' selected':'')+'>'+board.key+'</option>').join('')+'</select></label><label>태그 (필수)<input name="tags" required maxlength="220" value="'+escapeHTML(coinFilter)+'" placeholder="usdt btc 비트코인"></label><p class="subtle">공백 또는 쉼표로 구분 · 1~10개 · 태그당 최대 20자</p><label>제목<input name="title" minlength="2" maxlength="100" required placeholder="제목을 입력하세요"></label><label>내용<textarea name="body" minlength="2" maxlength="10000" required placeholder="서로 존중하며 생각을 나눠주세요"></textarea></label><label>사진 첨부 (최대 3장)<input id="postphotos" type="file" multiple accept="image/jpeg,image/png,image/webp"></label><p class="subtle">사진은 최대 1600px JPEG로 변환하며 위치 등 원본 메타데이터를 제거합니다. 개인정보·타인의 저작물이 담기지 않았는지 확인하세요.</p><div id="photopreviews" class="photo-previews"></div><details class="poll-composer"><summary>투표 추가 (선택)</summary><label>투표 질문<input name="poll_question" maxlength="100" placeholder="예: 가장 자주 보는 거래소는?"></label><label>선택지<textarea name="poll_options" maxlength="490" placeholder="한 줄에 하나씩, 2~6개"></textarea></label><p class="subtle">1인 1표 · 등록 후 선택지와 투표 변경 불가</p></details><p class="subtle">홍보 도배·사칭·개인정보 게시 금지 · <a href="/guidelines">운영 원칙</a></p><button class="solid wide" id="writesubmit">게시글 등록</button><p class="subtle" id="writeerror" role="alert"></p></form>');
  $('postphotos').onchange=event=>selectPhotos([...event.target.files]);
  $('writeform').onsubmit = async event => {
    event.preventDefault(); const form = new FormData(event.target); const button = $('writesubmit'); button.disabled = true;let uploaded=[],saved=false;
    try {
      if($('postphotos').disabled)throw Error('사진 처리가 끝난 후 등록해 주세요.');
      const tags=parseTags(form.get('tags'));const question=String(form.get('poll_question')||'').trim(),options=String(form.get('poll_options')||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      if((question||options.length)&&(question.length<2||question.length>100||options.length<2||options.length>6||options.some(o=>o.length>80)||new Set(options).size!==options.length))throw Error('투표 질문 2~100자와 서로 다른 선택지 2~6개(각 80자 이하)를 입력하세요.');
      uploaded=await uploadComposerImages();
      const { data } = await db('posts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ author_id: session.user.id, category: form.get('category'), tags, images:uploaded,poll_question:question||null,poll_options:options, title: form.get('title').trim(), body: form.get('body').trim() }) });saved=true;
      composerImages.forEach(image=>URL.revokeObjectURL(image.preview));composerImages=[];
      category = form.get('category'); coinFilter = ''; query = ''; $('search').value = ''; page = 0; navigate('board',{category}); await loadPosts(); toast('게시글을 등록했어요.'); loadAttention(); if (data[0]) openPost(data[0].id);
    } catch (error) { if(!saved&&error.status)await deleteUploadedPhotos(uploaded);if ($('writeerror')) $('writeerror').textContent = /태그|투표|사진|선택지/.test(error.message)?error.message:errorMessage(error); }
    finally { if (button.isConnected) button.disabled = false; }
  };
}

function deleteItem(table, id, postId = '') {
  modal('<h2>' + (table === 'posts' ? '내 글' : '댓글') + '을 삭제할까요?</h2><p>삭제하면 되돌릴 수 없습니다.</p><button class="solid" id="confirmdelete">삭제하기</button> <button onclick="' + (postId ? "openPost('" + postId + "')" : "document.getElementById('dialog').close()") + '">취소</button><p id="deleteerror" role="alert"></p>');
  $('confirmdelete').onclick = async event => { const button = event.target; button.disabled = true; try { await db(table + '?id=eq.' + id, { method: 'DELETE' }); $('dialog').close(); toast('삭제했어요.'); loadPosts(); if(activeView==='home')loadPopular(); if (postId) openPost(postId); } catch (error) { if ($('deleteerror')) $('deleteerror').textContent = errorMessage(error); } finally { if (button.isConnected) button.disabled = false; } };
}
function reportItem(table, id) {
  if (!session?.user) return authModal();
  modal('<h2>문제가 있는 내용을 알려주세요</h2><form id="reportform"><label>신고 사유<textarea name="reason" minlength="2" maxlength="500" required placeholder="도배, 사칭, 부적절한 내용 등"></textarea></label><button class="solid" id="reportsubmit">신고 접수</button><p id="reporterror" role="alert"></p></form>');
  $('reportform').onsubmit = async event => { event.preventDefault(); const button = $('reportsubmit'); button.disabled = true; try { await db('reports', { method: 'POST', body: JSON.stringify({ reporter_id: session.user.id, [table === 'posts' ? 'post_id' : 'comment_id']: id, reason: new FormData(event.target).get('reason').trim() }) }); info('신고를 접수했어요', '운영자가 내용을 확인할 수 있도록 저장했습니다.'); } catch (error) { if ($('reporterror')) $('reporterror').textContent = errorMessage(error); } finally { if (button.isConnected) button.disabled = false; } };
}
async function hideItem(table, id, postId = '') { try { await db(table + '?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) }); $('dialog').close(); toast('숨김 처리했어요.'); loadPosts(); if(activeView==='home')loadPopular(); if (postId) openPost(postId); } catch (error) { toast(errorMessage(error)); } }
async function showReports() {
  if (!moderator) return;
  modal('<h2>신고 관리</h2><p class="subtle">불러오는 중...</p>');
  try { const { data } = await db('reports?select=*,posts(title,status),comments(body,status)&order=created_at.desc&limit=50'); modal('<h2>신고 관리</h2><p class="subtle">최근 신고 50개 · 숨김 상태도 함께 확인할 수 있어요.</p>' + data.map(r => '<div class="comment"><small>' + time(r.created_at) + ' · ' + escapeHTML((r.posts || r.comments)?.status || '삭제됨') + '</small><p>' + escapeHTML(r.posts?.title || r.comments?.body || '삭제된 콘텐츠') + '</p><p class="subtle">사유: ' + escapeHTML(r.reason) + '</p><button class="danger" onclick="hideItem(\'' + (r.post_id ? 'posts' : 'comments') + '\',\'' + (r.post_id || r.comment_id) + '\')">숨김 처리</button></div>').join('')); } catch (error) { info('신고를 불러오지 못했어요', errorMessage(error)); }
}
function lounge(symbol){coinFilter=symbol;category='전체';query='';$('search').value='';page=0;navigate('board',{category:'전체'});}
function showSaved(){query='';$('search').value='';navigate('saved');}
async function init() {
  renderPopularShell(); updateAuth(); restoreCommunityRoute();
  if(activeView!=='home')loadAttentionSummary();
  window.addEventListener?.('popstate',restoreCommunityRoute);

  $('attentionperiod').onchange=loadAttention;
  document.querySelectorAll('[data-nav],[data-side]').forEach(b => b.onclick = () => navigate(b.dataset.nav || b.dataset.side));
  document.querySelectorAll('[data-sort]').forEach(button=>button.onclick=()=>setMarketSort(button.dataset.sort));
  document.querySelectorAll('[data-tab],[data-board]').forEach(button=>button.onclick=()=>openBoard(button.dataset.tab||button.dataset.board));
  document.querySelectorAll('[data-post-sort]').forEach(button=>button.onclick=()=>{page=0;navigate('board',{sort:button.dataset.postSort});});
  $('searchform').onsubmit = event => { event.preventDefault(); query = $('search').value.trim().slice(0, 100); savedOnly = false; coinFilter = ''; page = 0; marketPage=0; if(activeView==='market'||activeView==='saved')renderCoins();else navigate('board',{category:'전체',sort:'latest'}); };
  $('theme').onclick = () => { document.body.classList.toggle('dark'); store('altmoa-dark', document.body.classList.contains('dark')); };
  if (read('altmoa-dark', false)) document.body.classList.add('dark');
  $('dialog').addEventListener('close', () => { if (!$('dialog').open) activePostId = null; });
  $('dialog').addEventListener('click', event => { if (event.target === $('dialog')) { const r = $('dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('dialog').close(); } });
  setInterval(()=>{if(!document.hidden){if(['market','saved'].includes(activeView))loadMarket();if(activeView==='rank')loadAttention();if(activeView==='home'){loadPopular();loadAttentionSummary();}}},60000);
  document.addEventListener('visibilitychange', () => { if (['market','saved'].includes(activeView) && !document.hidden && (!lastFetchedAt || Date.now() - new Date(lastFetchedAt).getTime() > 60000)) loadMarket(); });
  try {
    config = (await fetchJSON('/api/config')).data;
    $('connectionstatus').textContent = config.communityReady ? '회원·게시판 연결됨' : '회원·게시판 준비 중';
    if (config.communityReady) {
      const hash = new URLSearchParams(location.hash.slice(1)); let recovery = false;
      if (hash.has('access_token')) {
        const token = hash.get('access_token'); const { data: user } = await fetchJSON(config.supabaseUrl + '/auth/v1/user', { headers: { apikey: config.supabaseKey, Authorization: 'Bearer ' + token } });
        setSession({ access_token: token, refresh_token: hash.get('refresh_token'), expires_at: Date.now() / 1000 + Number(hash.get('expires_in') || 3600), user }); recovery = hash.get('type') === 'recovery'; history.replaceState({}, '', location.pathname + location.search);
      } else if (session?.access_token) {
        try { const token = await freshToken(); const { data: user } = await fetchJSON(config.supabaseUrl + '/auth/v1/user', { headers: { apikey: config.supabaseKey, Authorization: 'Bearer ' + token } }); setSession({ ...session, user }); } catch (error) { if ([400, 401, 403].includes(error.status)) setSession(null); }
      }
      await refreshModerator(); if (recovery) passwordModal();
    } else setSession(null);
  } catch { config = { communityReady: false }; $('connectionstatus').textContent = '커뮤니티 연결 지연'; }
  if(activeView==='board')await loadPosts();
  if(activeView==='home')await loadPopular();
  if(activeView==='activity')await loadMyActivity();
  const linkedPost=new URLSearchParams(location.search).get('post');if(linkedPost&&/^[a-f0-9-]{36}$/i.test(linkedPost))await openPost(linkedPost);
}
init();
