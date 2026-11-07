# 0021. 기술 스택 재검토: 웹 + PWA 추천

- 상태: 제안 (2026-11-08, 사용자 결정 대기)
- 관련: [0006](0006-web-stack-and-hosting.md)(기존 스택), [0003](0003-ilp-recommendation.md)(정수계획), [0009](0009-data-minimization.md)(최소 수집), [`docs/SPEC.md`](../SPEC.md) '기술 스택'

## 맥락

첫 버전은 claude.ai 아티팩트(HTML 한 파일)로 와이어프레임을 잡고, 그 흐름대로 Vite + React 웹앱으로 옮겼다. 0006은 "어떤 웹 도구를 쓸지"만 다뤘고 **"왜 웹인가"는 기록하지 않았다.** 사용자는 이 선택을 학생 문제에서 다시 판단하라고 했다(2026-11-08).

## 판단 기준 (학생 문제에서)

1. 학기에 몇 번(수강신청 전, 전공제도 신청 기간 5월·11월) 확인한다 → 설치 없이 바로 열려야 한다.
2. 휴대폰과 PC를 모두 쓴다(비율은 설문 자료로 확인할 것, **확인 불가**).
3. 성적은 민감 정보다 → 계산은 학생 기기 안에서 하고 서버로 보내지 않는다(0009).
4. 서버가 꼭 필요한 일은 샘물 중계 로그인(한국 리전)과 회원 저장 둘뿐이다.
5. 1인 개발 → 구성 요소가 적고 하나하나 설명할 수 있어야 한다.

## 대안 비교

| 안 | 기준 1 설치 | 기준 3 성적 기기 안 | 기준 5 단순함 | 이식 비용 |
|---|---|---|---|---|
| **A. 웹 + PWA** (Vite·React·TS, 브라우저 계산, Vercel 함수·Supabase, 홈 화면 설치) | 링크로 바로 | 됨(HiGHS WebAssembly) | 엔진 한 벌을 브라우저·테스트·서버가 같이 씀 | 작음 |
| B. Next.js 풀스택 | 링크로 바로 | 됨 | 서버·클라이언트 경계가 생김. 계산이 브라우저라 서버 렌더링 이득이 작음 | 화면 전부 재작성 |
| C. 모바일 앱(React Native·Expo) + 웹 | 스토어 설치 필요 | 불확실: HiGHS WebAssembly가 Hermes에서 도는지 공식 확인 못 함 | 앱과 웹 두 벌 | 큼 |
| D. 서버 계산(FastAPI 등) | 링크로 바로 | 안 됨(성적이 서버로) | 서버 운영 필요 | 엔진·테스트 재작성 |

## 근거

- **선행 사례**: 다른 대학 학생들이 만든 졸업요건 서비스 — 명지대 [mju-graduate.com](https://mju-graduate.com), 동국대 [donggree.site](https://donggree.site), GIST [gijol.vercel.app](https://gijol.vercel.app), 수원대 [cchaksa.com](https://cchaksa.com) — 는 모두 웹이고, 광운대 KW-graduation은 크롬 확장이다(2026-10-21 조사). 같은 문제를 푸는 서비스가 앱 설치를 요구하지 않는다.
- **공식 문서**: iOS·iPadOS 16.4부터 홈 화면에 추가한 웹앱이 웹 푸시를 받을 수 있다. 사파리에서 연 사이트는 안 되고, 권한 요청은 사용자 동작에 반응할 때만 된다([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). 전공제도 신청 기간 알림(F11)을 앱 없이 할 수 있다.
- **공식 문서**: highs-js는 HiGHS를 WebAssembly로 컴파일한 MIT 라이브러리이고 Web Worker에서 풀 수 있다([highs-js](https://github.com/lovasoa/highs-js)).
- **확인 불가**: React Native 기본 엔진 Hermes의 WebAssembly 지원은 2026년 초 발표 소식만 2차 자료로 찾았고 공식 문서로 확인하지 못했다([hermes#395](https://github.com/facebook/hermes/issues/395)). 그래서 C안은 추천 계산을 서버로 옮겨야 할 위험이 있다.
- **측정(이전 저장소)**: 추천 p50 28ms·p95 94ms, `highs.wasm` 3.5MB(gzip 1.2MB). 브라우저 계산이 감당되는 크기다(0003).

## 결정(제안)

**A. 웹 + PWA.** 기존 Vite·React·TypeScript·Vercel·Supabase·HiGHS 구성을 유지하고, 이식이 끝난 뒤 PWA(홈 화면 설치, 선택 기능으로 알림)를 붙인다.

## 결과·한계

- 앱스토어 노출이 없다. 학교·상명프렌즈 안내 링크로 들어오는 경로에 기댄다.
- iOS 알림은 홈 화면에 추가한 학생만 받는다.
- Vercel Hobby는 비상업 용도만 허용한다(0006). 상용화하면 요금제를 바꾼다.
