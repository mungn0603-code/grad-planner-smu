// V4: 새 입학년도·새 판(가짜 2027)과 과거 판(가짜 2021)을 데이터만 바꿔 추가해도 엔진이 맞게 판정하는지.
// 엔진 코드는 이 테스트에서 건드리지 않는다(데이터 사본만 고침).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { audit, find } from './audit.ts';
import { addEdition, addPastEdition } from '../etl/compose.ts';
import { plan } from './plan.ts';
import type { Profile, Enrollment, Rule, Row } from './types.ts';

const base = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const ctx = structuredClone(base);
const G = 'green', g26 = base.catalogs[G].editions['2026'];
const row = (c: string) => g26.find(r => r.c === c)!;
// 2027판: ① 코드·이름 변경 HBEC0005→HBEC9005 ② 분리 HBEC0027 → HBEC9027+HBEC9028 ③ 학점 변경 HBEC0024 3→2 ④ 신설 HBEC9999
const r27: Row[] = g26.filter(r => !['HBEC0005', 'HBEC0027'].includes(r.c)).map(r => r.c === 'HBEC0024' ? { ...r, cr: 2 } : r).concat([
  { ...row('HBEC0005'), c: 'HBEC9005', n: '캡스톤디자인Ⅰ(2027)' },
  { ...row('HBEC0027'), c: 'HBEC9027', n: '공정유체역학A', cr: 2 }, { ...row('HBEC0027'), c: 'HBEC9028', n: '공정유체역학B', cr: 2 },
  { c: 'HBEC9999', n: '그린수소공학', cr: 3, t: '1전심', y: 4, s: 1 }]);
ctx.catalogs[G] = addEdition(base.catalogs[G], '2027', r27, [
  { from: ['HBEC0005'], to: ['HBEC9005'], kind: '명칭 변경' }, { from: ['HBEC0027'], to: ['HBEC9027', 'HBEC9028'], kind: '분리' }]);
// 2021판(과거 확장): 2022판과 같다고 가정한 사본
ctx.catalogs[G] = addPastEdition(ctx.catalogs[G], '2021', base.catalogs[G].editions['2022'], []);
// 요건: 그린 2027 신입생은 새 세트(총 128), 2021학번 세트 추가, 소프트웨어학과는 2026에서 끝(2027 데이터 없음)
const green26 = ctx.univ.sets.find(s => s.program === G && s.years[1] === 2026 && s.when?.with === 'single')!;
const v27 = structuredClone(green26); v27.years = [2027, 2027]; ((v27.rule as any).all as any[]).forEach(u => { u.vars = { ...u.vars, total: 128 }; });
const v21 = structuredClone(ctx.univ.sets.find(s => s.program === G && s.years[0] === 2022 && s.when?.with === 'single')!); v21.years = [2021, 2021];
ctx.univ.sets.push(v27, v21);
ctx.univ.programs.test = { name: '시험 규칙', catalogs: [] };
// courses는 '수강 기록 수'를 센다. 분리된 두 과목을 각각 요구하려면 과목별 규칙으로 쓴다(B1·B2)
const needB: Rule = { all: [{ id: 'B', courses: 1, of: { codes: ['HBEC9005'] } }, { id: 'split', courses: 2, of: { codes: ['HBEC9027', 'HBEC9028'] } },
  { id: 'B1', courses: 1, of: { codes: ['HBEC9027'] } }, { id: 'B2', courses: 1, of: { codes: ['HBEC9028'] } }] };
ctx.univ.blocks.test = needB;
ctx.univ.sets.push({ program: 'test', years: [2021, 2027], rule: { use: 'test' }, src: 'V4 시험' });

const P = (y: number, extra: Partial<Profile> = {}): Profile => ({ univ: 'smu-cheonan', catalogYear: y, programs: [{ id: G, role: 'primary' }, { id: 'test', role: 'track' }],
  admission: 'freshman', student: 'domestic', startSemester: 1, leaves: [], checks: {}, ...extra });
