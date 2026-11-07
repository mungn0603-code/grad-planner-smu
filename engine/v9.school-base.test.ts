// 샘물 학점이수상황표의 학생별 졸업 기준학점(Profile.vars)이 세트 숫자를 덮어쓰고, 편입생은 신입 세트의 교양 필수 영역을 확인 필요로 둔다
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { audit, find, reassign } from './audit.ts';
import type { Enrollment, Profile } from './types.ts';

const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const p: Profile = { univ: 'smu-cheonan', catalogYear: 2023, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: 'software', role: 'primary' }], now: '2026-2', leaves: [], checks: {} };
const es: Enrollment[] = [{ name: '전적대학 인정(일선)', credits: 65, category: '일선', src: 'transfer', lump: true }];
const r = (q: Profile) => audit(q, es, ctx).programs[0].result;

test('학교 기준 숫자는 세트에 있는 이름만 덮어쓴다', () => {
  assert.equal(find(r(p), 'total')!.need, 130);
  const x = r({ ...p, vars: { total: 120, major: 66, unknown: 1 } });
  assert.equal(find(x, 'total')!.need, 120);
  assert.equal(find(x, 'major')!.need, 66);
  assert.equal(find(x, 'deep')!.need, 15);          // 학교 값이 없으면 데이터 값
});

test('편입생: 교양 필수 영역은 확인 필요(ok:null), 졸업 학점은 인정학점과 함께 센다', () => {
  assert.notEqual(find(r(p), 'gearea')!.kind, 'check');
  const t = r({ ...p, admission: 'transfer', startSemester: 5, vars: { total: 130 } });
  const g = find(t, 'gearea')!;
  assert.equal(g.kind, 'check');
  assert.equal(g.ok, null);
  assert.equal(find(t, 'total')!.have, 65);
});

test('가정해 보기: 복수전공으로 바꾸면 주전공 45·다전공 36, 일선을 추가전공으로 바꾸면 다전공 학점에 든다', () => {
  const d: Profile = { ...p, programs: [{ id: 'software', role: 'primary' }, { id: 'ext', role: 'second' }] };
  const x = (category: string) => audit(d, [{ name: '다른 학과 전공', credits: 3, category, term: '2025-1' }], ctx).programs[0].result;
  assert.equal(find(x('일선'), 'major')!.need, 45);
  assert.equal(find(x('일선'), 'ext')!.need, 36);
  assert.equal(find(x('일선'), 'ext')!.have, 0);
  assert.equal(find(x('추가전공'), 'ext')!.have, 3);
  assert.equal(find(x('2전선'), 'ext')!.have, 3);
  assert.equal(find(x('1MD'), 'ext')!.have, 0);
  assert.equal(find(x('마이크로'), 'ext')!.have, 0);
  assert.equal(find(x('마이크로'), 'total')!.have, 3);
});

test('마이크로전공 2개 대체: 주전공 60·전공심화 0, MD로 모든 과목을 들은 마이크로전공이 2개면 충족', () => {
  const m: Profile = { ...p, programs: [{ id: 'software', role: 'primary' }, { id: 'md', role: 'micro' }] };
  const md = (codes: string[], category = '1MD') => codes.map(code => ({ code, credits: 3, category, term: '2025-1' }));
  const one = md(['HBEC0021', 'HBEC0006', 'HBEC0018', 'HBEC0010']), two = md(['HBEA0043', 'HBEA0035', 'HBEA0026']);
  const x = (es: Enrollment[]) => audit(m, es, ctx).programs;
  assert.equal(find(x(one)[0].result, 'major')!.need, 60);
  assert.equal(find(x(one)[0].result, 'deep')!.need, 0);
  assert.equal(x(one)[1].result.ok, false);
  assert.equal(x([...one, ...two])[1].result.ok, true);
  assert.equal(x([...one, ...md(['HBEA0043', 'HBEA0035', 'HBEA0026'], '일선')])[1].result.ok, false); // 일선으로 들은 과목은 정정 전까지 MD가 아니다
});

test('가정해 보기 자동 나누기: 먼저 고른 마이크로전공부터 한 과목은 한 곳에만, 다전공은 주전공 과목을 그대로 둔다', () => {
  const md = (id: string) => { const b = ctx.univ.blocks['md.all']; const r = ('all' in b ? b.all : []).find(x => x.id === id)!; return 'of' in r ? { codes: r.of.codes, names: r.of.names } : {}; };
  const es: Enrollment[] = ['HBRZ0001', 'HBRZ0002', 'HBRZ0003', 'HBRZ0005', 'HBRZ0006'].map(code => ({ code, credits: 3, category: '일선', term: '2025-1' }));
  const x = reassign(p, es, ctx, [{ cat: '1MD', of: md('md.bio-material') }, { cat: '2MD', of: md('md.bio-data') }]);
  assert.deepEqual(x, { 0: '1MD', 1: '1MD', 2: '1MD', 3: '1MD', 4: '2MD' });
  const y = reassign(p, [{ code: 'HBEC0010', credits: 3, category: '일선' }, { code: 'HBEC0010', credits: 3, category: '1전선' }], ctx, [{ cat: '2전선', of: { codes: ['HBEC0010'] }, keep: ['major'] }]);
  assert.deepEqual(y, { 0: '2전선' });
});
