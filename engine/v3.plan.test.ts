// V3: 추천 품질을 최적해 기준으로 판정한다. 같은 입력으로 세 계획을 같은 척도(가중 부족분, plan.ts UNIT·imp)로 채점:
//   E = 정수계획(기본), G = 가중 탐욕(대체용), L = 현재 앱 V44 수뭉이 결과(oracle/expected)
// (a) 학기 최대·개설 학기·계절학기·추천 제외 규칙 위반 0
// (b) 시간 안에 최적 증명 ≥ 99%
// (c) 모델 일치: 풀이기가 본 칸별 부족분 = 평가기가 판정한 칸별 부족분(최적 사례 100%)
// (d) 지배: E 부족분 ≤ L 부족분(현재 앱 계획이 유효할 때), E ≤ G (최적 사례 100%)
// (e) 전체 계획 p95 < 200ms
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadUniv, ROOT } from './load.node.ts';
import { resolve, match } from './audit.ts';
import { fromLegacy, termOfSlot } from './fromLegacy.ts';
import { plan, score, type Plan } from './plan.ts';

const EXP = path.join(ROOT, 'oracle', 'expected');
const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const files = fs.existsSync(EXP) ? fs.readdirSync(EXP).filter(f => f.endsWith('.json')) : [];
const EVERY = +(process.env.V3_EVERY || 1); // 디버깅용 표본: n건마다 1건
const pct = (a: number, b: number) => (b ? Math.round(a / b * 1000) / 10 : 100);
const EPS = 1e-6;

// 현재 앱 수뭉이는 개설 학기를 학년·학기 칸(3-1 → 1학기)으로 본다. 휴학으로 칸이 다른 학기에 오면 열리지 않는 학기에 과목을 넣는다(무효 계획)
function offHalf(c: any, cat: any): string[] {
  const eds = Object.keys(cat.editions).sort(), last = new Map((cat.editions[eds[eds.length - 1]] as any[]).map(r => [r.c, r]));
  return c.plan.rows.filter((r: any) => { const row = last.get(r.c); if (!row?.s || /s$/.test(r.slot)) return false;
    const t = termOfSlot(r.slot, String(c.state.year), c.state.termMap || {}), hs = new Set([row.s, ...String(row.alt || '').split(',').filter(Boolean).map((a: string) => +a.split('-')[1])]);
    return t && !hs.has(+t.split('-')[1]); }).map((r: any) => r.c);
}
function hardOk(P: Plan, profile: any): boolean {
  const items = resolve(profile, P.rows.map(r => ({ code: r.code, planned: true as const })), ctx).items, pol = ctx.univ.policy;
  const cat = (code: string) => Object.values(ctx.catalogs).map(c => { const e = Object.keys(c.editions).sort().pop()!; return c.editions[e].find(r => r.c === code); }).find(Boolean);
  const base = (t: string) => P.load[t] - P.rows.filter(r => r.term === t).reduce((a, r) => a + r.cr, 0);
  return P.rows.every((r, i) => { const it = items[i], sea = /-[SW]$/.test(r.term), row = cat(r.code);
    const halves = row?.s ? new Set([row.s, ...String(row.alt || '').split(',').filter(Boolean).map(a => +a.split('-')[1])]) : null;
    return (P.fut.includes(r.term) || P.sea.includes(r.term)) && (sea ? !it.tags.has('major') && match(it, pol.season.offered) : !halves || halves.has(+r.term.split('-')[1]))
      && !pol.noPlan.some(f => f.tags && !f.names && match(it, f)) && !pol.noPlan.concat(pol.intlOnly).some(f => f.names?.includes(r.name)); })
    && [...P.fut, ...P.sea].every(t => !P.rows.some(r => r.term === t) || P.load[t] <= Math.max(P.lim[t], base(t)));
}

