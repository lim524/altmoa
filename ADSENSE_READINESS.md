# 알트모아 신청 전 점검

구현한 준비가 AdSense 승인을 보장하지 않습니다. Google은 실제 운영 콘텐츠와 정책 준수 여부를 심사합니다. 필수 게시글 수·방문자 수를 임의로 정하지 않습니다.

## 구현 완료
- 관심도: 내부 공개 글 제목과 태그만 통합. 지역·외부 출처 선택 제거. 표본 한계 표시.
- 소개, 운영 원칙, 이용약관, 개인정보처리방침, 비공개 운영 문의 페이지.
- 시세·환산·집계·출처 검증·계정 보안에 대한 자체 작성 이용 가이드 5편. 자동 생성한 회원 글이나 추천 수로 꾸미지 않음.
- 로그인 없이 읽을 수 있는 HTML 공개 글 목록 `/community`, 영구 글 주소 `/posts/UUID`. 숨김·삭제 글 404, 장애 503, 사용자 입력 HTML 이스케이프. 개인·오류 페이지 광고 없음.
- canonical, Open Graph, sitemap.xml, robots.txt, 실제 404 페이지. 가이드·정책·공개 글 목록으로 일반 링크 제공.
- 검증된 `ADSENSE_PUBLISHER_ID=ca-pub-실제16자리` 설정 후 재배포하면 소유권 확인 메타 태그와 실제 ads.txt 자동 생성. 미설정 시 가짜 게시자 ID나 ads.txt를 만들지 않음.
- 광고 예정 자리 빈 박스 제거. 현재 Google 광고 코드는 실행하지 않음.
- Vercel 공식 Analytics 2.0.1, Speed Insights 2.0.0 SDK를 MIT 라이선스와 함께 동봉. Vercel 빌드의 동적 관측 경로 사용. 쿼리·해시 제거, 문의·개인 화면 제외, 성능 10% 샘플링. **코드 설치와 대시보드 Enable은 별도**.

## 실제 운영 전에 필요한 설정
1. 기존 Supabase SQL Editor에서 `supabase/upgrade-community.sql` 전체 실행. 기본 schema.sql을 다시 실행하지 마세요. 태그·사진 비공개 버킷·투표·문의와 앞선 추천·등급 마이그레이션을 포함합니다.
2. 운영자 계정을 실제 moderators에 등록하고 신고·문의 접수와 처리 권한을 확인하세요. 문의는 저장형 inbox이며 자동 이메일 발송/회신 기능은 아닙니다. 처리 완료 시 삭제 버튼으로 개인정보를 정리하세요. 미연결 상태에서 접수 성공으로 표시하지 않습니다.
3. 도메인 소유/구매 후 Vercel 연결 및 DNS 검증. `SITE_URL`을 실제 대표 HTTPS 주소로 설정 후 재배포하고 sitemap·canonical을 확인하세요. 도메인 구매·유료 플랜을 자동 결제하지 않습니다.
4. Vercel Production 환경에 공개할 실제 `SITE_OPERATOR_NAME`, `SITE_CONTACT_EMAIL`을 설정하고 재배포. 운영자 인적사항을 기억이나 GitHub 이름으로 추정하지 않습니다.
5. **개인정보 방침의 실제 처리 관계 확인**: Supabase 프로젝트 저장 국가, Vercel·Supabase 계약 당사자/위탁 범위, 국외 이전 항목·시점·방법·국가·수탁자·보유 기간·거부 방법 및 필요한 근거, 책임자 정보를 실제 설정과 관련 법령에 맞춰 확정하세요. 현재 문서에 제공자와 처리 가능성은 설명했으나 미확인 계약·국가·기간을 지어내지 않았습니다. 법적 검토가 완료됐다는 의미는 아닙니다.
6. 운영자가 모든 안내 글을 검토하고 본인만의 정보·분석·원문 출처가 있는 실제 콘텐츠를 지속 작성하세요. 정책 페이지나 AI 글의 개수만 늘려 승인 요건을 충족했다고 판단하지 마세요. 게시물·사진·투표에 불법·권리침해·사기·괴롭힘이 없는지 관리하세요.
7. AdSense 계정에서 실제 사이트 추가, 게시자 ID 설정, 소유권 확인, 심사 신청은 계정 소유자가 진행. 승인 상태 Ready 확인 전 광고 송출을 켜지 않습니다.
8. 광고를 실제 활성화하는 별도 작업 전: 개인정보방침 실제 운영 내용 갱신, 필요한 지역별 동의 및 EEA/UK/스위스 개인 맞춤 광고에 필요한 Google 인증 CMP 구성, 광고 배치·모바일 오클릭 점검. 자체 체크박스를 인증 CMP로 간주하지 않습니다. 빈 게시판·로그인·문의·오류·검토되지 않은 UGC에는 광고를 자동으로 붙이지 않습니다.
9. Vercel Web Analytics/기본 Speed Insights의 Enable은 계정 로그인된 대시보드에서 필요합니다. Preview 배포 준비와 실제 열어본 상태를 구분하세요. Speed Insights Plus는 선택 유료 업그레이드이며 AdSense 승인 요건이 아닙니다.

## 사진·태그·투표 운영
- 신규 글 태그 1~10개, 영문 대문자/중복 제거. 사진 최대 3장, 원본 JPG/PNG/WebP 10MB 이하 → JPEG 최대1600px·2MB. 재인코딩으로 원본 메타데이터 제거; 눈에 보이는 개인정보는 작성자가 가려야 합니다.
- 비공개 Storage 버킷. 공개 게시글에 연결된 이미지만 일반 독자가 60초 signed URL 발급 가능. 작성자는 자신의 파일을 관리할 수 있습니다. 숨김 이후 기존 URL은 만료까지 남을 수 있습니다.
- 사진 업로드 실패와 게시글 저장 실패 시 첨부 정리를 시도합니다. 네트워크 불확실성·계정/글 삭제 후 잔여 파일이 생길 수 있어 운영자가 게시글 참조를 확인한 후 **Storage API**로 정리해야 합니다. storage.objects를 직접 DELETE하여 파일이 지워진 것으로 간주하지 마세요.
- 2~6개 선택지, 로그인 계정당 1표, 변경 불가. 선택지 수정 권한 없음. 타인 투표 내역 비공개, 결과 집계만 공개, 숨김 글 결과 제외. 실제 사람 기준 중복 계정 투표까지 막는 기능은 아닙니다.

## 공식 확인 자료
- https://support.google.com/adsense/answer/9724
- https://support.google.com/publisherpolicies/answer/11112688
- https://support.google.com/adsense/answer/7549925
- https://support.google.com/adsense/answer/7584263
- https://support.google.com/adsense/answer/13554116
- https://vercel.com/docs/analytics/quickstart
- https://vercel.com/docs/speed-insights/quickstart
