// 학점 플래너: 학점 추천(학기별 추천·바꾸기·담기)과 전공제도 계획(major.tsx). 조건을 바꾸면 바로 저장하고 다시 계산한다(확인 버튼 없음, 이슈 #42)
import { useEffect, useMemo, useState } from 'react';
import type { PlanOpts } from '../engine/plan.ts';
import type { Result, Univ } from '../engine/types.ts';
import { tracksOf } from './data.ts';
import { termOrd, termLabel, OWN, modeOf, progName, type PageProps, type State } from './state.ts';
import { runPlan, applySwaps, type PlanMsg } from './run.ts';
import { Reqs } from './reqs.tsx';
import { useWhatIf, wiOf, WhatIfFields, WhatIfBox, OwnBox, CompareBox, Opt } from './major.tsx';
import { Page, Loading, Empty, Icon, Switch } from './ui.tsx';

// 학점 추천 조건(계절학기·초과 신청·SM-CDR 트랙·전공제도). 바꾸면 바로 반영된다
function RecSettings({ s, univ, dispatch }: PageProps & { univ: Univ }) {
  const tracks = tracksOf(univ, s.me.program), wi = s.whatif ?? { ext: s.me.ext, mds: [] };
  const opt = (v: Partial<Pick<State, 'season' | 'overload' | 'whatif'>>) => dispatch({ t: 'opt', v });
  return <section className="panel">
    <Opt label="학기"><div className="toggles">
      <label className="tg"><Switch on={s.season} set={v => opt({ season: v })} label="계절학기 포함" />계절학기 포함</label>
      <label className="tg" title="학교 기준(직전 학기 학점·평점)을 넘었다면 다음 학기 학점 상한을 올려 계산합니다"><Switch on={s.overload} set={v => opt({ overload: v })} label="다음 학기 초과 신청" />다음 학기 초과 신청</label>
    </div></Opt>
    {!!tracks.length && <Opt label="SM-CDR 트랙"><div className="kinds" role="group" aria-label="SM-CDR 트랙">{tracks.map(t => { const on = s.me.tracks.includes(t.id);
      return <button key={t.id} type="button" aria-pressed={on} onClick={() => dispatch({ t: 'me', v: { tracks: on ? s.me.tracks.filter(x => x !== t.id) : [...s.me.tracks, t.id] } })}>{t.name}</button>; })}</div></Opt>}
    <WhatIfFields s={s} univ={univ} d={wi} set={v => opt({ whatif: wiOf({ ...wi, ...v }, s.me) })} />
  </section>;
}

