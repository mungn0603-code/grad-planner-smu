// 샘물 가져오기: 동의 → 학번·비밀번호 → 가져온 정보 확인 → 저장. 학적은 src/student.ts fromSmul로 학생 정보에 넣는다(ADR 0025)
import { useMemo, useState } from 'react';
import type { Enrollment } from '../engine/types.ts';
import { primaries, tracksOf, collegesOf } from './data.ts';
import { rowsToEnrollments, guessLeaves } from './paste.ts';
import { fromSmul, programId, type Student } from './student.ts';
import { termOrd, termLabel, termOptions, isPlanned, norm, toProfile, modeOf, type Major, type Me, type PageProps } from './state.ts';
import { Page, Loading } from './ui.tsx';
import { TERMS } from './home.tsx';

type Retake = NonNullable<Me['retake']>[number];
type Cdr = { tracks: string[]; done: string[] }; // 샘물 SM-CDR 이수조회: 신청한 트랙 이름, 이수한 비교과 프로그램 이름
type Got = { id: string; rows: string[][]; student: Student; cdr?: Cdr; cmp?: Record<string, number>; base?: Record<string, number>; retake?: Retake[]; recg?: { cat: string; cdt: number }[] }; // cmp: 학점이수상황표 이수구분별 취득학점, recg: 전적대학 인정학점(이수구분별)

// 둘 이상이면 줄을 나눠 1, 2, 3으로 번호를 붙인다
const MajorList = ({ ms, kind }: { ms: Major[]; kind?: boolean }) => { const t = (m: Major) => kind ? `${m.kind} ${m.name}` : m.name;
  return ms.length > 1 ? <ol className="num">{ms.map((m, i) => <li key={i}>{t(m)}</li>)}</ol> : <>{ms.length ? t(ms[0]) : '없음'}</>; };
export const MajorRows = ({ ms }: { ms: Major[] }) => <>
  <tr><td>다전공·부전공</td><td><MajorList ms={ms.filter(m => m.kind !== '마이크로전공')} kind /></td></tr>
  <tr><td>마이크로전공</td><td><MajorList ms={ms.filter(m => m.kind === '마이크로전공')} /></td></tr></>;

