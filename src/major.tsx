// 전공제도 계획(학점 플래너): 제2·3전공·부전공·연계·융합·자기설계·마이크로전공을 함께 골라 같은 기록으로 판정해 본다.
// 저장된 학적·기록은 바꾸지 않는다. 고른 전공의 교육과정 과목은 그 종류의 이수구분으로 옮긴 사본으로 평가한다(engine reassign).
// 과목 배정(한 과목은 한 곳에만)과 다전공 과목 추천은 엔진이 한다(ADR 0024). 전공선택(후보 전공 비교)·자기설계 과목 입력도 여기 둔다
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { audit, reassign, find, type Ctx } from '../engine/audit.ts';
import type { Filter, Row, Univ } from '../engine/types.ts';
import { loadCtx, primaries, progsFor } from './data.ts';
import { toProfile, roleText, progName, canDeep, OWN, type Me, type PageProps, type Prog, type State, type WhatIf } from './state.ts';
import { Caret, Fold, Icon, Loading } from './ui.tsx';

type MdRule = { id: string; label: string; courses: number; of: Filter };
const mdRulesOf = (u: Univ) => { const m = u.blocks['md.all']; return (m && 'all' in m ? m.all : []) as MdRule[]; };
const same = (x: Prog[], y: Prog[]) => x.map(g => g.id + g.role).join() === y.map(g => g.id + g.role).join();

export function useWhatIf({ s, univ, ctx }: PageProps, w: WhatIf | undefined) {
  const [cx, setCx] = useState<Ctx | null>(null); // 계획한 프로그램들의 카탈로그
  const ids = w && univ ? toProfile({ ...s.me, ext: w.ext }, univ, w.mds.length > 0).programs.map(p => p.id) : [];
  useEffect(() => { setCx(null); if (!univ || !ids.length) return; let off = false;
    loadCtx(univ, ids).then(c => { if (!off) setCx(c); }, e => console.error(e)); return () => { off = true; }; }, [univ, ids.join()]); // eslint-disable-line
  return useMemo(() => {
    if (!w || !univ || !ctx || !cx || cx.univ !== univ) return null;
    const md = w.mds.map(id => mdRulesOf(univ).find(r => r.id === id)).filter((r): r is MdRule => !!r), A = univ.policy.assign;
    // 새로 고른 다전공·부전공: 그 교육과정의 전공 과목(자기설계는 학생이 넣은 과목)을 그 종류의 이수구분으로 옮긴다.
    // 주전공·다른 다전공·마이크로전공으로 이미 센 과목은 그대로 둔다(한 과목은 한 곳에만)
    const codesOf = (g: Prog) => g.id === OWN ? (s.me.own ?? []).map(r => r.c)
      : [...new Set((univ.programs[g.id]?.catalogs ?? []).flatMap(c => Object.values(cx.catalogs[c]?.editions ?? {}).flat()).filter(r => univ.categories[r.t]?.includes('major')).map(r => r.c))];
    const picks = [...w.ext.filter(g => !s.me.ext.some(x => x.id === g.id)).flatMap(g => { const b = A?.by[univ.programs[g.id]?.kind ?? g.role], codes = codesOf(g);
      return b && codes.length ? [{ cat: b.cat, of: { codes }, keep: ['major', 'major2', 'md'] }] : []; }),
      ...md.map((r, k) => ({ cat: `${k + 1}MD`, of: { codes: r.of.codes, names: r.of.names } }))];
    // 샘물이 지금 이수 형태가 아닌 열을 0으로 줄 수 있어(실제 응답 확인 불가) 계획에서는 0을 학과 기준 숫자로 둔다(ADR 0017)
    const base = s.me.base && Object.fromEntries(Object.entries(s.me.base).filter(([, v]) => v > 0));
    // 마이크로전공은 고른 것만 칸(md1~md3)별로 판정해 겹치는 과목은 먼저 고른 쪽에만 든다(ADR 0017)
    const mdAll = univ.blocks['md.all'];
    const u: Univ = md.length && mdAll && 'all' in mdAll ? { ...univ, blocks: { ...univ.blocks, 'md.all': { ...mdAll, all: md.map((r, k) => ({ ...r, of: { ...r.of, every: [`md${k + 1}`] } })) } } } : univ;
    try {
      const moved = picks.length ? reassign(toProfile(s.me, univ), s.es, ctx, picks) : {};
      // 앞으로 들을 마이크로전공 과목은 카탈로그 이수구분을 쓰므로 카탈로그에도 먼저 고른 칸(1MD~3MD)을 입힌다(안 하면 추천 과목이 MD 칸을 못 채운다)
      const slot = new Map<string, string>();
      md.forEach((r, k) => [...(r.of.codes ?? []), ...(r.of.names ?? [])].forEach(x => { if (!slot.has(x)) slot.set(x, `${k + 1}MD`); }));
      const catalogs = !slot.size ? cx.catalogs : Object.fromEntries(Object.entries(cx.catalogs).map(([id, cat]) => [id, { ...cat, editions: Object.fromEntries(Object.entries(cat.editions).map(([ed, rows]) => [ed,
        rows.map(r => { const t = slot.get(r.c) ?? slot.get(r.n); return t ? { ...r, t } : r; })])) }]));
      const c: Ctx = { ...cx, univ: u, catalogs }, profile = toProfile({ ...s.me, ext: w.ext, base }, u, md.length > 0), es = s.es.map((e, i) => moved[i] ? { ...e, category: moved[i] } : e);
      return { profile, es, ctx: c, a: audit(profile, es, c), moved };
    } catch (e) { console.error(e); return null; }
  }, [w, univ, ctx, cx, s.me, s.es]);
}


