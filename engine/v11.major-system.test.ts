// V11: 전공제도(ADR 0024). 여러 전공제도를 동시에 판정하고 한 과목은 한 곳에만 센다. 입학유형별 기준은 학교 자료대로
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { audit, find } from './audit.ts';
import { plan } from './plan.ts';
import type { Catalog, Enrollment, Profile } from './types.ts';

const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const P: Profile = { univ: 'smu-cheonan', catalogYear: 2023, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: 'software', role: 'primary' }], now: '2026-2', leaves: [], checks: {} };
const take = (codes: string[], category: string, credits = 3): Enrollment[] => codes.map(code => ({ code, credits, category, term: '2025-1' }));
const res = (p: Profile, es: Enrollment[], id: string) => audit(p, es, ctx).programs.find(x => x.id === id)!.result;
const need = (p: Profile, id: string) => find(res(p, [], p.programs[0].id), id)?.need;

// 그린화학공학과에만 있는 과목 36학점, 건설시스템공학과에만 있는 과목(두 학과·소프트웨어학과의 모든 판에서 겹치지 않는 것)
const GREEN = ['HBEC0029', 'HBEC0033', 'HBEC0021', 'HBEC0030', 'HBEC0031', 'HBEC0010', 'HBEC0011', 'HBEC0045', 'HBJG4116', 'HBJG4148', 'HBEC0041', 'HBEC0034'];
const green36 = take(GREEN, '2전선');
const CIVIL = ['HBJG1022', 'HBJG2052', 'HBJG2081', 'HBJG2093', 'HBJG2111', 'HBJG4133', 'HBJG3131'];
const codes = (id: string) => new Set(Object.values(ctx.catalogs[id].editions).flat().map(r => r.c));
test('테스트 과목이 학과끼리 겹치지 않는다', () => {
  const [g, c, s] = ['green', 'civil', 'software'].map(codes);
  assert.ok(GREEN.every(x => g.has(x) && !c.has(x) && !s.has(x)));
  assert.ok(CIVIL.every(x => c.has(x) && !g.has(x) && !s.has(x)));
});

test('MJ01 심화전공: 주전공 75, 전공심화 15', () => {
  assert.equal(need(P, 'major'), 75);
  assert.equal(need(P, 'deep'), 15);
});

test('MJ03 제2전공: 주전공 45, 다전공은 배정된 과목만 36', () => {
  const p: Profile = { ...P, programs: [...P.programs, { id: 'green', role: 'second' }] };
  assert.equal(need(p, 'major'), 45);
  const g = res(p, green36, 'green');
  assert.equal(g.ok, true);
  assert.equal(find(g, 'm2')!.have, 36);
  assert.equal(res(p, take(GREEN.slice(1), '2전선'), 'green').ok, false); // MJ07: 하나라도 모자라면 미충족
});

test('MJ04 제2전공 + 제3전공: 교육과정에 있는 쪽으로, 한 과목은 한 전공에만', () => {
  const p: Profile = { ...P, programs: [...P.programs, { id: 'green', role: 'second' }, { id: 'civil', role: 'second' }] };
  const es = [...green36, ...take(CIVIL, '2전선')];
  const a = audit(p, es, ctx), g = a.programs.find(x => x.id === 'green')!.result, c = a.programs.find(x => x.id === 'civil')!.result;
  assert.equal(find(g, 'm2')!.have, 36);
  assert.equal(find(c, 'm2')!.have, CIVIL.length * 3);
  assert.equal(c.ok, false);
  assert.equal(find(g, 'm2')!.have + find(c, 'm2')!.have, es.reduce((s, e) => s + e.credits!, 0)); // 두 번 세지 않는다
});

test('MJ05 제2전공 + 부전공: 주전공 45, 이수구분 종류로 나눈다', () => {
  const p: Profile = { ...P, programs: [...P.programs, { id: 'green', role: 'second' }, { id: 'civil', role: 'minor' }] };
  assert.equal(need(p, 'major'), 45);
  const es = [...green36, ...take(CIVIL, '1부선')];
  assert.equal(res(p, es, 'green').ok, true);
  const c = res(p, es, 'civil');
  assert.equal(find(c, 'm2')!.need, 21);
  assert.equal(c.ok, true);
});

test('MJ06 연계·융합전공: 교육과정 과목을 연선·융선으로 36학점이면 충족, 2024에만 있던 전공도 판정', () => {
  const latest = (id: string) => { const e = ctx.catalogs[id].editions; return e[Object.keys(e).sort().pop()!]; };
  const sw = codes('software');
  const story = latest('lk-storytelling').map(r => r.c).filter(c => !sw.has(c)).slice(0, 12);
  const p: Profile = { ...P, programs: [...P.programs, { id: 'lk-storytelling', role: 'second' }] };
  assert.equal(story.length, 12);
  assert.equal(find(res(p, take(story, '연선'), 'lk-storytelling'), 'm2')!.have, 36);
  assert.equal(res(p, take(story, '연선'), 'lk-storytelling').ok, true);
  const robot = latest('fu-robotai').map(r => r.c).filter(c => !sw.has(c)).slice(0, 12);
  const q: Profile = { ...P, programs: [...P.programs, { id: 'fu-robotai', role: 'second' }] };
  assert.equal(res(q, take(robot, '융선'), 'fu-robotai').ok, robot.length === 12);
  assert.ok(Object.keys(ctx.catalogs['fu-robotai'].editions).every(y => y <= '2025')); // 2026에는 없는 융합전공
});

