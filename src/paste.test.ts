import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsToEnrollments, parseTerm, guessLeaves } from './paste.ts';

test('붙여넣기: 머리글로 열 찾기, 학기 해석, 합계 행 건너뛰기', () => {
  const rows = [
    ['성적표'],
    ['년도', '학기', '학수번호', '교과목명', '이수구분', '학점', '등급'],
    ['2024', '1학기', 'hbjo 2173', '컴퓨터프로그래밍Ⅰ(PBL)', '1전선', '3', 'A+'],
    ['', '하계', '', '타대 계절 교양', '교선', '2', 'P'],
    ['2025', '2', 'HBCD0005', '취업과창업(공과대학)', '1전선', '1', 'F'],
    ['', '', '', '합계', '', '6', ''],
  ];
  const r = rowsToEnrollments(rows);
  assert.equal(r.header, true);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.es, [
    { code: 'HBJO2173', name: '컴퓨터프로그래밍Ⅰ(PBL)', credits: 3, category: '1전선', grade: 'A+', term: '2024-1' },
    { name: '타대 계절 교양', credits: 2, category: '교선', grade: 'P', term: '2024-S' },
    { code: 'HBCD0005', name: '취업과창업(공과대학)', credits: 1, category: '1전선', grade: 'F', term: '2025-2' },
  ]);
  assert.equal(parseTerm('2023년 겨울학기'), '2023-W');
  assert.equal(rowsToEnrollments([['a', 'b']]).header, false);
});

test('여러 표: 표마다 머리글을 다시 읽고 제목 줄(##)의 학기를 쓴다', () => {
  const rows = [
    ['## 2024학년도 2학기 성적'], ['학수번호', '교과목명', '학점', '성적'], ['HBJO2161', '컴퓨터프로그래밍Ⅱ(PBL)', '3', 'A0'],
    ['## '], ['교과목명', '학수번호', '학점'], ['이산수학', 'HBJW0001', '3'],   // 학기 없는 표(시간표 등)
  ];
  assert.deepEqual(rowsToEnrollments(rows).es, [
    { code: 'HBJO2161', name: '컴퓨터프로그래밍Ⅱ(PBL)', credits: 3, grade: 'A0', term: '2024-2' },
    { code: 'HBJW0001', name: '이산수학', credits: 3 },
  ]);
});

test('복사 경로: 탭 텍스트에서 공백이 잘린 빈 제목 줄(##)도 표 경계로 본다', () => {
  const text = '## 2026학년도 1학기\n학수번호\t교과목명\t학점\nMAT1011\t공학수학(1)\t3\n## \n교과목명\t학수번호\t학점\n공학수학(2)\tMAT1012\t3';
  const rows = text.split('\n').map(l => l.split('\t').map(c => c.trim()));   // clipRows의 텍스트 경로와 같은 처리
  assert.deepEqual(rowsToEnrollments(rows).es, [
    { code: 'MAT1011', name: '공학수학(1)', credits: 3, term: '2026-1' },
    { code: 'MAT1012', name: '공학수학(2)', credits: 3 },
  ]);
});

test('휴학 추정: 입학부터 현재 학기 전까지 기록 없는 정규학기만(계절학기·현재 학기는 빼고)', () => {
  const es = ['2022-1', '2022-2', '2022-S', '2025-1', '2025-2', '2026-2'].map(term => ({ code: 'X', term }));
  assert.deepEqual(guessLeaves(es, 2022, '2026-2'), ['2023-1', '2023-2', '2024-1', '2024-2', '2026-1']);
  assert.deepEqual(guessLeaves(es, 2022, ''), []);
});
