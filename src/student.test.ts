// 샘물 학적 → 학생 정보(src/student.ts)와, 학점이수상황표의 학생별 기준이 다전공·부전공 세트에도 들어가는지
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from '../engine/load.node.ts';
import { audit, find } from '../engine/audit.ts';
import type { Profile } from '../engine/types.ts';
import { fromSmul } from './student.ts';

const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan')), u = ctx.univ;
const st = (entr: string, majors: [string, string][] = [], intl?: boolean) =>
  ({ name: '홍길동', dept: '소프트웨어학과', entr, majors: majors.map(([kind, name]) => ({ kind, name })), ...(intl == null ? {} : { intl }) });

test('학적의 다전공·연계·융합·부전공은 프로그램 id와 역할로, 이름을 못 찾으면 과목 데이터 없는 ext로', () => {
  const x = fromSmul(u, st('신입학', [['2전공', '공과대학 경영공학과'], ['연계전공', '디지털경영학연계전공'], ['융합전공', '빅데이터 융합전공'], ['부전공', '간호학과'], ['3전공', 'X123']]));
  assert.deepEqual(x.programs, [{ id: 'software', role: 'primary' }, { id: 'me', role: 'second' }, { id: 'lk-digitalbiz', role: 'second' },
    { id: 'fu-bigdata', role: 'second' }, { id: 'nursing', role: 'minor' }, { id: 'ext', role: 'second' }]);
  assert.deepEqual(fromSmul(u, st('신입학', [['2전공', '경영공학과']]), undefined, 'me').programs[0], { id: 'me', role: 'primary' }); // 학생이 고른 주전공이 먼저
});

test('학적의 마이크로전공은 신청이라 2개여도 이수 형태를 바꾸지 않는다(전공심화 그대로)', () => {
  const m: [string, string][] = [['마이크로전공', 'AI 데이터 마이크로전공'], ['마이크로전공', '바이오소재 마이크로전공']];
  const x = fromSmul(u, st('신입학', m), { MJR_CDT: 75, MJR_DEEP_CDT: 15 });
  assert.deepEqual(x.programs, [{ id: 'software', role: 'primary' }]);
  assert.deepEqual(x.vars, { major: 75, deep: 15 });
});

test('입학구분 → 편입·학사편입·신입, 외국인특별전형·외국 국적 → 유학생. 값이 없으면 비워 둔다', () => {
  const f = (entr: string, intl?: boolean) => { const x = fromSmul(u, st(entr, [], intl)); return [x.admission, x.student]; };
  assert.deepEqual(f('편입학'), ['transfer', undefined]);
  assert.deepEqual(f('학사편입학'), ['bachelor', undefined]);
  assert.deepEqual(f('신입학', false), ['freshman', 'domestic']);
  assert.deepEqual(f('외국인특별전형'), ['freshman', 'international']);
  assert.deepEqual(f('', true), [undefined, 'international']);
  assert.deepEqual(f(''), [undefined, undefined]);
});

test('학점이수상황표 기준: 주전공은 이수 형태별 열, 다전공·부전공 세트는 각자의 need를 샘물 값으로 덮어쓴다', () => {
  const base = { GRDT_CMP_CDT: 130, CULT_CDT: 33, MJR_CDT: 75, MJR_DEEP_CDT: 15, MMJR_MAIN_MJR_CDT: 45, MMJR_MJR_CDT: 40, MINOR_MAIN_MJR_CDT: 60, MINOR_MJR_CDT: 24, GP_AVG: 1.7 };
  const x = fromSmul(u, st('신입학', [['2전공', '경영공학과'], ['부전공', '간호학과']], false), base);
  assert.deepEqual(x.vars, { total: 130, ge: 33, major: 45, ext: 40 });
  assert.deepEqual(x.programs.slice(1).map(p => p.vars), [{ need: 40 }, { need: 24 }]);
  assert.deepEqual(fromSmul(u, st('신입학'), base).vars, { total: 130, ge: 33, major: 75, deep: 15 });
  const p: Profile = { univ: 'smu-cheonan', catalogYear: 2023, admission: 'freshman', student: 'domestic', startSemester: 1, leaves: [], checks: {}, ...x };
  const need = (id: string, q = p) => find(audit(q, [], ctx).programs.find(g => g.id === id)!.result, 'm2')!.need;
  assert.deepEqual([need('me'), need('nursing')], [40, 24]);
  const noBase = { ...p, ...fromSmul(u, st('신입학', [['2전공', '경영공학과'], ['부전공', '간호학과']])) };
  assert.deepEqual([need('me', noBase), need('nursing', noBase)], [36, 21]);   // 샘물 값이 없으면 학교 자료 숫자
  assert.equal(find(audit(p, [], ctx).programs[0].result, 'major')!.need, 45);
});
