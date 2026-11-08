// 학점 플래너: 학점 추천(학기별 추천·바꾸기·담기)과 전공제도 계획(major.tsx)
import { useEffect, useMemo, useState } from 'react';
import type { PlanOpts } from '../engine/plan.ts';
import type { Result, Univ } from '../engine/types.ts';
import { tracksOf } from './data.ts';
import { termOrd, termLabel, OWN, type PageProps } from './state.ts';
import { runPlan, applySwaps, type PlanMsg } from './run.ts';
import { Reqs } from './reqs.tsx';
import { useWhatIf, wiOf, WhatIfFields, WhatIfBox, OwnBox, CompareBox } from './major.tsx';
import { Page, Loading, Empty, Caret, Icon, Switch } from './ui.tsx';

// 학점 추천 조건(계절학기·초과 신청·SM-CDR 트랙·전공제도 계획). 고른 뒤 추천받기를 눌러야 저장되고 추천을 다시 계산한다
function RecSettings({ s, univ, dispatch }: PageProps & { univ: Univ }) {
  const tracks = tracksOf(univ, s.me.program);
  const [d, setD] = useState({ season: s.season, overload: s.overload, tracks: s.me.tracks, wi: s.whatif ?? { ext: s.me.ext, mds: [] } });
  const set = (v: Partial<typeof d>) => setD({ ...d, ...v }), wi = wiOf(d.wi, s.me);
  const same = d.season === s.season && d.overload === s.overload && d.tracks.join() === s.me.tracks.join() && JSON.stringify(wi) === JSON.stringify(s.whatif);
  const run = () => { dispatch({ t: 'opt', v: { season: d.season, overload: d.overload, whatif: wi } }); dispatch({ t: 'me', v: { tracks: d.tracks } }); };
  return <div className="rows wi-box"><section className="rc wi"><div className="rc-body form">
    <div className="toolbar">
      <label className="row"><Switch on={d.season} set={v => set({ season: v })} label="계절학기 포함" />계절학기 포함</label>
      <label className="row" title="학교 기준(직전 학기 학점·평점)을 넘었다면 다음 학기 학점 상한을 올려 계산합니다"><Switch on={d.overload} set={v => set({ overload: v })} label="다음 학기 초과 신청" />다음 학기 초과 신청</label>
    </div>
    {!!tracks.length && <div className="tracks"><span className="muted small">SM-CDR 트랙</span><div className="row" style={{ gap: 6 }}>
      {tracks.map(t => { const on = d.tracks.includes(t.id); return <button key={t.id} className={'pill' + (on ? ' on' : '')} aria-pressed={on}
        onClick={() => set({ tracks: on ? d.tracks.filter(x => x !== t.id) : [...d.tracks, t.id] })}>{t.name}</button>; })}</div></div>}
    <WhatIfFields s={s} univ={univ} d={d.wi} set={v => set({ wi: { ...d.wi, ...v } })} />
    <div className="row"><button className="btn p" disabled={same} onClick={run}>추천받기</button></div>
  </div></section></div>;
}

