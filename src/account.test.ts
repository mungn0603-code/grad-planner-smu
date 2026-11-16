// 학번 연결 증명(ADR 0029): 샘물 성공 뒤 10분 안, 같은 비밀값으로 만든 것만 통과
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProof, readProof } from '../server/account.ts';

const e = { SMUL_KEY_SECRET: 'test-secret' }, now = Date.UTC(2026, 10, 16);

test('증명: 맞는 증명은 학번을 돌려주고, 만료·위조·다른 비밀값은 거절', async () => {
  const p = (await makeProof(e, '202312345', now))!;
  assert.equal(await readProof(e, p, now), '202312345');
  assert.equal(await readProof(e, p, now + 601_000), null, '10분 뒤 만료');
  assert.equal(await readProof(e, p.replace('202312345', '202312346'), now), null, '학번 바꿔치기');
  assert.equal(await readProof({ SMUL_KEY_SECRET: 'other' }, p, now), null, '다른 비밀값');
  assert.equal(await readProof(e, 'junk', now), null);
  assert.equal(await makeProof({}, '202312345', now), undefined, '비밀값이 없으면 만들지 않음');
});
