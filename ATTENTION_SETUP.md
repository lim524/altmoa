# 관심도 집계 연결

## 지금 실제로 동작하는 범위

- `/api/attention?scope=internal&hours=24` 또는 `hours=1`: 공개된 알트모아 게시글의 제목·코인 태그로 계산하는 내부 관심도. 기존 posts 테이블을 사용하므로 추가 SQL 없이 동작합니다.
- 최대 요청 2,000건 범위에서 읽습니다. Supabase의 행 제한으로 더 적게 반환될 경우 정확한 전체 건수와 비교해 표본임을 표시합니다.
- 외부/내부, 국내/해외, 기간 전환, 상위 5개, 출처별 연결 상태 및 관련 원문 링크.
- 초기 사전 33개 코인. 한 글에서 같은 코인을 반복해도 1건이며, 같은 코인의 동일 정규화 제목은 선택 기간에 한 번만 집계합니다.
- 내부 글이 수정·삭제·숨김 처리되면 다음 조회에 반영됩니다. 댓글과 작성자 수는 집계하지 않습니다. 내부 급증 배수는 아직 제공하지 않습니다.

## 외부 출처를 자동 연결하지 않은 이유

2026-10-17에 아래 원문을 확인했습니다.

- DCInside: https://nstatic.dcinside.com/dc/w/policy/policy_index.html — 제16조는 사전 서면 동의 없는 크롤링을 금지한다고 명시합니다. 차트갤·비트코인갤 수집을 활성화하지 않았습니다.
- Coinpan: https://coinpan.com/index.php?act=dispMemberSignUpForm&mid=index — 제13조 ②는 얻은 정보의 사전승낙 없는 영리목적 이용을 제한합니다. 자동 수집을 활성화하지 않았습니다.
- Reddit: https://redditinc.com/policies/data-api-terms — 상업적 API 사용은 해당 조건과 별도 계약 여부 확인이 필요합니다.
- X: 공식 API 연결·이용 권한이 필요합니다.

robots.txt의 허용 규칙만으로 상업 이용 승낙을 받은 것으로 처리하지 않습니다. 어느 출처에도 메시지·제휴 문의를 발송하지 않았습니다. 프록시, 로그인, CAPTCHA 우회나 검색 결과 재수집을 통한 대체 수집은 구현하지 않았습니다.

## 외부 저장 구조 준비

새 Supabase SQL Editor 쿼리에서 `supabase/attention.sql`을 실행합니다. 기존 `schema.sql`을 다시 실행할 필요는 없습니다. 이 추가 마이그레이션은 반복 실행 가능하며 기존 회원·게시글 테이블을 변경하지 않습니다.

추가 테이블:

| 테이블 | 용도 |
| --- | --- |
| attention_sources | 승인 상태·허가 근거·연결 정보·마지막 갱신 시각 |
| external_documents | 원문 ID·링크·게시 시각·제목 해시, 원문 텍스트는 저장하지 않음 |
| coin_mentions | 글별 코인 연결 |
| attention_hourly | 출처·코인·시간별 중복 제외 언급 글 수 |
| attention_runs | 수집 성공·실패·완전성 이력 |

브라우저에서 외부 원문/언급/수집 이력을 직접 쓰거나 읽는 권한은 부여하지 않습니다. 공개 API는 제한된 출처 상태 및 승인·갱신 조건을 충족한 집계 RPC만 읽습니다. 허가가 철회된 출처는 `approved=false, status='paused'`로 바꾸면 순위에서 제외됩니다. 저장 데이터 삭제는 `attention_sources`의 해당 행 삭제로 하위 문서·집계까지 연쇄 삭제됩니다.

## 허가된 피드 수집기

`supabase/functions/collect-attention/index.ts`는 **허가된 JSON 피드 수신용** 수집기입니다. 디시 HTML 파서나 X/Reddit 공식 API 어댑터 자체가 아닙니다. 승낙/계약 후 제공받은 데이터 피드 또는 별도로 구현한 적법한 API 어댑터가 아래 형식으로 응답해야 합니다.

```json
{
  "complete": true,
  "nextCursor": "next-page-or-cursor",
  "items": [
    {
      "id": "source-post-id",
      "url": "https://원문-출처/글주소",
      "publishedAt": "2026-10-17T08:00:00Z",
      "title": "실제 원문 제목"
    }
  ]
}
```

