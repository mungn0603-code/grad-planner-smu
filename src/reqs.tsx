// 학점 계산기(샘물 기준 졸업요건)와 졸업요건 요약·카드. 카드는 학점 플래너의 전공제도 계획(가정 반영)도 같이 쓴다
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { pickSet, cmpDiff, resolve, match, catalogsOf, strips, type Audit, type Ctx, type Gpa, type Item } from '../engine/audit.ts';
import type { Enrollment, Filter, Profile, Result, Row, Rule, Univ } from '../engine/types.ts';
import { nameKey } from '../engine/data.ts';
import { termOrd, termLabel, gpaText, modeOf, progName, roleText, type Me, type PageProps } from './state.ts';
import { runPlan, applySwaps, type PlanMsg } from './run.ts';
import { useChecks, CheckInput } from './checks.tsx';
import { Page, Loading, Empty, Caret, Fold } from './ui.tsx';
import { Count } from './count.tsx';

const unitOf = (r: Result) => (r.kind === 'credits' ? '학점' : r.kind === 'courses' ? '과목' : '개');
function status(r: Result): [string, string] {
  if (r.ok === null) return ['null', r.note ?? '입력 필요'];
  if (r.ok) return r.done >= r.need ? ['ok', '충족'] : ['ok soft', '들으면 충족'];
  if (r.kind === 'check') return ['bad', '기준 미달'];
  if (r.kind === 'all' && r.need >= (r.children?.length ?? 0)) return ['bad', '부족'];
  return ['bad', `${+(r.need - r.have).toFixed(2)}${unitOf(r)} 부족`];
}
const numText = (r: Result) => r.kind === 'check' ? (r.ok === null ? '' : `${r.have} / ${r.need}`)
  : r.kind === 'all' ? (r.children && r.need < r.children.length ? `${r.children.length}개 중 ${r.need}개` : '')
  : `${r.have}/${r.need}${unitOf(r)}${r.done !== r.have ? ` (이수 ${r.done})` : ''}`;

export function reportHref(x: { univ: string; program: string; year: number; rule: string }) {
  const title = `[졸업 요건 오류] ${x.univ} ${x.program} ${x.year} ${x.rule}`;
  const body = `대학: ${x.univ}\n프로그램: ${x.program}\n요건 연도: ${x.year}\n규칙 id: ${x.rule}\n\n무엇이 다른지(학교 기준 문서 링크가 있으면 함께):\n`;
  const base = import.meta.env.VITE_REPORT_URL as string | undefined;
  return { title, body, href: base ? `${base}${base.includes('?') ? '&' : '?'}title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}` : null };
}

// 요건 트리 한 칸. 전부 닫힌 채로 시작한다. 과목으로 채우는 칸은 펼치면 관련 과목, 입력 항목은 확인 방법이 나온다
function Node({ r, title, x }: { r: Result; title?: string; x: Look }) {
  const [open, setOpen] = useState(false), [cls, txt] = status(r), pct = r.need > 0 ? Math.min(100, (r.have / r.need) * 100) : 100;
  const name = <span className="nm">{title ?? r.label ?? r.id} <span className="n">{numText(r)}</span></span>;
  const tail = <><div className="bar"><i style={{ width: pct + '%' }} /></div><span className={'chip ' + cls}>{txt}</span></>;
  const rule = x.rules.get(r), f = rule && ofOf(rule, x.univ);
  const body = r.children?.length
    ? kidsOf(r).map(c => <Node key={c.id} r={c} x={x} />)
    : f && Object.keys(f).length ? <Related r={r} f={f} x={x} />
    : r.kind === 'check' && rule && (rule.hint || 'list' in rule) ? <CheckHelp rule={rule} /> : null;
  if (!body) return <div className="leaf">{name}{tail}</div>;
  return <details className="node" onToggle={e => setOpen(e.currentTarget.open)}><summary><Caret />{name}{tail}</summary>{open && <div className="kids">{body}</div>}</details>;
}

