// 모든 대학 데이터 폴더가 참조 무결성 검사를 통과해야 한다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { check } from './check.ts';

const DATA = path.join(ROOT, 'data');
for (const u of fs.readdirSync(DATA).filter(d => fs.existsSync(path.join(DATA, d, 'rules.json')))) {
  test(`데이터 검사: ${u}`, () => {
    const { univ, catalogs } = loadUniv(path.join(DATA, u));
    assert.deepEqual(check(univ, catalogs), []);
  });
}

test('검사기가 잘못된 데이터를 잡는다', () => {
  const { univ, catalogs } = loadUniv(path.join(DATA, 'smu-cheonan'));
  const bad = { ...univ, sets: [...univ.sets, { program: 'nope', years: [2026, 2025] as [number, number], rule: { all: [{ use: 'missing' }, { credits: '$x' as const, of: { codes: ['ZZZ0000'] } }] }, src: '' }] };
  const e = check(bad, catalogs).join('\n');
  for (const s of ['프로그램 정의 없음', '근거(src) 없음', '연도 범위', '블록 missing 없음', '변수 $x', 'ZZZ0000']) assert.match(e, new RegExp(s.replace(/[$()]/g, '\\$&')));
});