export function PlanPage(props: PageProps) {
  const { s, dispatch, univ, ctx, profile, a: a0, toast } = props;
  // 전공제도 계획을 반영했으면 추천·졸업요건을 그 사본으로 계산한다
  const w = useWhatIf(props, s.whatif), pf = w?.profile ?? profile, es = w?.es ?? s.es, cx = w?.ctx ?? ctx, a = w?.a ?? a0;
  const [res, setRes] = useState<PlanMsg | null>(null), [busy, setBusy] = useState(false);
  const opts: PlanOpts = { season: s.season, overload: s.overload, tracks: s.me.tracks };
  const ready = !!(univ && ctx && profile && ctx.univ === univ && s.es.length && (!s.whatif || w));
  useEffect(() => {
    if (!ready) return; let off = false;
    const t = setTimeout(() => { setBusy(true);
      runPlan({ profile: pf!, enrollments: es, ctx: cx!, opts }).then(r => { if (!off) { setRes(r); setBusy(false); } }); }, 250);
    return () => { off = true; clearTimeout(t); };
  }, [ready, pf, es, cx, s.season, s.overload, s.me.tracks.join()]); // eslint-disable-line
  const labels = useMemo(() => { const m = new Map<string, string>([['min', '학기 최소학점'], ['repair', '보완']]);
    const walk = (r: Result) => { if (r.label && !m.has(r.id)) m.set(r.id, r.label); r.children?.forEach(walk); }; a?.programs.forEach(g => walk(g.result)); return m; }, [a]);
  // 이수 현황처럼 과목마다 이수구분만 보인다. 추천이 정한 이수구분(다전공 과목은 그 종류의 이수구분), 없으면 카탈로그 최신 판 값
  const catOf = useMemo(() => { const m = new Map<string, string>();
    for (const c of Object.values(cx?.catalogs ?? {})) for (const ed of Object.keys(c.editions).sort()) for (const r of c.editions[ed]) m.set(r.c, r.t);
    return (code: string) => m.get(code) || '이수구분 없음'; }, [cx]);
  const P = res?.plan;
  const terms = P ? [...P.fut, ...P.sea].sort((x, y) => termOrd(x) - termOrd(y)) : [];
  const fixed = (t: string) => (a ? a.items.filter(it => !it.out && it.term === t) : []);
  // 바꾸기: 고른 대체 과목을 추천 행에 덮어쓴다(후보는 엔진이 같은 요건을 채우는 과목만 준다). 지금 계획에 없는 바꾸기는 무시한다
  const [openKey, setOpenKey] = useState(''), [sub, setSub] = useState<'rec' | 'whatif'>('rec');
  const swaps = s.swaps ?? {};
  const shown = P ? applySwaps(P, swaps) : [];
  const usedCodes = new Set(shown.map(r => r.code));
  const swapN = shown.filter(r => r.swapped).length;
  const setSwap = (k: string, code: string | null) => { const { [k]: _, ...rest } = swaps; dispatch({ t: 'opt', v: { swaps: code ? { ...rest, [k]: code } : rest } }); };
  // 담기: 추천 과목을 수강 기록에 이수 예정으로 넣는다(이수 현황에 보이고, 다음 계산부터 넣어 둔 과목이 된다)
  const take = (r: { code: string; name: string; term: string }) => { dispatch({ t: 'add', es: [{ code: r.code, term: r.term, planned: true }] }); setOpenKey(''); toast(`'${r.name}' 과목을 이수 현황에 이수 예정으로 담았습니다.`); };
  if (!s.es.length) return <Page title="학점 플래너" narrow><Empty /></Page>;
  const SUB = [['rec', '학점 추천'], ['whatif', '전공제도 계획']] as const;
  const own = [...s.me.ext, ...(s.whatif?.ext ?? [])].some(g => g.id === OWN) || !!s.me.own?.length;
  return <Page title="학점 플래너"><div className="subsplit">
    <nav className="subnav" aria-label="학점 플래너 메뉴">{SUB.map(([k, l]) => <button key={k} aria-current={k === sub ? 'page' : undefined} onClick={() => setSub(k)}>{l}</button>)}</nav>
    <div className="subbody">
    {sub === 'whatif' ? <>
    {univ && <div className="rows wi-box">
      <WhatIfBox {...props} univ={univ} moved={w && a0 ? Object.entries(w.moved).map(([i, c]) => `${a0.items[+i]?.name}: ${a0.items[+i]?.cat || '—'} → ${c}`) : []} />
      {own && <OwnBox {...props} univ={univ} />}
      <CompareBox {...props} univ={univ} />
    </div>}
    {w && <><h2 className="wi-h">계획 반영 졸업요건</h2><Reqs props={props} a={w.a} profile={w.profile} ctx={w.ctx} es={w.es} plan={res} /></>}
    </> : <>
    {univ && <RecSettings {...props} univ={univ} />}
    {!ready ? <Loading /> : res?.error ? <div className="callout">추천을 계산하지 못했습니다. 새로고침해 주세요.</div> : !P ? <Loading /> : <>
      {P.unmet.length ? <details className="callout"><summary><b><Icon id="x" size={16} /> 충족 안 되는 요건 {P.unmet.length}개</b><Caret /></summary><ul>
        {P.unmet.map(u => <li key={u.program + u.id}>{u.label ?? labels.get(u.id) ?? u.id} — {+u.gap.toFixed(2)} 부족</li>)}</ul></details>
        : <div className="callout ok-box"><b><Icon id="check" size={16} /> 모든 요건 충족</b></div>}
      <p className="muted small">더 필요한 학점 {P.lb} · 남은 학기 수강 가능 {P.capacity}</p>
      {!terms.length ? <div className="ph">남은 학기가 없습니다. 마이페이지 → 정보 수정에서 현재 학기와 휴학 학기를 확인하세요.</div> :
        <>{swapN > 0 && <div className="swap-head small"><button className="lnk" onClick={() => dispatch({ t: 'opt', v: { swaps: {} } })}>처음 추천으로 되돌리기({swapN}개 바꿈)</button></div>}
        <div className={'terms' + (busy ? ' stale' : '')}>{terms.map((t, ti) => { const rows = shown.filter(r => r.term === t), fx = fixed(t);
          const load = P.load[t] + rows.reduce((x, r) => x + r.cr - r.orig.cr, 0);
          return <details className="term" key={t} open={ti === 0}><summary><b>{termLabel(t)}</b><span className="n">{rows.length + fx.length}과목 · {load} / {P.lim[t]}학점<Caret /></span></summary>
            {fx.map(it => <div className="course fixed" key={'f' + it.i}>{it.name} · {it.cr}</div>)}
            {rows.map(r => { const alts = (P.alts[r.k] ?? []).filter(x => !usedCodes.has(x.code)), open = openKey === r.k, can = alts.length > 0 || r.swapped;
              const why = <small>{can && <span className="swap-mark" aria-label="바꿀 수 있음">⇄</span>}{r.cat ?? catOf(r.code)}</small>;
              return <div className={'course' + (r.swapped ? ' swapped' : '') + (open ? ' open' : '')} key={r.k}>
                <button className="course-btn" aria-expanded={open} onClick={() => setOpenKey(open ? '' : r.k)}>{r.name} · {r.cr}{why}</button>
                {open && <div className="alts" role="group" aria-label={`${r.orig.name} 담기·바꾸기`}>
                  <button className="btn p" onClick={() => take({ code: r.code, name: r.name, term: t })}>이수 예정으로 담기</button>
                  {r.swapped && <button className="pill" onClick={() => setSwap(r.k, null)}>↺ {r.orig.name} · {r.orig.cr}</button>}
                  {alts.map(x => <button key={x.code} className="pill" onClick={() => { setSwap(r.k, x.code); setOpenKey(''); }}>{x.name} · {x.cr}</button>)}
                  {!can && <span className="muted small">바꿀 과목이 없습니다</span>}</div>}</div>; })}
            {!rows.length && !fx.length && <div className="muted small">추천 없음</div>}</details>; })}</div></>}
    </>}
    </>}
    </div></div>
  </Page>;
}
