'use strict';
let activityData=null,activityAt=0,activityPending=null;
async function loadMarketActivity(){
 if(activityData&&Date.now()-activityAt<600000){renderMarketActivity(activityData);return;}
 if(activityPending)return activityPending;
 activityPending=(async()=>{try{
  const {data}=await fetchJSON('/api/market-activity');
  if(!['ready','collecting','building'].includes(data.status))throw Error('invalid_activity');
  activityData=data;activityAt=Date.now()-(data.status==='building'?590000:data.stale?540000:0);renderMarketActivity(data);
 }catch{
  for(const id of ['marketactivity','activitysummary'])if($(id))$(id).innerHTML='<p class="activity-message">시장 활성도 연결 지연 · 다음 갱신 때 다시 확인합니다.</p>';
 }finally{activityPending=null;}})();return activityPending;
}
function activityChart(history){
 const points=(history||[]).filter(p=>Number.isFinite(p.score)&&Number.isFinite(Date.parse(p.at)));
 if(points.length<2)return '<p class="activity-message">실제 점수 이력이 2개 이상 쌓이면 최근 24시간 차트가 표시됩니다.</p>';
 const start=Date.parse(points[0].at),end=Date.parse(points.at(-1).at),gap=600000*2.5;let path='';
 points.forEach((p,i)=>{const x=36+(Date.parse(p.at)-start)/Math.max(1,end-start)*628,y=122-p.score;path+=(i===0||Date.parse(p.at)-Date.parse(points[i-1].at)>gap?'M':'L')+x.toFixed(1)+','+y.toFixed(1)+' ';});
 return '<svg class="activity-chart" viewBox="0 0 700 155" role="img" aria-label="실제 집계된 알트 시장 활성도 점수 이력. 수집 공백은 선을 연결하지 않습니다."><path class="chart-grid" d="M36 22H664M36 72H664M36 122H664"/><text x="4" y="26">100</text><text x="10" y="76">50</text><text x="16" y="126">0</text><path class="chart-line" d="'+path+'"/><text x="36" y="147">'+escapeHTML(time(points[0].at))+'</text><text x="664" y="147" text-anchor="end">'+escapeHTML(time(points.at(-1).at))+'</text></svg>';
}
function renderMarketActivity(data){
 const waiting=data.status==='building',score=Number.isFinite(data.score)?data.score.toFixed(1):'—';
 const change=Number.isFinite(data.dayChange)?(data.dayChange>0?'+':'')+data.dayChange.toFixed(1)+'점':'비교 이력 수집 중';
 const status=data.stale?'갱신 지연 · 이전 집계':data.status==='ready'?'집계 완료':'거래대금 기준 수집 중';
 const summary='<div class="activity-summary-value"><strong>'+score+'</strong><span>/ 100</span></div><p>'+status+'</p><small>전일 대비 '+change+'</small>';
 if($('activitysummary'))$('activitysummary').innerHTML=waiting?'<p class="activity-message">첫 시장 데이터를 집계하고 있습니다.</p>':summary;
 if(!$('marketactivity'))return;
 if(waiting){$('marketactivity').innerHTML='<p class="activity-message">첫 집계 중입니다. 잠시 후 다시 확인해 주세요.</p>';return;}
 const percent=n=>Number.isFinite(n)?n.toFixed(1)+'%':'—';
 $('marketactivity').innerHTML='<div class="activity-overview"><div>'+summary+'</div><dl><div><dt>평가 대상</dt><dd>'+Number(data.count)+'개</dd></div><div><dt>상승 코인</dt><dd>'+Number(data.upCount)+'개 · '+percent(data.upPercent)+'</dd></div><div><dt>BTC보다 강한 코인</dt><dd>'+Number(data.strongCount)+'개 · '+percent(data.strongPercent)+'</dd></div><div><dt>BTC 24시간 등락률</dt><dd>'+attentionChange(data.btcChange)+'</dd></div></dl></div><div class="activity-parts"><div><span>거래 활성도</span><b>'+(Number.isFinite(data.parts?.volume)?data.parts.volume.toFixed(1):'—')+' <small>/ 40</small></b><small>'+(Number.isFinite(data.volumeRatio)?data.volumeRatio.toFixed(2)+'배 · 비교 대상 '+Number(data.comparisonCount)+'개':'완료된 UTC 일봉 '+Number(data.baselineDays||0)+'/7개 확보')+'</small></div><div><span>상승 확산도</span><b>'+Number(data.parts?.breadth||0).toFixed(1)+' <small>/ 30</small></b><small>24시간 수익률이 양수인 비율</small></div><div><span>BTC 대비 강도</span><b>'+Number(data.parts?.strength||0).toFixed(1)+' <small>/ 30</small></b><small>BTC의 24시간 수익률을 넘은 비율</small></div></div>'+(data.status==='collecting'?'<p class="activity-message">완료된 UTC 일봉 7일 거래대금과 공통 종목 90% 조건이 충족되면 종합 점수를 표시합니다. 부족한 항목을 0점으로 계산하지 않습니다.</p>':'')+activityChart(data.history)+'<p class="activity-source">'+escapeHTML(data.source)+' · '+time(data.asOf)+' KST · 약 10분 갱신 · 공유 캐시 · 투자 권유·수익 확률이 아닙니다.</p>';
}

function showActivityDetails(){navigate('rank');const details=$('activitymethod');if(!details)return;details.open=true;details.scrollIntoView({behavior:'smooth',block:'start'});}
