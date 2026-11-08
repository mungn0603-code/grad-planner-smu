// 전공제도 계획(학점 플래너): 제2·3전공·부전공·연계·융합·자기설계·마이크로전공을 함께 골라 같은 기록으로 판정해 본다.
// 저장된 학적·기록은 바꾸지 않는다. 고른 전공의 교육과정 과목은 그 종류의 이수구분으로 옮긴 사본으로 평가한다(engine reassign).
// 과목 배정(한 과목은 한 곳에만)과 다전공 과목 추천은 엔진이 한다(ADR 0024). 전공선택(후보 전공 비교)·자기설계 과목 입력도 여기 둔다
import { useEffect, useMemo, useState } from 'react';
import { audit, reassign, find, type Ctx } from '../engine/audit.ts';
import type { Filter, Row, Univ } from '../engine/types.ts';
import { loadCtx, primaries, progsFor } from './data.ts';
import { toProfile, roleText, progName, OWN, type Me, type PageProps, type Prog, type State, type WhatIf } from './state.ts';
import { Caret, Fold, Loading } from './ui.tsx';

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

// 다전공·부전공 고르기. 종류를 고르고 그 종류의 전공을 더한다. 다전공은 제3전공까지(2개)
const KINDS = [['dept', '제2·3전공'], ['minor', '부전공'], ['linked', '연계전공'], ['fusion', '융합전공'], ['ism', '자기설계융합전공']] as const;
type Kind = typeof KINDS[number][0];
export function ExtFields({ univ, primary, ext, set }: { univ: Univ; primary: string; ext: Prog[]; set: (ext: Prog[]) => void }) {
  const [kind, setKind] = useState<Kind>('dept'), role = kind === 'minor' ? 'minor' : 'second';
  const opts = progsFor(univ, role).filter(p => p.kind === (kind === 'minor' ? 'dept' : kind) && p.id !== primary && !ext.some(g => g.id === p.id));
  const full = role === 'second' && ext.filter(g => g.role === 'second').length >= 2;
  return <>
    {ext.length > 0 && <ul className="chips">{ext.map(g => <li key={g.id + g.role}>
      <button className="pill on" aria-label={`${progName(univ, g)} 빼기`} onClick={() => set(ext.filter(x => x !== g))}>{progName(univ, g)} · {roleText(univ, g)} ✕</button></li>)}</ul>}
    <div className="grid">
      <label className="field">종류<select value={kind} onChange={e => setKind(e.target.value as Kind)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="field">전공<select value="" disabled={full || !opts.length} onChange={e => e.target.value && set([...ext, { id: e.target.value, role }])}>
        <option value="">{full ? '다전공은 2개까지' : '고르기'}</option>{opts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </div>
  </>;
}

// 계획 입력: 다전공·부전공과 마이크로전공(고른 순서 = 1MD~3MD)
export function WhatIfFields({ s, univ, d, set }: { s: State; univ: Univ; d: WhatIf; set: (v: Partial<WhatIf>) => void }) {
  const mdRules = mdRulesOf(univ), label = (id: string) => mdRules.find(r => r.id === id)?.label;
  return <>
    <ExtFields univ={univ} primary={s.me.program} ext={d.ext} set={ext => set({ ext })} />
    {mdRules.length > 0 && <div className="grid"><label className="field">마이크로전공<select value="" disabled={d.mds.length >= 3} onChange={e => e.target.value && set({ mds: [...d.mds, e.target.value] })}>
      <option value="">고르기</option>{mdRules.filter(r => !d.mds.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label></div>}
    {d.mds.length > 0 && <ul className="chips">
      {d.mds.map((id, k) => <li key={id}><button className="pill on" aria-label={`${label(id)} 빼기`} onClick={() => set({ mds: d.mds.filter(x => x !== id) })}>{k + 1}. {label(id)} ✕</button></li>)}</ul>}
  </>;
}

export function WhatIfBox({ s, univ, dispatch, moved }: PageProps & { univ: Univ; moved: string[] }) {
  const cur = s.whatif, empty: WhatIf = { ext: s.me.ext, mds: [] };
  const [d, setD] = useState<WhatIf>(cur ?? empty), next = wiOf(d, s.me);
  const apply = (w?: WhatIf) => dispatch({ t: 'opt', v: { whatif: w } });
  return <details className="rc fold-card wi" open><summary aria-label="전공제도 계획 접기·펼치기"><b>전공제도 계획</b><span className="v" />
    <span className="st">{cur ? '반영 중' : ''}</span><Caret corner /></summary>
    <div className="rc-body form">
      <WhatIfFields s={s} univ={univ} d={d} set={v => setD({ ...d, ...v })} />
      <div className="row">
        <button className="btn p" disabled={JSON.stringify(next) === JSON.stringify(cur)} onClick={() => apply(next)}>반영하기</button>
        {cur && <button className="btn" onClick={() => { apply(undefined); setD(empty); }}>되돌리기</button>}
      </div>
      {cur && moved.length > 0 && <Fold title={`옮긴 과목 ${moved.length}개`}><ul className="small">{moved.map(m => <li key={m}>{m}</li>)}</ul></Fold>}
      <ul className="small muted">
        <li>다전공은 제3전공까지 신청할 수 있어요. 마이크로전공은 2개 이상 이수하면 다전공·부전공·심화전공을 대신해요.</li>
        <li>신청 전에 들은 과목을 반영하려면 학기 중(개강일~종강일)에 샘물에서 이수구분 정정을 신청하세요.</li>
        {d.mds.length > 1 && <li>두 마이크로전공에 겹치는 과목은 먼저 고른 쪽에 들어가요.</li>}
      </ul>
    </div></details>;
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
  return <details className="rc fold-card wi"><summary aria-label="자기설계융합전공 과목 펼치기"><b>자기설계융합전공 과목</b><span className="v" />
    <span className="st">{own.length ? `${own.length}과목 · ${own.reduce((n, r) => n + r.cr, 0)}학점` : ''}</span><Caret corner /></summary>
    <div className="rc-body form">
      <p className="small muted">승인받은 이수계획표의 과목을 넣으세요.</p>
      {!cx ? <Loading /> : <form className="grid" onSubmit={e => { e.preventDefault(); if (hit && !own.some(r => r.c === hit.c)) { set([...own, { c: hit.c, n: hit.n, cr: hit.cr, t: '2전선' }]); setQ(''); } }}>
        <label className="field" style={{ gridColumn: '1 / -1' }}>과목명 또는 학수번호<input list="own-catalog" value={q} onChange={e => setQ(e.target.value)} placeholder={`${list.length}과목에서 검색`} />
          <datalist id="own-catalog">{list.map(r => <option key={r.c} value={`${r.c} ${r.n}`}>{`${r.cr}학점`}</option>)}</datalist></label>
        <div className="field"><button className="btn p" disabled={!hit}>{hit ? `${hit.n} 넣기` : '넣기'}</button></div>
      </form>}
      {own.length > 0 && <ul className="chips">{own.map(r => <li key={r.c}><button className="pill on" aria-label={`${r.n} 빼기`} onClick={() => set(own.filter(x => x !== r))}>{r.n} · {r.cr} ✕</button></li>)}</ul>}
    </div></details>;
}

// 전공선택: 학부·자유전공 입학생이 주전공을 정하기 전에 후보 전공을 같은 수강 기록으로 비교한다(주전공만 바꿔 판정, 다전공·학생별 기준은 빼고)
export function CompareBox({ s, univ }: PageProps & { univ: Univ }) {
  const [ids, setIds] = useState<string[]>([]), [cx, setCx] = useState<Ctx | null>(null);
  const me = (id: string): Me => ({ ...s.me, program: id, ext: [], tracks: [], base: undefined });
  useEffect(() => { setCx(null); if (!ids.length) return; let off = false;
    loadCtx(univ, ids.flatMap(id => toProfile(me(id), univ).programs.map(p => p.id))).then(c => { if (!off) setCx(c); }, e => console.error(e)); return () => { off = true; }; }, [univ, ids.join()]); // eslint-disable-line
  const rows = useMemo(() => !cx ? [] : ids.map(id => {
    try { const r = audit(toProfile(me(id), univ), s.es, cx).programs[0].result, t = find(r, 'total'), m = find(r, 'major');
      return { id, left: t ? +Math.max(0, t.need - t.have).toFixed(1) : null, major: m ? `${+m.have.toFixed(1)} / ${m.need}` : '—', ok: r.ok };
    } catch { return { id, left: null, major: '—', ok: null }; } }), [cx, ids, s.es, s.me]); // eslint-disable-line
  return <details className="rc fold-card wi"><summary aria-label="전공선택 후보 비교 펼치기"><b>전공선택 · 후보 전공 비교</b><span className="v" />
    <span className="st">{ids.length ? `${ids.length}개` : ''}</span><Caret corner /></summary>
    <div className="rc-body form">
      <p className="small muted">학부·자유전공으로 입학했다면 주전공을 고르기 전에 후보 전공마다 남은 학점을 비교해 보세요.</p>
      <div className="grid"><label className="field">후보 전공<select value="" disabled={ids.length >= 3} onChange={e => e.target.value && setIds([...ids, e.target.value])}>
        <option value="">{ids.length >= 3 ? '3개까지' : '고르기'}</option>{primaries(univ).filter(p => !ids.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
      {ids.length > 0 && (!cx ? <Loading /> : <div className="scroll-x tbl-box"><table className="tbl"><thead><tr><th>전공</th><th>졸업까지</th><th>전공 학점</th><th>상태</th><th /></tr></thead><tbody>
        {rows.map(r => <tr key={r.id}><td className="l">{univ.programs[r.id]?.name}</td><td>{r.left == null ? '—' : `${r.left}학점`}</td><td>{r.major}</td>
          <td><span className={'chip ' + (r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'null')}>{r.ok === true ? '충족' : r.ok === false ? '부족' : '입력 필요'}</span></td>
          <td><button className="icon-btn sm" aria-label={`${univ.programs[r.id]?.name} 빼기`} onClick={() => setIds(ids.filter(x => x !== r.id))}>✕</button></td></tr>)}
      </tbody></table></div>)}
    </div></details>;
}
