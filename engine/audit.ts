// 졸업요건 평가기. 수강 기록 → (판 고르기 → 태그 → 재수강·중복 정리) → 프로그램별 규칙 트리 평가.
// 추천(plan.ts)도 이 평가기로 검산한다(기준이 한 곳에만 있도록).
import type { Univ, Catalog, Row, Profile, Enrollment, Rule, Filter, Result, ReqSet, With, N } from './types.ts';
import { nameKey } from './data.ts';

export interface Ctx { univ: Univ; catalogs: Record<string, Catalog> }
export interface Item {
  i: number; code?: string; name: string; cr: number; cat: string; area?: string; term?: string;
  planned: boolean; lump: boolean; ed?: string; cat0?: Catalog;
  tags: Set<string>; ids: Set<string>; key: string;
  out?: 'retake' | 'dup' | 'fail';    // 셈에서 빠진 이유
}
export interface Gpa { gpa: number; cr: number; terms: Record<string, { gpa: number; cr: number }> } // cr: 평점에 넣은 학점
export interface Audit { items: Item[]; programs: { id: string; role: string; result: Result }[]; warnings: string[]; gpa?: Gpa }

export const termOrd = (t?: string) => { if (!t) return 1e9; const y = +t.slice(0, 4), h = t.slice(5); return y * 4 + ({ '1': 0, S: 1, '2': 2, W: 3 } as Record<string, number>)[h]; };

// 카탈로그 한 개의 색인(코드 → 판 → 행, 판별 대응표, 역대응 수)
interface Idx { cat: Catalog; eds: string[]; byCode: Map<string, Map<string, Row>>; map: Map<string, string[]>; rev: Map<string, Map<string, number>> }
const IDX = new WeakMap<Catalog, Idx>();
function index(cat: Catalog, univ: Univ): Idx {
  let x = IDX.get(cat); if (x) return x;
  const eds = Object.keys(cat.editions).sort(), byCode = new Map<string, Map<string, Row>>(), map = new Map<string, string[]>();
  for (const ed of eds) for (const r of cat.editions[ed]) { if (!byCode.has(r.c)) byCode.set(r.c, new Map()); const m = byCode.get(r.c)!; if (!m.has(ed)) m.set(ed, r); }
  for (const e of [...(cat.equiv || []), ...univ.equiv]) for (const f of e.from) for (const ed of e.ed || eds) map.set(ed + '|' + f, e.to);
  const rev = new Map<string, Map<string, number>>();
  for (const ed of eds) { const m = new Map<string, number>(); for (const r of cat.editions[ed]) for (const t of map.get(ed + '|' + r.c) ?? [r.c]) m.set(t, (m.get(t) || 0) + 1); rev.set(ed, m); }
  x = { cat, eds, byCode, map, rev }; IDX.set(cat, x); return x;
}
const mapping = (x: Idx, ed: string, code: string) => x.map.get(ed + '|' + code) ?? [code];
// 같은 과목 판정 키: 그 판에서 1:1로만 대응하면 대응 과목 코드, 아니면 자기 코드
const canon = (x: Idx, ed: string, code: string) => { const m = mapping(x, ed, code); return m.length === 1 && (x.rev.get(ed)?.get(m[0]) || 0) === 1 ? m[0] : code; };

export function strips(ctx: Ctx, cats: Catalog[]): RegExp[] {
  return [...ctx.univ.nameStrip, ...cats.flatMap(c => c.nameStrip || [])].map(s => new RegExp(s, 'g'));
}
export function catalogsOf(p: Profile, ctx: Ctx): Catalog[] {
  const ids = [...new Set(p.programs.flatMap(g => ctx.univ.programs[g.id]?.catalogs || []))];
  return ids.map(id => ctx.catalogs[id]).filter(Boolean);
}