// 라벨 없는 '전부 충족' 묶음(데이터 구조용)은 한 단계 풀어서 보여 준다
const kidsOf = (r: Result) => (r.children ?? []).flatMap(c => (!c.label && c.kind === 'all' && c.children && c.need >= c.children.length ? c.children : [c]));
const findId = (r: Result | undefined, id: string): Result | undefined => !r ? undefined : r.id === id ? r : r.children?.map(c => findId(c, id)).find(Boolean);
const usedIn = (r: Result, out = new Set<number>()) => { r.used?.forEach(i => out.add(i)); r.children?.forEach(c => usedIn(c, out)); return out; };
// 카드로 보여 줄 요건: 주전공 세트의 묶음(primary·교양 필수 영역·라벨 없는 묶음)을 한 단계 풀고, 졸업 학점(요약 상자)과 기준 0인 항목은 뺀다.
// 다전공·부전공 학점 합계(ext)는 프로그램별 카드가 있으면 뺀다(ADR 0024). 학과 정보 없이 가져온 다전공('ext' 프로그램)만 있으면 합계로 보인다
// ponytail: 묶음 id(primary·gearea·ext)는 상명 천안 데이터 기준. 다른 대학을 열면 데이터에 카드 표시 여부를 둔다
const cardsOf = (r: Result, sumExt: boolean) => (r.children ?? []).flatMap(c => (c.id === 'primary' || c.id === 'gearea' || !c.label) && c.children ? c.children : [c])
  .filter(c => c.id !== 'total' && !(c.kind === 'credits' && c.need === 0) && (sumExt || c.id !== 'ext'));
export type Card = { key: string; title: string; rs: { r: Result; program: string; title?: string }[]; basis?: string; now?: Got };

// 결과 칸 → 규칙. 결과 트리와 규칙 트리를 나란히 따라간다(use는 바깥 규칙을 남긴다: hint가 거기 있을 수 있다)
function mapRules(rule: Rule, res: Result, u: Univ, out: Map<Result, Rule>) {
  if (!out.has(res)) out.set(res, rule);
  if ('use' in rule) return mapRules(u.blocks[rule.use], res, u, out);
  if ('all' in rule) rule.all.forEach((r, k) => { const c = res.children?.[k]; if (c) mapRules(r, c, u, out); });
}
const ofOf = (rule: Rule, u: Univ): Filter | undefined => 'use' in rule ? ofOf(u.blocks[rule.use], u) : 'of' in rule ? rule.of : undefined;

// 요건 칸을 펼쳤을 때 쓰는 조회표: 칸별 규칙, 수강 기록, 아직 안 들은 카탈로그 과목(최신 판)
type Look = { rules: Map<Result, Rule>; items: Item[]; es: Enrollment[]; univ: Univ; todo: (f: Filter) => Item[] };
function lookOf(a: Audit, profile: Profile, ctx: Ctx, es: Enrollment[]): Look {
  const u = ctx.univ, rules = new Map<Result, Rule>();
  for (const g of profile.programs) { try { const st = pickSet(profile, g, u), r = a.programs.find(x => x.id === g.id)?.result; if (st && r) mapRules(st.rule, r, u, rules); } catch { /* 세트 겹침은 화면 위 오류로 보인다 */ } }
  const cats = catalogsOf(profile, ctx), sp = strips(ctx, cats), ns = (f?: Filter) => f?.names && new Set(f.names.map(n => nameKey(n, sp)));
  const codes = new Set<string>(), keys = new Set<string>();
  a.items.filter(it => !it.out).forEach(it => { it.ids.forEach(c => codes.add(c)); keys.add(it.key); });
  // 추천하지 않는 과목(교직·다른 학과 전용 교양, 내국인에게 유학생 전용)은 '들을 과목'에서 뺀다
  const excl = [...u.policy.noPlan, ...(profile.student === 'international' ? [] : u.policy.intlOnly)];
  let cat: Item[] | undefined;
  const todo = (f: Filter) => {
    if (!cat) { const seen = new Set<string>(), rows: Row[] = [];
      for (const c of cats) { const eds = Object.keys(c.editions).sort(); for (const r of c.editions[eds[eds.length - 1]]) if (!seen.has(r.c)) { seen.add(r.c); rows.push(r); } }
      cat = resolve(profile, rows.map(r => ({ code: r.c, planned: true as const })), ctx).items.filter(it => !excl.some(e => match(it, e, ns(e)))); }
    const nf = ns(f), nn = ns(f.not);
    return cat.filter(it => !keys.has(it.key) && ![...it.ids].some(c => codes.has(c)) && match(it, { ...f, not: undefined }, nf) && !(f.not && match(it, f.not, nn)));
  };
  return { rules, items: a.items, es, univ: u, todo };
}

