// V0 교차 확인용: 학과 3개 × 5건을 Node(vm)에서 돌려 결과 해시를 oracle/probe.json에 쓴다.
// 브라우저에서 같은 ctx.js·같은 입력으로 돌린 해시와 비교한다(큰 결과를 채팅으로 옮기지 않기 위해 해시만).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadDept } from './load.mjs';

const IN_CTX = fs.readFileSync(new URL('./ctx.js', import.meta.url), 'utf8');
const H = s => crypto.createHash('sha256').update(s).digest('hex');
const out = [];
for (const dept of ['그린화학공학과', '소프트웨어학과', '간호학과']) {
  const exp = JSON.parse(fs.readFileSync(new URL(`./expected/${JSON.parse(loadDept(dept).run('JSON.stringify(U.id)'))}.json`, import.meta.url), 'utf8'));
  const { run } = loadDept(dept);
  run(IN_CTX);
  const picks = [3, 27, 48, 66, 89].map(i => exp.cases[i % exp.cases.length]); // 연도·현재 학기·패턴이 섞이게
  for (const c of picks) {
    run(`__build(${JSON.stringify(c.f)})`);
    const audit = H(run('JSON.stringify(__audit())'));
    const plan = H(run(`JSON.stringify(__plan(${JSON.stringify(c.tracks)},${c.f.p === 'r80' && !c.f.leave && c.f.mode === 'single'}))`));
    out.push({ dept, id: c.id, f: c.f, tracks: c.tracks, sea: c.f.p === 'r80' && !c.f.leave && c.f.mode === 'single', audit, plan });
  }
}
fs.writeFileSync(new URL('./probe.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.length, 'probes');
