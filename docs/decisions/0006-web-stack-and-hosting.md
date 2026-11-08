# 0006. Vite + React + TypeScript, 라이브러리 최소화, Vercel 서울 리전 + 보안 헤더

- 상태: 채택 (2026-10-20 웹앱, 2026-10-21 Vercel 함수 추가, 2026-10-27 사용자 확정 "수파베이스+버셀로 간다", 프로젝트 이름 `grad-planner`). 2026-11-08 재검토 후 유지, 앱 포장 추가(→ [0021](0021-stack-review.md))
- 관련: `package.json`, `vite.config.ts`, `vercel.json`, `src/`, [`ARCHITECTURE.md` §2·§10](../ARCHITECTURE.md)

## 맥락

기존 앱은 클래식 스크립트 1개(약 1,800줄)에서 전역 상태를 바꾸고 `innerHTML`로 화면 전체를 다시 그렸다. 웹 먼저, 나중에 모바일(같은 빌드를 감싸는 방식)로 갈 계획이었다.

## 결정

- **화면**: React 19 + Vite 8 + TypeScript 7(타입 검사만). 라우터·상태관리 라이브러리 없이 `useReducer` + 해시 주소. `@vitejs/plugin-react`도 넣지 않았다(Fast Refresh만 잃고 JSX는 Vite 내장 변환).
- **엔진은 의존성이 HiGHS 하나**이고 빌드 도구가 없다(Node 24가 TypeScript를 바로 실행).
- 의존성 추가는 사용자 승인 뒤에만 한다. 지금 런타임 의존성은 `highs`, `react`, `react-dom` 세 개다.
- **배포**: Vercel, 함수 리전 `icn1`(서울). 정적 앱 + 함수 하나(`api/smul.ts`). 모든 응답에 보안 헤더(CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy)를 붙인다.

## 근거

- **설계 판단**: 전체 다시 그리기·전역 상태 문제를 선언형 렌더러로 없앤다. React 런타임(gzip 약 45KB)은 계획한 OCR 모델(약 29MB)에 비해 작다.
- **측정**: `npm run build`·`npm test` 통과, 개발 서버와 빌드본(`vite preview`, 배포와 같은 CSP)에서 화면 흐름 확인(1280px·375px).
- **공식 문서**: 보안 헤더는 OWASP Secure Headers Project의 권장 헤더를 따랐다([OWASP](https://owasp.org/www-project-secure-headers/)). CSP는 `default-src 'self'`에서 시작해 HiGHS용 `wasm-unsafe-eval`, Google Fonts 두 도메인만 열었다.
- 리전 `icn1`: 사용자와 샘물 서버가 모두 한국에 있어 왕복이 짧다는 판단(**추정**, 지연 시간은 측정하지 않음). 2단계 Supabase도 서울 리전이다(0011).

## 검토한 대안

| 대안 | 판단 |
|---|---|
| 라우터·상태관리 라이브러리(React Router, Redux 등) | 화면 6개, 상태 하나라 필요 없다. 과설계를 피함 |
| 다른 호스팅(Cloudflare Pages, Netlify, 자체 서버) | 2026-10-21에는 비교를 남기지 않았다. Vercel은 정적 파일 + TypeScript 함수를 설정 없이 함께 배포하는 점으로 골랐다. 2026-10-27 재검토: Cloudflare 무료는 상업 이용이 되지만 함수 실행 지역을 서울로 고정하기 어렵다고 판단(**확인 안 함, 근거 약함**) |
| Lovable(2026-10-27 검토) | 기존 GitHub 저장소 연결은 공식 FAQ상 가능([FAQ](https://lovable.dev/faq/github/import-github-repo)). 그러나 서버 기능이 Supabase Edge Functions 기준이라 `api/smul.ts`(비밀번호를 다루는 함수)를 다시 짜고 차단기·IP 제한을 다시 검증해야 한다. 얻는 것은 AI 편집 화면뿐이라 미채택 |
| Google AI Studio(2026-10-27 검토) | AI Studio에서 만든 Gemini 앱을 Cloud Run에 올리는 용도로 판단해 기존 Vite 저장소 배포 경로로 맞지 않는다고 봄(**공식 문서 확인 안 함, 근거 약함**). 미채택 |

## 결과·한계

- Vercel Hobby 요금제는 비상업 개인 용도만 허용한다([Hobby](https://vercel.com/docs/plans/hobby), [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)). 상용화하면 Pro가 필요하다. 사용자는 2026-10-21 Pro 전환을 지금은 하지 않기로 했다.
- Supabase 무료 플랜은 7일 동안 데이터베이스 활동이 적으면 프로젝트를 일시정지한다([공식 문서](https://supabase.com/docs/guides/platform/free-project-pausing)). 정지되면 `smul_try`를 못 읽어 샘물 가져오기가 503으로 막힌다. 방학 등 이용이 끊긴 뒤에는 Supabase Studio에서 복구하거나 Pro로 올린다.
- 배포 절차·환경 변수는 README '배포'와 ARCHITECTURE §12.
- Chrome 계열에서만 확인했고 Safari·Firefox는 확인 불가.