// 요건 칸 하나에서 아직 안 들은 과목. 들은 과목은 '들어간 과목'에만 보인다(같은 표를 두 번 보이지 않는다)
function Related({ r, f, x }: { r: Result; f: Filter; x: Look }) {
  const todo = useMemo(() => x.todo(f), [x, f]), gap = +(r.need - r.have).toFixed(2);
  return <div className="rel">
    {r.ok === false && <p className="small">이 중에서 <b>{gap}{unitOf(r)}</b> 더 들어야 합니다.</p>}
    {!todo.length ? <p className="muted small">더 들을 수 있는 과목이 없습니다.</p> :
      <div className="scroll-x tbl-box"><table className="tbl"><thead><tr><th>과목명</th><th>학점</th><th>이수구분</th><th>학수번호</th></tr></thead><tbody>
        {todo.map(it => <tr key={it.code}><td className="l">{it.name}</td><td>{it.cr}</td><td>{it.cat || '—'}</td><td className="muted">{it.code}</td></tr>)}
      </tbody></table></div>}
  </div>;
}

// 성적표로 알 수 없는 입력 항목(비교과·인증·평점)의 확인 방법. 규칙에 프로그램 목록(list)이 있으면 보여 준다
const isGpa = (rule: Rule | undefined, u: Univ) => !!rule && 'check' in rule && rule.check === u.policy.gpa?.check;
function CheckHelp({ rule, gpa }: { rule?: Rule; gpa?: Gpa }) {
  const list = rule && 'list' in rule ? rule.list : undefined;
  return <div className="rel small">
    {gpa && <p>평점평균 <b className="gpa">{gpaText(gpa.gpa)}</b> / 4.5 ({gpa.cr}학점). 공식 평점은 샘물에서 확인하세요.</p>}
    {rule?.hint && <p>{rule.hint}</p>}
    {!!list?.length && <><p>인정되는 비교과 프로그램 {list.length}개</p><ul>{list.map(n => <li key={n}>{n}</li>)}</ul></>}
  </div>;
}

// 펼친 카드 맨 위 안내. 하위 항목이 있으면 몇 개를 채워야 하는지만 적는다(인정 기준 문구는 화면에 쓰지 않는다, 이슈 #42)
function basis(rule: Rule | undefined, r: Result, u: Univ): string | undefined {
  if (!rule) return;
  if (rule.hint) return rule.hint;
  if ('use' in rule) return basis(u.blocks[rule.use], r, u);
  if ('all' in rule) { const n = (r.children ?? []).filter(c => c.label).length; return n ? (r.need < n ? `아래 ${n}개 중 ${r.need}개를 채우면 돼요` : `아래 ${n}개를 모두 채워야 해요`) : undefined; }
}
// 들은 학점을 이수구분별로(1전선·전선 → 전선처럼 앞 숫자는 뺀다), 많은 순
type Got = { got: [string, number][]; left: number };
function breakdown(r: Result, items: Item[], es: Enrollment[]): Got | undefined {
  if (r.kind !== 'credits') return;
  const m = new Map<string, number>();
  for (const i of r.used ?? []) { const it = items[i]; if (!it) continue; const c = (es[it.i]?.category ?? it.cat ?? '기타').replace(/^\d/, ''); m.set(c, (m.get(c) ?? 0) + it.cr); }
  return { got: [...m].map(([c, n]): [string, number] => [c, +n.toFixed(1)]).sort((x, y) => y[1] - x[1]), left: +Math.max(0, r.need - r.have).toFixed(1) };
}
// 예: 전선 21학점, 전심 6학점 이수 · 48학점 남음
const GotLine = ({ g }: { g: Got }) => <p className="basis got">
  {g.got.length ? <>{g.got.map(([c, n], i) => <span key={c}>{i > 0 && ', '}{c} <b>{n}</b>학점</span>)} 이수</> : '이수 없음'}
  {' · '}{g.left > 0 ? <><b>{g.left}</b>학점 남음</> : '충족'}</p>;
const subIds = (program: string, r: Result, out = new Set<string>()) => { out.add(`${program}.${r.id}`); r.children?.forEach(c => subIds(program, c, out)); return out; };

