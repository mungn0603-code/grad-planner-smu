// 학점 플래너 바꾸기: 추천 과목을 바꾸기 후보로 바꿔도 못 채운 요건이 늘지 않고, 학기 상한을 넘지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { plan, score } from './plan.ts';
import type { Profile } from './types.ts';

const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));

test('바꾸기 후보로 한 과목씩 바꿔도 부족분이 늘지 않는다', () => {
  for (const program of ['software', 'nursing', 'smkorean']) {
    const p: Profile = { univ: 'smu-cheonan', catalogYear: 2025, admission: 'freshman', student: 'domestic', startSemester: 1, programs: [{ id: program, role: 'primary' }], now: '2025-2', leaves: [], checks: {} };
    const P = plan(p, [], ctx, { exact: false }); // 탐욕으로도 같은 성질(후보 계산은 풀이 방법과 무관)
    const base = score(p, [], ctx, {}, P.rows).shortfall;
    let n = 0;
    for (const r of P.rows) for (const a of (P.alts[`${r.term}|${r.code}`] ?? []).slice(0, 2)) {
      const rows = P.rows.map(x => (x === r ? { code: a.code, term: r.term } : x));
      assert.ok(score(p, [], ctx, {}, rows).shortfall <= base + 1e-9, `${program} ${r.term} ${r.code} → ${a.code}`);
      assert.ok(P.load[r.term] - r.cr + a.cr <= P.lim[r.term]);
      n++;
    }
    assert.ok(n > 0, `${program}: 바꾸기 후보가 하나도 없다`);
  }
});
