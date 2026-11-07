// 남은 학기 추천.
// 기본: 정수계획(HiGHS)으로 정확히 푼다. 목적은 사전식 우선순위 — ① 요건 부족분 ② 학기 최소학점 부족분 ③ 추천 학점 ④ 취향(관심 트랙·권장 학기·정규학기).
// 대체: 풀이기를 못 쓰거나 시간 안에 해를 못 찾으면 현재 앱 수뭉이(smPlan)를 옮긴 가중 탐욕 + 1과목 수리.
// 어느 쪽이든 결과는 평가기(audit)로 다시 판정한다(기준은 평가기 한 곳). 근거·검증은 docs/ARCHITECTURE.md §4.
import loadHighs from 'highs';
import type { Profile, Enrollment, Rule, Result, Filter, Row, Term } from './types.ts';
import { audit, resolve, match, strips, catalogsOf, pickSet, termOrd, type Ctx, type Item, type Audit } from './audit.ts';
import { nameKey } from './data.ts';

// Node는 여기서 바로 불러온다. 브라우저(Web Worker)는 highs.wasm 위치를 알려야 하므로 initHighs({ locateFile })를 먼저 부른다.
// 못 불러오면 탐욕으로 대체
let highs = (globalThis as any).process?.versions?.node ? await loadHighs().catch(() => null) : null;
export async function initHighs(settings?: Parameters<typeof loadHighs>[0]) { highs = await loadHighs(settings).catch(() => null); return !!highs; }

export interface PlanOpts { tracks?: string[]; season?: boolean; overload?: boolean; exact?: boolean; timeLimit?: number }
export interface PlanRow { term: Term; code: string; name: string; cr: number; why: string[]; keys?: string[] } // keys: 채우는 요건 칸 '프로그램.id'(why는 id만)
export interface Unmet { program: string; id: string; label?: string; gap: number; reachable: boolean }
export interface Exact { status: string; optimal: boolean; ms: number; slack: Record<string, number> } // slack: 요건 칸 id → 풀이기가 본 부족분
export interface Alt { code: string; name: string; cr: number }
export interface Plan { alts: Record<string, Alt[]>; rows: PlanRow[]; fut: Term[]; sea: Term[]; load: Record<Term, number>; lim: Record<Term, number>;
  lb: number; capacity: number; unmet: Unmet[]; shortfall: number; after: Audit; repaired: number; strategy: 'milp' | 'greedy'; exact?: Exact }

// ── 학기 계산 ──
const nextReg = (t: Term) => { const [y, h] = t.split('-'); return h === '1' ? `${y}-2` : `${+y + 1}-1`; };
const seaAfter = (t: Term) => { const [y, h] = t.split('-'); return h === '1' ? `${y}-S` : `${y}-W`; };
const half = (t: Term) => +t.split('-')[1], isSea = (t: Term) => /-[SW]$/.test(t);
export function regTerms(p: Profile): { term: Term; ord: number }[] {
  const out: { term: Term; ord: number }[] = []; let t = p.startTerm ?? `${p.catalogYear}-1`, ord = p.startSemester;
  for (let guard = 0; ord <= 8 && guard < 40; guard++, t = nextReg(t)) if (!p.leaves.includes(t)) out.push({ term: t, ord: ord++ });
  return out;
}

interface Leaf { program: string; id: string; label?: string; kind: 'credits' | 'courses'; rem: number; need: number; have: number; of: Filter; w: number; group?: { rem: number }; ident: boolean; total: boolean }
// 평가 결과 트리와 규칙 트리를 나란히 따라가 '채울 수 있는 칸'(학점·과목 수)을 모은다. need < 자식 수인 all은 고르기 묶음(예: 균형 3/5)
function leaves(rule: Rule, res: Result, ctx: Ctx, program: string, w: number, group: Leaf['group'], out: Leaf[]) {
  if ('use' in rule) return leaves(ctx.univ.blocks[rule.use], res, ctx, program, rule.w ?? w, group, out);
  const ww = rule.w ?? w;
  if ('all' in rule) {
    const g = res.need < rule.all.length ? { rem: res.need - res.have } : group;
    rule.all.forEach((r, k) => leaves(r, res.children![k], ctx, program, ww, g, out)); return;
  }
  if ('credits' in rule || 'courses' in rule) {
    const of = rule.of, ident = !!(of.codes || of.names);
    out.push({ program, id: res.id, label: res.label, kind: 'credits' in rule ? 'credits' : 'courses', rem: res.need - res.have, need: res.need, have: res.have,
      of, w: ww, group, ident, total: !ident && !of.tags && !of.every && !of.not });
  }
}
const cloneL = (L: Leaf[]) => { const g = new Map<object, { rem: number }>();
  return L.map(l => ({ ...l, group: l.group && (g.get(l.group) || g.set(l.group, { ...l.group }).get(l.group)) })); };