export function resolve(p: Profile, es: Enrollment[], ctx: Ctx): { items: Item[]; warnings: string[] } {
  const { univ } = ctx, cats = catalogsOf(p, ctx), xs = cats.map(c => index(c, univ)), st = strips(ctx, cats), warnings: string[] = [];
  const items: Item[] = es.map((e, i) => {
    let row: Row | undefined, ed: string | undefined, x: Idx | undefined;
    if (e.code) {
      x = xs.find(v => v.byCode.has(e.code!));
      if (x) {
        const vers = x.byCode.get(e.code)!, latest = [...vers.keys()].sort().pop()!;
        const cy = String(p.catalogYear);
        if (e.planned) ed = latest;
        else {
          // 판 고르기: 수강한 해의 판(그 해 이하 가장 최근) → 요건 연도 판 → 그 과목이 있는 가장 최근 판
          let ed0 = cy;
          if (univ.policy.edition === 'term' && e.term) { const y = +e.term.slice(0, 4); ed0 = x.eds.filter(v => +v <= y).pop() || x.eds[0]; }
          ed = [ed0, cy].find(v => vers.has(v)) || latest;
        }
        row = vers.get(ed);
      } // 카탈로그에 없는 학수번호도 샘물의 과목명·이수구분·학점으로 그대로 센다(경고하지 않는다)
    }
    const name = e.name ?? row?.n ?? e.code ?? '', cat = e.category ?? row?.t ?? '';
    // 영역: 직접 고친 값 → 샘물 이수 당시 교양영역(없어진 과목·개편된 영역도 학교 기록대로) → 카탈로그
    const area = e.area ?? (e.cultArea ? univ.cultAreas?.find(m => new RegExp(m.re).test(e.cultArea!))?.area : undefined) ?? row?.a;
    const tags = new Set<string>(univ.categories[cat] ?? []);
    if (!(cat in univ.categories) && cat) warnings.push(`${name}: 이수구분 '${cat}'은 졸업 학점에만 넣었습니다`);
    for (const t of (area && univ.areas[area]) || []) tags.add(t);
    if (e.src) tags.add('src.' + e.src);
    if (e.code) for (const ct of univ.codeTags || []) if (new RegExp(ct.re).test(e.code)) ct.tags.forEach(t => tags.add(t));
    const ids = new Set<string>(); if (e.code) { ids.add(e.code); if (x && ed) for (const t of mapping(x, ed, e.code)) ids.add(t); }
    const it: Item = { i, code: e.code, name, cr: e.credits ?? row?.cr ?? 0, cat, area, term: e.term, planned: !!e.planned, lump: !!e.lump, ed, cat0: x?.cat, tags, ids, key: nameKey(name, st) };
    if (e.grade && /^(F|NP|U)$/i.test(e.grade)) it.out = 'fail';
    return it;
  });
  // 재수강: 같은 과목(같은 코드 또는 1:1 대응)은 하나만 남긴다
  const groups = new Map<string, Item[]>();
  for (const it of items) if (!it.out && it.code && it.cat0 && it.ed) { const k = canon(index(it.cat0, univ), it.ed, it.code); (groups.get(k) || groups.set(k, []).get(k)!).push(it); }
  for (const g of groups.values()) if (g.length > 1) {
    g.sort((a, b) => termOrd(b.term) - termOrd(a.term)); // ponytail: 'best'(성적 우선)는 성적 척도가 대학마다 달라 아직 latest와 같게 처리
    g.slice(1).forEach(it => { it.out = 'retake'; });
  }
  // 중복: 옛 판 과목이 대응하는 현재 판 과목을 또 들었으면 현재 판 쪽을 셈에서 뺀다(분리·통합 과목)
  const latestOf = (it: Item) => [...index(it.cat0!, univ).byCode.get(it.code!)!.keys()].sort().pop();
  const covered = new Set<string>();
  for (const it of items) if (!it.out && it.code && it.cat0 && it.ed && it.ed !== latestOf(it)) for (const t of mapping(index(it.cat0, univ), it.ed, it.code)) covered.add(t);
  for (const it of items) if (!it.out && it.code && it.cat0 && it.ed === latestOf(it) && covered.has(it.code)) it.out = 'dup';
  return { items, warnings };
}

