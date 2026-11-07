// SM-CDR 비교과: 고른(가져온) 프로그램 하나가 그 이름이 든 모든 트랙의 비교과 요건에 들어간다. 휴학을 안 넣어도 지난 학기에 추천하지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { audit, find } from './audit.ts';
import { plan } from './plan.ts';
import type { Profile, Rule } from './types.ts';

const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const u = ctx.univ;
const listOf = (r: Rule): string[] | undefined => 'use' in r ? listOf(u.blocks[r.use]) : 'all' in r ? r.all.map(listOf).find(Boolean) : 'list' in r ? r.list : undefined;
const tracks = u.sets.filter(s => s.when?.role === 'track' || s.program.startsWith('cdr.')).map(s => ({ id: s.program, year: s.years[0], list: listOf(s.rule) ?? [] }));
const prof = (t: { id: string; year: number }, extra: Partial<Profile> = {}): Profile => ({ univ: 'smu-cheonan', catalogYear: t.year, admission: 'freshman', student: 'domestic', startSemester: 1,
  programs: [{ id: t.id, role: 'track' }], now: '2026-1', leaves: [], checks: {}, ...extra });
const ex = (p: Profile) => find(audit(p, [], ctx).programs[0].result, 'ex');

for (const name of ['상생플러스', '캡스톤디자인경진대회', 'WIDEEP공과대학선후배이어주기']) test(`비교과 '${name}'을 고르면 그 이름이 든 트랙 모두 충족`, () => {
  const has = tracks.filter(t => t.list.includes(name)), not = tracks.find(t => t.list.length && !t.list.includes(name))!;
  assert.ok(has.length > 1);
  for (const t of has) assert.equal(ex(prof(t, { done: [name.replace('WIDEEP', 'WIDEEP ')] }))?.ok, true, t.id); // 띄어쓰기가 달라도 같은 프로그램
  assert.equal(ex(prof(not, { done: [name] }))?.ok, false);
  assert.equal(ex(prof(not))?.ok, null); // 고른 것도 입력도 없으면 '입력 필요'
});

test('휴학을 안 넣어 8학기가 현재 학기보다 먼저 끝나도 지난 학기에 추천하지 않는다', () => {
  const p: Profile = { univ: 'smu-cheonan', catalogYear: 2022, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: 'smkorean', role: 'primary' }], now: '2026-2', leaves: [], checks: {} };
  assert.deepEqual(plan(p, [], ctx).fut, []);
  assert.deepEqual(plan({ ...p, leaves: ['2023-1', '2023-2', '2024-1', '2024-2'] }, [], ctx).fut, ['2027-1', '2027-2']);
});