// 고른 값만 남긴 계획. 지금 학적과 같으면 undefined(계획 없음)
export const wiOf = (d: WhatIf, me: Me): WhatIf | undefined => same(d.ext, me.ext) && !d.mds.length ? undefined : d;

// 설정 한 줄: 왼쪽 이름, 오른쪽 고르는 칸(학점 추천 조건·전공제도 계획이 같이 쓴다)
export const Opt = ({ label, children }: { label: string; children: ReactNode }) =>
  <div className="opt"><span className="opt-l">{label}</span><div className="opt-v">{children}</div></div>;

// 전공제도 고르기. 종류를 누르면 그 종류의 전공 목록이 나오고, 고르면 바로 반영된다. 심화전공은 다전공·부전공을 하지 않는 것이라 누르면 바로 목록을 비운다(engine withOf).
// 처음 고른 종류는 학생이 지금 하는 전공제도(첫 다전공·부전공), 없으면 심화전공. 다전공은 제3전공까지(2개). 이수 제외 학생(편입 등)은 심화전공을 할 수 없어 deep=false
const KINDS = [['deep', '심화전공'], ['dept', '제2·3전공'], ['minor', '부전공'], ['linked', '연계전공'], ['fusion', '융합전공'], ['ism', '자기설계융합전공']] as const;
type Kind = typeof KINDS[number][0];
const kindOf = (u: Univ, ext: Prog[]): Kind => {
  const g = ext[0]; if (!g) return 'deep'; if (g.role === 'minor') return 'minor';
  const k = u.programs[g.id]?.kind; return k === 'linked' || k === 'fusion' || k === 'ism' ? k : 'dept';
};
export function ExtFields({ univ, primary, ext, set, deep = true, clear = () => set([]) }:
  { univ: Univ; primary: string; ext: Prog[]; set: (ext: Prog[]) => void; deep?: boolean; clear?: () => void }) {
  const [kind, setKind] = useState<Kind>(() => { const k = kindOf(univ, ext); return k === 'deep' && !deep ? 'dept' : k; });
  const role = kind === 'minor' ? 'minor' : 'second';
  const opts = progsFor(univ, role).filter(p => p.kind === (kind === 'minor' ? 'dept' : kind) && p.id !== primary && !ext.some(g => g.id === p.id));
  const full = role === 'second' && ext.filter(g => g.role === 'second').length >= 2;
  return <div className="ext">
    <div className="kinds" role="radiogroup" aria-label="전공제도 종류">{KINDS.filter(([k]) => deep || k !== 'deep').map(([k, l]) =>
      <button key={k} type="button" role="radio" aria-checked={k === kind} onClick={() => { setKind(k); if (k === 'deep') clear(); }}>{l}</button>)}</div>
    {kind !== 'deep' && <select className="pick" value="" disabled={full || !opts.length} aria-label="전공 고르기" onChange={e => e.target.value && set([...ext, { id: e.target.value, role }])}>
      <option value="">{full ? '다전공 최대 2개 선택' : opts.length ? '전공 고르기' : '고를 수 있는 전공 없음'}</option>{opts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
    {ext.length > 0 && <ul className="chips">{ext.map(g => <li key={g.id + g.role}>
      <button className="pill on" aria-label={`${progName(univ, g)} 빼기`} onClick={() => set(ext.filter(x => x !== g))}>{progName(univ, g)}<small>{roleText(univ, g)}</small><Icon id="x" size={14} /></button></li>)}</ul>}
  </div>;
}

// 계획 입력: 다전공·부전공과 마이크로전공(고른 순서 = 1MD~3MD)
export function WhatIfFields({ s, univ, d, set }: { s: State; univ: Univ; d: WhatIf; set: (v: Partial<WhatIf>) => void }) {
  const mdRules = mdRulesOf(univ), label = (id: string) => mdRules.find(r => r.id === id)?.label, full = d.mds.length >= 3;
  return <>
    <Opt label="전공제도"><ExtFields univ={univ} primary={s.me.program} ext={d.ext} set={ext => set({ ext })} deep={canDeep(s.me)} clear={() => set({ ext: [], mds: [] })} /></Opt>
    {mdRules.length > 0 && <Opt label="마이크로전공">
      <select className="pick" value="" disabled={full} aria-label="마이크로전공 고르기" onChange={e => e.target.value && set({ mds: [...d.mds, e.target.value] })}>
        <option value="">{full ? '마이크로전공 최대 3개 선택' : '마이크로전공 고르기'}</option>{mdRules.filter(r => !d.mds.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
      {d.mds.length > 0 && <ul className="chips">{d.mds.map((id, k) => <li key={id}>
        <button className="pill on" aria-label={`${label(id)} 빼기`} onClick={() => set({ mds: d.mds.filter(x => x !== id) })}>{label(id)}<small>{k + 1}순위</small><Icon id="x" size={14} /></button></li>)}</ul>}
    </Opt>}
  </>;
}

// 전공제도 계획. 고르면 바로 반영하고(확인 버튼 없음), 처음 값은 학생의 지금 전공제도다
export function WhatIfBox({ s, univ, dispatch, moved }: PageProps & { univ: Univ; moved: string[] }) {
  const d = s.whatif ?? { ext: s.me.ext, mds: [] }, [n, setN] = useState(0); // n: 되돌리면 종류 고르기를 처음 상태로
  const set = (v: Partial<WhatIf>) => dispatch({ t: 'opt', v: { whatif: wiOf({ ...d, ...v }, s.me) } });
  return <section className="panel">
    <WhatIfFields key={n} s={s} univ={univ} d={d} set={set} />
    {s.whatif && <Opt label=""><button className="lnk" onClick={() => { dispatch({ t: 'opt', v: { whatif: undefined } }); setN(n + 1); }}>내 전공제도로 되돌리기</button></Opt>}
    {moved.length > 0 && <Fold title={`이수구분이 바뀌는 과목 ${moved.length}개`}><ul className="small">{moved.map(m => <li key={m}>{m}</li>)}</ul></Fold>}
    <Fold title="신청 안내"><ul className="small muted">
      <li>다전공·부전공을 신청하지 않으면 3학년 1학기에 심화전공으로 바뀌어요.</li>
      <li>다전공은 제3전공까지 신청할 수 있어요. 마이크로전공은 2개 이상 이수하면 다전공·부전공·심화전공을 대신해요.</li>
      <li>신청 전에 들은 과목을 반영하려면 학기 중(개강일~종강일)에 샘물에서 이수구분 정정을 신청하세요.</li>
      {d.mds.length > 1 && <li>두 마이크로전공에 겹치는 과목은 먼저 고른 쪽에 들어가요.</li>}
    </ul></Fold>
  </section>;
}

// 자기설계융합전공 이수계획표 과목. 학교 교육과정에서 골라 넣는다(이수구분은 다전공과 같은 2전선으로 본다, ADR 0024)
export function OwnBox({ s, dispatch, univ }: PageProps & { univ: Univ }) {
  const [cx, setCx] = useState<Ctx | null>(null), [q, setQ] = useState('');
  useEffect(() => { let off = false; loadCtx(univ, primaries(univ).map(p => p.id)).then(c => { if (!off) setCx(c); }, e => console.error(e)); return () => { off = true; }; }, [univ]);
  const list = useMemo(() => { const m = new Map<string, Row>();
    for (const c of Object.values(cx?.catalogs ?? {})) for (const ed of Object.keys(c.editions).sort()) for (const r of c.editions[ed]) m.set(r.c, r);
    return [...m.values()]; }, [cx]);
  const own = s.me.own ?? [], hit = list.find(r => q.startsWith(r.c + ' ') || q === r.c || q === r.n);
  const set = (rows: Row[]) => dispatch({ t: 'me', v: { own: rows.length ? rows : undefined } });
  // 목록에서 고르면 바로 넣는다(넣기 버튼 없음)
  const pick = (v: string) => { setQ(v); const h = list.find(r => v.startsWith(r.c + ' ')); if (h && !own.some(r => r.c === h.c)) { set([...own, { c: h.c, n: h.n, cr: h.cr, t: '2전선' }]); setQ(''); } };
  return <section className="panel">
    <Opt label="자기설계 과목">
      {!cx ? <Loading /> : <form onSubmit={e => { e.preventDefault(); if (hit) pick(`${hit.c} ${hit.n}`); }}>
        <input className="pick" list="own-catalog" value={q} onChange={e => pick(e.target.value)} placeholder="이수계획표 과목 검색" aria-label="자기설계융합전공 과목 검색" />
        <datalist id="own-catalog">{list.map(r => <option key={r.c} value={`${r.c} ${r.n}`}>{`${r.cr}학점`}</option>)}</datalist></form>}
      {own.length > 0 && <ul className="chips">{own.map(r => <li key={r.c}><button className="pill on" aria-label={`${r.n} 빼기`} onClick={() => set(own.filter(x => x !== r))}>{r.n}<small>{r.cr}학점</small><Icon id="x" size={14} /></button></li>)}</ul>}
    </Opt>
  </section>;
}

// 전공선택: 학부·자유전공 입학생이 주전공을 정하기 전에 후보 전공을 같은 수강 기록으로 비교한다(주전공만 바꿔 판정, 다전공·학생별 기준은 빼고).
// 그 학과 교육과정(모든 판)에 전공 이수구분으로 있는 과목만 전공 학점으로 센다. 다른 학과에서 전공으로 들은 과목은 일반선택(일선)으로 옮겨 판정한다(이슈 #42).
// 반대로 그 학과 과목을 일반선택으로 들은 경우는 학교 정정 절차가 확인 불가라 옮기지 않는다
const FREE = '일선';
export function CompareBox({ s, univ }: PageProps & { univ: Univ }) {
  const [ids, setIds] = useState<string[]>([]), [cx, setCx] = useState<Ctx | null>(null);
  const me = (id: string): Me => ({ ...s.me, program: id, ext: [], tracks: [], base: undefined });
  useEffect(() => { setCx(null); if (!ids.length) return; let off = false;
    loadCtx(univ, ids.flatMap(id => toProfile(me(id), univ).programs.map(p => p.id))).then(c => { if (!off) setCx(c); }, e => console.error(e)); return () => { off = true; }; }, [univ, ids.join()]); // eslint-disable-line
  const rows = useMemo(() => !cx ? [] : ids.map(id => {
    try {
      const p = toProfile(me(id), univ);
      const codes = [...new Set((univ.programs[id]?.catalogs ?? []).flatMap(c => Object.values(cx.catalogs[c]?.editions ?? {}).flat()).filter(r => univ.categories[r.t]?.includes('major')).map(r => r.c))];
      const moved = reassign(p, s.es, cx, [{ cat: FREE, of: { tags: ['major'], not: { codes } } }]);
      const r = audit(p, s.es.map((e, i) => moved[i] ? { ...e, category: moved[i] } : e), cx).programs[0].result, t = find(r, 'total'), m = find(r, 'major');
      return { id, left: t ? +Math.max(0, t.need - t.have).toFixed(1) : null, major: m ? `${+m.have.toFixed(1)} / ${m.need}` : '—', ok: r.ok };
    } catch { return { id, left: null, major: '—', ok: null }; } }), [cx, ids, s.es, s.me]); // eslint-disable-line
  return <details className="panel fold-panel"><summary><b>후보 전공 비교</b><small className="muted">학부·자유전공 입학생</small><Caret /></summary>
    <Opt label="후보 전공">
      <select className="pick" value="" disabled={ids.length >= 3} aria-label="후보 전공 고르기" onChange={e => e.target.value && setIds([...ids, e.target.value])}>
        <option value="">{ids.length >= 3 ? '후보 전공 최대 3개 선택' : '후보 전공 고르기'}</option>{primaries(univ).filter(p => !ids.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </Opt>
    {ids.length > 0 && (!cx ? <Loading /> : <div className="scroll-x tbl-box cmp"><table className="tbl"><thead><tr><th>전공</th><th>졸업까지</th><th>전공 학점</th><th>상태</th><th /></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td className="l">{univ.programs[r.id]?.name}</td><td><b>{r.left == null ? '—' : r.left}</b>{r.left != null && '학점'}</td><td>{r.major}</td>
        <td><span className={'chip ' + (r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'null')}>{r.ok === true ? '충족' : r.ok === false ? '부족' : '입력 필요'}</span></td>
        <td><button className="icon-btn sm" aria-label={`${univ.programs[r.id]?.name} 빼기`} onClick={() => setIds(ids.filter(x => x !== r.id))}><Icon id="x" size={14} /></button></td></tr>)}
    </tbody></table></div>)}
  </details>;
}