- 피드는 `limit=200`, `cursor=이전응답값`을 받습니다. 한 실행에 최대 200건, 원문 게시 시각은 최근 8일 이내입니다.
- `complete=false`는 미처리 데이터가 남았다는 뜻입니다. 다음 실행에서 cursor를 이어받고, 완료 전 출처를 `partial`로 표시해 순위에서 제외합니다.
- 삭제/철회는 `{"id":"source-post-id","deleted":true}`로 반환합니다. 편집된 글은 같은 ID의 새 제목과 메타데이터를 반환합니다.
- 수집기는 제목을 임시로 코인 판별에만 사용하고, 원문 제목·본문·작성자·닉네임·IP는 DB에 저장하지 않습니다. 저장되는 것은 제목 SHA-256 및 링크·시각·코인 연결입니다.
- 승인 근거가 있는 출처만 `approved=true`, `permission_ref=실제 허가 근거`, `feed_url=피드 주소`로 설정합니다. `link_prefix`는 실제 원문 URL 범위에 맞춰 좁혀야 합니다.
- `feed_url`에 인증 토큰을 넣지 않습니다. 현재 수집기는 별도 인증이 필요 없는 승인된 피드 형식을 지원합니다. 인증이 필요한 공급자는 전용 서버 어댑터를 추가해야 합니다.

Supabase CLI로 프로젝트를 선택한 후:

```sh
supabase functions deploy collect-attention --project-ref 실제프로젝트ID
```

Supabase Edge Function Secrets에 아래 값을 직접 설정합니다. 키를 채팅이나 Git에 붙이지 않습니다.

- `ATTENTION_COLLECTOR_SECRET`: 충분히 긴 임의 비밀 문자열
- `ATTENTION_FEED_HOSTS`: 승인된 피드 호스트명만 쉼표로 구분

`SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function의 서버 런타임 값을 사용합니다. 이 service-role 키를 Vercel 공개 설정이나 프런트엔드에 넣지 않습니다. `verify_jwt=false` 대신 함수 자체에서 `x-collector-secret`을 검증합니다.

Supabase Vault에 `attention_collector_url`(배포된 함수의 전체 HTTPS 주소), `attention_collector_secret`(위와 같은 비밀값)을 설정한 뒤 `supabase/attention-cron.sql`을 실행하면 10분 간격으로 호출합니다. 승인 피드나 Vault 설정이 없으면 예약 SQL은 중단됩니다. 중지할 때는 다음 SQL을 실행합니다.

```sql
select cron.unschedule(jobid) from cron.job where jobname='altmoa-attention-10min';
```

## 외부 순위와 배수

- 승인되었고 상태가 `collecting`이며 최근 20분 안에 완전한 수집이 성공한 출처만 포함합니다.
- 최근 1/24시간에 코인별 제목 해시를 중복 제외하고 집계합니다. 여러 출처에 복붙된 제목은 전체 건수에서 한 번만 세되 출처 수는 별도로 표시합니다.
- 급증 배수는 직전 7일의 같은 길이 기간 평균과 비교합니다. 8일 이상 수집 이력, 최근 8일 완전 수집 성공 1,037회 이상(10분 간격의 90% 이상), 성공 수집 간 30분 초과 공백 없음, 현재 5건 이상 및 기준 평균 1건 이상이어야 표시합니다. 그 외에는 배수를 숨깁니다.
- 원문 메타데이터는 8일, 수집 로그는 9일 보관하며 정상 수집 시 정리합니다. 모든 수집이 정지된 경우 정리는 별도 DB 작업으로 실행해야 합니다.

## 검증 범위

JavaScript의 코인 판별·중복·기간·공개키 제한·API 오류 및 UI 상태 테스트는 실행합니다. 현재 연결된 DB로 내부 게시글 읽기도 확인합니다. 외부 출처 허가/계약, `attention.sql` 적용, Supabase Edge 배포·Cron 등록은 아직 실행되지 않았으며 외부 수집 실적이 있는 것처럼 표시하지 않습니다. SQL RPC와 Deno 함수의 실제 서버 실행 검증은 연결 후 필요합니다.
