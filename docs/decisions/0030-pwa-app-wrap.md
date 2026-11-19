# 0030. 홈 화면 설치(PWA)와 Capacitor 앱 포장: 앱은 운영 주소를 연다

- 상태: 채택 (2026-11-18, 사용자 승인: Capacitor 패키지 추가)
- 관련: [0021](0021-stack-review.md)(웹 + PWA, 이후 Capacitor), [0029](0029-social-login.md)(로그인), 이슈 #56

## 맥락

0021에서 웹을 먼저 내고 같은 빌드를 Capacitor로 포장하기로 했다. 그 뒤 스토어 등록은 하지 않기로 정했다(SPEC 미결 사항 1). 완료 기준은 Android 설치 파일과 iOS 빌드 성공이다.

## 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| PWA | `manifest.webmanifest` + 아이콘만. 서비스 워커는 넣지 않음 | 설치에는 manifest(이름·아이콘 192·512·시작 주소·display)면 된다. 캐시 서비스 워커는 새 배포 뒤에도 옛 화면을 보여 줄 위험이 있고, 계산·저장은 이미 기기 안에서 한다 |
| 아이콘 | 상명 로고의 파란 마크(`public/logo.jpg` 왼쪽)를 잘라 씀 | 학교 홈페이지 자료를 쓰기로 한 화면 결정과 같다. 원본이 89×120px라 확대 뒤 두 색으로 정리했다. 2026-11-19 ADR 0032로 학사모 아이콘으로 교체 |
| 앱이 여는 것 | `server.url` = 운영 주소 | 화면이 `/api/smul`·`/api/account`를 상대 경로로 부르고, 로그인은 운영 주소로 돌아온다. 묶은 파일을 열면(origin `https://localhost`) 둘 다 깨진다. 운영 주소를 열면 웹과 똑같이 돌고, 화면을 고쳐도 앱을 다시 빌드할 필요가 없다 |
| 빌드 | GitHub Actions(`app.yml`): Android `assembleDebug` APK, iOS 서명 없는 시뮬레이터 빌드(macOS 러너) | 개발 PC가 Windows이고 Java·Android SDK도 없다. 공개 저장소는 기본 러너가 무료다(0021) |
| Android 서명 | 고정 키(PKCS12, GitHub 비밀값 `ANDROID_KEYSTORE`·`ANDROID_KEYSTORE_PASSWORD`)로 디버그 빌드에 서명. 비밀값이 없으면 기본 디버그 키 | 앱 링크는 서명 지문을 확인하는데 CI의 기본 디버그 키는 실행마다 새로 생긴다. 스토어에 올리지 않으므로 배포(release) 빌드는 만들지 않는다. 키 원본은 `private/android/`(git 제외) |
| 로그인 | 시스템 브라우저에서 하고 **앱 링크**로 앱에 돌아온다(2026-11-18 수정) | 구글은 웹뷰 안 OAuth를 막는다(`disallowed_useragent`). 네이티브 앱 OAuth는 시스템 브라우저를 쓰라는 것이 표준 권고다([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)). 운영 주소 밖으로 가는 이동은 Capacitor가 시스템 브라우저로 연다(`Bridge.launchIntent`). 로그인 뒤 운영 주소로 돌아오면 `autoVerify` 앱 링크(`public/.well-known/assetlinks.json`)로 앱이 열리고, `MainActivity.onNewIntent`가 그 주소를 웹뷰에 불러와 로그인을 마친다. 플러그인을 추가하지 않는다 |

## 근거

- Capacitor `server.url`은 문서상 라이브 리로드용이고 스토어 앱에는 권하지 않는다([Capacitor config](https://capacitorjs.com/docs/config)). 스토어에 내지 않으므로 받아들였다. 스토어에 낸다면 Apple 4.2(웹 재포장 반려)도 함께 다시 봐야 한다(0021).
- 처음에는 `allowNavigation`에 로그인 주소를 넣어 웹뷰 안에서 로그인하게 했으나, 구글 차단 때문에 위처럼 바꿨다.
- 앱 링크 확인 파일 형식: [Android 앱 링크 확인](https://developer.android.com/training/app-links/verify-android-applinks).

## 한계

- 앱 링크는 `assetlinks.json`이 운영 주소에 배포된 뒤에야 확인된다. 실제 휴대폰에서 로그인 왕복은 **확인 불가**(시험 안 함). 앱 링크가 안 열리면 로그인이 브라우저에서 끝나고, 브라우저에는 PKCE 값이 없어 앱은 로그인되지 않는다.
- PKCE 값은 sessionStorage에 있다. 로그인하는 동안 안드로이드가 앱을 종료하면 값이 사라져 다시 로그인해야 한다.
- 서명 키를 바꾸면 `assetlinks.json` 지문도 바꿔 배포해야 한다.
- iOS 빌드는 서명이 없어 iPhone에 설치할 수 없다. 빌드가 되는지만 확인한다. iPhone은 PWA(사파리 → 홈 화면에 추가)를 쓴다.
- 앱은 인터넷이 있어야 열린다(운영 주소를 열기 때문).
