// 현재 앱(V44) 저장 상태 S(v2) → Profile + Enrollment[].
// 용도: (1) V1 동일성 검사 입력 (2) 새 앱에서 기존 사용자의 백업 파일 가져오기.
// 지난 학기 과목은 학수번호·학기만 넘기고 학점·이수구분은 엔진이 그 학기 판에서 읽는다(버전 축 검증).
import type { Catalog, Enrollment, Profile, Equiv } from './types.ts';

const SEMS = ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2', '4-1', '4-2'];
const isSea = (s: string) => /^[1-4]-[12]s$/.test(s);
export const sIdx = (s: string) => { const i = SEMS.indexOf(s); return i >= 0 ? i : isSea(s) ? SEMS.indexOf(s.slice(0, -1)) + 0.5 : -1; };
const tIdx = (t: string) => { const [y, h] = t.split('-').map(Number); return y * 2 + h - 1; };
const tOfIdx = (i: number) => Math.floor(i / 2) + '-' + (i % 2 + 1);

// 학년·학기 칸 → 실제 학기. 저장된 배정(termMap: 휴학·사진 인식)이 있으면 그 값, 없으면 앞 배정에서 이어 센다
export function termOfSlot(slot: string, year: string, termMap: Record<string, string> = {}): string | null {
  if (isSea(slot)) { const b = termOfSlot(slot.slice(0, -1), year, termMap); return b ? b.slice(0, 4) + '-' + (slot[2] === '1' ? 'S' : 'W') : null; }
  const i = sIdx(slot); if (i < 0 || !year) return null;
  const y0 = tIdx(year + '-1');
  const tm = Object.entries(termMap).filter(([t, v]) => SEMS.includes(v) && tIdx(t) >= y0).map(([t, v]) => [tIdx(t), sIdx(v)]);
  const ex = tm.filter(([, j]) => j === i).sort((a, b) => a[0] - b[0])[0]; if (ex) return tOfIdx(ex[0]);
  const prev = tm.filter(([, j]) => j < i).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0], next = tm.filter(([, j]) => j > i).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  let k = prev ? prev[0] + (i - prev[1]) : y0 + i; if (next && k > next[0] - (next[1] - i)) k = next[0] - (next[1] - i);
  return tOfIdx(Math.max(y0, k));
}

// 휴학 학기: 입학 1학기부터 4학년 2학기 사이 실제 학기 중 학년·학기 칸이 배정되지 않은 학기(현재 앱 termRow)
function leavesOf(year: string, tm: Record<string, string>): string[] {
  const ts = SEMS.map(s => tIdx(termOfSlot(s, year, tm)!)), y0 = tIdx(year + '-1'), out: string[] = [];
  for (let i = y0; i <= Math.max(...ts); i++) if (!ts.includes(i)) out.push(tOfIdx(i));
  return out;
}

export interface LegacyCtx { univ: string; dept: Catalog; tracks: string[] /* 트랙 프로그램 id, 현재 앱 TRK 순서 */; trackNames: string[] }

export function fromLegacy(S: any, L: LegacyCtx): { profile: Profile; enrollments: Enrollment[] } {
  const year = String(S.year), tm = S.termMap || {}, ed = L.dept.editions, eds = Object.keys(ed).sort(), CUR = eds[eds.length - 1];
  const ni = S.now === 'done' ? 99 : sIdx(S.now), term = (s: string | null) => (s ? termOfSlot(s, year, tm) ?? undefined : undefined);
  const edOf = (t?: string | null) => { if (!t) return year; const y = +t.slice(0, 4); return eds.filter(v => +v <= y).pop() || eds[0]; };
  const rowIn = (e: string, code: string) => (ed[e] || []).find(r => r.c === code);
  const map = new Map<string, string[]>(); (L.dept.equiv || []).forEach((q: Equiv) => q.from.forEach(f => (q.ed || eds).forEach(e => map.set(e + '|' + f, q.to))));
  // 놓친 신설 과목(현재 앱 missedPlan): 지난 학기 칸에 그 학기 판 과목으로 이어지지 않는 2026 과목
  const cov = new Set<string>();
  SEMS.forEach((s, i) => { if (i >= ni) return; const e = edOf(termOfSlot(s, year, tm)), [g, h] = s.split('-').map(Number);
    (ed[e] || []).filter(r => r.y === g && r.s === h).forEach(r => { cov.add(r.c); (map.get(e + '|' + r.c) ?? [r.c]).forEach(t => cov.add(t)); }); });
  const missed = new Set(S.now === 'done' ? [] : ed[CUR].filter(r => sIdx(r.y + '-' + r.s) < ni && !cov.has(r.c)).map(r => r.c));
  const out: Enrollment[] = [];
  for (const [k, st] of Object.entries<any>((S.sel || {})[year] || {})) {
    if (!st || !st.on) continue;
    const code = k.slice(2);
    if (k.startsWith('o:')) {
      const r0 = rowIn(year, code) || eds.slice().reverse().map(e => rowIn(e, code)).find(Boolean);
      const slot = st.slot || (r0 ? r0.y + '-' + r0.s : null); if (!slot || !r0) continue;
      out.push({ code, term: term(slot), ...(sIdx(slot) >= ni ? { planned: true as const } : {}) });
    } else {
      const r = rowIn(CUR, code); if (!r) continue;
      const slot = st.slot || r.y + '-' + r.s;
      if (!(sIdx(slot) >= ni || st.slot || missed.has(code))) continue; // 현재 앱 화면에 없는 카드
      // 2026 카드: 앞으로 들을 과목은 계획, 지난 칸에 둔 과목은 2026판 그대로(현재 앱 동작)
      out.push({ code, term: term(slot), ...(sIdx(slot) >= ni ? { planned: true as const } : { category: r.t, credits: r.cr, name: r.n }) });
    }
  }
  for (const x of S.custom || []) {
    const kind = x.kind === '마이크로' ? '일선' : x.kind, done = x.slot && sIdx(x.slot) < ni;
    out.push({ name: x.name, credits: +x.cr || 0, category: kind, ...(x.area && x.area !== '해당 없음' ? { area: x.area } : {}),
      ...(x.slot ? { term: term(x.slot) } : {}), ...(done ? {} : { planned: true as const }) });
  }
  const mode = S.mode === 'double' || S.mode === 'minor' ? S.mode : 'single';
  const checks: Profile['checks'] = {};
  if (typeof S.gpa === 'number') checks.gpa = S.gpa;
  if (S.port) checks.port = true;
  L.tracks.forEach((pid, i) => { checks[`cdr.ex.${pid}`] = Math.max(0, parseInt((S.cdrEx || {})[L.trackNames[i]], 10) || 0); });
  const profile: Profile = {
    univ: L.univ, catalogYear: +year, admission: 'freshman', student: 'domestic', startSemester: 1,
    programs: [{ id: L.dept.id, role: 'primary' }, ...(mode === 'double' ? [{ id: 'ext', role: 'second' as const }] : mode === 'minor' ? [{ id: 'ext', role: 'minor' as const }] : []),
      ...L.tracks.map(id => ({ id, role: 'track' as const }))],
    now: S.now === 'done' ? undefined : term(S.now), leaves: leavesOf(year, tm), checks,
  };
  return { profile, enrollments: out };
}