const withOf = (p: Profile): With => p.programs.some(g => g.role === 'second') ? 'double' : p.programs.some(g => g.role === 'minor') ? 'minor' : p.programs.some(g => g.role === 'micro') ? 'micro' : 'single';
export function pickSet(p: Profile, prog: { id: string; role: string }, univ: Univ): ReqSet | null {
  const w = withOf(p), ok = univ.sets.filter(s => s.program === prog.id && s.years[0] <= p.catalogYear && p.catalogYear <= s.years[1] &&
    (!s.when?.role || s.when.role === prog.role) && (!s.when?.with || s.when.with === w) &&
    (!s.when?.admission || s.when.admission === p.admission) && (!s.when?.student || s.when.student === p.student));
  if (!ok.length) return null;
  const spec = (s: ReqSet) => Object.keys(s.when || {}).length;
  ok.sort((a, b) => spec(b) - spec(a));
  if (ok.length > 1 && spec(ok[0]) === spec(ok[1])) throw new Error(`요건 세트 겹침: ${prog.id} ${p.catalogYear}`);
  const s = ok[0], v = prog.role === 'primary' ? p.vars : undefined;
  const tu = p.admission === 'transfer' && !s.when?.admission ? univ.policy.transferUnknown ?? [] : [];
  if (!(v && Object.keys(v).length) && !tu.length || !('all' in s.rule)) return s;
  // 세트 맨 위 묶음마다: 학교 기준 숫자는 세트에 있는 이름만 덮어쓰고, 편입생에게 같은지 모르는 묶음은 확인 필요 항목으로 바꾼다
  const all = s.rule.all.map((r): Rule => {
    if (!('use' in r)) return r;
    const b = univ.blocks[r.use], id = b?.id ?? r.use;
    if (tu.includes(id)) return { id, label: `${b?.label ?? id}(편입생 기준 확인 필요)`, check: `transfer.${id}`,
      hint: '편입생에게 이 기준이 같은지 학점플래너 데이터로는 알 수 없습니다. 샘물 학점이수상황표에서 확인하고, 충족했으면 켜 주세요.' };
    return v && r.vars ? { ...r, vars: { ...r.vars, ...Object.fromEntries(Object.entries(v).filter(([k]) => k in r.vars!)) } } : r;
  });
  return { ...s, rule: { ...s.rule, all } };
}

export function match(it: Item, f: Filter, nameSet?: Set<string>): boolean {
  if (it.out) return false;
  if (f.codes || f.names) {
    if (it.lump) return false;
    const byCode = !!f.codes && f.codes.some(c => it.ids.has(c));
    const byName = !!f.names && (nameSet ? nameSet.has(it.key) : false);
    if (!byCode && !byName) return false;
  }
  if (f.tags && !f.tags.some(t => it.tags.has(t))) return false;
  if (f.every && !f.every.every(t => it.tags.has(t))) return false;
  if (f.not && match(it, f.not, undefined)) return false;
  return true;
}

