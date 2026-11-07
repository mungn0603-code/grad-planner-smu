// 학교 학점이수상황표의 이수구분별 취득학점과 앱이 센 값 대조: 성적이 나온 기록만, F·재수강 이전·계획은 빼고 센다
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { resolve, cmpDiff } from './audit.ts';
import type { Enrollment, Profile } from './types.ts';

const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const p: Profile = { univ: 'smu-cheonan', catalogYear: 2023, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: 'software', role: 'primary' }], now: '2026-2', leaves: [], checks: {} };
const es: Enrollment[] = [
  { code: 'HBJO2173', category: '1전선', term: '2023-1', grade: 'F', credits: 3 },
  { code: 'HBJO2173', category: '1전선', term: '2023-2', grade: 'B0', credits: 3 }, // 재수강
  { code: 'HBJO2193', category: '1전선', term: '2023-1', grade: 'A0', credits: 3 },
  { name: '교양 과목', category: '교선', term: '2023-1', grade: 'P', credits: 2 },
  { code: 'HBJW0001', category: '1전선', term: '2026-2', credits: 3 },                // 수강 중(성적 없음)
];

test('학교 합계와 같으면 경고가 없고, 다르면 이수구분별로 알린다', () => {
  const { items } = resolve(p, es, ctx);
  assert.deepEqual(cmpDiff(items, es, { '1전선': 6, 교선: 2 }), []);
  const w = cmpDiff(items, es, { '1전선': 3, '1전심': 3, 교선: 2 }); // 학교는 한 과목을 1전심으로 판정
  assert.equal(w.length, 2);
  assert.match(w[0], /^1전선 .*학교 학점이수상황표 3학점, 앱 6학점/);
  assert.match(w[1], /^1전심 .*학교 학점이수상황표 3학점, 앱 0학점/);
});
