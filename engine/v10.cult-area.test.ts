// 교양 영역은 샘물 이수 당시 교양영역(cultArea)으로 정한다. 카탈로그에서 없어진 과목도 학교 기록대로 센다(0016 갱신 2026-10-29)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { audit, find } from './audit.ts';
import type { Enrollment, Profile } from './types.ts';

const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const p: Profile = { univ: 'smu-cheonan', catalogYear: 2022, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: 'green', role: 'primary' }], now: '2026-2', leaves: [], checks: {} };
const r = (es: Enrollment[]) => audit(p, es, ctx).programs[0].result;
// 지금 카탈로그에 없는 과목(학수번호는 가짜)
const gone: Enrollment[] = [
  { code: 'HBZZ9001', name: '인간과시간', credits: 2, category: '교선', grade: 'A0', term: '2022-1', cultArea: '핵심(윤리실천역량)' },
  { code: 'HBZZ9002', name: '물리현상의이해', credits: 3, category: '교선', grade: 'A0', term: '2022-2', cultArea: '균형(자연)' },
];

test('카탈로그에 없는 과목도 샘물 교양영역으로 핵심·균형을 센다', () => {
  const x = r(gone);
  assert.equal(find(x, 'core')!.have, 1);
  assert.equal(find(x, 'bal')!.have, 1);
  assert.equal(find(r(gone.map(({ cultArea, ...e }) => e)), 'core')!.have, 0); // 고치기 전 동작: 영역이 없어 못 셌다
});

test('직접 고친 영역이 샘물 값보다, 모르는 샘물 값은 카탈로그로', () => {
  assert.equal(find(r([{ ...gone[0], area: '일반교양' }]), 'core')!.have, 0);
  assert.equal(find(r([{ ...gone[0], cultArea: '균형교양' }]), 'core')!.have, 0); // 대응 없는 이름 + 카탈로그에도 없음
});
