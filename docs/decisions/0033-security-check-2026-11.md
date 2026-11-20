# 0033. 보안 기본 5항목 점검(2026-11-20)

- 상태: 채택 (2026-11-20, 사용자 요청 "보안 점검하자")
- 관련: `api/smul.ts`, `api/account.ts`, `server/smul/limit.ts`, `server/account.ts`, `supabase/migrations/`, `vercel.json`, [0009](0009-data-minimization.md), [0013](0013-smul-failure-handling.md), [0029](0029-social-login.md)

## 맥락

바이브 코딩으로 만든 앱에서 흔히 빠지는 보안 기본 5가지(SQL 인젝션, 무차별 대입, 비밀번호 해시, 파일 업로드 검증, 오래된 라이브러리)를 기준으로 서버 함수 2개(`api/smul.ts`, `api/account.ts`), Supabase 표·함수, 화면, 의존성을 확인했다. 운영 Supabase 프로젝트의 보안 진단(Security Advisor)도 함께 봤다.

## 점검 결과

| 항목 | 상태 | 확인한 내용 |
|---|---|---|
| 1. SQL 인젝션 | 잘 되어 있음 | DB는 RPC(`smul_try`·`smul_ok`·`account_get`·`account_put`)로만 쓴다. 값은 함수 인자(JSON)로 넘기고 SQL 문장에 붙이지 않는다. 모든 표는 RLS를 켜고 anon·authenticated 권한을 회수했다. 함수는 `security definer set search_path = ''`, 실행 권한은 service_role만 있다. 브라우저는 Supabase를 직접 부르지 않는다(CSP `connect-src 'self'`). 서버가 학번 9자리 숫자, 비밀번호 1~100자, 저장값 512KB, PKCE challenge 형식, 로그인 제공자 목록을 다시 검사한다 |
| 2. 무차별 대입 | 잘 되어 있음 | 샘물 로그인: 같은 학번으로 5번 실패할 때마다 1·5·10·30분 잠근다(0013). IP 분당 제한, IP 24시간 실패 50회, 같은 학번 동시 요청 차단, 샘물 장애 차단기가 있다. 회원 로그인은 구글·카카오 소셜 로그인뿐이라 우리 쪽에 비밀번호 입력이 없다. 두 함수 모두 다른 사이트에서 부르지 못하게 Origin을 확인한다 |
| 3. 비밀번호 해시 | 해당 없음(저장 안 함) | 회원 비밀번호가 없다(소셜 로그인, 0029). 샘물 비밀번호는 그 요청 안에서만 쓰고 저장·기록하지 않는다(0009). 횟수 표에 남는 학번·IP는 HMAC-SHA256 값만 둔다 |
| 4. 파일 업로드 검증 | 해당 없음 | 파일 입력이 없다. 성적 붙여넣기는 글자로 받아 브라우저 안에서만 읽는다. CSP `default-src 'self'`, `object-src 'none'` |
| 5. 취약 라이브러리 | 잘 되어 있음 | `npm audit` 0건(vite 8.3.6). 이전 저장소(grad-planner)는 vite 8.3.2에 high 1건이 있어 8.3.8로 올렸다. 이 저장소는 이미 영향 범위(8.3.0~8.3.2) 밖이었다 |

Supabase Security Advisor(2026-11-20 조회):

| 경고 | 판단 |
|---|---|
| RLS Enabled No Policy(INFO) — `smul_try`, `account_state`, `account_link`, `saved_state` | 의도한 설정. 정책이 없으면 anon·authenticated는 아무 행도 못 본다. 서버 함수만 service role로 쓴다 |
| Leaked Password Protection Disabled(WARN) | 이메일·비밀번호 가입에만 해당한다. 화면에 이메일 가입이 없어 영향 없음 |

근거: `npm audit`(측정), Supabase Security Advisor·RLS 문서(공식 문서), GitHub Advisory(공식 문서). 5항목 목록은 사용자가 가져온 체크리스트로, OWASP Top 10 전체를 대신하지는 않는다.

## 결정

- 이 저장소의 코드는 바꾸지 않는다. 점검 결과만 기록한다.

## 남은 확인

- 배포 전마다 `npm audit`을 돌린다.
- 옛 표 `account_link`·`saved_state`는 20261116180000 이전 파일에 적은 대로 다음 이전 파일에서 지운다(운영 데이터 삭제라 사용자 확인 뒤).
- 이메일 가입을 쓸 일이 없으면 Supabase Auth에서 Email 제공자를 꺼 둔다(대시보드 설정, 사용자).
