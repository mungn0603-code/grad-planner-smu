// 샘물 이수구분 코드표(dsCmpDivRcd, 2026-11-22 확인, 이슈 #89)의 이름이 모두 이수구분 표에 있어야 한다.
// 표에 없으면 그 과목은 어느 요건에도 들어가지 않는다(사용조사: 다전공 2전심 과목이 전공 학점에서 빠짐)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { resolve, audit } from './audit.ts';
import type { Profile, Result } from './types.ts';

const SMUL = ['교필', '교선', '교기', '1전필', '1전선', '2전필', '2전선', '3전필', '3전선', '4전필', '4전선', '1전심', '2전심', '3전심', '4전심',
  '1교직', '2교직', '3교직', '부교직', '2부교직', '4교직', '1MD', '2MD', '3MD', '1부필', '1부선', '2부필', '2부선', '1부심', '2부심', '일선',
  '1학기', '2학기', '3학기', '1부학기', '2부학기', '4학기', '복필', '복선', '연필', '연선', '2연필', '2연선', '융필', '융선', '2융필', '2융선', '전적대학이수학점'];
const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));

test('샘물 이수구분 코드표 48개가 모두 표에 있다', () => {
  assert.deepEqual(SMUL.filter(c => !(c in ctx.univ.categories)), []);
});

test('다전공 2전심·주전공 1학기(학부기초) 과목이 전공 학점으로 들어간다', () => {
  const p: Profile = { univ: 'smu-cheonan', catalogYear: 2023, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: 'software', role: 'primary' }], now: '2026-2', leaves: [], checks: {} };
  const { items, warnings } = resolve(p, [{ name: '가', category: '2전심', credits: 3, term: '2025-1', grade: 'A0' }, { name: '나', category: '1학기', credits: 3, term: '2023-1', grade: 'A0' }], ctx);
  assert.deepEqual(warnings, []);
  assert.ok(items[0].tags.has('major2') && items[0].tags.has('m2.dept'));
  assert.ok(items[1].tags.has('major'));
});

test('과목명이 바뀐 교양필수도 샘물 교양영역 이름으로 그 칸을 채운다', () => {
  const p: Profile = { univ: 'smu-cheonan', catalogYear: 2023, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: 'green', role: 'primary' }], now: '2026-2', leaves: [], checks: {} };
  const find = (r: Result): Result | undefined => r.label === '알고리즘과게임콘텐츠' ? r : r.children?.map(find).find(Boolean);
  const got = (cultArea?: string) => find(audit(p, [{ name: '바뀐 이름의 알고리즘 과목', category: '교필', credits: 2, term: '2023-1', grade: 'A0', ...(cultArea ? { cultArea } : {}) }], ctx).programs[0].result)!;
  assert.equal(got().ok, false);
  assert.equal(got('기초(알고리즘과게임콘텐츠)').ok, true);
});
