# 알트모아 (Altmoa)

알트코인 원화 시세와 커뮤니티. Vercel Functions + 정적 프런트엔드 + Supabase Auth/Postgres 구조입니다. 외부 관심도는 아직 수집하지 않으며 가상 순위·글·수치는 표시하지 않습니다.

## Vercel 배포

1. GitHub의 `lim524/altmoa` 저장소를 Import합니다.
2. Framework `Other`, Root Directory는 저장소 루트, Build Command/Install Command는 비우고 Output Directory는 `dist`로 둡니다. `vercel.json`에 설정이 포함되어 있습니다.
3. Node.js 24.x를 사용합니다. `api/index.mjs`는 정적 파일과 별도로 Vercel Function으로 배포됩니다.
4. 시세 조회는 키 없이 동작합니다. 업비트 Open API 연결 실패 시 오류와 마지막 갱신 시간을 표시합니다. 제공처 이용약관·재표시 범위는 공개 서비스 전에 확인해야 합니다.

## Supabase 연결 (회원·글·댓글)

1. 새 Supabase 프로젝트를 만들고 SQL Editor에서 `supabase/schema.sql`을 **한 번** 실행합니다. 기존 타 서비스의 DB 대신 알트모아 전용 프로젝트를 권장합니다.
2. Authentication > URL Configuration에서 Site URL을 실제 Vercel 주소 또는 `https://altmoa.com`으로 설정합니다. Redirect URLs에 사용하는 정확한 사이트 주소를 추가합니다. 로컬 테스트 시 `http://localhost:3000/`도 추가합니다.
3. Email provider를 켜고 이메일 확인을 활성화합니다. 실제 회원을 받기 전 발신 메일 설정도 완료합니다.
4. Vercel Environment Variables에 다음 **두 개**를 넣고 재배포합니다.

| 변수 | 값 |
| --- | --- |
| `SUPABASE_URL` | `https://프로젝트ID.supabase.co` |
| `SUPABASE_ANON_KEY` | 프로젝트의 `anon` 키 또는 `sb_publishable_...` 키 |

`service_role`과 `sb_secret_...` 키는 사용하지 않습니다. `/api/config`는 공개용 키만 전달하며 실제 쓰기 권한은 DB의 RLS가 검사합니다. 이메일·비밀번호는 Supabase Auth로 직접 전송되고 서버 로그에 기록하지 않습니다. 로그인 세션은 해당 탭의 sessionStorage에 보관됩니다.

Supabase 미연결 상태에서는 글·댓글 작성을 막고 연결 준비 상태를 표시합니다. DB 테이블이 없거나 네트워크 오류가 있으면 저장 성공으로 표시하지 않습니다.

## 운영자와 신고

가입 후 Supabase SQL Editor에서 운영자의 실제 Auth 사용자 UUID를 지정합니다.

```sql
insert into public.moderators(user_id) values ('실제-운영자-사용자-UUID');
```

재로그인하면 내 계정 > 신고 관리에서 최근 신고 50건을 확인하고 콘텐츠를 숨길 수 있습니다. 역할은 사용자 메타데이터로 부여할 수 없고 관리자 DB 작업으로만 지정합니다. 작성자는 본인 글·댓글을 삭제할 수 있습니다. 게시글 60초, 댓글 10초의 계정별 작성 간격을 DB에서 강제합니다. 게시판은 페이지당 20개, 댓글은 오래된 순으로 200개까지 표시합니다. 인기 탭은 현재 페이지의 최근 글을 댓글 수로 정렬하며 안내문에 이를 명시합니다.

## 광고 위치

현재 실제 광고 스크립트·발행자 ID 없이 예약 공간만 배치했습니다.

- PC 상단: 90px 높이 가로형, 로고·검색·내비게이션 아래
- PC 오른쪽: 250px 높이 사이드바 영역, 버튼과 분리
- PC/모바일: 게시글 목록 아래 110/100px 반응형 영역
- 모바일 상단·사이드바는 숨김
- 로그인·글쓰기·게시글 상세·댓글 모달 내부에는 광고 없음

애드센스 승인·광고 단위 생성·동의 관리 등 설정 뒤 실제 코드를 연결합니다. 빈 콘텐츠 페이지에 광고만 노출하는 상태를 만들지 않도록 실제 광고 활성화 시 콘텐츠 유무도 함께 검사해야 합니다. 이미지 첨부는 아직 구현하지 않았습니다. 공개 운영 전 개인정보 안내, 문의 수단, 게시판 운영 정책 등 실제 운영자 정보가 필요한 항목을 작성해야 합니다.

## 로컬 실행과 검사

외부 라이브러리 설치가 필요 없습니다. Node.js 24 이상을 사용하세요.

```sh
cp .env.example .env.local
# .env.local에 공개 Supabase URL/키 설정 (회원 테스트 시)
npm run dev
# http://localhost:3000
npm run check
npm test
```

`dist/index.html`을 직접 열거나 단순 정적 서버만 띄우면 `/api/*`가 없으므로 시세·설정 조회가 동작하지 않습니다. 기존 ChatGPT Site는 정적 프로토타입이며 이 버전의 서버 기능은 Vercel 또는 `npm run dev`에서 실행합니다.

## 확인 범위와 남은 작업

API 응답 변환·오류 처리·공개키 제한, 프런트엔드 상태 흐름을 자동 검사합니다. 실제 Supabase 프로젝트가 아직 연결되지 않아 SQL 적용, 이메일 인증, RLS 다중 계정 권한 및 실데이터 저장은 배포 후 확인해야 합니다. 외부 관심도 수집기, 이미지 업로드, 추천·좋아요, 전체 데이터 기준 인기순, 검색엔진용 게시글 개별 페이지, 실제 광고 송출은 후속 작업입니다.
