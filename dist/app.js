'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (key, fallback, storage = localStorage) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value, storage = localStorage) => { try { storage.setItem(key, JSON.stringify(value)); } catch { toast('브라우저 저장 공간을 사용할 수 없어요.'); } };
let config = null, session = read('altmoa-session', null, sessionStorage), refreshPromise = null;
let coins = [], posts = [], favorites = read('altmoa-stars', []), sort = 'volume', query = '', category = '전체', coinFilter = '', savedOnly = false;
let page = 0, total = 0, feedRequest = 0, marketBusy = false, activePostId = null, moderator = false;
let lastFetchedAt = null, marketFailed = false;
const PAGE_SIZE = 20;
const time = value => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
const won = n => '₩' + new Intl.NumberFormat('ko-KR', { maximumFractionDigits: n < 1 ? 5 : n < 100 ? 2 : 0 }).format(n);
const volume = n => n >= 1e12 ? (n / 1e12).toFixed(2) + '조' : n >= 1e8 ? (n / 1e8).toFixed(1) + '억' : (n / 1e4).toFixed(0) + '만';
function toast(message) { $('toast').textContent = message; $('toast').style.display = 'block'; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => $('toast').style.display = 'none', 2800); }
function modal(html, postId = null) { activePostId = postId; $('modalcontent').innerHTML = html; if (!$('dialog').open) $('dialog').showModal(); }
function info(title, body) { modal('<div class="eyebrow">ALTMOA</div><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(body) + '</p>'); }
function method() { info('관심도 집계 안내', '현재 외부 관심도 수집은 연결되지 않았습니다. 연결된 출처가 없으므로 언급량·급상승 배수·종합점수를 표시하지 않습니다. 시세 표는 업비트 원화 마켓의 실제 응답을 사용하고, 관심도 순위와 분리합니다. 전일 대비 등락률은 UTC 기준 전일 종가 대비이며, 거래대금은 최근 24시간 기준입니다.'); }
function rules() { info('함께 지켜요', '홍보 도배, 사칭, 수익 보장, 개인정보 공개, 불법·음란 콘텐츠는 게시할 수 없습니다. 문제가 있는 글·댓글은 신고해 주세요. 작성자는 자신의 글·댓글을 삭제할 수 있고 운영자는 신고 내용을 확인해 숨김 처리할 수 있습니다. 사진 첨부와 외부 원문 수집은 아직 제공하지 않습니다. 관심 코인은 이 브라우저에 저장됩니다.'); }
function errorMessage(error) { const m = error.message || ''; if (/60초|10초/.test(m)) return m; if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호를 확인해 주세요.'; if (/email not confirmed/i.test(m)) return '이메일 인증을 완료한 뒤 로그인해 주세요.'; if (/already registered/i.test(m)) return '이미 가입된 이메일입니다.'; if (/rate limit|too many/i.test(m)) return '요청이 많아요. 잠시 후 다시 시도해 주세요.'; if (/duplicate key|23505/.test(m)) return '이미 신고한 항목입니다.'; if (/JWT|token|로그인/.test(m)) return '다시 로그인해 주세요.'; if (/schema cache|does not exist/i.test(m)) return '게시판 연결을 준비하고 있습니다.'; if (/fetch|network|timeout|abort/i.test(m)) return '연결하지 못했어요. 잠시 후 다시 시도해 주세요.'; if (error.status === 401 || error.status === 403) return '접근 권한을 확인해 주세요.'; return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'; }
async function fetchJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(data?.msg || data?.error_description || data?.message || data?.error || 'Request failed'); error.status = response.status; throw error; }
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
  if (session?.user) return modal('<div class="eyebrow">MY ALTMOA</div><h2>내 계정</h2><p>' + escapeHTML(session.user.email) + '</p><button class="solid" onclick="signOut()">로그아웃</button>' + (moderator ? ' <button onclick="showReports()">신고 관리 →</button>' : ''));
  const signup = mode === 'signup';
  modal('<div class="eyebrow">WELCOME TO ALTMOA</div><h2>' + (signup ? '알트모아에 가입하기' : '다시 만나 반가워요') + '</h2><form id="authform">' + (signup ? '<label>닉네임<input name="nickname" minlength="2" maxlength="20" required autocomplete="nickname"></label>' : '') + '<label>이메일<input name="email" type="email" required autocomplete="email"></label><label>비밀번호<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></label><p class="subtle">' + (signup ? '이메일 인증 후 이용할 수 있습니다. 8자 이상의 비밀번호를 사용하세요.' : '이메일로 가입한 계정으로 로그인하세요.') + '</p><button class="solid wide" id="authsubmit">' + (signup ? '가입하기' : '로그인') + '</button><p id="autherror" role="alert" class="subtle"></p></form><button onclick="authModal(\'' + (signup ? 'login' : 'signup') + '\')">' + (signup ? '이미 계정이 있어요 → 로그인' : '아직 계정이 없어요 → 회원가입') + '</button>' + (!signup ? '<button style="float:right" onclick="resetPassword()">비밀번호 재설정</button>' : ''));
  $('authform').onsubmit = async event => {
    event.preventDefault(); const form = new FormData(event.target); const submit = $('authsubmit'); submit.disabled = true; $('autherror').textContent = '';
    try {
      const path = signup ? '/signup' : '/token?grant_type=password';
      const body = { email: form.get('email').trim(), password: form.get('password') };
      if (signup) body.data = { nickname: form.get('nickname').trim() };
      const { data } = await fetchJSON(config.supabaseUrl + '/auth/v1' + path, { method: 'POST', headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (data.access_token) { setSession({ ...data, expires_at: data.expires_at || Date.now() / 1000 + data.expires_in }); await refreshModerator(); $('dialog').close(); toast('로그인했어요.'); await loadPosts(); }
      else info('인증 메일을 확인해 주세요', '받은 메일에서 인증을 완료한 뒤 로그인해 주세요. 메일이 없다면 스팸함도 확인해 주세요.');
    } catch (error) { if ($('autherror')) $('autherror').textContent = errorMessage(error); }
    finally { if (submit.isConnected) submit.disabled = false; }
  };
}
async function signOut() { try { const token = await freshToken(); if (token) await fetchJSON(config.supabaseUrl + '/auth/v1/logout', { method: 'POST', headers: { apikey: config.supabaseKey, Authorization: 'Bearer ' + token } }); } catch {} setSession(null); moderator = false; $('dialog').close(); toast('로그아웃했어요.'); await loadPosts(); }
function resetPassword() {
  modal('<div class="eyebrow">ACCOUNT RECOVERY</div><h2>비밀번호 재설정</h2><form id="recoverform"><label>가입한 이메일<input name="email" type="email" required autocomplete="email"></label><button class="solid wide">재설정 메일 받기</button><p id="recoverstatus" role="status"></p></form>');
  $('recoverform').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; try { await fetchJSON(config.supabaseUrl + '/auth/v1/recover?redirect_to=' + encodeURIComponent(location.origin + '/'), { method: 'POST', headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: new FormData(event.target).get('email').trim() }) }); info('메일을 확인해 주세요', '등록된 계정이 있다면 비밀번호 재설정 메일이 발송됩니다.'); } catch (error) { if ($('recoverstatus')) $('recoverstatus').textContent = errorMessage(error); } finally { if (button.isConnected) button.disabled = false; } };
}
function passwordModal() {
  modal('<h2>새 비밀번호 설정</h2><form id="passwordform"><label>새 비밀번호<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label><button class="solid wide">비밀번호 변경</button><p id="passwordstatus" role="alert"></p></form>');
  $('passwordform').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; try { const token = await freshToken(); await fetchJSON(config.supabaseUrl + '/auth/v1/user', { method: 'PUT', headers: { apikey: config.supabaseKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: new FormData(event.target).get('password') }) }); $('dialog').close(); toast('비밀번호를 변경했어요.'); } catch (error) { if ($('passwordstatus')) $('passwordstatus').textContent = errorMessage(error); } finally { if (button.isConnected) button.disabled = false; } };
}
async function loadMarket() {
  if (marketBusy) return; marketBusy = true;
  try {
    const { data } = await fetchJSON('/api/market'); coins = data.coins; lastFetchedAt = data.fetchedAt; marketFailed = false;
    $('marketbadge').textContent = 'UPBIT'; $('markettime').textContent = '업비트 · ' + time(data.fetchedAt) + ' KST 조회 · 60초마다 갱신';
    $('globalstatus').textContent = '실제 시세 · 외부 관심도 수집 준비 중';
    $('ticker').innerHTML = '<span style="color:var(--accent);font-weight:700">UPBIT · KRW</span>' + ['BTC', 'ETH', 'SOL', 'XRP'].map(symbol => { const c = coins.find(x => x.symbol === symbol); return c ? '<span><b>' + symbol + '</b>' + won(c.price) + ' <span class="' + (c.change >= 0 ? 'up' : 'down') + '">' + (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + '%</span></span>' : ''; }).join('') + '<span style="color:#94a0b2;font-size:10px">전일 종가 대비</span>';
    renderCoins(); renderLounges();
  } catch {
    marketFailed = true; $('marketbadge').textContent = '연결 지연'; $('markettime').innerHTML = coins.length ? '갱신 실패 · 마지막 성공: ' + escapeHTML(time(lastFetchedAt)) + ' KST (이전 데이터)' : '시세를 불러오지 못했어요. 새로고침으로 다시 시도하세요.';
    if (!coins.length) { $('coins').innerHTML = '<tr><td colspan="6" class="empty">시세 제공처에 연결하지 못했습니다.</td></tr>'; $('ticker').innerHTML = '<span class="inline-status">시세 연결 지연 · 잠시 후 다시 시도합니다.</span>'; }
    else $('ticker').innerHTML = '<span class="inline-status">시세 갱신 지연 · 마지막 조회 ' + escapeHTML(time(lastFetchedAt)) + ' KST</span>';
    $('globalstatus').textContent = '시세 연결 지연 · 관심도 수집 준비 중';
  } finally { marketBusy = false; }
}
function renderCoins() {
  const list = coins.filter(c => c.symbol !== 'BTC' && (!savedOnly || favorites.includes(c.symbol)) && (!query || (c.name + ' ' + c.symbol).toLowerCase().includes(query.toLowerCase()))).sort((a, b) => sort === 'change' ? b.change - a.change : b.volume24h - a.volume24h);
  $('ranktitle').textContent = savedOnly ? '나의 관심 코인' : '알트코인 시세';
  $('coins').innerHTML = list.slice(0, 5).map((c, i) => '<tr><td class="rank">' + (i + 1) + '</td><td><button class="coinline" onclick="detail(\'' + c.symbol + '\')"><span class="coinicon" style="--coin:#475569">' + escapeHTML(c.symbol.slice(0, 1)) + '</span><span><b>' + escapeHTML(c.symbol) + '</b><small>' + escapeHTML(c.name) + '</small></span></button></td><td>' + won(c.price) + '</td><td class="' + (c.change >= 0 ? 'up' : 'down') + '">' + (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + '%</td><td>' + volume(c.volume24h) + '원</td><td><button class="star ' + (favorites.includes(c.symbol) ? 'saved' : '') + '" onclick="star(\'' + c.symbol + '\')" aria-label="' + c.symbol + ' 관심 ' + (favorites.includes(c.symbol) ? '해제' : '저장') + '">' + (favorites.includes(c.symbol) ? '★' : '☆') + '</button></td></tr>').join('') || '<tr><td colspan="6" class="empty">' + (savedOnly ? '저장한 관심 코인이 없어요. ☆로 코인을 모아보세요.' : '검색 결과가 없습니다.') + '</td></tr>';
}
function star(symbol) { favorites = favorites.includes(symbol) ? favorites.filter(x => x !== symbol) : [...favorites, symbol]; store('altmoa-stars', favorites); renderCoins(); }
function detail(symbol) { const c = coins.find(x => x.symbol === symbol); if (!c) return; modal('<div class="eyebrow">UPBIT · KRW' + (marketFailed ? ' · 이전 데이터' : '') + '</div><h2>' + escapeHTML(c.name) + ' <span class="subtle">' + escapeHTML(c.symbol) + '</span></h2><div class="detail-stats"><div><small>현재가</small><b style="font-size:16px">' + won(c.price) + '</b></div><div><small>전일 대비</small><b style="font-size:16px">' + (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + '%</b></div><div><small>24h 거래대금</small><b style="font-size:16px">' + volume(c.volume24h) + '원</b></div></div><p class="subtle">조회: ' + escapeHTML(time(lastFetchedAt)) + ' KST · 외부 관심도는 아직 수집하지 않습니다.</p><button class="solid" onclick="document.getElementById(\'dialog\').close();lounge(\'' + c.symbol + '\')">' + c.symbol + ' 이야기 보기 →</button>'); }
function renderLounges() { const list = ['SUI', 'SOL', 'DOGE', 'XRP', 'SEI']; $('lounges').innerHTML = list.map(symbol => { const c = coins.find(x => x.symbol === symbol); return '<button onclick="lounge(\'' + symbol + '\')"><span>' + escapeHTML(c?.name || symbol) + '</span><small>' + symbol + '</small></button>'; }).join(''); $('topics').innerHTML = ['SUI', 'SOL', 'DOGE', 'PEPE', 'SEI', 'ONDO'].map(symbol => '<button onclick="lounge(\'' + symbol + '\')"># ' + symbol + '</button>').join(''); }
async function loadPosts() {
  const requestId = ++feedRequest;
  if (!config?.communityReady) { $('posts').innerHTML = '<div class="connection"><b>커뮤니티를 준비하고 있어요.</b>회원 서버가 연결되면 실제 이야기를 나눌 수 있어요.</div>'; $('boardstatus').textContent = '회원·게시판 서버 미연결'; $('pagination').innerHTML = ''; $('recenttopics').innerHTML = '<p class="inline-status">아직 연결된 이야기가 없습니다.</p>'; return; }
  $('boardstatus').textContent = '게시글을 불러오는 중입니다.';
  const params = new URLSearchParams({ select: 'id,author_id,title,category,coin,created_at,profiles(nickname),comments(count)', status: 'eq.published', order: 'created_at.desc', limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (!['전체', '인기'].includes(category)) params.set('category', 'eq.' + category);
  if (coinFilter) params.set('coin', 'eq.' + coinFilter);
  if (query) params.set('title', 'ilike.*' + query.replace(/[\\%_*]/g, '\\$&') + '*');
  try {
    const { data, response } = await db('posts?' + params, { headers: { Prefer: 'count=exact' } });
    if (requestId !== feedRequest) return;
    posts = data; total = Number(response.headers.get('content-range')?.split('/')[1]) || data.length;
    if (category === '인기') posts.sort((a, b) => (b.comments?.[0]?.count || 0) - (a.comments?.[0]?.count || 0));
    $('posts').innerHTML = posts.map(p => '<button class="post" onclick="openPost(\'' + p.id + '\')"><span class="tag">' + escapeHTML(p.category) + '</span><span class="post-title">' + escapeHTML(p.title) + '<span class="comments">[' + (p.comments?.[0]?.count || 0) + ']</span></span><small>' + escapeHTML(p.profiles?.nickname || '알트모아 회원') + '<br>' + time(p.created_at) + '</small></button>').join('') || '<div class="empty">' + (query || coinFilter ? '조건에 맞는 이야기가 없어요.' : '아직 이야기가 없어요. 첫 글을 남겨보세요.') + '</div>';
    $('boardstatus').textContent = (coinFilter ? coinFilter + ' · ' : '') + (category === '인기' ? '현재 페이지의 최근 글을 댓글 수로 정렬 · ' : '') + '총 ' + total + '개 이야기';
    $('pagination').innerHTML = (page > 0 ? '<button onclick="changePage(-1)">← 이전</button>' : '') + '<span>' + (page + 1) + '</span>' + ((page + 1) * PAGE_SIZE < total ? '<button onclick="changePage(1)">다음 →</button>' : '');
    $('recenttopics').innerHTML = posts.slice(0, 3).map((p, i) => '<div class="reason"><span class="reason-num">0' + (i + 1) + '</span><div><button style="text-align:left;padding:0" onclick="openPost(\'' + p.id + '\')"><b>' + escapeHTML(p.title) + '</b></button><p>' + escapeHTML(p.category) + (p.coin ? ' · ' + escapeHTML(p.coin) : '') + '</p></div></div>').join('') || '<p class="inline-status">첫 이야기를 기다리고 있어요.</p>';
  } catch (error) { if (requestId !== feedRequest) return; $('posts').innerHTML = '<div class="connection"><b>게시글을 불러오지 못했어요.</b><button onclick="loadPosts()">다시 시도 →</button></div>'; $('boardstatus').textContent = errorMessage(error); $('pagination').innerHTML = ''; }
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === category));
}
function changePage(delta) { page = Math.max(0, page + delta); loadPosts(); $('boardpanel').scrollIntoView({ behavior: 'smooth' }); }
async function openPost(id) {
  modal('<p class="loading">이야기를 불러오고 있어요.</p>', id);
  try {
    const { data } = await db('posts?' + new URLSearchParams({ select: '*,profiles(nickname)', id: 'eq.' + id, status: 'eq.published' }));
    if (activePostId !== id || !$('dialog').open) return;
    const p = data[0]; if (!p) return info('이야기를 찾을 수 없어요', '삭제되었거나 숨김 처리된 게시글입니다.');
    modal('<div class="eyebrow">' + escapeHTML(p.category) + (p.coin ? ' · ' + escapeHTML(p.coin) : '') + '</div><h2>' + escapeHTML(p.title) + '</h2><p class="subtle">' + escapeHTML(p.profiles?.nickname || '알트모아 회원') + ' · ' + time(p.created_at) + '</p><div class="postbody">' + escapeHTML(p.body) + '</div><div class="row-actions"><button onclick="reportItem(\'posts\',\'' + id + '\')">신고</button>' + (session?.user?.id === p.author_id ? '<button class="danger" onclick="deleteItem(\'posts\',\'' + id + '\')">내 글 삭제</button>' : '') + (moderator ? '<button class="danger" onclick="hideItem(\'posts\',\'' + id + '\')">운영자 숨김</button>' : '') + '</div><h3 style="font-size:14px;margin-top:26px">댓글</h3><div id="comments"><p class="subtle">불러오는 중...</p></div><form id="commentform"><label class="subtle" for="commentbody">함께 나눌 이야기</label><textarea id="commentbody" name="body" maxlength="2000" required style="height:80px" placeholder="' + (session?.user ? '댓글을 입력하세요' : '로그인 후 댓글을 남길 수 있어요') + '"></textarea><button class="solid" id="commentsubmit">댓글 등록</button><p id="commenterror" class="subtle" role="alert"></p></form>', id);
    $('commentform').onsubmit = async event => {
      event.preventDefault(); if (!session?.user) return authModal();
      const button = $('commentsubmit'); button.disabled = true;
      try { await db('comments', { method: 'POST', body: JSON.stringify({ post_id: id, author_id: session.user.id, body: new FormData(event.target).get('body').trim() }) }); if (activePostId === id) { $('commentbody').value = ''; await loadComments(id); } loadPosts(); }
      catch (error) { if ($('commenterror')) $('commenterror').textContent = errorMessage(error); }
      finally { if (button.isConnected) button.disabled = false; }
    };
    await loadComments(id);
  } catch (error) { if (activePostId === id) info('이야기를 불러오지 못했어요', errorMessage(error)); }
}
async function loadComments(id) {
  try {
    const { data } = await db('comments?' + new URLSearchParams({ select: 'id,author_id,body,created_at,profiles(nickname)', post_id: 'eq.' + id, status: 'eq.published', order: 'created_at.asc', limit: '200' }));
    if (activePostId !== id || !$('comments')) return;
    $('comments').innerHTML = data.map(c => '<div class="comment"><small>' + escapeHTML(c.profiles?.nickname || '알트모아 회원') + ' · ' + time(c.created_at) + '</small><p>' + escapeHTML(c.body) + '</p><div class="row-actions"><button onclick="reportItem(\'comments\',\'' + c.id + '\')">신고</button>' + (session?.user?.id === c.author_id ? '<button onclick="deleteItem(\'comments\',\'' + c.id + '\',\'' + id + '\')">삭제</button>' : '') + (moderator ? '<button onclick="hideItem(\'comments\',\'' + c.id + '\',\'' + id + '\')">숨김</button>' : '') + '</div></div>').join('') || '<p class="subtle">첫 댓글을 남겨보세요.</p>';
    if (data.length === 200) $('comments').insertAdjacentHTML('beforeend', '<p class="subtle">댓글은 먼저 작성된 200개까지 표시합니다.</p>');
  } catch (error) { if (activePostId === id && $('comments')) $('comments').textContent = errorMessage(error); }
}
function writePost() {
  if (!config?.communityReady || !session?.user) return authModal();
  modal('<div class="eyebrow">NEW CONVERSATION</div><h2>어떤 이야기를 나눠볼까요?</h2><form id="writeform"><label>게시판 <select name="category"><option>자유</option><option>분석</option><option>소식</option><option>질문</option></select></label><label>관련 코인<select name="coin"><option value="">관련 코인 없음</option>' + coins.filter(c => c.symbol !== 'BTC').map(c => '<option value="' + c.symbol + '"' + (coinFilter === c.symbol ? ' selected' : '') + '>' + escapeHTML(c.name) + ' (' + c.symbol + ')</option>').join('') + '</select></label><label>제목<input name="title" minlength="2" maxlength="100" required placeholder="제목을 입력하세요"></label><label>내용<textarea name="body" minlength="2" maxlength="10000" required placeholder="서로 존중하며 생각을 나눠주세요"></textarea></label><p class="subtle">홍보 도배·사칭·개인정보 게시 금지 · 사진 첨부는 준비 중입니다.</p><button class="solid wide" id="writesubmit">게시글 등록</button><p class="subtle" id="writeerror" role="alert"></p></form>');
  $('writeform').onsubmit = async event => {
    event.preventDefault(); const form = new FormData(event.target); const button = $('writesubmit'); button.disabled = true;
    try {
      const { data } = await db('posts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ author_id: session.user.id, category: form.get('category'), coin: form.get('coin') || null, title: form.get('title').trim(), body: form.get('body').trim() }) });
      category = '전체'; coinFilter = ''; query = ''; $('search').value = ''; page = 0; await loadPosts(); toast('게시글을 등록했어요.'); if (data[0]) openPost(data[0].id);
    } catch (error) { if ($('writeerror')) $('writeerror').textContent = errorMessage(error); }
    finally { if (button.isConnected) button.disabled = false; }
  };
}
function deleteItem(table, id, postId = '') {
  modal('<h2>' + (table === 'posts' ? '내 글' : '댓글') + '을 삭제할까요?</h2><p>삭제하면 되돌릴 수 없습니다.</p><button class="solid" id="confirmdelete">삭제하기</button> <button onclick="' + (postId ? "openPost('" + postId + "')" : "document.getElementById('dialog').close()") + '">취소</button><p id="deleteerror" role="alert"></p>');
  $('confirmdelete').onclick = async event => { const button = event.target; button.disabled = true; try { await db(table + '?id=eq.' + id, { method: 'DELETE' }); $('dialog').close(); toast('삭제했어요.'); loadPosts(); if (postId) openPost(postId); } catch (error) { if ($('deleteerror')) $('deleteerror').textContent = errorMessage(error); } finally { if (button.isConnected) button.disabled = false; } };
}
function reportItem(table, id) {
  if (!session?.user) return authModal();
  modal('<h2>문제가 있는 내용을 알려주세요</h2><form id="reportform"><label>신고 사유<textarea name="reason" minlength="2" maxlength="500" required placeholder="도배, 사칭, 부적절한 내용 등"></textarea></label><button class="solid" id="reportsubmit">신고 접수</button><p id="reporterror" role="alert"></p></form>');
  $('reportform').onsubmit = async event => { event.preventDefault(); const button = $('reportsubmit'); button.disabled = true; try { await db('reports', { method: 'POST', body: JSON.stringify({ reporter_id: session.user.id, [table === 'posts' ? 'post_id' : 'comment_id']: id, reason: new FormData(event.target).get('reason').trim() }) }); info('신고를 접수했어요', '운영자가 내용을 확인할 수 있도록 저장했습니다.'); } catch (error) { if ($('reporterror')) $('reporterror').textContent = errorMessage(error); } finally { if (button.isConnected) button.disabled = false; } };
}
async function hideItem(table, id, postId = '') { try { await db(table + '?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) }); $('dialog').close(); toast('숨김 처리했어요.'); loadPosts(); if (postId) openPost(postId); } catch (error) { toast(errorMessage(error)); } }
async function showReports() {
  if (!moderator) return;
  modal('<h2>신고 관리</h2><p class="subtle">불러오는 중...</p>');
  try { const { data } = await db('reports?select=*,posts(title,status),comments(body,status)&order=created_at.desc&limit=50'); modal('<h2>신고 관리</h2><p class="subtle">최근 신고 50개 · 숨김 상태도 함께 확인할 수 있어요.</p>' + data.map(r => '<div class="comment"><small>' + time(r.created_at) + ' · ' + escapeHTML((r.posts || r.comments)?.status || '삭제됨') + '</small><p>' + escapeHTML(r.posts?.title || r.comments?.body || '삭제된 콘텐츠') + '</p><p class="subtle">사유: ' + escapeHTML(r.reason) + '</p><button class="danger" onclick="hideItem(\'' + (r.post_id ? 'posts' : 'comments') + '\',\'' + (r.post_id || r.comment_id) + '\')">숨김 처리</button></div>').join('')); } catch (error) { info('신고를 불러오지 못했어요', errorMessage(error)); }
}
function lounge(symbol) { coinFilter = symbol; category = '전체'; query = ''; $('search').value = ''; page = 0; loadPosts(); $('boardpanel').scrollIntoView({ behavior: 'smooth' }); toast(symbol + ' 관련 이야기'); }
function showSaved() { savedOnly = true; query = ''; $('search').value = ''; renderCoins(); $('marketpanel').scrollIntoView({ behavior: 'smooth' }); }
function navigate(section) {
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === section));
  if (section === 'saved') return showSaved();
  if (section === 'coins') return modal('<div class="eyebrow">COIN LOUNGE</div><h2>코인별 토론</h2><div class="topics">' + ['SUI', 'SOL', 'DOGE', 'XRP', 'SEI', 'PEPE', 'ETH', 'ONDO'].map(s => '<button onclick="document.getElementById(\'dialog\').close();lounge(\'' + s + '\')">' + s + ' →</button>').join('') + '</div>');
  if (section === 'rank') return $('rankpanel').scrollIntoView({ behavior: 'smooth' });
  if (section === 'board') return $('boardpanel').scrollIntoView({ behavior: 'smooth' });
  savedOnly = false; query = ''; coinFilter = ''; category = '전체'; page = 0; $('search').value = ''; renderCoins(); loadPosts(); window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function init() {
  renderLounges(); updateAuth();
  document.querySelectorAll('[data-nav],[data-side]').forEach(b => b.onclick = () => navigate(b.dataset.nav || b.dataset.side));
  document.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { sort = b.dataset.sort; document.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b)); renderCoins(); });
  document.querySelectorAll('[data-tab],[data-board]').forEach(b => b.onclick = () => { category = b.dataset.tab || b.dataset.board; coinFilter = ''; page = 0; loadPosts(); if (b.dataset.board) $('boardpanel').scrollIntoView({ behavior: 'smooth' }); });
  $('searchform').onsubmit = event => { event.preventDefault(); query = $('search').value.trim().slice(0, 100); savedOnly = false; coinFilter = ''; page = 0; renderCoins(); loadPosts(); };
  $('theme').onclick = () => { document.body.classList.toggle('dark'); store('altmoa-dark', document.body.classList.contains('dark')); };
  if (read('altmoa-dark', false)) document.body.classList.add('dark');
  $('dialog').addEventListener('close', () => { if (!$('dialog').open) activePostId = null; });
  $('dialog').addEventListener('click', event => { if (event.target === $('dialog')) { const r = $('dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('dialog').close(); } });
  loadMarket();
  setInterval(() => { if (!document.hidden) loadMarket(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (!lastFetchedAt || Date.now() - new Date(lastFetchedAt).getTime() > 60000)) loadMarket(); });
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
  await loadPosts();
}
init();
