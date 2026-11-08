// V0 오라클: 현재 앱(V44)으로 픽스처마다 판정·추천 결과를 뽑아 oracle/expected/에 쓴다(생성물, git 제외).
// 사용: node oracle/harness.mjs [학과명...]   (인자 없으면 40개 전부)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadDept } from './load.mjs';

const OUT = new URL('./expected/', import.meta.url);
const units = JSON.parse(fs.readFileSync(new URL('./legacy/units.json', import.meta.url), 'utf8'));
const NOWS = ['1-2', '2-2', '3-1', '4-1'];
const PATS = ['all', 'r80', 'leave', 'double', 'minor'];

const IN_CTX = fs.readFileSync(new URL('./ctx.js', import.meta.url), 'utf8');
const seedOf = s => crypto.createHash('sha256').update(s).digest().readUInt32LE(0);
fs.mkdirSync(OUT, { recursive: true });
const depts = process.argv.slice(2).length ? process.argv.slice(2) : units.order;
const sums = [];
for (const dept of depts) {
  const { run } = loadDept(dept);
  run(IN_CTX);
  const st = JSON.parse(run('JSON.stringify(__static())'));
  const cases = [];
  for (const year of units.units[dept].years) for (const now of NOWS) for (const p of PATS) {
    const id = `${st.id}|${year}|${now}|${p}`, seed = seedOf(id);
    const f = { seed, year, now, p: p === 'all' ? 'all' : 'r80', mode: p === 'double' ? 'double' : p === 'minor' ? 'minor' : 'single',
      leave: p === 'leave' ? `${+year + 1}-2` : null };
    run(`__build(${JSON.stringify(f)})`);
    const state = JSON.parse(run('JSON.stringify(S)'));
    const audit = JSON.parse(run('JSON.stringify(__audit())'));
    const tracks = st.TRK.length ? (p === 'r80' ? [st.TRK[0]] : p === 'leave' ? st.TRK.slice(0, 2) : p === 'double' ? [st.TRK[st.TRK.length - 1]] : []) : [];
    const plan = JSON.parse(run(`JSON.stringify(__plan(${JSON.stringify(tracks)},${p === 'r80'}))`));
    cases.push({ id, f, tracks, state, audit, plan });
  }
  const body = JSON.stringify({ static: st, cases });
  fs.writeFileSync(new URL(`${st.id}.json`, OUT), body);
  sums.push(`${crypto.createHash('sha256').update(body).digest('hex')}  ${st.id}.json`);
  console.log(dept, cases.length);
}
if (!process.argv.slice(2).length) fs.writeFileSync(new URL('../expected.sha256', OUT), sums.join('\n') + '\n');
