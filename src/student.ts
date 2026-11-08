// 샘물 학적·학점이수상황표(/api/smul 응답의 student·base) → 엔진 학생 정보(Profile의 programs·admission·student·vars).
// 서버 응답 형식은 그대로 두고 여기서 바꾼다(ADR 0025). 값을 못 받은 항목은 비워 두어 부르는 쪽이 이전 값을 쓰게 한다.
import type { Profile, Univ, With } from '../engine/types.ts';
import { withOf } from '../engine/audit.ts';

export type Major = { kind: string; name: string };
export type Student = { name: string; dept: string; entr: string; majors: Major[]; intl?: boolean };
type Prog = Profile['programs'][number];

// 학적 구분(server/smul/parse.ts MAJORS) → 역할. 2~4전공·연계·융합은 다전공, 부전공은 부전공. 마이크로전공은 넣지 않는다(아래)
const ROLE: Record<string, 'second' | 'minor'> = { '2전공': 'second', '3전공': 'second', '4전공': 'second', 연계전공: 'second', 융합전공: 'second', 부전공: 'minor' };
// 학점이수상황표 기준학점 열(dsGrdtBaseInfo, 학교 열 이름) → 주전공 세트 숫자. 이수 형태마다 주전공 학점 열이 다르다.
// 이수 제외(편입·외국인특별전형 등)는 심화전공 열을 쓴다. 마이크로전공 대체 때 주전공 학점 열은 확인 불가라 학과 기준 숫자를 쓴다
const BASE: Record<With, Record<string, string>> = {
  single: { total: 'GRDT_CMP_CDT', ge: 'CULT_CDT', major: 'MJR_CDT', deep: 'MJR_DEEP_CDT' },
  exempt: { total: 'GRDT_CMP_CDT', ge: 'CULT_CDT', major: 'MJR_CDT', deep: 'MJR_DEEP_CDT' },
  double: { total: 'GRDT_CMP_CDT', ge: 'CULT_CDT', major: 'MMJR_MAIN_MJR_CDT', ext: 'MMJR_MJR_CDT' },
  minor: { total: 'GRDT_CMP_CDT', ge: 'CULT_CDT', major: 'MINOR_MAIN_MJR_CDT', ext: 'MINOR_MJR_CDT' },
  micro: { total: 'GRDT_CMP_CDT', ge: 'CULT_CDT' },
};
// 다전공·부전공 프로그램 세트의 need. 학점이수상황표 열이 학생당 하나라 다전공이 둘이면 같은 값을 쓴다(전공별 열은 확인 불가)
const NEED = { second: 'MMJR_MJR_CDT', minor: 'MINOR_MJR_CDT' };

const key = (s: string) => s.replace(/\s/g, '');
const pick = (b: Record<string, number>, cols: Record<string, string>) =>
  Object.fromEntries(Object.entries(cols).filter(([, c]) => typeof b[c] === 'number').map(([k, c]) => [k, b[c]]));

// 학적의 학과·전공 이름 → 그 역할 세트가 있는 프로그램 id. 값이 '대학 학과' 꼴일 수 있어 전체와 마지막 낱말을 맞춘다. 못 찾으면(코드 값 등) undefined
export function programId(u: Univ, name: string, role: 'primary' | 'second' | 'minor'): string | undefined {
  const ks = [key(name), key(name.trim().split(/\s+/).pop() ?? '')].filter(Boolean);
  return Object.keys(u.programs).find(id => ks.includes(key(u.programs[id].name)) && u.sets.some(s => s.program === id && s.when?.role === role));
}

// primary: 주전공 프로그램 id(학생이 고른 값, 없으면 학과 이름으로 찾음). 전공제도 이수 제외(공학인증 등)는 샘물에 없어 학생이 따로 표시한다(Profile.exempt)
export function fromSmul(u: Univ, st: Student, base?: Record<string, number>, primary = programId(u, st.dept, 'primary')):
  Pick<Profile, 'programs'> & Partial<Pick<Profile, 'admission' | 'student' | 'vars'>> {
  const b = base ?? {};
  const ext: Prog[] = st.majors.filter(m => m.kind in ROLE).map(m => {
    const role = ROLE[m.kind], need = b[NEED[role]];
    // 이름으로 못 찾은 다전공·부전공은 과목 데이터 없는 'ext'로 둔다(주전공 기준 45·60은 맞게 잡힌다)
    return { id: programId(u, m.name, role) ?? 'ext', role, ...(typeof need === 'number' ? { vars: { need } } : {}) };
  });
  // 학적의 마이크로전공은 '신청'이라 이수 형태를 바꾸지 않는다(2개 이상 '이수'해야 대체, ADR 0017). 대체는 계획 화면에서 고른다
  const admission = !st.entr ? undefined : /학사\s*편입/.test(st.entr) ? 'bachelor' : /편입/.test(st.entr) ? 'transfer' : 'freshman';
  // 외국인특별전형은 입학구분 이름으로, 그 밖에는 국적으로 본다(일반전형 유학생과 구분하지 않음, ADR 0024)
  const student = /외국인/.test(st.entr) || st.intl ? 'international' : st.intl === false ? 'domestic' : undefined;
  const programs: Prog[] = [...(primary ? [{ id: primary, role: 'primary' as const }] : []), ...ext];
  const vars = pick(b, BASE[withOf({ programs, admission: admission ?? 'freshman', student: student ?? 'domestic' })]);
  return { programs, ...(admission ? { admission } : {}), ...(student ? { student } : {}), ...(Object.keys(vars).length ? { vars } : {}) };
}
