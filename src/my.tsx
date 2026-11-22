// 마이페이지: 내 정보·정보 수정·직접 입력 항목·계정. 과목 목록·추가·삭제는 이수 현황(record.tsx)
import { useMemo, useState } from 'react';
import type { Ctx } from '../engine/audit.ts';
import type { Enrollment, Row, Univ } from '../engine/types.ts';
import { primaries, yearsOf, collegesOf } from './data.ts';
import { termOrd, termLabel, termOptions, isPlanned, blank, modeOf, progName, roleText, canDeep, type Me, type PageProps } from './state.ts';
import { useChecks } from './checks.tsx';
import { MajorRows } from './join.tsx';
import { ExtFields } from './major.tsx';
import { Page, Seg, Switch, Caret, Loading, LoginButtons } from './ui.tsx';
import { logout, quit, type Acct } from './account.ts';

type AcctProps = { acct: Acct | null | undefined; setAcct: (a: Acct | null) => void };

export function MyPage(p: PageProps & AcctProps) {
  const { s, univ, profile } = p, me = s.me;
  const prog = univ?.programs[me.program];
  const checks = useChecks(p);
  // 샘물에서 가져왔으면 학적의 다전공 이름 그대로, 아니면 직접 고른 다전공·부전공
  const majors = me.majors ?? (univ ? me.ext.map(g => ({ kind: roleText(univ, g), name: progName(univ, g) })) : []);
  return <Page title="마이페이지" sub={<a className="cta small-cta" href="#/result">학점 계산기 보기</a>} narrow>
      <div className="box">
        <h2>내 정보</h2>
        {!me.sno && !s.es.length ? <p className="muted">아직 가져온 정보가 없습니다.</p> : <table className="info"><tbody>
          {me.sno && <tr><td>학번</td><td>{me.sno}</td></tr>}{me.name && <tr><td>이름</td><td>{me.name}</td></tr>}
          <tr><td>학과</td><td>{prog?.name ?? '—'}</td></tr>
          <tr><td>입학구분</td><td>{me.entr ?? ({ freshman: '신입', transfer: '편입', bachelor: '학사편입' })[me.admission]}{me.student === 'international' ? ' · 유학생' : ''}</td></tr>
          {profile && <tr><td>이수 형태</td><td>{modeOf(profile, me)}</td></tr>}
          <MajorRows ms={majors} />
          <tr><td>입학년도</td><td>{me.year || '—'}</td></tr>
          {me.base?.GRDT_CMP_CDT != null && <tr><td>졸업 기준학점</td><td>{me.base.GRDT_CMP_CDT}학점</td></tr>}
          <tr><td>현재 학기</td><td>{me.now || '졸업'}</td></tr>
        </tbody></table>}
        <details className="fold"><summary><span>정보 수정 <small className="muted">{me.sno ? '학과·현재 학기·휴학' : '학과·다전공·편입·휴학'}</small></span><Caret /></summary>
          <div className="fold-body"><ProfileForm {...p} /></div></details>
        {!!checks.count && <details className="fold"><summary><span>직접 입력 항목 <small className="muted">평점·인증 등 {checks.count}개</small></span><Caret /></summary>
          <div className="fold-body">{checks.form}</div></details>}
        <Account {...p} />
      </div>
  </Page>;
}