const prim = (a: ReturnType<typeof audit>) => a.programs[0].result;

test('2027 신입생은 2027 요건(총 128)으로 판정', () => {
  const a = audit(P(2027), [{ code: 'HBEC9999', term: '2027-1' }], ctx);
  assert.equal(find(prim(a), 'total')!.need, 128);
  assert.equal(a.items[0].ed, '2027'); assert.equal(a.items[0].cr, 3); // 신설 과목은 2027판에서 읽힘
});

test('2025학번이 2027년에 들은 과목은 2027판 속성, 2026년에 들은 같은 과목은 2026판', () => {
  const a = audit(P(2025), [{ code: 'HBEC0024', term: '2027-1' }], ctx), b = audit(P(2025), [{ code: 'HBEC0024', term: '2026-1' }], ctx);
  assert.equal(a.items[0].ed, '2027'); assert.equal(a.items[0].cr, 2);
  assert.equal(b.items[0].ed, '2026'); assert.equal(b.items[0].cr, 3);
});

test('옛 과목 이수가 새 코드 요건을 충족(이름 변경·분리)', () => {
  const a = audit(P(2024), [{ code: 'HBEC0005', term: '2025-1' }, { code: 'HBEC0027', term: '2025-2' }], ctx);
  const t = a.programs[1].result;
  assert.equal(find(t, 'B')!.ok, true);
  assert.equal(find(t, 'split')!.have, 1); // 옛 과목 하나 = 수강 기록 하나
  assert.equal(find(t, 'B1')!.ok, true); assert.equal(find(t, 'B2')!.ok, true); // 분리된 두 과목을 각각 충족
  assert.ok(a.items[1].ids.has('HBEC9027') && a.items[1].ids.has('HBEC9028'));
});

test('옛 과목을 들었으면 대응하는 2027 새 과목은 추천하지 않는다', () => {
  const p = { ...P(2025), now: '2026-2', programs: [{ id: G, role: 'primary' as const }] };
  const r = plan(p, [{ code: 'HBEC0027', term: '2025-2' }, { code: 'HBEC0005', term: '2026-1' }], ctx).rows.map(x => x.code);
  for (const c of ['HBEC9027', 'HBEC9028', 'HBEC9005', 'HBEC0027', 'HBEC0005']) assert.ok(!r.includes(c), c);
  assert.ok(r.length > 0);
});

test('옛 과목이 덮는 새 분리 과목을 또 들으면 중복으로 뺀다', () => {
  const a = audit(P(2024), [{ code: 'HBEC0027', term: '2025-2' }, { code: 'HBEC9027', planned: true }], ctx);
  assert.equal(a.items[1].out, 'dup');
});

test('요건 데이터가 없는 연도는 조용히 대체하지 않고 ok:null', () => {
  const a = audit({ ...P(2027), programs: [{ id: 'software', role: 'primary' }] }, [], ctx);
  assert.equal(a.programs[0].result.ok, null); assert.match(a.programs[0].result.note!, /2027학번 미지원/);
});

test('2021판·2021학번 세트 추가로 과거 학번도 판정', () => {
  const c = ctx.catalogs[G].editions['2021'][0];
  const a = audit(P(2021), [{ code: c.c, term: '2021-1' }], ctx);
  assert.equal(a.items[0].ed, '2021'); assert.notEqual(prim(a).ok, undefined); assert.ok(find(prim(a), 'total')!.need > 0);
});

test('2027 추가 전 결과는 그대로(기존 학번 회귀 없음)', () => {
  const es: Enrollment[] = [{ code: 'HBEC0024', term: '2024-2' }, { code: 'HBEC0005', term: '2025-1' }];
  const before = audit(P(2023), es, base), after = audit(P(2023), es, ctx);
  assert.deepEqual(find(prim(after), 'total'), find(prim(before), 'total'));
  assert.deepEqual(find(prim(after), 'major'), find(prim(before), 'major'));
});
