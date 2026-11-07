# 0021. 기술 스택 재검토: 웹 + PWA, 이후 Capacitor로 앱 포장

- 상태: 채택 (2026-11-08 사용자 결정)
- 관련: [0006](0006-web-stack-and-hosting.md)(기존 스택), [0003](0003-ilp-recommendation.md)(정수계획), [0009](0009-data-minimization.md)(최소 수집), [`docs/SPEC.md`](../SPEC.md) '기술 스택'

## 맥락

첫 버전은 claude.ai 아티팩트(HTML 한 파일)로 와이어프레임을 잡고, 그 흐름대로 Vite + React 웹앱으로 옮겼다. 0006은 "어떤 웹 도구를 쓸지"만 다뤘고 **"왜 웹인가"는 기록하지 않았다.** 사용자는 이 선택을 학생 문제에서 다시 판단하라고 했다(2026-11-08).

## 판단 기준 (학생 문제에서)

1. 학기에 몇 번(수강신청 전, 전공제도 신청 기간 5월·11월) 확인한다 → 설치 없이 바로 열려야 한다.
2. 휴대폰과 PC를 모두 쓴다(비율은 설문 자료로 확인할 것, **확인 불가**).
3. 성적은 민감 정보다 → 계산은 학생 기기 안에서 하고 서버로 보내지 않는다(0009).
4. 서버가 꼭 필요한 일은 샘물 중계 로그인(한국 리전)과 회원 저장 둘뿐이다.
5. 1인 개발 → 구성 요소가 적고 하나하나 설명할 수 있어야 한다.

## 결정

스택은 네 층으로 나눠 정했다.

| 층 | 결정 | 이유 |
|---|---|---|
| 학생이 쓰는 형태 | **웹 + PWA**로 먼저 내고, 이식이 끝나면 같은 빌드를 **Capacitor로 iOS·Android 앱으로 포장** | 설치 없이 링크로 열리는 웹이 기준 1에 맞다. 앱스토어 노출과 앱 알림은 포장으로 더한다. 두 방식은 같은 빌드를 쓰므로 배타적이지 않다 |
| 계산 위치 | **학생 기기 안** (HiGHS WebAssembly, Web Worker) | 성적이 서버로 가지 않는다(기준 3). 추천 p95 94ms로 기기에서 감당된다 |
| 화면 프레임워크 | **React + Vite** | 이식을 그대로 할 수 있다. 다른 프레임워크는 화면 재작성에 비해 얻는 것이 작다 |
| 서버·DB | **Vercel + Supabase** | **무료**라서(사용자 결정). Vercel은 함수 리전을 서울에 고정할 수 있고, Supabase는 Postgres와 행 단위 보안을 준다 |

## 근거

- **사용자 결정**(2026-11-08): 위 네 층의 선택. 서버·DB는 무료라는 점이 선택 이유다.
- **선행 사례**: 다른 대학 학생들이 만든 졸업요건 서비스 — 명지대 [mju-graduate.com](https://mju-graduate.com), 동국대 [donggree.site](https://donggree.site), GIST [gijol.vercel.app](https://gijol.vercel.app), 수원대 [cchaksa.com](https://cchaksa.com) — 는 모두 웹이고, 광운대 KW-graduation은 크롬 확장이다(2026-10-21 조사).
- **공식 문서**: iOS·iPadOS 16.4부터 홈 화면에 추가한 웹앱이 웹 푸시를 받을 수 있다. 사파리에서 연 사이트는 안 되고, 권한 요청은 사용자 동작에 반응할 때만 된다([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- **공식 문서**: Capacitor로 iOS 앱을 빌드하려면 Mac과 Xcode가 필요하다(Capacitor 8은 Xcode 26 이상, Node 22 이상)([Capacitor](https://capacitorjs.com/docs/getting-started/environment-setup)). 개발 PC가 Windows이므로 iOS 빌드는 GitHub Actions의 macOS 러너로 한다. 공개 저장소는 GitHub 기본 러너 사용이 무료다([GitHub Docs](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)).
- **공식 문서**: highs-js는 HiGHS를 WebAssembly로 컴파일한 MIT 라이브러리이고 Web Worker에서 풀 수 있다([highs-js](https://github.com/lovasoa/highs-js)). Capacitor 앱도 화면을 시스템 웹뷰로 그리므로 같은 엔진이 그대로 돈다.
- **측정(이전 저장소)**: 추천 p50 28ms·p95 94ms, `highs.wasm` 3.5MB(gzip 1.2MB)(0003).

## 검토한 대안

| 층 | 대안 | 판단 |
|---|---|---|
| 형태 | 웹만 | 홈 화면 아이콘·알림이 없다. PWA를 더하는 비용이 작아 고르지 않음 |
| 형태 | React Native 앱 | 화면 전부 재작성. HiGHS WebAssembly가 React Native 기본 엔진(Hermes)에서 도는지 공식 문서로 확인하지 못했다([hermes#395](https://github.com/facebook/hermes/issues/395)) → 추천을 서버로 옮겨야 할 위험 |
| 형태 | Flutter 앱 | TypeScript 엔진과 테스트(V1~V10)를 Dart로 다시 써야 한다. 제출 일정 위험이 가장 크다 |
| 형태 | 브라우저 확장 | 휴대폰에서 못 쓴다. 샘물 서버 중계 로그인이 이미 있어 이점이 없다 |
| 계산 | 서버 계산(FastAPI 등) | 성적이 서버로 간다(0009와 충돌). 서버 운영비, 엔진 재작성 |
| 화면 | Next.js | 계산이 브라우저라 서버 렌더링 이득이 작고 검색 노출도 필요 없다. 화면 재작성 |
| 화면 | Svelte·Vue | 화면 재작성, 얻는 것은 번들 크기 정도 |
| 서버 | Cloudflare Workers | 무료 하루 10만 요청·요청당 CPU 10ms. 실행 위치를 서울로 고정하지 못하고 Smart Placement가 자동 배치한다([Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/)). 무료 상업 이용 조건은 확인하지 못함 |
| 서버 | Firebase | 함수 서울 리전(asia-northeast3) 지원([Firebase](https://firebase.google.com/docs/functions/locations)). 문서형 DB라 횟수 제한 표·보안 규칙을 다시 짜야 한다. 함수 요금제 조건은 확인하지 않음 |
| 서버 | 자체 서버(VM + Postgres) | 1인이 운영·보안을 모두 맡아야 한다 |

## 결과·한계

- **무료의 대가:** Vercel Hobby는 비상업 개인 용도만 허용한다([Hobby](https://vercel.com/docs/plans/hobby)). 상용화하면 Pro로 바꿔야 한다. Supabase 무료는 7일 동안 활동이 적으면 프로젝트를 일시정지한다([Supabase](https://supabase.com/docs/guides/platform/free-project-pausing)). 방학 뒤에는 복구가 필요하다(0006).
- **앱 포장 조건:** Apple은 웹사이트를 다시 포장한 수준의 앱을 반려한다(App Review Guidelines 4.2). 앱에는 신청 기간 알림, 저장한 결과 오프라인 보기처럼 웹보다 나은 기능을 넣는다. 스토어 등록에는 Apple·Google 개발자 계정이 필요하다.
- iOS 웹 알림은 홈 화면에 추가한 학생만 받는다. 그래서 알림은 앱 포장 쪽이 주 경로다.
- 앱스토어 노출 전까지는 학교·상명프렌즈 안내 링크로 들어오는 경로에 기댄다.