// 추천 과목의 이수구분 묶음(색): 주전공·다전공·마이크로전공·교양
const grp = (u: Univ, c: string) => { const t = u.categories[c] ?? []; return t.includes('major') ? 'mj' : t.includes('major2') ? 'm2' : t.includes('md') ? 'md' : t.includes('ge') ? 'ge' : ''; };

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
  // 과목마다 이수구분만 보인다. 추천이 정한 이수구분(다전공 과목은 그 종류의 이수구분), 없으면 카탈로그 최신 판 값
  const catOf = useMemo(() => { const m = new Map<string, string>();
    for (const c of Object.values(cx?.catalogs ?? {})) for (const ed of Object.keys(c.editions).sort()) for (const r of c.editions[ed]) m.set(r.c, r.t);
    return (code: string) => m.get(code) || ''; }, [cx]);
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
  const take = (r: { code: string; name: string; term: string }) => { dispatch({ t: 'add', es: [{ code: r.code, term: r.term, planned: true }] }); setOpenKey(''); toast(`'${r.name}' 과목을 이수 예정으로 담았습니다.`); };
  if (!s.es.length) return <Page title="학점 플래너" narrow><Empty /></Page>;
  const SUB = [['rec', '학점 추천'], ['whatif', '전공제도 계획']] as const;
  const own = [...s.me.ext, ...(s.whatif?.ext ?? [])].some(g => g.id === OWN) || !!s.me.own?.length;
  // 지금 계산 중인 전공제도 한 줄(예: 심화전공 / 다전공 · 경영공학과)
  const now = pf && univ ? [modeOf(pf, s.me), ...pf.programs.filter(g => g.role === 'second' || g.role === 'minor').map(g => progName(univ, g))].join(' · ') : undefined;
  return <Page title="학점 플래너" sub={now}><div className="subsplit">
    <nav className="subnav" aria-label="학점 플래너 메뉴">{SUB.map(([k, l]) => <button key={k} aria-current={k === sub ? 'page' : undefined} onClick={() => setSub(k)}>{l}</button>)}</nav>
    <div className="subbody">
    {sub === 'whatif' ? <>
      {univ && <WhatIfBox {...props} univ={univ} moved={w && a0 ? Object.entries(w.moved).map(([i, c]) => `${a0.items[+i]?.name}: ${a0.items[+i]?.cat || '—'} → ${c}`) : []} />}
      {own && univ && <OwnBox {...props} univ={univ} />}
      {!ready || !a || !pf || !cx ? <Loading /> : <Reqs props={props} a={a} profile={pf} ctx={cx} es={es} plan={res} />}
      {univ && <CompareBox {...props} univ={univ} />}
    </> : <>
    {univ && <RecSettings {...props} univ={univ} />}
    {!ready ? <Loading /> : res?.error ? <div className="callout">추천을 계산하지 못했습니다. 새로고침해 주세요.</div> : !P ? <Loading /> : <>
      <section className={'plan-sum' + (busy ? ' stale' : '')}>
        <div className={'verdict ' + (P.unmet.length ? 'bad' : 'ok')}><Icon id={P.unmet.length ? 'x' : 'check'} size={18} />{P.unmet.length ? `못 채우는 요건 ${P.unmet.length}개` : '모든 요건 충족'}</div>
        <dl className="stats">
          <div><dt>더 들을 학점</dt><dd>{P.lb}</dd></div>
          <div><dt>남은 학기</dt><dd>{terms.length}</dd></div>
          <div><dt>수강 가능 학점</dt><dd>{P.capacity}</dd></div>
        </dl>
        {P.unmet.length > 0 && <ul className="unmet">{P.unmet.map(u => <li key={u.program + u.id}>{u.label ?? labels.get(u.id) ?? u.id}<b>{+u.gap.toFixed(2)} 부족</b></li>)}</ul>}
      </section>
      {!terms.length ? <div className="ph">남은 학기가 없습니다. 마이페이지 → 정보 수정에서 현재 학기와 휴학 학기를 확인하세요.</div> :
        <>{swapN > 0 && <div className="swap-head small"><button className="lnk" onClick={() => dispatch({ t: 'opt', v: { swaps: {} } })}>처음 추천으로 되돌리기({swapN}개 바꿈)</button></div>}
        <div className={'terms' + (busy ? ' stale' : '')}>{terms.map(t => { const rows = shown.filter(r => r.term === t), fx = fixed(t);
          const load = P.load[t] + rows.reduce((x, r) => x + r.cr - r.orig.cr, 0), lim = P.lim[t];
          return <section className="term" key={t}>
            <header><b>{termLabel(t)}</b><span className="n"><b>{load}</b> / {lim}학점</span>
              <div className="load" aria-hidden="true"><i style={{ width: Math.min(100, lim ? load / lim * 100 : 0) + '%' }} /></div></header>
            {fx.map(it => <div className="course fixed" key={'f' + it.i}><span className="c-n">{it.name}</span><span className="c-cr">{it.cr}</span>
              <small><Icon id="check" size={13} />담은 과목</small></div>)}
            {rows.map(r => { const alts = (P.alts[r.k] ?? []).filter(x => !usedCodes.has(x.code)), open = openKey === r.k, can = alts.length > 0 || r.swapped, cat = r.cat ?? catOf(r.code);
              return <div className={'course' + (r.swapped ? ' swapped' : '') + (open ? ' open' : '')} key={r.k}>
                <button className="course-btn" aria-expanded={open} onClick={() => setOpenKey(open ? '' : r.k)}><span className="c-n">{r.name}</span><span className="c-cr">{r.cr}</span>
                  <small>{cat && univ && <span className={'cat ' + grp(univ, cat)}>{cat}</span>}{can && <span className="swap-mark" role="img" aria-label="다른 과목으로 바꾸기 가능" title="다른 과목으로 바꾸기 가능"><Icon id="swap" size={14} /></span>}</small></button>
                {open && <div className="alts" role="group" aria-label={`${r.orig.name} 담기·바꾸기`}>
                  <button className="btn p" onClick={() => take({ code: r.code, name: r.name, term: t })}>이수 예정으로 담기</button>
                  {r.swapped && <button className="pill" onClick={() => setSwap(r.k, null)}>↺ {r.orig.name} · {r.orig.cr}</button>}
                  {alts.map(x => <button key={x.code} className="pill" onClick={() => { setSwap(r.k, x.code); setOpenKey(''); }}>{x.name} · {x.cr}</button>)}</div>}</div>; })}
            {!rows.length && !fx.length && <div className="muted small empty-t">추천 과목 없음</div>}</section>; })}</div></>}
    </>}
    </>}
    </div></div>
  </Page>;
}