export function ResultPage(props: PageProps) {
  const { s, univ, ctx, profile, a } = props;
  // 카드를 펼쳤을 때 보이는 '채울 추천 과목'은 학점 플래너와 같은 추천을 쓴다(같은 옵션·바꾸기)
  // ponytail: 화면에 들어올 때마다 추천을 다시 푼다(Worker, 수백 ms). 느려지면 학점 플래너와 결과를 나눠 갖는다
  const [plan, setPlan] = useState<PlanMsg | null>(null);
  const ready = !!(univ && ctx && profile && ctx.univ === univ && s.es.length);
  useEffect(() => { if (!ready) return; let off = false;
    runPlan({ profile: profile!, enrollments: s.es, ctx: ctx!, opts: { season: s.season, overload: s.overload, tracks: s.me.tracks } }).then(r => { if (!off) setPlan(r); });
    return () => { off = true; }; }, [ready, profile, s.es, s.season, s.overload, s.me.tracks.join()]); // eslint-disable-line
  const prog = univ?.programs[s.me.program];
  const sub = prog && profile ? `${s.me.year}학번 ${prog.name} · ${modeOf(profile, s.me)}` : undefined;
  if (!s.es.length) return <Page title="학점 계산기" narrow><Empty /></Page>;
  if (!univ || !profile || !a || !ready) return <Page title="학점 계산기" sub={sub}><Loading /></Page>;
  return <Page title="학점 계산기" sub={sub}><Reqs props={props} a={a} profile={profile} ctx={ctx!} es={s.es} plan={plan} calc /></Page>;
}

