// 대학 데이터 검사(참조 무결성). JSON Schema가 못 보는 것: 참조한 블록·학수번호·변수·프로그램이 실제로 있는지, 연도 범위가 겹치는지.
import type { Rule, Filter, Univ, Catalog } from './types.ts';

export function check(univ: Univ, catalogs: Record<string, Catalog>): string[] {
  const err: string[] = [], codes = new Set<string>(), cats = new Set<string>(), areas = new Set<string>();
  for (const c of Object.values(catalogs)) for (const rows of Object.values(c.editions)) for (const r of rows) { codes.add(r.c); cats.add(r.t); if (r.a) areas.add(r.a); }
  for (const t of cats) if (!(t in univ.categories)) err.push(`이수구분 '${t}' 태그 대응 없음`);
  for (const a of areas) if (!(a in univ.areas)) err.push(`영역 '${a}' 태그 대응 없음`);
  for (const ct of univ.codeTags || []) { try { new RegExp(ct.re); } catch { err.push(`codeTags 정규식 오류 ${ct.re}`); } }
  for (const [id, p] of Object.entries(univ.programs)) for (const c of p.catalogs) if (!catalogs[c]) err.push(`프로그램 ${id}: 카탈로그 ${c} 없음`);
  for (const x of univ.policy.extra ?? []) { if (!univ.blocks[x.use]) err.push(`덧붙이는 블록 ${x.use} 없음`); for (const g of x.programs ?? []) if (!univ.programs[g]) err.push(`덧붙이는 블록 ${x.use}: 프로그램 ${g} 없음`); }
  for (const [id, p] of Object.entries(univ.programs)) if (p.kind && !univ.policy.assign?.by[p.kind]) err.push(`프로그램 ${id}: 배정 종류 ${p.kind} 없음`);
  const filt = (f: Filter, where: string) => { for (const c of f.codes || []) if (!codes.has(c)) err.push(`${where}: 학수번호 ${c}가 어느 카탈로그에도 없음`); if (f.not) filt(f.not, where); };
  // 규칙을 따라가며 블록·변수 확인. vars = 지금까지 받은 변수
  const walk = (r: Rule, vars: Set<string>, where: string, seen: string[]) => {
    const need = (n: unknown) => { if (typeof n === 'string' && n.startsWith('$') && !vars.has(n.slice(1))) err.push(`${where}: 변수 ${n} 값 없음`); };
    if ('use' in r) {
      if (seen.includes(r.use)) return err.push(`${where}: 블록 순환 ${[...seen, r.use].join('→')}`);
      const b = univ.blocks[r.use]; if (!b) return err.push(`${where}: 블록 ${r.use} 없음`);
      walk(b, new Set([...vars, ...Object.keys(r.vars || {})]), `${where}>${r.use}`, [...seen, r.use]);
    } else if ('credits' in r) { need(r.credits); filt(r.of, where); (r.capped || []).forEach(c => { need(c.max); filt(c.of, where); }); }
    else if ('courses' in r) { need(r.courses); filt(r.of, where); }
    else if ('all' in r) { need(r.need); r.all.forEach((c, i) => walk(c, vars, `${where}.${c.id ?? i}`, seen)); }
    else need(r.min);
  };
  const key = (s: Univ['sets'][number]) => JSON.stringify([s.program, s.when?.role, s.when?.with, s.when?.admission, s.when?.student]);
  const byKey = new Map<string, [number, number][]>();
  for (const s of univ.sets) {
    const where = `세트 ${s.program} ${s.years.join('~')}`;
    if (!univ.programs[s.program]) err.push(`${where}: 프로그램 정의 없음`);
    if (!s.src) err.push(`${where}: 근거(src) 없음`);
    if (!(s.years[0] <= s.years[1])) err.push(`${where}: 연도 범위 거꿀`);
    const ranges = byKey.get(key(s)) || byKey.set(key(s), []).get(key(s))!;
    for (const [a, b] of ranges) if (s.years[0] <= b && a <= s.years[1]) err.push(`${where}: 같은 조건 세트와 연도 겹침(${a}~${b})`);
    ranges.push(s.years);
    walk(s.rule, new Set(), where, []);
  }
  return [...new Set(err)];
}
