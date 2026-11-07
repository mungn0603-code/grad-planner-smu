// V1: 새 엔진 판정 = 현재 앱(V44) 판정. 입력은 oracle/expected(현재 앱이 낸 정답, node oracle/harness.mjs로 생성).
// 설명된 차이(oracle/known-diffs.json 규칙)만 허용하고, 설명 안 된 불일치는 0이어야 통과.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadUniv, ROOT } from './load.node.ts';
import { audit, find, match, strips, catalogsOf } from './audit.ts';
import { nameKey } from './data.ts';
import { fromLegacy } from './fromLegacy.ts';

const EXP = path.join(ROOT, 'oracle', 'expected');
const ctx = loadUniv(path.join(ROOT, 'data', 'smu-cheonan'));
const files = fs.existsSync(EXP) ? fs.readdirSync(EXP).filter(f => f.endsWith('.json')) : [];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// known-diffs 규칙별 판정. 차이가 규칙으로 정확히 설명되면 그 규칙 이름을, 아니면 null
const EQ = new Map<string, Map<string, string[]>>();
const eqOf = (id: string) => EQ.get(id) || EQ.set(id, new Map((ctx.catalogs[id].equiv || []).flatMap(e => e.from.flatMap(f => (e.ed || []).map(ed => [ed + '|' + f, e.to] as [string, string[]]))))).get(id)!;
// 엔진이 센 CDR 과목을 현재 앱 방식으로 다시 걸러 본다: 그 결과가 현재 앱 값과 같으면 어떤 규칙 때문인지 돌려준다
function explainCdr(a: any, st: any, i: number, k: 'deep' | 'sel', field: 'have' | 'done', got: number, want: number): string | null {
  const of = (ctx.univ.blocks[`cdr.${st.id}.${i}`] as any).all[k === 'deep' ? 0 : 1].of, M = new Set<string>(of.codes);
  const names = new Set<string>(of.names.map((n: string) => nameKey(n, strips(ctx, catalogsOf(a.profile, ctx)))));
  const eq = eqOf(st.id), tOrd = (t?: string) => (t ? +t.slice(0, 4) * 4 + ({ '1': 0, S: 1, '2': 2, W: 3 } as any)[t.slice(5)] : 1e9);
  // 현재 앱은 전공심화·전공선택을 한 번에 학기순으로 훑으며 중복을 거른다(seen 공유)
  const hit = a.items.filter((it: any) => (field === 'have' || !it.planned) && match(it, { tags: ['major'] })
    && ((it.code && [...it.ids].some((c: string) => M.has(c))) || names.has(it.key)));
  const seen = new Set<string>(), why = new Set<string>(); let legacy = 0;
  for (const it of hit.slice().sort((x: any, y: any) => tOrd(x.term) - tOrd(y.term))) {
    const mine = (k === 'deep') === it.tags.has('major.deep');
    const tg = it.code && it.ed ? (eq.get(it.ed + '|' + it.code) ?? [it.code]) : [], h = tg.filter((c: string) => M.has(c));
    const key = h.length ? h : names.has(it.key) ? ['@' + it.key] : [];
    if (!key.length) { if (mine) why.add('legacy-rename-as-discontinued'); continue; }
    if (key.every((c: string) => seen.has(c))) { if (mine) why.add('legacy-cdr-merge-once'); continue; }
    key.forEach((c: string) => seen.add(c)); if (mine) legacy += it.cr;
  }
  return why.size && near(legacy, want) && !near(got, want) ? [...why].join('+') : null;
}

export function compare(c: any, st: any) {
  const L = { univ: 'smu-cheonan', dept: ctx.catalogs[st.id], tracks: st.TRK.map((_: string, i: number) => `cdr.${st.id}.${i}`), trackNames: st.TRK };
  const { profile, enrollments } = fromLegacy(c.state, L);
  const a = audit(profile, enrollments, ctx), prim = a.programs[0].result, A = c.audit, diffs: string[] = [], known: string[] = [];
  const ax = { ...a, profile };
  const chk = (k: string, got: number | undefined, want: number, why?: () => string | null) => {
    if (got != null && near(got, want)) return; const w = got != null && why ? why() : null;
    (w ? known : diffs).push(`${k}: 엔진 ${got} ≠ 현재 앱 ${want}${w ? ' [' + w + ']' : ''}`); };
  for (const k of ['total', 'major', 'deep', 'ge', 'ext']) {
    const r = find(prim, k); chk(k + '.have', r?.have, A.all[k]); chk(k + '.done', r?.done, A.done[k]);
    if (k !== 'deep' || A.req.deep) chk(k + '.need', r?.need, A.req[k] || 0);
  }
  chk('basic', find(prim, 'basic')?.have, A.ge.basic); chk('core', find(prim, 'core')?.have, A.ge.core); chk('bal', find(prim, 'bal')?.have, A.ge.bal);
  st.TRK.forEach((t: string, i: number) => {
    const r = a.programs.find(p => p.id === `cdr.${st.id}.${i}`)!.result, x = A.cdr[t];
    for (const k of ['deep', 'sel', 'ge'] as const) for (const fd of ['have', 'done'] as const) {
      const got = find(r, k)?.[fd], want = (fd === 'have' ? x.all : x.done)[k];
      chk(`cdr${i}.${k}.${fd}`, got, want, k === 'ge' ? undefined : () => explainCdr(ax, st, i, k, fd, got!, want));
    }
    chk(`cdr${i}.ex`, find(r, 'ex')?.have, x.ex);
  });
  if (A.thesis) { const t = find(prim, 'thesis'); chk('thesis.deep', find(t, 'thesisDeep')?.have, A.thesis.deep); if (t?.ok !== A.thesis.ok) diffs.push(`thesis.ok: 엔진 ${t?.ok} ≠ 현재 앱 ${A.thesis.ok}`); }
  return { diffs, known, a, profile, enrollments };
}

test('V1 감사 결과 동일성', { skip: !files.length && 'oracle/expected 없음 (node oracle/harness.mjs 먼저)' }, () => {
  let n = 0, kn = 0; const bad: string[] = [], byField = new Map<string, number>(), byRule = new Map<string, number>();
  for (const f of files) {
    const { static: st, cases } = JSON.parse(fs.readFileSync(path.join(EXP, f), 'utf8'));
    for (const c of cases) { n++; const { diffs, known } = compare(c, st);
      if (known.length) { kn++; known.forEach(d => { const r = d.match(/\[(.+)\]$/)![1]; byRule.set(r, (byRule.get(r) || 0) + 1); }); }
      if (diffs.length) { bad.push(`${c.id}  ${diffs.join(' | ')}`); diffs.forEach(d => { const k = d.split(':')[0].replace(/^cdr\d+/, 'cdr'); byField.set(k, (byField.get(k) || 0) + 1); }); } }
  }
  console.log(`픽스처 ${n}건: 완전 일치 ${n - kn - bad.length}, 설명된 차이 포함 ${kn}`, Object.fromEntries(byRule));
  if (bad.length) { console.log(`설명 안 된 불일치 ${bad.length}건, 항목별:`, Object.fromEntries(byField)); console.log(bad.slice(0, 15).join('\n')); }
  assert.equal(bad.length, 0, `설명 안 된 불일치 ${bad.length}/${n}`);
});
