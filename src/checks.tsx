// 성적표로 알 수 없는 졸업 조건(평점·인증·비교과 등)의 입력. 주전공·다전공 요건과 진로 트랙별로 묶는다
import { useMemo } from 'react';
import { pickSet } from '../engine/audit.ts';
import { checksIn } from './data.ts';
import { norm, type Me, type PageProps } from './state.ts';
import { Switch } from './ui.tsx';

export type CheckDef = ReturnType<typeof checksIn>[number];

export function useChecks({ s, dispatch, univ, profile, a }: PageProps) {
  const me = s.me, set = (v: Partial<Me>) => dispatch({ t: 'me', v }), auto = !!a?.gpa;
  const groups = useMemo(() => {
    if (!univ || !profile) return [];
    return profile.programs.map(g => { const out: CheckDef[] = [];
      try { const st = pickSet(profile, g, univ); if (st) checksIn(st.rule, univ, out); } catch { /* 졸업요건 화면에서 오류 표시 */ }
      // 성적으로 평점을 계산했으면 평점은 입력받지 않는다
      return { id: g.id, role: g.role, name: univ.programs[g.id]?.name ?? g.id, checks: out.filter(c => !(auto && c.key === univ.policy.gpa?.check)) }; }).filter(x => x.checks.length);
  }, [univ, profile, auto]);
  const input = (c: CheckDef) => <CheckInput key={c.key} c={c} me={me} set={set} />;
  const [main, tracks] = [groups.filter(g => g.role !== 'track'), groups.filter(g => g.role === 'track')];
  const form = <div className="form">
    <p className="muted small">샘물에서 확인한 값을 넣어 주세요.</p>
    {main.map(g => <div className="grid checks" key={g.id}>{g.checks.map(input)}</div>)}
    {!!tracks.length && <details className="tracks-box"><summary>진로 트랙(SM-CDR) 인증 항목 {tracks.length}개 <small className="muted">— 트랙 인증을 받으려는 경우만</small></summary>
      {tracks.map(g => <div key={g.id} className="track-checks"><b>{g.name}</b><div className="grid checks">{g.checks.map(input)}</div></div>)}</details>}
  </div>;
  return { count: main.reduce((n, g) => n + g.checks.length, 0), form, groups, input };
}

// 성적표로 알 수 없는 졸업 조건 하나(인증 여부는 스위치, 평점·횟수는 숫자)
export function CheckInput({ c, me, set, bare }: { c: CheckDef; me: Me; set: (v: Partial<Me>) => void; bare?: boolean }) {
  const v = me.checks[c.key];
  // 프로그램 목록이 있으면 이수한 프로그램을 고른다. 고른 프로그램은 같은 이름이 든 모든 트랙에 함께 들어간다
  if (c.list) { const done = me.done ?? [], has = (n: string) => done.some(d => norm(d) === norm(n));
    return <div className="field">{bare ? `이수한 프로그램 (기준 ${c.min}개)` : `${c.label} (기준 ${c.min}개)`}
      <div className="chips" role="group" aria-label={`${c.label} 이수한 프로그램`}>{c.list.map(n => { const on = has(n);
        return <button key={n} type="button" className={'pill' + (on ? ' on' : '')} aria-pressed={on}
          onClick={() => { const { [c.key]: _, ...rest } = me.checks; set({ checks: rest, done: on ? done.filter(d => norm(d) !== norm(n)) : [...done, n] }); }}>{n}</button>; })}</div></div>; } // 예전 스위치 값은 지운다
  if (c.min === 1) return <label className="check-row"><Switch on={!!v} set={x => set({ checks: { ...me.checks, [c.key]: x } })} label={c.label} />
    <span>{bare ? '인증 받음' : c.label}{!bare && c.hint && <small className="muted">{c.hint}</small>}</span></label>;
  return <label className="field">{bare ? `값 입력 (기준 ${c.min})` : `${c.label} (기준 ${c.min})`}{!bare && c.hint && <small className="muted">{c.hint}</small>}
    <input type="number" step="any" inputMode="decimal" value={typeof v === 'number' ? String(v) : ''} placeholder={bare ? '예: 3.5' : undefined}
      onChange={e => { const { [c.key]: _, ...rest } = me.checks; set({ checks: e.target.value === '' ? rest : { ...rest, [c.key]: +e.target.value } }); }} /></label>;
}