// 졸업요건 요약과 상태별 카드. 학점 계산기(샘물 기준, calc)와 학점 플래너(가정 반영)가 같이 쓴다
export function Reqs({ props, a, profile, ctx, es, plan, calc }: { props: PageProps; a: Audit; profile: Profile; ctx: Ctx; es: Enrollment[]; plan: PlanMsg | null; calc?: boolean }) {
  const { s, dispatch, toast } = props, univ = ctx.univ;
  const look = useMemo(() => lookOf(a, profile, ctx, es), [a, profile, ctx, es]);
  const checks = useChecks(props), setMe = (v: Partial<Me>) => dispatch({ t: 'me', v });
  const checkOf = (r: Result) => checks.groups.flatMap(g => g.checks).find(c => c.key === r.id || c.label === r.label);
  const primary = a.programs.find(g => g.role === 'primary'), prim = primary?.result;
  const total = findId(prim, 'total');
  const pct = total && total.need ? Math.min(100, Math.round((total.have / total.need) * 100)) : 0;
  const tracks = calc ? a.programs.filter(g => g.role === 'track') : [];
  const exts = profile.programs.filter(g => g.role === 'second' || g.role === 'minor' || g.role === 'micro');
  const cards: Card[] = [
    ...(prim ? cardsOf(prim, exts.some(g => g.id === 'ext')).map(r => ({ key: r.id, title: r.label ?? r.id, rs: [{ r, program: primary!.id }],
      basis: basis(look.rules.get(r), r, univ), now: breakdown(r, a.items, es) })) : []),
    ...exts.filter(g => g.id !== 'ext').flatMap(g => { const res = a.programs.find(x => x.id === g.id)?.result; return res ? [{ key: g.id,
      title: g.role === 'micro' ? roleText(univ, g) : `${progName(univ, g)} · ${roleText(univ, g)}`, rs: [{ r: top(res), program: g.id }], now: breakdown(top(res), a.items, es) }] : []; }),
  ];
  const report = (program: string) => (rule: string) => {
    const x = reportHref({ univ: univ.id, program, year: s.me.year, rule });
    if (x.href) window.open(x.href, '_blank', 'noopener');
    else navigator.clipboard?.writeText(`${x.title}\n${x.body}`).then(() => toast('신고 내용을 복사했습니다(개인정보 없음). 문의 채널에 붙여넣어 주세요.'), () => toast(x.title));
  };
  // 샘물 학점 대조는 샘물 기준(학점 계산기)에서만 한다
  const warns = [...new Set([...a.warnings, ...(calc && s.me.cmp ? cmpDiff(a.items, es, s.me.cmp) : [])])];
  // 상태별로 나눈다: 부족 → 입력 필요 → 충족. 부족은 학점 요건을 남은 학점이 많은 순으로 먼저(docs/decisions/0015)
  const gap = (c: Card) => { const r = c.rs[0].r; return r.kind === 'credits' ? r.need - r.have : -1; };
  const groups: [string, Card[]][] = [['부족', cards.filter(c => c.rs[0].r.ok === false).sort((p, q) => gap(q) - gap(p))],
    ['입력 필요', cards.filter(c => c.rs[0].r.ok === null)], ['충족', cards.filter(c => c.rs[0].r.ok === true)]];
  const row = (c: Card) => { const r = c.rs[0].r, ck = r.kind === 'check' ? checkOf(r) : undefined;
    return <ResultCard key={c.key} c={c} input={ck && <CheckInput c={ck} me={s.me} set={setMe} bare />}
      body={r.kind === 'check' ? <CheckHelp rule={look.rules.get(r)} gpa={isGpa(look.rules.get(r), univ) ? a.gpa : undefined} /> : <Detail c={c} x={look} report={report} recs={recsFor(c, plan, s.swaps ?? {})} />} />; };
  return <>
    <section className="box summary">
      {total ? <>
        <div className="sum-top">
          <div><span className="lbl">졸업까지</span><div className="big"><Count value={+Math.max(0, total.need - total.have).toFixed(1)} /><small>학점 남음</small></div></div>
          <span className="sum">{+total.have.toFixed(1)} / {total.need}학점</span>
        </div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
        <div className="sum-foot"><span className="counts">{groups.map(([l, cs]) => <span key={l}>{l} <b>{cs.length}</b></span>)}</span>
          {calc && groups[0][1].length > 0 && <a className="btn p" href="#/plan">학점 플래너에서 채우기</a>}</div>
      </>: <p className="muted">이 학번·학과는 아직 지원하지 않습니다.</p>}
      {warns.length > 0 && <Fold title={`확인할 점 ${warns.length}개`}><ul className="warn">{warns.map(w => <li key={w}>{w}</li>)}</ul></Fold>}
    </section>
    {groups.map(([l, cs]) => cs.length > 0 && <section className="req" key={l}><h2>{l} <span className="n">{cs.length}</span></h2><div className="rows">{cs.map(row)}</div></section>)}
    {!!tracks.length && <section className="req"><h2>진로 트랙 인증 <span className="n">SM-CDR · 선택</span></h2><div className="rows">
      {(() => { const mine = tracks.filter(g => s.me.tracks.includes(g.id)), list = mine.length ? mine : tracks;
        const tc: Card = { key: 'tracks', title: '진로 트랙 인증(SM-CDR)', rs: list.map(g => ({ r: g.result, program: g.id, title: univ.programs[g.id]?.name })) };
        const gs = checks.groups.filter(g => tc.rs.some(x => x.program === g.id));
        return <details className="rc fold-card"><summary aria-label="진로 트랙 인증(SM-CDR) 펼치기"><b>트랙 고르기·인증 항목</b>
          <span className="v" /><span className="st">{mine.length ? `고른 트랙 ${mine.length}개` : '고른 트랙 없음'}</span><Caret corner /></summary>
          <div className="rc-body">
            <p className="small muted">인증받으려는 트랙을 고르세요. 고른 트랙은 학점 플래너 추천에도 반영됩니다.</p>
            <div className="row pills">{tracks.map(g => { const on = s.me.tracks.includes(g.id);
              return <button key={g.id} className={'pill' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setMe({ tracks: on ? s.me.tracks.filter(x => x !== g.id) : [...s.me.tracks, g.id] })}>{univ.programs[g.id]?.name ?? g.id}</button>; })}</div>
            <h3>{mine.length ? '고른 트랙' : '전체 트랙'}</h3>
            <Detail c={tc} x={look} report={report} recs={recsFor(tc, plan, s.swaps ?? {})}
              extra={gs.length > 0 && <Fold title="인증 항목 입력"><div className="form">{gs.map(g => <div key={g.id} className="track-checks"><b>{g.name}</b><div className="grid checks">{g.checks.map(checks.input)}</div></div>)}</div></Fold>} />
          </div></details>; })()}
    </div></section>}
  </>;
}
const top = (r: Result): Result => !r.label && r.children?.length === 1 ? top(r.children[0]) : r; // 이름 없는 세트 껍데기는 벗긴다

// 이 카드 요건을 채우는 학점 플래너 추천(바꾸기 반영). null = 아직 계산 중
function recsFor(c: Card, plan: PlanMsg | null, swaps: Record<string, string>) {
  if (!plan?.plan) return plan?.error ? [] : null;
  const ids = new Set(c.rs.flatMap(x => [...subIds(x.program, x.r)]));
  return applySwaps(plan.plan, swaps).filter(r => (r.orig.keys ?? []).some(k => ids.has(k)));
}

