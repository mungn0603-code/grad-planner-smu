# 데이터 도구

천안캠퍼스 졸업요건 데이터(`data/smu-cheonan/`)를 만드는 도구다. 앱 실행에는 필요 없다.

| 도구 | 하는 일 | 다시 돌리면 |
|---|---|---|
| `smu-cheonan/linked_fusion_pdf.py` | 학교 게시판의 연계·융합전공 교육과정표 PDF → `smu-cheonan/raw/linked-fusion.json` | 같은 PDF면 같은 결과 |
| `smu-cheonan/major-system.ts` | 전공제도(ADR 0024) 데이터: 다전공·부전공·입학유형별 세트, 연계·융합 카탈로그(`gen/lk-*`·`gen/fu-*`) | 같은 결과(자기가 만든 세트는 지우고 다시 만든다) |
| `compose.ts` | 새 학년도 교육과정 판을 카탈로그에 붙일 때 옛 과목 → 새 과목 대응표를 다시 계산(V4 테스트가 씀) | 함수 모음 |

```bash
pip install -r etl/requirements.txt                              # pypdf
python etl/smu-cheonan/linked_fusion_pdf.py --download           # PDF 받기(raw/pdf/, git 제외) + JSON 만들기
node etl/smu-cheonan/major-system.ts                             # 카탈로그·세트 만들기
npm test                                                         # 데이터 검사 포함
```

학과 교육과정(`gen/<학과>.json`)과 기본 졸업요건(`rules.json`·`sets.csv`의 주전공 세트)은 첫 버전 앱에서 한 번 옮긴 것이다. 그 이전 도구는 다시 돌리면 이후에 더한 데이터를 지워서 옮기지 않았다(ADR 0023). 2027학번부터는 학교 원본 표를 읽는 도구를 새로 만든다.

학생 기록의 과목명·이수구분·학점과 학생별 졸업 기준은 샘물 값을 그대로 쓴다(ADR 0016). 이 도구들의 과목명은 추천 화면용이라 손으로 다듬지 않는다.