export function JoinPage({ s, dispatch, univ, ctx }: PageProps) {
  const [got, setGot] = useState<Got | null>(null), [pick, setPick] = useState('');
  const consent = !!s.consent;
  const progs = univ ? primaries(univ) : [];
  const auto = got && univ ? programId(univ, got.student.dept, 'primary') ?? '' : '';
  const program = pick || auto, year = got && +got.id.slice(0, 4) > 2000 ? +got.id.slice(0, 4) : s.me.year;
  // 학적(입학구분·다전공·부전공·유학생)은 샘물 값으로 정한다. 값을 못 받으면 이전 값을 둔다
  const st = got?.student, sm = st && univ ? fromSmul(univ, st, undefined, program || undefined) : undefined;
  const me: Me | undefined = sm && { ...s.me, program, year, ext: sm.programs.filter(g => g.role !== 'primary'), admission: sm.admission ?? s.me.admission, student: sm.student ?? s.me.student, base: got?.base };
  // 다시 가져오면 샘물 기록으로 바꾼다. 직접 넣은 학점교류·일괄 인정과 다음 학기 이후 계획은 남긴다(전적대학 인정학점을 샘물에서 받았으면 예전 편입 인정은 그 값으로 바꾼다)
  // 휴학 학기·SM-CDR(트랙·이수한 비교과)도 가져온 값으로 채운다. 휴학은 직접 넣은 값이 있으면 그대로 둔다
  const save = (es: Enrollment[]) => {
    if (!got || !st || !me) return;
    const keep = s.es.filter(e => !(got.recg?.length && e.src === 'transfer') && (e.src || e.lump || (e.term && termOrd(e.term) > termOrd(s.me.now))));
    const recg: Enrollment[] = (got.recg ?? []).map(r => ({ name: `전적대학 인정(${r.cat || '이수구분 없음'})`, credits: r.cdt, ...(r.cat ? { category: r.cat } : {}), src: 'transfer', lump: true }));
    const leaves = s.me.leaves.length || me.admission !== 'freshman' ? s.me.leaves : guessLeaves(es, year, s.me.now);
    const cdr = got.cdr, tk = (x: string) => norm(x).replace(/SM-?CDR/gi, ''); // 트랙 이름 끝의 'SM-CDR'은 있어도 없어도 같게 본다(샘물 CDR_NM 실제 형태 확인 불가)
    const tracks = cdr?.tracks.length && univ ? tracksOf(univ, program).filter(t => cdr.tracks.some(n => tk(n) === tk(t.name))).map(t => t.id) : [];
    dispatch({ t: 'load', s: { ...s, me: { ...me, name: st.name || s.me.name, sno: got.id, entr: st.entr || s.me.entr, majors: st.majors, leaves,
      tracks: tracks.length ? tracks : program === s.me.program ? s.me.tracks : [], ...(cdr ? { done: cdr.done } : {}), cmp: got.cmp, retake: got.retake },
      es: [...keep, ...recg, ...es.map(e => ({ ...e, ...(isPlanned(e.term, s.me.now) ? { planned: true as const } : {}) }))] } });
    location.hash = '#/result';
  };
  return <Page title="샘물 가져오기" sub="샘물 학번·비밀번호로 수강 기록과 학과를 한 번에 가져옵니다." narrow>
    <div className="steps-h"><span className="on">1 동의</span><span className={consent ? 'on' : ''}>2 재학생 인증</span><span className={got ? 'on' : ''}>3 확인</span></div>
    {!got ? <div className="box">
      <h2>개인정보 수집·이용 동의</h2>{TERMS}
      <label className="check"><input type="checkbox" checked={consent} onChange={e => dispatch({ t: 'opt', v: { consent: e.target.checked ? new Date().toISOString() : undefined } })} />위 내용을 확인했고 동의합니다.</label>
      <h2 className="mt">재학생 인증</h2>
      <SmulLogin consent={consent} onDone={setGot} />
    </div> : !univ || !ctx || !me ? <Loading /> : <div className="box">
      <h2>가져온 정보 확인</h2>
      <table className="info"><tbody>
        <tr><td>학번</td><td>{got.id}</td></tr>
        <tr><td>이름</td><td>{got.student.name || '—'}</td></tr>
        <tr><td>학과</td><td>{auto && !pick ? univ.programs[auto].name : <select value={program} onChange={e => setPick(e.target.value)} aria-label="학과">
          <option value="">학과를 고르세요{got.student.dept ? ` (샘물: ${got.student.dept})` : ''}</option>
          {collegesOf(progs).map(c => <optgroup key={c} label={c || '기타'}>{progs.filter(p => p.college === c).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</select>}</td></tr>
        <tr><td>입학구분</td><td>{got.student.entr || <small className="muted">가져오지 못함</small>}</td></tr>
        {program && <tr><td>이수 형태</td><td>{modeOf(toProfile(me, univ), me)}</td></tr>}
        <MajorRows ms={got.student.majors} />
        <tr><td>입학년도</td><td>{year || '—'}</td></tr>
        {got.recg && got.recg.length > 0 && <tr><td>전적대학 인정</td><td>{+got.recg.reduce((n, r) => n + r.cdt, 0).toFixed(1)}학점 <small className="muted">({got.recg.map(r => `${r.cat} ${r.cdt}`).join(', ')})</small></td></tr>}
        <tr><td>졸업 기준학점</td><td>{got.base?.GRDT_CMP_CDT != null ? `${got.base.GRDT_CMP_CDT}학점` : <small className="muted">가져오지 못함</small>}</td></tr>
        <tr><td>SM-CDR</td><td>{got.cdr ? `${got.cdr.tracks.join(', ') || '신청한 트랙 없음'} · 이수한 비교과 ${got.cdr.done.length}개` : <small className="muted">가져오지 못함</small>}</td></tr>
      </tbody></table>
      <Preview rows={got.rows} terms={termOptions(year || new Date().getFullYear())} now={s.me.now} add={save} onDone={() => setGot(null)}
        label="저장하고 결과 보기" disabled={!program} />
    </div>}
  </Page>;
}

// 학번·비밀번호는 이 화면 상태에만 두고(저장 안 함) 받아 온 뒤 비밀번호 칸을 비운다
function SmulLogin({ consent, onDone }: { consent: boolean; onDone: (x: Got) => void }) {
  const [id, setId] = useState(''), [pw, setPw] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  return <form className="login" onSubmit={async e => { e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await fetch('/api/smul', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, pw }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.rows)) throw new Error(j?.error ?? '학점플래너 서버에 문제가 있습니다. 잠시 뒤 다시 시도해 주세요.');
      setPw(''); onDone({ id, rows: j.rows, student: { name: '', dept: '', entr: '', ...j.student, majors: Array.isArray(j.student?.majors) ? j.student.majors : [] }, ...(j.cdr ? { cdr: j.cdr } : {}), ...(j.cmp ? { cmp: j.cmp } : {}), ...(j.base ? { base: j.base } : {}), ...(j.retake ? { retake: j.retake } : {}), ...(Array.isArray(j.recg) ? { recg: j.recg } : {}) });
    } catch (x) { setErr(x instanceof TypeError ? '학점플래너 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.' : (x as Error).message); }
    finally { setBusy(false); } }}>
    <input className="in-f" value={id} onChange={e => setId(e.target.value.trim())} inputMode="numeric" pattern="\d{9}" title="숫자 9자리" maxLength={9} autoComplete="username" placeholder="학번 (9자리)" aria-label="학번" required disabled={!consent} />
    <input className="in-f" type="password" value={pw} onChange={e => setPw(e.target.value)} maxLength={100} autoComplete="current-password" placeholder="샘물 비밀번호" aria-label="샘물 비밀번호" required disabled={!consent} />
    {err && <p className="warn" role="alert">{err}</p>}
    <button className={'cta blue wide' + (busy ? ' busy' : '')} disabled={!consent || busy} title={consent ? undefined : '먼저 동의해 주세요'}><span className="spin" />로그인</button>
  </form>;
}

