// 화면 공용 상태(useReducer + 기기 저장)와 학생 정보 → 엔진 입력(Profile). 화면 파일은 이 타입과 함수만 나눠 쓴다.
import type { Dispatch } from 'react';
import { termOrd, withOf, type Audit, type Ctx } from '../engine/audit.ts';
import type { Enrollment, Profile, Row, Univ } from '../engine/types.ts';
import { UNIVS, tracksOf } from './data.ts';
import { withBase } from './student.ts';

export { termOrd };
export type Prog = Profile['programs'][number];
export type Major = { kind: string; name: string };
type Retake = { code: string; year: string; sem: string; prev: string };

// ext: 다전공(제2·3전공·연계·융합·자기설계)·부전공 프로그램. 샘물 학적 또는 직접 고른 값. 학생별 기준(vars)은 toProfile이 base로 채운다(ADR 0025)
// exempt: 전공제도 이수 제외(공학인증·체육특기자 등, 샘물에 없어 직접 표시). own: 자기설계융합전공 이수계획표 과목
// name·sno·entr·majors: 샘물에서 받은 이름·학번·입학구분·다전공(화면 표시용, 이 기기에만 저장). done: 이수한 비교과 프로그램(샘물 SM-CDR 이수조회 또는 직접 고름)
// base: 샘물 학점이수상황표의 학생별 졸업 기준학점(학교 열 이름 그대로). retake: 이번 학기 재수강 대상(저장만)
export interface Me {
  univ: string; program: string; year: number; ext: Prog[]; exempt?: true; own?: Row[];
  admission: Profile['admission']; student: Profile['student']; now: string; leaves: string[]; tracks: string[]; checks: Profile['checks'];
  name?: string; sno?: string; entr?: string; majors?: Major[]; done?: string[]; cmp?: Record<string, number>; base?: Record<string, number>; retake?: Retake[];
}
// consent: 샘물 가져오기 동의 시각(ISO), swaps: 학점 플래너 바꾸기('학기|추천 학수번호' → 고른 학수번호), whatif: 전공제도 계획
export interface State { me: Me; es: Enrollment[]; season: boolean; overload: boolean; consent?: string; swaps?: Record<string, string>; whatif?: WhatIf }
// 전공제도 계획: 다전공·부전공 목록과 마이크로전공(고른 순서 = 1MD~3MD). 저장된 학적·기록은 바꾸지 않는다
export type WhatIf = { ext: Prog[]; mds: string[] };
export type Action =
  | { t: 'me'; v: Partial<Me> } | { t: 'add'; es: Enrollment[] } | { t: 'del'; i: number } | { t: 'edit'; i: number; v: Partial<Enrollment> }
  | { t: 'opt'; v: Partial<Pick<State, 'season' | 'overload' | 'consent' | 'swaps' | 'whatif'>> } | { t: 'load'; s: State } | { t: 'clear' };
export interface PageProps { s: State; dispatch: Dispatch<Action>; univ: Univ | null; ctx: Ctx | null; profile: Profile | null; a: Audit | null; toast: (m: string) => void }

export const nowTerm = () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1; return m >= 3 && m <= 8 ? `${y}-1` : m >= 9 ? `${y}-2` : `${y - 1}-2`; };
export const blank = (): State => ({ me: { univ: UNIVS[0]?.id ?? '', program: '', year: 0, ext: [], admission: 'freshman', student: 'domestic', now: nowTerm(), leaves: [], tracks: [], checks: {} }, es: [], season: false, overload: false });
export const termLabel = (t?: string) => (!t ? '미정' : t.endsWith('-S') ? `${t.slice(0, 4)} 여름` : t.endsWith('-W') ? `${t.slice(0, 4)} 겨울` : t);
export const termOptions = (year: number, reg = false) => { const o: string[] = []; for (let y = year; y < year + 8; y++) o.push(...(reg ? [`${y}-1`, `${y}-2`] : [`${y}-1`, `${y}-S`, `${y}-2`, `${y}-W`])); return o; };
export const isPlanned = (term: string | undefined, now: string) => !term || !now || termOrd(term) >= termOrd(now);
export const norm = (s: string) => s.replace(/\s/g, '');
export const gpaText = (g: number) => g.toFixed(2);

export const OWN = 'ism'; // 자기설계융합전공 프로그램 id. 학생이 넣은 교육과정(Profile.own)을 이 프로그램에 붙인다

// micro: 전공제도 계획에서 마이크로전공을 골랐을 때(마이크로전공 2개 이상으로 다·부·심화전공 대신)
export function toProfile(me: Me, u: Univ, micro = false): Profile {
  const who = { admission: me.admission, student: me.student, ...(me.exempt ? { exempt: true as const } : {}) };
  const { programs, vars } = withBase([{ id: me.program, role: 'primary' }, ...me.ext.filter(g => u.programs[g.id]),
    ...(micro && u.programs.md ? [{ id: 'md', role: 'micro' as const }] : [])], me.base, who);
  return {
    univ: me.univ, catalogYear: me.year, ...who, startSemester: me.admission === 'freshman' ? 1 : 5,
    programs: [...programs, ...tracksOf(u, me.program).map(t => ({ id: t.id, role: 'track' as const }))],
    ...(me.own?.length ? { own: { id: OWN, name: u.programs[OWN]?.name ?? OWN, editions: { [String(me.year)]: me.own } } } : {}),
    ...(me.now ? { now: me.now } : {}), leaves: me.leaves, checks: me.checks, ...(me.done ? { done: me.done } : {}), ...(vars ? { vars } : {}),
  };
}

// 지금 몇 번째 정규학기인지(입학 학기가 1, 휴학 학기는 세지 않음). 모르면(졸업·입학년도 없음) 큰 수
export function semNo(me: Me) {
  if (!me.year || !me.now) return 99;
  let n = 0;
  for (let y = me.year; y <= +me.now.slice(0, 4); y++) for (const t of [`${y}-1`, `${y}-2`]) if (termOrd(t) <= termOrd(me.now) && !me.leaves.includes(t)) n++;
  return n;
}
// 화면에 보일 이수 형태. 다전공·부전공을 신청하지 않은 학생은 2학년 2학기 전까지 '심화전공 예정'(3학년 1학기 진입 때 심화전공으로 바뀜)
export function modeOf(p: Profile, me: Me): string {
  const w = withOf(p);
  if (w === 'single') return me.admission === 'freshman' && semNo(me) < 4 ? '심화전공 예정' : '심화전공';
  return ({ double: '다전공', minor: '부전공', micro: '마이크로전공', exempt: '전공제도 이수 제외' } as const)[w];
}
// 심화전공을 할 수 있는 학생인지(편입·외국인특별전형·이수 제외 표시는 심화전공 이수 불가, engine withOf와 같은 규칙)
export const canDeep = (me: Me) => me.admission === 'freshman' && me.student !== 'international' && !me.exempt;
// 프로그램 종류 이름(다전공·부전공 목록 표시용). 'ext'는 학과 정보 없이 가져온 다전공·부전공
const KIND: Record<string, string> = { dept: '다전공', linked: '연계전공', fusion: '융합전공', ism: '자기설계융합전공' };
export const roleText = (u: Univ, g: Prog) => g.role === 'minor' ? '부전공' : g.role === 'micro' ? '마이크로전공' : KIND[u.programs[g.id]?.kind ?? 'dept'] ?? '다전공';
export const progName = (u: Univ, g: Prog) => g.id === 'ext' ? roleText(u, g) : u.programs[g.id]?.name ?? g.id;