// ── 부족분 척도(풀이기 목적함수와 평가기 판정에 같은 값을 쓴다) ──
// 학점 칸은 1학점 = 1, 과목 수 칸과 고르기 묶음은 1개 = 3(대략 한 과목 학점), 가중치 w(졸업논문 10 등)는 ×(1 + w/10)
const UNIT = { credits: 1, courses: 3, group: 3 } as const, imp = (w: number) => 1 + w / 10;

// 추천·채점 공통 준비: 기준 판정, 채울 칸, 학기, 후보
function prepare(p: Profile, es: Enrollment[], ctx: Ctx, opts: PlanOpts) {
  const { policy } = ctx.univ, cats = catalogsOf(p, ctx), st = strips(ctx, cats);
  const progs = p.programs.filter(g => g.role !== 'track' || (opts.tracks || []).includes(g.id));
  const base = audit(p, es, ctx);
  const L0: Leaf[] = [];
  for (const g of progs) { const set = pickSet(p, g, ctx.univ), r = base.programs.find(x => x.id === g.id)!.result; if (set) leaves(set.rule, r, ctx, g.id, 0, undefined, L0); }
  const trackL = L0.filter(l => l.program !== progs[0]?.id && (opts.tracks || []).includes(l.program));
  const nsCache = new Map<Filter, Set<string>>(), ns = (f: Filter) => { if (!f.names) return undefined; let s = nsCache.get(f); if (!s) nsCache.set(f, s = new Set(f.names.map(n => nameKey(n, st)))); return s; };
  const fm = (it: Item, f: Filter): boolean => match(it, { ...f, not: undefined }, ns(f)) && !(f.not && fm(it, f.not));

  // 현재 학기가 학기 목록에 없으면(휴학을 안 넣어 8학기가 먼저 끝남, 또는 휴학 중) 현재 학기까지 지난 학기로 본다. 지난 학기에 추천하지 않는다
  const seq = regTerms(p), nowOrd = seq.find(x => x.term === p.now)?.ord ?? (p.now ? Math.max(0, ...seq.filter(x => termOrd(x.term) <= termOrd(p.now)).map(x => x.ord)) : 99);
  const fut = seq.filter(x => x.ord > nowOrd).map(x => x.term), ordOf = new Map(seq.map(x => [x.term, x.ord]));
  const termOfOrd = new Map(seq.map(x => [x.ord, x.term]));
  const sea = opts.season ? [p.now, ...fut].filter((t): t is Term => !!t && (ordOf.get(t) ?? 9) < 8).map(seaAfter) : [];
  const lim: Record<Term, number> = {}, baseLoad: Record<Term, number> = {};
  fut.forEach((t, i) => { lim[t] = opts.overload && i === 0 && policy.overload ? policy.overload.max : policy.termMax; });
  sea.forEach(t => { lim[t] = policy.season.max; });
  for (const t of [...fut, ...sea]) baseLoad[t] = base.items.filter(it => !it.out && it.term === t).reduce((a, it) => a + it.cr, 0);
  const terms = [...fut, ...sea], order = (t: Term) => terms.indexOf(t);
  const minOf = (t: Term) => policy.termMin[(ordOf.get(t) ?? 1) - 1] ?? 0;

  // 후보: 프로그램 카탈로그의 최신 판 과목. 들은 과목·추천 제외·유학생 전용(내국인)·이미 채운 특정 과목 요건의 과목은 뺀다
  const taken = new Set<string>(), takenK = new Set<string>();
  base.items.filter(it => !it.out).forEach(it => { it.ids.forEach(c => taken.add(c)); takenK.add(it.key); });
  const rows: Row[] = [], seen = new Set<string>();
  for (const c of cats) { const eds = Object.keys(c.editions).sort(); for (const r of c.editions[eds[eds.length - 1]]) if (!seen.has(r.c)) { seen.add(r.c); rows.push(r); } }
  // 다전공·부전공 교육과정에만 있는 과목은 그 종류의 이수구분으로 추천한다(주전공 교육과정에도 있으면 주전공 과목으로 둔다)
  const A = policy.assign, codesOf = (gs: Profile['programs']) => catalogsOf({ ...p, programs: gs }, ctx).flatMap(c => Object.values(c.editions).flat().map(r => r.c));
  const primCodes = new Set(codesOf(p.programs.filter(g => g.role === 'primary'))), planCat = new Map<string, string>();
  if (A) for (const g of p.programs) { const b = g.role !== 'primary' && g.role !== 'track' && A.by[ctx.univ.programs[g.id]?.kind ?? g.role];
    if (b) for (const c of codesOf([g])) if (!primCodes.has(c) && !planCat.has(c)) planCat.set(c, b.cat); }
  const asPlan = (code: string, term?: Term) => ({ code, ...(term ? { term } : {}), planned: true as const, ...(planCat.has(code) ? { category: planCat.get(code) } : {}) });
  const res = resolve(p, rows.map(r => asPlan(r.c)), ctx).items;
  const excl = [...policy.noPlan, ...(p.student === 'international' ? [] : policy.intlOnly)];
  const doneIdent = L0.filter(l => l.kind === 'courses' && l.ident && l.rem <= 0);
  const cand = res.map((it, k) => ({ it, row: rows[k] })).filter(({ it }) => !it.out && ![...it.ids].some(c => taken.has(c)) && !takenK.has(it.key)
    && !excl.some(f => fm(it, f)) && !doneIdent.some(l => fm(it, l.of))).map(({ it, row }) => {
    const hs = row.s ? new Set([row.s, ...String(row.alt || '').split(',').filter(Boolean).map(a => +a.split('-')[1])]) : null;
    const defOrd = row.y && row.s ? (row.y - 1) * 2 + row.s : null;
    return { it, row, cr: it.cr, halves: hs, def: defOrd ? termOfOrd.get(defOrd) : undefined, defOrd, seaOk: !!policy.season.offered && fm(it, policy.season.offered),
      major: it.tags.has('major'), M: L0.map(l => fm(it, l.of)), interest: trackL.some(l => l.ident && fm(it, l.of)) };
  });
  // 들을 수 있는 학기: 계절학기는 계절 허용 과목(교양)만, 정규학기는 개설 학기(1·2학기, 달력 기준)가 맞아야 한다
  const canIn = (c: typeof cand[number], t: Term) => (isSea(t) ? c.seaOk && !c.major : !c.halves || c.halves.has(half(t)));

  // 못 채운 칸: 학점·과목 수 칸, 또는 고르기 묶음. 입력값 확인(평점·인증)은 추천으로 못 채우므로 뺀다
  const failing = (a: Audit) => { const f: { program: string; r: Result }[] = [];
    const walk = (g: string, r: Result) => { if (r.ok !== false || r.kind === 'check') return;
      if (r.kind === 'all' && r.need >= (r.children?.length ?? 0)) return r.children!.forEach(c => walk(g, c));
      f.push({ program: g, r }); };
    a.programs.filter(x => progs.some(g => g.id === x.id)).forEach(x => walk(x.id, x.result)); return f; };
  const leafIdx = (f: { program: string; r: Result }) => f.r.kind === 'all'
    ? L0.map((l, i) => (l.program === f.program && f.r.children!.some(ch => ch.id === l.id && ch.ok !== true) ? i : -1)).filter(i => i >= 0)
    : L0.map((l, i) => (l.program === f.program && l.id === f.r.id ? i : -1)).filter(i => i >= 0);
  const fKey = (f: { program: string; r: Result }) => `${f.program}.${f.r.id}`;
  const fWeight = (f: { program: string; r: Result }) => (f.r.kind === 'all' ? UNIT.group : UNIT[f.r.kind as 'credits' | 'courses']) * imp(Math.max(0, ...leafIdx(f).map(i => L0[i].w)));
  const shortfall = (fs: ReturnType<typeof failing>) => fs.reduce((a, f) => a + Math.max(0, f.r.need - f.r.have) * fWeight(f), 0);
  const withRows = (rs: { code: string; term: Term }[]) => [...es, ...rs.map(r => asPlan(r.code, r.term))];
  return { policy, progs, base, L0, fm, fut, sea, terms, order, lim, baseLoad, minOf, ordOf, nowOrd, cand, canIn, failing, leafIdx, fKey, shortfall, withRows };
}

