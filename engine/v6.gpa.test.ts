// 평점평균 자동 계산: 4.5 만점 학점 가중 평균, P는 빼고, 재수강한 F는 빼고, 계산값이 평점 요건에 들어간다
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { audit, find } from './audit.ts';
import type { Profile } from './types.ts';

const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const p: Profile = { univ: 'smu-cheonan', catalogYear: 2023, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: 'smkorean', role: 'primary' }], now: '2025-1', leaves: [], checks: { gpa: 4.5 } };

test('성적으로 평점평균과 학기 평점을 계산하고 평점 요건에 넣는다', () => {
  const a = audit(p, [
    { code: 'HBHA4373', term: '2023-1', grade: 'A+', credits: 3 },
    { code: 'HBHA4387', term: '2023-1', grade: 'F', credits: 3 },
    { code: 'HBLG9001', term: '2023-1', grade: 'P', credits: 1 },
    { code: 'HBHA4387', term: '2023-2', grade: 'B0', credits: 3 }, // F 재수강
    { code: 'HBHA1011', term: '2023-2', grade: 'C+', credits: 3 },
    { code: 'HBHA2192', term: '2025-1', credits: 3, planned: true },
  ], ctx);
  assert.ok(a.gpa);
  assert.equal(a.gpa.cr, 9); // A+ 3 + B0 3 + C+ 3 (F는 재수강으로 빠지고 P·계획은 뺀다)
  assert.equal(a.gpa.gpa, (4.5 + 3 + 2.5) / 3);
  assert.deepEqual(a.gpa.terms['2023-1'], { gpa: 4.5 / 2, cr: 6 }); // 학기 평점은 그 학기 성적표 그대로(F 포함)
  const r = find(a.programs[0].result, 'gpa');
  assert.equal(r?.have, a.gpa.gpa); // 직접 넣은 4.5보다 계산값이 우선
});

test('재수강하지 않은 F는 평점에 남고, 성적이 없으면 직접 넣은 값을 쓴다', () => {
  const a = audit(p, [{ code: 'HBHA4373', term: '2023-1', grade: 'A0', credits: 3 }, { code: 'HBHA4387', term: '2023-1', grade: 'F', credits: 3 }], ctx);
  assert.equal(a.gpa?.gpa, 2);
  const b = audit(p, [{ code: 'HBHA4373', term: '2023-1', grade: 'P', credits: 3 }], ctx);
  assert.equal(b.gpa, undefined);
  assert.equal(find(b.programs[0].result, 'gpa')?.have, 4.5);
});
