// 요건 IR. 대학×프로그램×입학년도 데이터로 졸업요건을 표현한다. 코드는 대학을 모른다.
// 버전 축은 둘: 요건은 학생의 catalogYear, 과목 속성(학점·이수구분)은 수강 학기의 판(policy.edition).

export type Term = string;            // '2025-1' '2025-2' '2025-S'(여름) '2025-W'(겨울)
export type Role = 'primary' | 'second' | 'minor' | 'micro' | 'track'; // micro: 마이크로전공 묶음(2개 이상이면 다·부·심화전공을 대신하는 학교)
export type With = 'single' | 'double' | 'minor' | 'micro';

/* ── 학생 입력 ── */
export interface Enrollment {
  code?: string;                      // 학수번호. 없으면 이름으로만 판정
  name?: string;                      // code가 있으면 카탈로그에서 채운다
  credits?: number;                   // 성적표 학점 우선, 없으면 그 판의 학점
  term?: Term;                        // 없으면 '학기 미정'
  category?: string;                  // 성적표 이수구분 원문. 있으면 카탈로그보다 우선
  area?: string;                      // 교양 영역 원문
  cultArea?: string;                  // 샘물이 기록한 이수 당시 교양영역 이름. Univ.cultAreas로 영역을 정해 카탈로그 영역보다 우선한다(area가 있으면 area)
  grade?: string;                     // 'F'·'NP' → 학점 0
  src?: 'transfer' | 'exchange';      // 편입 인정 · 학점교류/타대 계절 → 태그 'src.transfer'·'src.exchange'
  lump?: true;                        // 과목 내역 없는 일괄 인정: codes·names·courses 조건에 안 잡힌다
  planned?: true;                     // 아직 듣지 않음(계획)
}
export interface Profile {
  univ: string;
  catalogYear: number;                // 요건 연도. 기본 = 입학년도
  programs: { id: string; role: Role }[];
  admission: 'freshman' | 'transfer';
  student: 'domestic' | 'international';
  startSemester: number;              // 1, 3학년 편입이면 5
  startTerm?: Term;                   // 첫 학기(기본 catalogYear-1). 편입·복학이면 실제 첫 학기
  now?: Term;                         // 현재 학기(추천이 쓴다. 이 학기는 수강신청이 끝난 것으로 본다)
  leaves: Term[];
  checks: Record<string, number | boolean>; // 'gpa':3.2, 'topik':4, 'port':true, 'cdr.ex.<트랙>':1
  done?: string[];                    // 이수한 비교과 프로그램 이름. list가 있는 check는 이 중 list에 든 개수로 판정한다(모든 트랙에 같이 적용)
  vars?: Record<string, number>;      // 학교가 학생별로 정한 졸업 기준(샘물 학점이수상황표). 주전공 세트가 가진 같은 이름의 숫자를 덮어쓴다
}

/* ── 대학 데이터: 생성(gen/, ETL이 통째로 다시 쓴다) ── */
export interface Row { c: string; n: string; cr: number; t: string; y?: number; s?: number; alt?: string; a?: string }
export interface Equiv { from: string[]; to: string[]; kind?: string; ed?: string[] } // ed 판에서 from 이수 = to 모두 이수. to:[] = 폐지
export interface Catalog {
  id: string; name: string;
  editions: Record<string, Row[]>;    // 연도별 전체 스냅숏
  equiv?: Equiv[];
  nameStrip?: string[];               // 이 카탈로그 과목명에서 지울 정규식(학과명 꼬리표 등)
}

/* ── 대학 데이터: 큐레이션(rules.json + sets.csv) ── */
export interface Univ {
  id: string; name: string;
  portal?: { name: string; url: string; hint?: string }; // 학생이 직접 로그인할 학교 포털(웹앱 '학교 사이트에서 가져오기')
  categories: Record<string, string[]>; // 이수구분 → 태그. 없는 이수구분은 총학점에만 들어간다
  areas: Record<string, string[]>;      // 교양 영역 → 태그
  cultAreas?: { re: string; area: string }[]; // 학교 포털 교양영역 이름(Enrollment.cultArea) → areas 키. 맞는 것이 없으면 카탈로그 영역
  nameStrip: string[];                  // 과목명 비교 전에 지울 정규식
  codeTags?: { re: string; tags: string[] }[]; // 학수번호 모양으로 붙이는 태그(예: 3000·4000단위 → 'level.34'). V2 연세대에서 추가
  equiv: Equiv[];
  programs: Record<string, { name: string; college?: string; catalogs: string[] }>; // 과목을 찾을 카탈로그(앞이 우선), college: 단과대(화면에서 학과 고르기용)
  blocks: Record<string, Rule>;
  sets: ReqSet[];
  policy: Policy;
}
export interface When { role?: Role; with?: With; admission?: Profile['admission']; student?: Profile['student'] }
export interface ReqSet { program: string; years: [number, number]; when?: When; rule: Rule; src: string }
export type N = number | `$${string}`;
export type Rule = { id?: string; label?: string; hint?: string; w?: number } & ( // hint: 학생에게 보이는 설명(입력값을 어디서 확인하는지 등)
  | { credits: N; of: Filter; capped?: { of: Filter; max: N }[] }   // 학점 합 ≥. 상한을 넘는 학점은 뺀다
  | { courses: N; of: Filter }                                      // 과목 수 ≥ (lump 제외)
  | { all: Rule[]; need?: N }                                       // need 없으면 전부, 있으면 n개 이상
  | { check: string; min?: N; list?: string[] }                     // Profile.checks 값 ≥ min (true = 1). list: 인정되는 프로그램 이름(Profile.done과 맞춰 센다)
  | { use: string; vars?: Record<string, number> }                  // 공유 블록 + 숫자
);
// codes·names는 과목 식별(둘 중 하나만 맞아도 됨, 동등 과목 포함). tags(하나 이상)·every(모두)·not은 추가 조건(AND). 빈 Filter = 전부
export interface Filter { codes?: string[]; names?: string[]; tags?: string[]; every?: string[]; not?: Filter }

export interface Policy {
  termMax: number;
  termMin: number[];                  // 학년-학기 순번별 최소
  overload?: { max: number; prevMin: number; gpaMin: number };
  season: { max: number; offered: Filter };
  retake: 'latest' | 'best';
  edition: 'term' | 'catalog';        // 지난 과목 속성을 읽을 판: 수강한 해 / 요건 연도
  noPlan: Filter[];                   // 하나라도 맞으면 추천하지 않음(교직, 다른 학과 전용 교양)
  intlOnly: Filter[];                 // 유학생에게만 추천
  transferUnknown?: string[];         // 편입생 전용 세트가 없을 때, 신입 세트에서 편입생에게 같은지 모르는 묶음 id(예: 교양 필수 영역) → 확인 필요(ok:null)로 바꾼다
  gpa?: { check: string; scale: Record<string, number> }; // 성적표 성적 → 평점. 성적이 있으면 평점평균을 계산해 checks[check]에 넣는다(P·NP 등 척도에 없는 성적은 뺀다)
}

export interface Result {
  id: string; label?: string; kind?: 'credits' | 'courses' | 'all' | 'check'; ok: boolean | null;
  have: number; done: number; need: number;   // done = 계획 제외
  children?: Result[]; note?: string;
  used?: number[];                              // 셈에 들어간 기록(Audit.items의 i). credits·courses만
}