function ProfileForm({ s, dispatch, univ }: PageProps) {
  const me = s.me, set = (v: Partial<Me>) => dispatch({ t: 'me', v });
  const progs = univ ? primaries(univ) : [], dataYears = univ && me.program ? yearsOf(univ, me.program) : [];
  const thisYear = new Date().getFullYear();
  const years = [...new Set([...dataYears, ...Array.from({ length: 8 }, (_, i) => thisYear - i)])].sort((a, b) => b - a);
  const [leaveOn, setLeaveOn] = useState(me.leaves.length > 0);
  const [picked, setCollege] = useState<string | null>(null), college = picked ?? progs.find(p => p.id === me.program)?.college ?? ''; // 학과를 고르기 전 단과대만 바꾼 상태
  const inCollege = progs.filter(p => p.college === college);
  const leaveTerms = termOptions(me.year || thisYear, true).filter(t => !me.now || termOrd(t) <= termOrd(me.now) + 2);
  const setProgram = (program: string) => set({ program, year: 0, tracks: [], ext: me.ext.filter(g => g.id !== program) });
  return <div className="form">
    <div className="grid">
      <label className="field">단과대학<select value={college} disabled={!univ} onChange={e => { const c = e.target.value; setCollege(c); const first = progs.find(p => p.college === c); if (first && first.college !== progs.find(p => p.id === me.program)?.college) setProgram(first.id); }}>
        {collegesOf(progs).map(c => <option key={c} value={c}>{c || '기타'}</option>)}</select></label>
      <label className="field">학과·전공<select value={me.program} disabled={!univ} onChange={e => setProgram(e.target.value)}>
        {inCollege.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field">현재 학기<select value={me.now} onChange={e => set({ now: e.target.value })}>
        {termOptions(me.year || thisYear, true).map(t => <option key={t} value={t}>{t}</option>)}<option value="">졸업(남은 학기 없음)</option></select></label>
      {/* 샘물에서 가져왔으면 입학년도(학번)·다전공·입학구분·유학생 여부는 샘물 학적 값을 쓰고 고치지 않는다 */}
      {!me.sno && <>
        <label className="field">입학년도<select value={me.year} onChange={e => set({ year: +e.target.value })}>
          {years.map(y => <option key={y} value={y}>{y}{dataYears.includes(y) ? '' : ' (미지원)'}</option>)}</select></label>
        <label className="field">입학 유형<select value={me.admission} onChange={e => set({ admission: e.target.value as Me['admission'] })}>
          <option value="freshman">신입</option><option value="transfer">일반편입</option><option value="bachelor">학사편입</option></select></label>
        <label className="field">학생 유형<select value={me.student} onChange={e => set({ student: e.target.value as Me['student'] })}>
          <option value="domestic">내국인</option><option value="international">외국인특별전형</option></select></label>
      </>}
    </div>
    {!me.sno && univ && <div className="field">전공제도<ExtFields univ={univ} primary={me.program} ext={me.ext} set={ext => set({ ext })} deep={canDeep(me)} /></div>}
    {me.sno ? <p className="muted small">학적이 바뀌었으면 샘물에서 다시 가져오세요.</p>
      : me.admission !== 'freshman' && <p className="muted small">편입 인정학점은 과목 추가에서 '편입 인정(일괄)'로 넣습니다.</p>}
    <label className="check-row"><Switch on={!!me.exempt} set={v => set({ exempt: v ? true : undefined })} label="전공제도 이수 제외 대상" />
      <span>전공제도 이수 제외 대상<small className="muted">공학인증·체육특기자·특수교육대상자 등</small></span></label>
    <div className="leave">
      <label className="check-row"><Switch on={leaveOn} set={v => { setLeaveOn(v); if (!v) set({ leaves: [] }); }} label="휴학한 학기가 있음" />
        <span>휴학한 학기가 있음</span></label>
      {leaveOn && <div className="chips" role="group" aria-label="휴학 학기">{leaveTerms.map(t => { const on = me.leaves.includes(t);
        return <button key={t} type="button" className={'pill' + (on ? ' on' : '')} aria-pressed={on}
          onClick={() => set({ leaves: on ? me.leaves.filter(x => x !== t) : [...me.leaves, t].sort((a, b) => termOrd(a) - termOrd(b)) })}>{t.replace('-', '년 ')}학기</button>; })}</div>}
    </div>
  </div>;
}

type AddTab = 'search' | 'direct';
export function AddCourse({ s, dispatch, univ, ctx, toast }: PageProps) {
  const [tab, setTab] = useState<AddTab>('search');
  const terms = termOptions(s.me.year || new Date().getFullYear());
  const add = (es: Enrollment[]) => { dispatch({ t: 'add', es: es.map(e => ({ ...e, ...(isPlanned(e.term, s.me.now) ? { planned: true as const } : {}) })) }); toast(`${es.length}과목 추가`); };
  return <>
    <Seg<AddTab> items={[['search', '과목 검색'], ['direct', '직접 입력']]} value={tab} onChange={setTab} label="입력 방법" />
    {!univ || !ctx ? <Loading /> : tab === 'search' ? <SearchAdd ctx={ctx} terms={terms} now={s.me.now} add={add} /> : <DirectAdd univ={univ} terms={terms} now={s.me.now} add={add} />}
  </>;
}

function TermSelect({ terms, value, set }: { terms: string[]; value: string; set: (v: string) => void }) {
  return <label className="field">학기<select value={value} onChange={e => set(e.target.value)}><option value="">미정</option>{terms.map(t => <option key={t} value={t}>{termLabel(t)}</option>)}</select></label>;
}

function SearchAdd({ ctx, terms, now, add }: { ctx: Ctx; terms: string[]; now: string; add: (es: Enrollment[]) => void }) {
  const list = useMemo(() => { const m = new Map<string, Row>();
    for (const c of Object.values(ctx.catalogs)) for (const ed of Object.keys(c.editions).sort()) for (const r of c.editions[ed]) m.set(r.c, r);
    return [...m.values()]; }, [ctx]);
  const [q, setQ] = useState(''), [term, setTerm] = useState(now);
  const hit = list.find(r => q.startsWith(r.c + ' ') || q === r.c || q === r.n);
  return <form className="grid" onSubmit={e => { e.preventDefault(); if (hit) { add([{ code: hit.c, ...(term ? { term } : {}) }]); setQ(''); } }}>
    <label className="field" style={{ gridColumn: '1 / -1' }}>과목명 또는 학수번호<input list="catalog" value={q} onChange={e => setQ(e.target.value)} placeholder={`${list.length}과목에서 검색`} />
      <datalist id="catalog">{list.map(r => <option key={r.c} value={`${r.c} ${r.n}`}>{`${r.cr}학점 · ${r.t}`}</option>)}</datalist></label>
    <TermSelect terms={terms} value={term} set={setTerm} />
    <div className="field">&nbsp;<button className="btn p" disabled={!hit}>{hit ? `${hit.n} 추가` : '추가'}</button></div>
  </form>;
}

function DirectAdd({ univ, terms, now, add }: { univ: Univ; terms: string[]; now: string; add: (es: Enrollment[]) => void }) {
  const empty = { name: '', credits: '3', category: '', area: '', grade: '', term: now, kind: '' as '' | 'transfer' | 'exchange' };
  const [f, setF] = useState(empty), up = (v: Partial<typeof f>) => setF({ ...f, ...v });
  return <form className="grid" onSubmit={e => { e.preventDefault(); if (!f.name.trim()) return;
    add([{ name: f.name.trim(), credits: +f.credits || 0, ...(f.category ? { category: f.category } : {}), ...(f.area ? { area: f.area } : {}), ...(f.grade ? { grade: f.grade } : {}),
      ...(f.term ? { term: f.term } : {}), ...(f.kind ? { src: f.kind } : {}), ...(f.kind === 'transfer' ? { lump: true as const } : {}) }]); setF({ ...empty, term: f.term }); }}>
    <label className="field">과목명<input value={f.name} onChange={e => up({ name: e.target.value })} required /></label>
    <label className="field">학점<input type="number" step="0.5" min="0" value={f.credits} onChange={e => up({ credits: e.target.value })} /></label>
    <label className="field">이수구분<select value={f.category} onChange={e => up({ category: e.target.value })}><option value="">(없음)</option>{Object.keys(univ.categories).map(c => <option key={c}>{c}</option>)}</select></label>
    <label className="field">교양 영역<select value={f.area} onChange={e => up({ area: e.target.value })}><option value="">(없음)</option>{Object.keys(univ.areas).map(c => <option key={c}>{c}</option>)}</select></label>
    <TermSelect terms={terms} value={f.term} set={term => up({ term })} />
    <label className="field">성적<input value={f.grade} onChange={e => up({ grade: e.target.value })} placeholder="A+, P, F …" /></label>
    <label className="field">출처<select value={f.kind} onChange={e => up({ kind: e.target.value as typeof f.kind })}><option value="">이 학교</option><option value="exchange">학점교류·타대 계절</option><option value="transfer">편입 인정(일괄)</option></select></label>
    <div className="field">&nbsp;<button className="btn p">추가</button></div>
  </form>;
}

// 로그인(구글·카카오, ADR 0029). 로그인하면 이 기기 내용이 그 계정에 저장된다
const NAME: Record<string, string> = { google: '구글', kakao: '카카오' };
// 로그아웃 하나로 이 기기의 정보까지 지운다(초기화 버튼 없음). 로그인 안 했으면 로그인 버튼, 했으면 계정 상태·탈퇴
function Account({ s, dispatch, toast, acct, setAcct }: PageProps & AcctProps) {
  if (acct === undefined) return null;
  const out = () => { if (!confirm(acct ? '로그아웃하면 이 기기의 정보는 지웁니다. 다시 로그인하면 불러옵니다.' : '로그아웃하면 이 기기의 내 정보와 수강 기록을 지웁니다.')) return;
    if (acct) logout(); dispatch({ t: 'load', s: blank() }); setAcct(null); };
  const outBtn = <button className="btn" onClick={out}>로그아웃</button>;
  if (!acct) return <>
    <div className="sec acct"><span>로그인<small className="muted">다른 기기에서도 이어서 봅니다.</small></span><LoginButtons /></div>
    {(s.me.sno || s.es.length > 0) && <div className="sec out">{outBtn}</div>}</>;
  const who = `${NAME[acct.provider] ?? ''} 계정`.trim();
  return <div className="sec"><span>{`${who}에 저장 중`}
      <button className="lnk small quit" onClick={async () => { if (!confirm('탈퇴하면 서버에 저장한 정보를 지웁니다. 이 기기의 정보는 남습니다.')) return;
        try { await quit(); setAcct(null); toast('탈퇴했습니다.'); } catch (x) { toast((x as Error).message); } }}>탈퇴</button></span>
    {outBtn}</div>;
}
