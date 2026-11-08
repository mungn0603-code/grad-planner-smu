// data/<univ>/ 정적 파일을 불러와 엔진 컨텍스트로 만든다(engine/load.node.ts의 브라우저판).
// 파일은 빌드 때 자산으로 복사되고, 고른 대학·프로그램의 파일만 내려받는다.
import { assemble } from '../engine/data.ts';
import type { Ctx } from '../engine/audit.ts';
import type { Catalog, Rule, Univ } from '../engine/types.ts';

// 지금은 상명대 천안캠만 연다(2026-10-21 범위 축소). 다른 대학 데이터는 data/에 남아 있고 이 경로만 넓히면 다시 묶인다
const NAMES = import.meta.glob<string>('../data/smu-cheonan/rules.json', { eager: true, import: 'name' });
const URLS = import.meta.glob<string>(['../data/smu-cheonan/rules.json', '../data/smu-cheonan/sets.csv', '../data/smu-cheonan/gen/*.json'], { eager: true, query: '?url', import: 'default' });

export const UNIVS = Object.entries(NAMES).map(([p, name]) => ({ id: p.split('/')[2], name }));

async function get(path: string) {
  const u = URLS[path]; if (!u) throw new Error(`데이터 파일 없음: ${path}`);
  const r = await fetch(u); if (!r.ok) throw new Error(`불러오기 실패 ${r.status}: ${path}`);
  return r;
}

const univCache = new Map<string, Promise<Univ>>();
export function loadUniv(id: string): Promise<Univ> {
  let p = univCache.get(id);
  if (!p) univCache.set(id, p = Promise.all([get(`../data/${id}/rules.json`).then(r => r.json()), get(`../data/${id}/sets.csv`).then(r => r.text())])
    .then(([rules, csv]) => assemble(rules, csv)));
  return p;
}

// 프로그램이 쓰는 카탈로그만 불러온다(파일 이름 = 카탈로그 id)
const catCache = new Map<string, Promise<Catalog>>();
export async function loadCtx(univ: Univ, programIds: string[]): Promise<Ctx> {
  const ids = [...new Set(programIds.flatMap(p => univ.programs[p]?.catalogs || []))];
  const cats = await Promise.all(ids.map(id => {
    const k = `../data/${univ.id}/gen/${id}.json`;
    if (!catCache.has(k)) catCache.set(k, get(k).then(r => r.json()));
    return catCache.get(k)!;
  }));
  return { univ, catalogs: Object.fromEntries(cats.map(c => [c.id, c])) };
}

// 프로그램 고르기용: 주전공으로 고를 수 있는 프로그램, 그 학과의 트랙, 입학년도 범위
const key = (name: string) => (name === '그린화학공학과' ? '' : name); // 개발자 학과를 목록 맨 앞에 둔다
export function primaries(u: Univ) {
  const ids = [...new Set(u.sets.filter(s => !s.when?.role || s.when.role === 'primary').map(s => s.program))];
  return ids.filter(id => u.programs[id]).map(id => ({ id, name: u.programs[id].name, college: u.programs[id].college ?? '' })).sort((a, b) => key(a.name).localeCompare(key(b.name), 'ko'));
}
// ponytail: 트랙 소속은 id 규칙(cdr.<학과>.<번호>, 상명 SM-CDR)으로 찾는다. 다른 대학에 트랙이 생기면 데이터에 소속 필드를 둔다
export const tracksOf = (u: Univ, primary: string) =>
  Object.keys(u.programs).filter(id => id.startsWith(`cdr.${primary}.`)).map(id => ({ id, name: u.programs[id].name }));
export function yearsOf(u: Univ, program: string) {
  const ys = u.sets.filter(s => s.program === program).flatMap(s => [s.years[0], s.years[1]]);
  if (!ys.length) return [];
  const out: number[] = []; for (let y = Math.max(...ys); y >= Math.min(...ys); y--) out.push(y);
  return out;
}
export const collegesOf = (ps: { college: string }[]) => [...new Set(ps.map(p => p.college))].sort((a, b) => a.localeCompare(b, 'ko'));
// 다전공·부전공으로 고를 수 있는 프로그램(그 역할 세트가 있는 것). kind: 학과(dept)·연계(linked)·융합(fusion)·자기설계(ism)
export const progsFor = (u: Univ, role: 'second' | 'minor') =>
  [...new Set(u.sets.filter(s => s.when?.role === role).map(s => s.program))].filter(id => u.programs[id])
    .map(id => ({ id, name: u.programs[id].name, kind: u.programs[id].kind ?? 'dept' })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

// 요건 트리에서 학생이 직접 넣는 값(check)과 기준값 모으기
export function checksIn(rule: Rule, u: Univ, out: { key: string; label: string; hint?: string; min: number; list?: string[] }[] = [], vars: Record<string, number> = {}) {
  if ('use' in rule) checksIn(u.blocks[rule.use], u, out, { ...vars, ...(rule.vars || {}) });
  else if ('all' in rule) rule.all.forEach(r => checksIn(r, u, out, vars));
  else if ('check' in rule && !out.some(c => c.key === rule.check)) {
    const min = rule.min == null ? 1 : typeof rule.min === 'number' ? rule.min : vars[rule.min.slice(1)] ?? 1;
    out.push({ key: rule.check, label: rule.label ?? rule.check, ...(rule.hint ? { hint: rule.hint } : {}), min, ...(rule.list ? { list: rule.list } : {}) });
  }
  return out;
}