// 임의의 추천 행(예: 현재 앱 수뭉이 결과)을 같은 척도로 채점한다
export function score(p: Profile, es: Enrollment[], ctx: Ctx, opts: PlanOpts, rows: { code: string; term: Term }[]) {
  const P = prepare(p, es, ctx, opts), after = audit(p, P.withRows(rows), ctx), fails = P.failing(after);
  return { after, fails: fails.map(f => P.fKey(f)), shortfall: P.shortfall(fails) };
}

export function plan(p: Profile, es: Enrollment[], ctx: Ctx, opts: PlanOpts = {}): Plan {
  const P = prepare(p, es, ctx, opts), { L0, cand, fut, sea, terms, lim, baseLoad, canIn, fm, order, minOf } = P;
  type Cand = typeof cand[number];

  // ── 하한·용량(보고용). 서로 겹치지 않는 칸들의 '최소로 더 들어야 할 학점' 합. 필요조건일 뿐 충분조건은 아니다 ──
  const totalOf = (L: Leaf[]) => L.find(l => l.total && l.program === P.progs[0]?.id);
  const total0 = totalOf(L0);
  const lbMin = fut.reduce((a, t) => a + Math.max(0, minOf(t) - baseLoad[t]), 0);
  const pool = [...cand.map(c => c.it), ...P.base.items.filter(it => !it.out)];
  const minCr = (fs: Filter[]) => Math.min(...cand.filter(c => fs.some(f => fm(c.it, f))).map(c => c.cr), Infinity);
  type Need = { fs: Filter[]; cr: number };
  const needs: Need[] = [], groups = new Map<object, Leaf[]>();
  for (const l of L0.filter((l, i) => l.program === P.progs[0]?.id && !l.total && l.need > l.have && cand.some(c => c.M[i]))) { // 들을 과목이 없는 칸(예: 다전공 데이터 없음)은 하한에서 뺀다
    if (l.group) { (groups.get(l.group) || groups.set(l.group, []).get(l.group)!).push(l); continue; }
    const cr = l.kind === 'credits' ? l.need - l.have : (l.need - l.have) * minCr([l.of]);
    if (Number.isFinite(cr)) needs.push({ fs: [l.of], cr });
  }
  for (const [g, ls] of groups) { const k = (g as { rem: number }).rem, cr = k * Math.min(...ls.map(l => minCr([l.of])));
    if (k > 0 && Number.isFinite(cr)) needs.push({ fs: ls.map(l => l.of), cr }); }
  // 겹침 표를 한 번만 만든다(칸 × 과목 소속 → 두 칸이 같은 과목을 공유하는지)
  const memb = needs.map(d => pool.map(it => d.fs.some(f => fm(it, f))));
  const apart = needs.map((_, a) => needs.map((_, b) => !memb[a].some((x, j) => x && memb[b][j])));
  let lbCat = 0;
  if (needs.length <= 14) for (let m = 1; m < 1 << needs.length; m++) {
    let ok = true, s = 0; for (let a = 0; a < needs.length && ok; a++) if (m >> a & 1) { s += needs[a].cr; for (let b = a + 1; b < needs.length; b++) if (m >> b & 1 && !apart[a][b]) { ok = false; break; } }
    if (ok) lbCat = Math.max(lbCat, s); }
  const lb = Math.max(total0 ? Math.max(0, total0.need - total0.have) : 0, lbMin, lbCat);
  const capacity = terms.reduce((a, t) => a + Math.max(0, lim[t] - baseLoad[t]), 0);

  // ── 정확 풀이(정수계획) ──
  function exact(): { out: PlanRow[]; info: Exact } | null {
    if (!highs || opts.exact === false) return null;
    const t0 = performance.now(), obj: string[] = [], cons: string[] = [], bin: string[] = [], ints: string[] = [], bnd: string[] = [];
    const num = (v: number) => (Math.round(v * 1e6) / 1e6).toString();
    const sum = (ts: [number, string][]) => ts.filter(([c]) => c !== 0).map(([c, v], i) => `${c < 0 ? '-' : i ? '+' : ''} ${num(Math.abs(c))} ${v}`).join(' ') || '0 zero';
    // 대칭 제거: 모델에 들어가는 성질(학점·채우는 칸·계절 가능·전공·개설 학기·관심·권장 학기)이 모두 같은 후보는 구별되지 않으므로
    // "그 묶음에서 학기 t에 몇 과목" 정수 변수 하나로 바꾼다. 해 공간이 같아 정확성은 그대로이고 변수가 크게 준다
    const cls = new Map<string, Cand[]>();
    for (const c of cand) { const k = [c.cr, c.M.map(b => +b).join(''), +c.seaOk, +c.major, c.halves ? [...c.halves].sort().join('') : '*', +c.interest, c.defOrd ?? ''].join('|');
      (cls.get(k) || cls.set(k, []).get(k)!).push(c); }
    const K = [...cls.values()], X: [number, Term, string][] = []; // [묶음 번호, 학기, 변수]
    K.forEach((g, i) => { const c = g[0]; terms.forEach((t, k) => { if (!canIn(c, t)) return; const v = `n${i}_${k}`; X.push([i, t, v]);
      if (g.length === 1) bin.push(v); else { ints.push(v); bnd.push(`0 <= ${v} <= ${g.length}`); }
      // ④ 취향(합쳐도 1학점보다 훨씬 작게): 계절학기 0.0005, 권장 학기에서 떨어진 학기 수 × 0.0001, 관심 트랙 −0.0002
      const dev = c.defOrd ? Math.abs((P.ordOf.get(t) ?? (P.ordOf.get(t.slice(0, 4) + (t.endsWith('S') ? '-1' : '-2')) ?? 0) + 0.5) - Math.max(c.defOrd, P.nowOrd + 1)) : 0;
      obj.push(`+ ${num(c.cr + (isSea(t) ? 0.0005 : 0) + 0.0001 * dev - (c.interest ? 0.0002 : 0) + 0.00001)} ${v}`); }); }); // ③ 추천 학점(0학점 과목도 아주 작은 비용)
    K.forEach((g, i) => { const vs = X.filter(x => x[0] === i).map(x => x[2]); if (vs.length > 1 || g.length > 1) cons.push(`once${i}: ${vs.join(' + ') || '0 zero'} <= ${g.length}`); });
    terms.forEach((t, k) => { const ts = X.filter(x => x[1] === t && K[x[0]][0].cr > 0).map(([i, , v]) => [K[i][0].cr, v] as [number, string]); if (!ts.length) return;
      cons.push(`cap${k}: ${sum(ts)} <= ${num(Math.max(0, lim[t] - baseLoad[t]))}`);
      const mn = isSea(t) ? 0 : minOf(t) - baseLoad[t];
      if (mn > 0) { cons.push(`min${k}: ${sum(ts)} + m${k} >= ${num(mn)}`); obj.push(`+ 10 m${k}`); } });           // ② 학기 최소학점(약한 제약)
    const slackName = new Map<string, string>(), coef = (l: Leaf, c: Cand) => (l.kind === 'credits' ? c.cr : 1);
    const terms4 = (i: number) => X.filter(([g]) => K[g][0].M[i]).map(([g, , v]) => [coef(L0[i], K[g][0]), v] as [number, string]);
    const grp = new Map<object, number[]>();
    L0.forEach((l, i) => { if (l.rem <= 0) return; if (l.group) { (grp.get(l.group) || grp.set(l.group, []).get(l.group)!).push(i); return; }
      const s = `s${i}`; slackName.set(`${l.program}.${l.id}`, s);
      cons.push(`r${i}: ${sum(terms4(i))} + ${s} >= ${num(l.rem)}`); obj.push(`+ ${num(1000 * UNIT[l.kind] * imp(l.w))} ${s}`); }); // ① 요건 부족분
    let gi = 0;
    for (const [g, idx] of grp) { const need = (g as { rem: number }).rem; if (need <= 0) continue; gi++;
      const ys = idx.map(i => { const y = `y${i}`; bin.push(y); cons.push(`g${i}: ${sum(terms4(i))} - ${num(L0[i].rem)} ${y} >= 0`); return y; });
      const s = `sg${gi}`, any = L0[idx[0]], prog = any.program;
      // 묶음 id는 평가기 결과에서 그 하위 칸의 부모 id(예: 'bal')
      const parent = P.base.programs.find(x => x.id === prog)!.result, findParent = (r: Result): Result | undefined => r.children?.some(ch => ch.id === any.id) ? r : r.children?.map(findParent).find(Boolean);
      slackName.set(`${prog}.${findParent(parent)?.id}`, s);
      cons.push(`gs${gi}: ${ys.join(' + ')} + ${s} >= ${need}`); obj.push(`+ ${num(1000 * UNIT.group * imp(Math.max(...idx.map(i => L0[i].w))))} ${s}`); }
    const lp = `Minimize\n obj: ${obj.join(' ').replace(/^\+ /, '') || '0 zero'}\nSubject To\n${cons.map(c => ' ' + c).join('\n')}\n`
      + (bnd.length ? `Bounds\n${bnd.map(b => ' ' + b).join('\n')}\n` : '') + (ints.length ? `Generals\n ${ints.join(' ')}\n` : '') + (bin.length ? `Binaries\n ${bin.join(' ')}\n` : '') + 'End';
    let r;
    // 허용 간격 0.5: 부족분(×1000 이상)·최소학점(×10)·학점(×1) 차이는 정수라 더 나은 해는 목적값이 최소 1 − 0.06(취향 합 상한)만큼 작다.
    // 그래서 0.5 간격에서 멈춰도 ①~③은 정확히 최적이고, ④ 취향(동점 처리)만 최선 노력이 된다
    try { r = highs.solve(lp, { output_flag: false, time_limit: opts.timeLimit ?? 1, mip_rel_gap: 0, mip_abs_gap: 0.5 }); } catch { return null; }
    const hasSol = r.Status === 'Optimal' || (r.Status === 'Time limit reached' && Object.values(r.Columns).some((c: any) => c.Primal != null));
    if (!hasSol) return null;
    // 묶음 → 실제 과목: 같은 묶음 안에서는 후보 순서대로(구별되지 않으므로 어느 과목이든 같은 판정)
    const out: PlanRow[] = [], next = new Map<number, number>();
    for (const [i, t, v] of X) { const cnt = Math.round((r.Columns[v] as any)?.Primal ?? 0);
      for (let j = 0; j < cnt; j++) { const at = next.get(i) ?? 0, c = K[i][at]; next.set(i, at + 1);
        out.push({ term: t, code: c.row.c, name: c.it.name, cr: c.cr, why: L0.filter((l, li) => c.M[li] && l.rem > 0).map(l => l.id) }); } }
    const slack: Record<string, number> = {};
    for (const [k, s] of slackName) slack[k] = Math.round(((r.Columns[s] as any)?.Primal ?? 0) * 1e6) / 1e6;
    return { out, info: { status: r.Status, optimal: r.Status === 'Optimal', ms: performance.now() - t0, slack } };
  }

  // ── 대체: 가중 탐욕(현재 앱 수뭉이 순서) → 1과목 수리 ──
  function greedy() {
    const L = cloneL(L0), load = { ...baseLoad }, used = new Set<Cand>(), out: PlanRow[] = [], totalL = totalOf(L);
    const fits = (c: Cand, t: Term) => load[t] + c.cr <= lim[t] && canIn(c, t);
    // 학기 고르기(현재 앱 place 순서: 원하는 학기 → 권장 학기 → 가장 덜 찬 정규학기)
    const place = (c: Cand, want?: Term, regOnly = false) => {
      const ok = (regOnly ? fut : terms).filter(t => fits(c, t)); if (!ok.length) return null;
      if (want && ok.includes(want)) return want; if (c.def && ok.includes(c.def)) return c.def;
      const reg = ok.filter(t => !isSea(t)), pl = reg.length ? reg : ok;
      return pl.slice().sort((a, b) => load[a] - load[b] || order(a) - order(b))[0];
    };
    const live = (l: Leaf) => l.rem > 0 && (!l.group || l.group.rem > 0);
    const add = (c: Cand, t: Term, why: string[]) => {
      used.add(c); load[t] += c.cr; out.push({ term: t, code: c.row.c, name: c.it.name, cr: c.cr, why });
      L.forEach((l, i) => { if (!c.M[i]) return; const was = l.rem > 0; l.rem -= l.kind === 'credits' ? c.cr : 1; if (was && l.rem <= 0 && l.group) l.group.rem--; });
    };
    const contrib = (c: Cand) => L.filter((l, i) => c.M[i] && live(l));
    const futDef = (c: Cand) => (c.defOrd ?? 0) > P.nowOrd ? 1 : 0, defK = (c: Cand) => (c.defOrd ? -c.defOrd : -9);
    // ① 특정 과목 요건(예: 캡스톤): 권장 학기에 먼저
    for (const l of L.filter(l => l.kind === 'courses' && l.of.codes && !l.of.names && live(l)))
      for (const c of cand.filter(c => !used.has(c) && c.M[L.indexOf(l)])) { if (!live(l)) break; const t = place(c, c.def, true); if (t) add(c, t, contrib(c).map(x => x.id)); }
    // ② 여러 요건을 함께 채우는 과목부터(가중치 합이 큰 순)
    const gt = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
    const skipped = new Set<Cand>();
    for (let guard = 0; guard < 400; guard++) {
      let best: Cand | null = null, bk: number[] = [];
      for (const c of cand) { if (used.has(c) || skipped.has(c)) continue; const sc = contrib(c).reduce((a, l) => a + l.w, 0); if (!sc) continue;
        const k = [sc, c.interest ? 1 : 0, futDef(c), defK(c), c.cr]; if (!best || gt(k, bk)) { best = c; bk = k; } }
      if (!best) break;
      const t = place(best); if (!t) { skipped.add(best); continue; }
      add(best, t, contrib(best).map(l => l.id));
    }
    // ③ 남은 졸업학점 ④ 학기 최소 신청학점
    const fit = (cr: number, want: number) => (cr >= want ? 100 - (cr - want) : cr);
    const filler = (want: number) => cand.filter(c => !used.has(c)).sort((a, b) => +b.interest - +a.interest || +b.major - +a.major || futDef(b) - futDef(a) || fit(b.cr, want || 3) - fit(a.cr, want || 3) || (a.defOrd ?? 9) - (b.defOrd ?? 9));
    for (let guard = 0; guard < 60 && totalL && totalL.rem > 0; guard++) {
      const F = filler(totalL.rem); let hit: [Cand, Term] | null = null;
      for (const t of fut.slice().sort((a, b) => load[a] - load[b] || order(a) - order(b))) { const c = F.find(c => fits(c, t)); if (c) { hit = [c, t]; break; } }
      if (!hit) for (const c of F) { const t = sea.find(t => fits(c, t)); if (t) { hit = [c, t]; break; } }
      if (!hit) break; add(hit[0], hit[1], ['total']);
    }
    for (const t of fut) for (let g = 0; g < 12 && load[t] < minOf(t); g++) { const c = filler(minOf(t) - load[t]).find(c => fits(c, t)); if (!c) break; add(c, t, ['min']); }
    // 검산 → 1과목 수리(평가 40번까지)
    let after = audit(p, P.withRows(out), ctx), fails = P.failing(after), repaired = 0, budget = 40;
    for (let round = 0; round < 6 && fails.length && budget > 0; round++) {
      const idx = P.leafIdx(fails[0]); let fixed = false;
      for (const c of cand.filter(c => !used.has(c) && idx.some(i => c.M[i])).slice(0, 20)) {
        const t = place(c), tries: PlanRow[][] = t ? [[...out, { term: t, code: c.row.c, name: c.it.name, cr: c.cr, why: ['repair'] }]] : [];
        for (const r of out) { if (tries.length >= 8) break; if (load[r.term] - r.cr + c.cr > lim[r.term] || !canIn(c, r.term)) continue;
          tries.push(out.map(x => x === r ? { term: r.term, code: c.row.c, name: c.it.name, cr: c.cr, why: ['repair'] } : x)); }
        for (const rs of tries) { if (budget-- <= 0) break; const a = audit(p, P.withRows(rs), ctx), fs2 = P.failing(a);
          if (fs2.length < fails.length) { out.length = 0; out.push(...rs); after = a; fails = fs2; repaired++; fixed = true;
            used.clear(); rs.forEach(r => { const cc = cand.find(x => x.row.c === r.code); if (cc) used.add(cc); });
            Object.keys(load).forEach(tt => { load[tt] = baseLoad[tt] + rs.filter(r => r.term === tt).reduce((a2, r) => a2 + r.cr, 0); }); break; } }
        if (fixed) break;
      }
      if (!fixed) break;
    }
    return { out, repaired };
  }

  const ex = exact(), g = ex ? null : greedy(), out = ex ? ex.out : g!.out;
  const after = audit(p, P.withRows(out), ctx), fails = P.failing(after);
  const load = { ...baseLoad }; out.forEach(r => { load[r.term] += r.cr; });
  // 미충족 사유. reachable: 들을 수 있는 과목을 모두 들으면(학기 용량 무시, 개설 학기는 고려) 채워지는가. false면 데이터상 불가
  const avail = (i: number) => cand.filter(c => c.M[i] && terms.some(t => canIn(c, t) && c.cr <= lim[t])).reduce((a, c) => a + (L0[i].kind === 'credits' ? c.cr : 1), 0) >= L0[i].need - L0[i].have;
  const unmet: Unmet[] = fails.map(f => { const idx = P.leafIdx(f);
    const reachable = f.r.kind === 'all' ? f.r.have + idx.filter(avail).length >= f.r.need : idx.every(avail);
    return { program: f.program, id: f.r.id, label: f.r.label, gap: f.r.need - f.r.have, reachable }; });
  out.sort((a, b) => order(a.term) - order(b.term));
  // 바꾸기 후보(키 '학기|학수번호'): 추천 과목이 채우는 요건 칸(졸업 학점 제외)을 모두 채우고, 학점이 같거나 많고,
  // 그 학기에 들을 수 있고 학기 상한을 넘지 않는 다른 후보. 그래서 바꿔도 요건 판정은 나빠지지 않는다
  const inOut = new Set(out.map(r => r.code)), byCode = new Map(cand.map(c => [c.row.c, c])), alts: Record<string, Alt[]> = {};
  for (const r of out) { const c = byCode.get(r.code); if (!c) continue;
    r.keys = L0.filter((l, i) => c.M[i] && l.rem > 0).map(l => `${l.program}.${l.id}`);
    const need = L0.map((l, i) => (c.M[i] && l.rem > 0 && !l.total ? i : -1)).filter(i => i >= 0);
    const xs = cand.filter(x => x !== c && !inOut.has(x.row.c) && x.cr >= c.cr && canIn(x, r.term) && load[r.term] - c.cr + x.cr <= lim[r.term]
      && need.every(i => x.M[i]) && (need.length > 0 || x.major === c.major))
      .sort((a, b) => +b.interest - +a.interest || a.cr - b.cr || (a.defOrd ?? 99) - (b.defOrd ?? 99)).slice(0, 12);
    if (xs.length) alts[`${r.term}|${r.code}`] = xs.map(x => ({ code: x.row.c, name: x.it.name, cr: x.cr })); }
  return { alts, rows: out, fut, sea, load, lim, lb, capacity, unmet, shortfall: P.shortfall(fails), after, repaired: g?.repaired ?? 0,
    strategy: ex ? 'milp' : 'greedy', ...(ex ? { exact: ex.info } : {}) };
}