test('MJ06b 제2전공 + 연계전공: 같은 과목도 이수구분 종류(2전선·연선)로 나눈다', () => {
  const p: Profile = { ...P, programs: [...P.programs, { id: 'green', role: 'second' }, { id: 'lk-globalculture', role: 'second' }] };
  const gc = codes('lk-globalculture');
  const shared = [...gc].find(c => codes('depenglish').has(c))!; // 영어권지역학 과목이면서 연계전공 교육과정
  const a = audit(p, [...green36, ...take([shared], '연선')], ctx);
  assert.equal(find(a.programs.find(x => x.id === 'lk-globalculture')!.result, 'm2')!.have, 3);
  assert.equal(find(a.programs.find(x => x.id === 'green')!.result, 'm2')!.have, 36);
  const b = audit(p, take([shared], '2전선'), ctx); // 다전공 이수구분이면 연계전공 교육과정에 있어도 제2전공으로
  assert.equal(find(b.programs.find(x => x.id === 'green')!.result, 'm2')!.have, 3);
  assert.equal(find(b.programs.find(x => x.id === 'lk-globalculture')!.result, 'm2')!.have, 0);
});

test('MJ08 마이크로전공: 두 묶음이 같은 과목을 쓰면 하나로만 센다', () => {
  const p: Profile = { ...P, programs: [...P.programs, { id: 'md', role: 'micro' }] };
  const protein = take(['HBEC0021', 'HBEC0006', 'HBEC0018', 'HBEC0010'], 'MD'), chem = take(['HBEC0029', 'HBEC0030', 'HBJG4148'], 'MD'); // 화학기초는 HBEC0010을 함께 쓴다
  assert.equal(res(p, [...protein, ...chem], 'md').ok, false);
  assert.equal(res(p, [...protein, ...take(['HBEA0043', 'HBEA0035', 'HBEA0026'], 'MD')], 'md').ok, true);
});

test('MJ09 마이크로전공 2개로 채울 때 주전공 학점', () => {
  const m = (program: string, catalogYear: number) => need({ ...P, catalogYear, programs: [{ id: program, role: 'primary' }, { id: 'md', role: 'micro' }] }, 'major');
  assert.equal(m('software', 2023), 60);
  assert.equal(m('software', 2022), 74); // 2022학번 이전 공과대학
  assert.equal(m('me', 2022), 60);       // 경영공학과는 공과대학이지만 60
  assert.equal(m('nursing', 2023), 94);
});

test('MJ10 일반편입: 전공 60, 전공심화 해당없음, 교양 영역 확인 필요', () => {
  const p: Profile = { ...P, admission: 'transfer', startSemester: 5 };
  assert.equal(need(p, 'major'), 60);
  assert.equal(need(p, 'deep'), 0);
  assert.equal(need(p, 'total'), 130);
  assert.equal(find(res(p, [], 'software'), 'gearea')!.kind, 'check');
  const d: Profile = { ...p, programs: [...p.programs, { id: 'green', role: 'second' }] };
  assert.equal(need(d, 'major'), 45); // 편입생도 다전공은 할 수 있다
});

test('MJ11 학사편입: 총 65, 전공 60, 교양 없음', () => {
  const p: Profile = { ...P, admission: 'bachelor', startSemester: 5 };
  assert.equal(need(p, 'total'), 65);
  assert.equal(need(p, 'major'), 60);
  assert.equal(need(p, 'ge'), 0);
  assert.equal(find(res(p, [], 'software'), 'gearea'), undefined);
});

test('MJ12 외국인특별전형: 전공심화 해당없음, 한국어졸업인증 4급(예·능계열 3급)', () => {
  const p: Profile = { ...P, student: 'international' };
  assert.equal(need(p, 'deep'), 0);
  assert.equal(need(p, 'topik'), 4);
  assert.equal(need({ ...p, programs: [{ id: 'visual', role: 'primary' }] }, 'topik'), 3);
  assert.equal(need(P, 'topik'), undefined); // 내국인에게는 없다
});

test('MJ13 이수 의무 제외 표시(공학인증 등): 전공심화만 해당없음', () => {
  const p: Profile = { ...P, exempt: true };
  assert.equal(need(p, 'major'), 75);
  assert.equal(need(p, 'deep'), 0);
});

test('MJ14 자기설계융합전공: 학생이 넣은 교육과정으로 36, 같은 종류 다전공과 나눠 배정', () => {
  const own: Catalog = { id: 'ism', name: '자기설계융합전공', editions: { '2026': CIVIL.map(c => ({ c, n: c, cr: 3, t: '2전선' })) } };
  const p: Profile = { ...P, own, programs: [...P.programs, { id: 'green', role: 'second' }, { id: 'ism', role: 'second' }] };
  const a = audit(p, [...green36, ...take(CIVIL, '2전선')], ctx);
  assert.equal(find(a.programs.find(x => x.id === 'green')!.result, 'm2')!.have, 36);
  assert.equal(find(a.programs.find(x => x.id === 'ism')!.result, 'm2')!.have, CIVIL.length * 3);
});

test('추천: 다전공 교육과정에만 있는 과목을 다전공 이수구분으로 추천해 다전공 36을 채운다', () => {
  const p: Profile = { ...P, now: '2023-2', programs: [...P.programs, { id: 'green', role: 'second' }] };
  const r = plan(p, [], ctx);
  const g = codes('green'), s = codes('software');
  assert.ok(r.rows.filter(x => g.has(x.code) && !s.has(x.code)).length >= 12);
  assert.ok(!r.unmet.some(u => u.program === 'green'), JSON.stringify(r.unmet));
});