// 요건 한 줄. 닫힌 채로 시작하고, 펼치면 인정 기준과 입력 칸(평점·인증)이나 요건 트리·들어간 과목·채울 추천 과목이 나온다
function ResultCard({ c, input, body }: { c: Card; input?: ReactNode; body?: ReactNode }) {
  const r = c.rs[0].r, [cls, txt] = status(r), pct = r.need > 0 ? Math.min(100, (r.have / r.need) * 100) : 100;
  const v = r.kind === 'check' ? (r.ok === null ? '미입력' : r.need === 1 ? (r.ok ? '인증 완료' : '미인증') : Number.isInteger(r.have) ? String(r.have) : r.have.toFixed(2))
    : <>{+r.have.toFixed(1)}<small> / {r.need}{r.kind === 'all' ? '' : unitOf(r)}</small></>;
  const tone = r.ok === true ? 'ok' : r.ok === false ? 'bad' : '', [open, setOpen] = useState(false);
  return <details className={'rc fold-card ' + tone} onToggle={e => setOpen(e.currentTarget.open)}><summary aria-label={`${c.title} 펼치기`}><b>{c.title}</b><span className="v">{v}</span>
    {r.kind !== 'check' ? <div className="bar"><i style={{ width: pct + '%' }} /></div> : <span />}
    {r.kind === 'check' && r.ok === null ? <span className="st null">펼쳐서 입력</span> : <span className={'st ' + cls.split(' ')[0]}>{txt}</span>}<Caret corner /></summary>
    {open && <div className="rc-body">{c.now && <GotLine g={c.now} />}{c.basis && <p className="basis">{c.basis}</p>}
      {input && <div className="rc-input">{input}</div>}{body}</div>}</details>;
}

function Detail({ c, x, report, extra, recs }: { c: Card; x: Look; report: (program: string) => (rule: string) => void; extra?: ReactNode; recs?: { term: string; code: string; name: string; cr: number }[] | null }) {
  const used = [...new Set(c.rs.flatMap(y => [...usedIn(y.r)]))].map(i => x.items[i]).filter(Boolean).sort((p, q) => termOrd(p.term) - termOrd(q.term));
  const lacking = c.rs.filter(y => y.r.ok === false);
  // 행에 이미 이름·값·상태가 있으니 요건 자신은 다시 그리지 않는다. 트랙처럼 여럿이면 트랙마다 한 줄
  const one = c.rs.length === 1 ? c.rs[0] : null, f = one && !one.r.children?.length ? (() => { const rule = x.rules.get(one.r); return rule && ofOf(rule, x.univ); })() : undefined;
  return <>
    {!one ? <div className="tree">{c.rs.map(y => <Node key={y.program + y.r.id} r={y.r} title={y.title} x={x} />)}</div>
      : one.r.children?.length ? <div className="tree">{kidsOf(one.r).map(k => <Node key={k.id} r={k} x={x} />)}</div> : null}
    <Fold title={`들어간 과목 ${used.length}개`}>
      {!used.length ? <p className="muted small">아직 이 요건에 들어간 과목이 없습니다.</p> :
        <div className="scroll-x tbl-box"><table className="tbl"><thead><tr><th>학기</th><th>학수번호</th><th>과목명</th><th>이수구분</th><th>학점</th><th>성적</th><th>상태</th></tr></thead><tbody>
          {used.map(it => <tr key={it.i}><td>{termLabel(it.term)}</td><td>{it.code ?? '—'}</td><td className="l">{it.name}</td><td>{x.es[it.i]?.category ?? it.cat ?? '—'}</td><td>{it.cr}</td><td>{x.es[it.i]?.grade ?? '—'}</td>
            <td>{it.planned ? <span className="chip null">수강 중·이수 예정</span> : <span className="chip ok">이수</span>}</td></tr>)}
        </tbody></table></div>}
    </Fold>
    {f && Object.keys(f).length > 0 && <Fold title="아직 안 들은 관련 과목"><Related r={one!.r} f={f} x={x} /></Fold>}
    {extra}
    {lacking.length > 0 && <Fold title={`채울 수 있는 추천 과목${recs ? ` ${recs.length}개` : ''}`}>
      {recs == null ? <p className="muted small">추천을 계산하는 중…</p>
        : !recs.length ? <p className="muted small">남은 학기에 이 요건을 채울 추천 과목이 없습니다.</p>
        : <><div className="recs">{recs.map(r => <span key={r.term + r.code} className="rec"><b>{termLabel(r.term)}</b>{r.name} · {r.cr}</span>)}</div>
          <p className="small"><a className="lnk" href="#/plan">학점 플래너에서 담거나 다른 과목으로 바꾸기</a></p></>}
    </Fold>}
    {one && <p className="small"><button className="lnk muted" onClick={() => report(one.program)(one.r.id)}>학교 안내와 다르면 알려 주세요</button></p>}
  </>;
}