const NAMES = new WeakMap<Filter, Map<string, Set<string>>>(); // 필터별 정규화한 과목명 집합(평가마다 다시 만들지 않게)
export function evaluate(rule: Rule, items: Item[], p: Profile, ctx: Ctx, st: RegExp[], vars: Record<string, number> = {}, id = 'root'): Result {
  const num = (n: N) => typeof n === 'number' ? n : (() => { const v = vars[n.slice(1)]; if (v == null) throw new Error(`변수 없음 ${n} (${id})`); return v; })();
  const rid = rule.id ?? id, base = { id: rid, ...(rule.label ? { label: rule.label } : {}) };
  const names = (f: Filter) => { if (!f.names) return undefined; const sig = st.map(r => r.source).join('|');
    let m = NAMES.get(f); if (!m) NAMES.set(f, m = new Map()); let s = m.get(sig); if (!s) m.set(sig, s = new Set(f.names.map(n => nameKey(n, st)))); return s; };
  const pick = (f: Filter) => { const ns = names(f), nn = f.not ? names(f.not) : undefined;
    return items.filter(it => match(it, { ...f, not: undefined }, ns) && !(f.not && match(it, f.not, nn))); };
  if ('use' in rule) {
    const b = ctx.univ.blocks[rule.use]; if (!b) throw new Error(`블록 없음 ${rule.use}`);
    return evaluate(b, items, p, ctx, st, { ...vars, ...(rule.vars || {}) }, rule.id ?? b.id ?? rule.use);
  }
  if ('credits' in rule) {
    const need = num(rule.credits), hit = pick(rule.of);
    let have = hit.reduce((a, it) => a + it.cr, 0), done = hit.filter(it => !it.planned).reduce((a, it) => a + it.cr, 0);
    for (const c of rule.capped || []) { const m = hit.filter(it => pick(c.of).includes(it)), max = num(c.max);
      have -= Math.max(0, m.reduce((a, it) => a + it.cr, 0) - max); done -= Math.max(0, m.filter(it => !it.planned).reduce((a, it) => a + it.cr, 0) - max); }
    return { ...base, kind: 'credits', ok: have >= need, have, done, need, used: hit.map(it => it.i) };
  }
  if ('courses' in rule) {
    const need = num(rule.courses), hit = pick(rule.of).filter(it => !it.lump);
    return { ...base, kind: 'courses', ok: hit.length >= need, have: hit.length, done: hit.filter(it => !it.planned).length, need, used: hit.map(it => it.i) };
  }
  if ('all' in rule) {
    const children = rule.all.map((r, k) => evaluate(r, items, p, ctx, st, vars, `${rid}.${k}`));
    const need = rule.need == null ? children.length : num(rule.need);
    const okN = children.filter(c => c.ok === true).length, nullN = children.filter(c => c.ok === null).length;
    const doneN = children.filter(c => c.done >= c.need).length;
    return { ...base, kind: 'all', ok: okN >= need ? true : okN + nullN >= need ? null : false, have: okN, done: doneN, need, children };
  }
  const v = p.checks[rule.check], need = rule.min == null ? 1 : num(rule.min);
  // 프로그램 목록이 있으면 고른(가져온) 프로그램 중 목록에 든 개수. 예전 직접 입력값이 더 크면 그 값
  const ns = (x: string) => x.replace(/\s/g, ''), done = rule.list && p.done?.length ? rule.list.filter(n => p.done!.some(d => ns(d) === ns(n))).length : null;
  if (v == null && done == null) return { ...base, kind: 'check', ok: null, have: 0, done: 0, need, note: '입력 필요' };
  const have = Math.max(done ?? 0, typeof v === 'boolean' ? (v ? 1 : 0) : v ?? 0);
  return { ...base, kind: 'check', ok: have >= need, have, done: have, need };
}

// 평점평균: 척도에 있는 성적(P·NP 등은 빼고)을 학점으로 가중 평균한다. 계획 과목·재수강 이전 기록·중복은 빼고,
// F는 나중에 같은 과목을 다시 들었으면 뺀다. 학기 평점은 그 학기 성적표 그대로(재수강 여부와 상관없이) 계산한다
// ponytail: 재수강 F 처리와 P/NP 제외는 학칙 원문 미확인(ADR 0014). 학교 기준이 다르면 여기만 고친다
export function gpa(items: Item[], es: Enrollment[], scale: Record<string, number>): Gpa | undefined {
  const pt = (it: Item) => { const g = es[it.i]?.grade?.trim().toUpperCase(); return g != null && g in scale && !it.planned && it.cr > 0 ? scale[g] : undefined; };
  const later = (it: Item) => items.some(o => !o.out && o !== it && termOrd(o.term) > termOrd(it.term) && [...o.ids].some(c => it.ids.has(c)));
  const avg = (xs: Item[]) => { const cr = xs.reduce((a, it) => a + it.cr, 0); return { gpa: cr ? xs.reduce((a, it) => a + pt(it)! * it.cr, 0) / cr : 0, cr }; };
  const graded = items.filter(it => pt(it) != null);
  const all = graded.filter(it => !it.out || (it.out === 'fail' && !later(it)));
  if (!all.length) return;
  const terms: Gpa['terms'] = {};
  for (const t of new Set(graded.map(it => it.term ?? ''))) terms[t] = avg(graded.filter(it => (it.term ?? '') === t));
  return { ...avg(all), terms };
}