test('V3 추천 품질(최적해 기준)', { skip: !files.length && 'oracle/expected 없음' }, () => {
  let n = 0, k = 0, hardBad = 0, optimal = 0, milp = 0, consBad = 0, domL = 0, domLN = 0, domG = 0, gWorse = 0, lWorse = 0, anyE = 0, anyL = 0;
  const times: number[] = [], solveMs: number[] = [], ex: string[] = [], extra: number[] = [];
  for (const f of files) {
    const { static: st, cases } = JSON.parse(fs.readFileSync(path.join(EXP, f), 'utf8'));
    const Lg = { univ: 'smu-cheonan', dept: ctx.catalogs[st.id], tracks: st.TRK.map((_: string, i: number) => `cdr.${st.id}.${i}`), trackNames: st.TRK };
    for (const c of cases) {
      if (!c.plan.fut.length || k++ % EVERY) continue; n++;
      const { profile, enrollments } = fromLegacy(c.state, Lg);
      const opts = { tracks: c.tracks.map((t: string) => `cdr.${st.id}.${st.TRK.indexOf(t)}`), season: c.id.endsWith('|r80') };
      const t0 = performance.now(), E = plan(profile, enrollments, ctx, opts); times.push(performance.now() - t0);
      const G = plan(profile, enrollments, ctx, { ...opts, exact: false });
      if (E.strategy === 'milp') { milp++; solveMs.push(E.exact!.ms); }
      // (a)
      for (const [nm, P] of [['E', E], ['G', G]] as const) if (!hardOk(P, profile)) { hardBad++; if (ex.length < 8) ex.push(`하드 제약 ${nm} ${c.id}`); }
      if (!E.exact?.optimal) { if (ex.length < 12) ex.push(`최적 미증명 ${c.id}: ${E.exact?.status ?? '탐욕 대체'}`); continue; }
      optimal++;
      // (c) 칸별 부족분 일치
      const evalGap = new Map(E.unmet.map(u => [`${u.program}.${u.id}`, u.gap]));
      const solverGap = new Map(Object.entries(E.exact!.slack).filter(([, v]) => v > EPS));
      const same = evalGap.size === solverGap.size && [...evalGap].every(([key, g]) => Math.abs((solverGap.get(key) ?? -1) - g) < 1e-4);
      if (!same) { consBad++; if (ex.length < 16) ex.push(`모델 불일치 ${c.id}: 평가기 ${JSON.stringify([...evalGap])} / 풀이기 ${JSON.stringify([...solverGap])}`); }
      // (d) 지배
      if (G.shortfall + EPS < E.shortfall) { domG++; if (ex.length < 20) ex.push(`탐욕이 더 좋음 ${c.id}: E ${E.shortfall} G ${G.shortfall}`); }
      if (G.shortfall > E.shortfall + EPS) gWorse++;
      if (!offHalf(c, ctx.catalogs[st.id]).length) {
        domLN++;
        const L = score(profile, enrollments, ctx, opts, c.plan.rows.map((r: any) => ({ code: r.c, term: termOfSlot(r.slot, String(c.state.year), c.state.termMap || {})! })));
        if (L.shortfall + EPS < E.shortfall) { domL++; if (ex.length < 24) ex.push(`현재 앱이 더 좋음 ${c.id}: E ${E.shortfall} L ${L.shortfall} (L 미충족 ${L.fails})`); }
        if (L.shortfall > E.shortfall + EPS) lWorse++;
        if (L.fails.some(x => !x.endsWith('.ext'))) anyL++;
        if (E.unmet.some(u => u.id !== 'ext')) anyE++; // 같은 사례 집합에서 비교
      }
      extra.push(E.rows.reduce((a, r) => a + r.cr, 0) - E.lb);
    }
  }
  times.sort((a, b) => a - b); solveMs.sort((a, b) => a - b); extra.sort((a, b) => a - b);
  const q = (a: number[], x: number) => Math.round(a[Math.min(a.length - 1, Math.floor(a.length * x))] ?? NaN);
  console.log(JSON.stringify({ 사례: n, '(a)하드제약위반(E+G)': hardBad, '(b)최적증명': `${optimal}/${n} (${pct(optimal, n)}%)`, '풀이기 사용': milp,
    '(c)모델불일치': consBad, '(d)E가 현재앱보다 나쁨': `${domL}/${domLN}`, '(d)E가 탐욕보다 나쁨': domG,
    '탐욕이 최적보다 나쁨': `${gWorse} (${pct(gWorse, optimal)}%)`, '현재앱이 최적보다 나쁨': `${lWorse}/${domLN} (${pct(lWorse, domLN)}%)`,
    '요건 하나라도 못 채움 E/현재앱(같은 사례)': `${pct(anyE, domLN)}% / ${pct(anyL, domLN)}%`,
    '(e)전체 p50/p95 ms': [q(times, 0.5), q(times, 0.95)], '풀이 p50/p95/max ms': [q(solveMs, 0.5), q(solveMs, 0.95), q(solveMs, 1)],
    '하한 대비 추가 학점 p50/p90': [q(extra, 0.5), q(extra, 0.9)] }, null, 1));
  if (ex.length) console.log(ex.join('\n'));
  assert.equal(hardBad, 0, '(a)'); assert.ok(optimal >= n * 0.99, '(b)'); assert.equal(consBad, 0, '(c)');
  assert.equal(domL, 0, '(d) 현재 앱'); assert.equal(domG, 0, '(d) 탐욕'); assert.ok(q(times, 0.95) < 200, '(e)');
});