function Preview({ rows, terms, now, add, onDone, label, disabled }: { rows: string[][]; terms: string[]; now: string; add: (es: Enrollment[]) => void; onDone: () => void; label?: string; disabled?: boolean }) {
  const res = useMemo(() => rowsToEnrollments(rows), [rows]), [def, setDef] = useState(now); // 샘물 행은 학수번호가 항상 있어 카탈로그로 채우지 않는다
  if (!res.header) return <div className="preview"><p className="warn">수강 기록을 가져오지 못했습니다. 잠시 뒤 다시 시도하거나 마이페이지에서 과목을 직접 추가하세요.</p>
    <button className="btn" onClick={onDone}>닫기</button></div>;
  const noTerm = res.es.filter(e => !e.term).length, out = res.es.map(e => (e.term || !def ? e : { ...e, term: def }));
  return <div className="preview">
    <p className="small muted">{res.es.length}과목</p>
    {noTerm > 0 && <label className="row small" style={{ marginBottom: 8 }}>학기 정보가 없는 {noTerm}과목의 학기
      <select value={def} onChange={e => setDef(e.target.value)}><option value="">미정</option>{terms.map(t => <option key={t} value={t}>{termLabel(t)}</option>)}</select></label>}
    <div className="scroll-x tbl-box"><table className="tbl"><thead><tr><th>학기</th><th>학수번호</th><th>과목명</th><th>학점</th><th>이수구분</th><th>성적</th></tr></thead><tbody>
      {out.slice(0, 200).map((e, i) => <tr key={i} className={!e.code && e.credits == null ? 'miss' : ''}><td>{termLabel(e.term)}</td><td>{e.code ?? '—'}</td><td className="l">{e.name ?? '—'}</td><td>{e.credits ?? '—'}</td><td>{e.category ?? '—'}</td><td>{e.grade ?? '—'}</td></tr>)}
    </tbody></table></div>
    <div className="row" style={{ marginTop: 14 }}><button className="btn p" disabled={!out.length || disabled} onClick={() => { add(out); onDone(); }}>{label ?? `${out.length}과목 추가`}</button>
      <button className="btn" onClick={onDone}>취소</button>{disabled && <span className="small warn-t">학과를 골라 주세요</span>}</div>
  </div>;
}