// 학교가 판정한 이수구분별 취득학점(샘물 학점이수상황표)과 앱이 센 값을 견준다. 성적이 나온 기록만 센다(수강 중·계획·F·재수강 이전·중복 제외).
// 다르면 과목 이수구분이 성적표와 졸업 판정에서 다르게 잡힌 것이라(교육과정 개편·이수구분 변경 등) 학생에게 알린다
export function cmpDiff(items: Item[], es: Enrollment[], school: Record<string, number>): string[] {
  const mine: Record<string, number> = {};
  for (const it of items) if (!it.out && !it.planned && es[it.i]?.grade) mine[it.cat] = (mine[it.cat] ?? 0) + it.cr;
  return [...new Set([...Object.keys(school), ...Object.keys(mine)])].filter(c => Math.abs((school[c] ?? 0) - (mine[c] ?? 0)) > 1e-9)
    .map(c => `${c || '(이수구분 없음)'} 취득학점: 학교 학점이수상황표 ${school[c] ?? 0}학점, 앱 ${mine[c] ?? 0}학점. 이수구분이 바뀐 과목이 있을 수 있으니 샘물 학점이수상황표로 확인해 주세요`);
}

export function audit(p: Profile, es: Enrollment[], ctx: Ctx): Audit {
  const { items, warnings } = resolve(p, es, ctx), st = strips(ctx, catalogsOf(p, ctx));
  // 성적이 있으면 평점 입력 항목을 계산값으로 채운다(직접 넣은 값보다 우선)
  const g = ctx.univ.policy.gpa, G = g && gpa(items, es, g.scale);
  if (g && G) p = { ...p, checks: { ...p.checks, [g.check]: G.gpa } };
  const programs = p.programs.map(g => {
    const set = pickSet(p, g, ctx.univ);
    const result: Result = set ? { ...evaluate(set.rule, items, p, ctx, st, {}, g.id), id: g.id }
      : { id: g.id, ok: null, have: 0, done: 0, need: 0, note: `${p.catalogYear}학번 미지원` };
    return { id: g.id, role: g.role, result };
  });
  return { items, programs, warnings, ...(G ? { gpa: G } : {}) };
}

// 가정해 보기: 고른 다전공·마이크로전공의 과목을 그 이수구분으로 옮긴다. 앞에 고른 것부터, 한 과목은 한 곳에만 넣는다(학교: 중복 인정 불가).
// keep 태그가 있는 과목은 옮기지 않는다(예: 주전공 학점을 지키려면 'major'). 반환: 수강 기록 순번 → 새 이수구분
// ponytail: 고른 순서대로 넣는다. 주전공·다전공 같은 과목 6학점 중복 인정과 최적 배정은 하지 않는다(필요하면 plan.ts 정수계획으로)
export function reassign(p: Profile, es: Enrollment[], ctx: Ctx, picks: { cat: string; of: Filter; keep?: string[] }[]): Record<number, string> {
  const { items } = resolve(p, es, ctx), st = strips(ctx, catalogsOf(p, ctx)), out: Record<number, string> = {};
  for (const k of picks) {
    const ns = k.of.names && new Set(k.of.names.map(n => nameKey(n, st)));
    for (const it of items) if (!(it.i in out) && !it.lump && !k.keep?.some(t => it.tags.has(t)) && match(it, k.of, ns)) out[it.i] = k.cat;
  }
  return out;
}

// 결과 트리에서 id로 찾기
export function find(r: Result | undefined, id: string): Result | undefined {
  if (!r) return; if (r.id === id) return r;
  for (const c of r.children || []) { const x = find(c, id); if (x) return x; }
}
