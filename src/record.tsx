// 이수 현황: 학기별 수강 기록. 학점 플래너와 같은 학기 카드 모양이고, 과목을 누르면 자세한 내용과 고치기(이수/이수 예정·학기·삭제)가 열린다.
// 이수 예정 과목은 밀어서 뺄 수 있다. 과목 추가·다시 가져오기도 여기서
import { Fragment, useState } from 'react';
import type { Item } from '../engine/audit.ts';
import { termOrd, termLabel, termOptions, gpaText, type PageProps, type State, type Action } from './state.ts';
import { Page, Loading, Caret, Modal, Swipe } from './ui.tsx';
import { AddCourse } from './my.tsx';

const OUT = { retake: '재수강 제외', dup: '중복 제외', fail: '미취득' } as const;

// 이수 예정 과목의 학기 바꾸기: 이번 학기부터 앞으로의 학기(계절학기는 '계절학기 포함'일 때만). 학점 플래너와 같이 쓴다
// terms: 학점 플래너가 계획하는 학기(그 밖으로 옮기면 플래너에서 안 보인다). 없으면 앞으로 8년
export function TermSelect({ s, i, dispatch, terms }: { s: State; i: number; dispatch: (a: Action) => void; terms?: string[] }) {
  const cur = s.es[i]?.term ?? '', now = s.me.now;
  const opts = terms ? [...terms] : termOptions(+(now || cur).slice(0, 4) || new Date().getFullYear(), !s.season).filter(t => !now || termOrd(t) >= termOrd(now));
  if (cur && !opts.includes(cur)) opts.unshift(cur);
  return <select className="term-sel" aria-label="학기" value={cur} onChange={e => dispatch({ t: 'edit', i, v: { term: e.target.value } })}>
    {opts.map(t => <option key={t} value={t}>{termLabel(t)}</option>)}</select>;
}

export function RecordPage(p: PageProps) {
  const { s, dispatch, a, toast } = p;
  const [openI, setOpenI] = useState(-1), [adding, setAdding] = useState(false);
  const acts = <><div className="row rec-acts"><a className="btn p" href="#/join">{s.es.length ? '샘물에서 다시 가져오기' : '샘물에서 가져오기'}</a><button className="btn" onClick={() => setAdding(true)}>과목 추가</button></div>
    <Modal open={adding} onClose={() => setAdding(false)} title="과목 추가"><AddCourse {...p} /></Modal></>;
  if (!s.es.length) return <Page title="이수 현황" narrow><div className="box empty"><p>아직 수강 기록이 없어요.</p>{acts}</div></Page>;
  if (!a) return <Page title="이수 현황"><Loading /></Page>;
  const stat = (it: Item) => it.out ? ['unv', OUT[it.out]] : !it.planned ? ['ok', '이수'] : it.term && it.term === s.me.now ? ['null', '수강 중'] : ['null', '이수 예정'];
  const terms = [...new Set(a.items.map(it => it.term ?? ''))].sort((x, y) => termOrd(x || undefined) - termOrd(y || undefined));
  const sum = (its: Item[]) => +its.filter(it => !it.out).reduce((n, it) => n + it.cr, 0).toFixed(1);
  const all = a.items.filter(it => !it.out);
  return <Page title="이수 현황">
    <p className="small muted" style={{ marginTop: 0 }}>{a.gpa && <><b className="gpa">평점평균 {gpaText(a.gpa.gpa)}</b> / 4.5 ({a.gpa.cr}학점 기준) · </>}이수 {sum(all.filter(it => !it.planned))}학점 · 수강 중·이수 예정 {sum(all.filter(it => it.planned))}학점</p>
    {acts}
    {/* 학기마다 접는다. 이번 학기와 이수 예정 과목이 있는 학기만 펼친 채로 시작한다 */}
    <div className="terms">{terms.map(t => { const its = a.items.filter(it => (it.term ?? '') === t), tg = a.gpa?.terms[t];
      return <details className="term" key={t || 'none'} open={t === s.me.now || its.some(it => it.planned)}>
        <summary><b>{termLabel(t || undefined)}</b><span className="n">{tg && <>평점 <b className="gpa">{gpaText(tg.gpa)}</b> · </>}{its.length}과목 · {sum(its)}학점<Caret /></span></summary>
        {its.map(it => { const [cls, txt] = stat(it), open = openI === it.i, e = s.es[it.i];
          const mine = e?.planned && it.term !== s.me.now; // 담은 이수 예정 과목(이번 학기 수강 중은 샘물 기록)
          const del = () => { dispatch({ t: 'del', i: it.i }); setOpenI(-1); toast(`'${it.name}' 뺐어요.`); };
          const row = <div className={'course' + (it.out ? ' fixed' : '') + (open ? ' open' : '')}>
            <button className="course-btn" aria-expanded={open} onClick={() => setOpenI(open ? -1 : it.i)}>{e?.grade && <b className="grade">{e.grade}</b>}{it.name} · {it.cr}
              <small>{cls !== 'ok' && <span className={'chip ' + cls}>{txt}</span>}{it.cat || '이수구분 없음'}</small></button>
            {open && <div className="alts small">
              <span>학수번호 {it.code ?? '—'}{e?.src ? ` · ${e.src === 'transfer' ? '편입 인정' : '학점교류'}` : ''}{e?.lump ? ' · 일괄' : ''}</span>
              <span className="row">{mine && <TermSelect s={s} i={it.i} dispatch={dispatch} />}
                {!it.out && <button className="btn" onClick={() => dispatch({ t: 'edit', i: it.i, v: { planned: e?.planned ? undefined : true } })}>{e?.planned ? '이수로 바꾸기' : '이수 예정으로 바꾸기'}</button>}
                <button className="btn" onClick={del}>삭제</button></span>
            </div>}</div>;
          // 밀어서 빼기는 이수 예정 과목만(이수한 기록은 실수로 지우지 않게 눌러서 연 칸에서만 삭제)
          return mine ? <Swipe key={it.i} label="빼기" tone="del" onAct={del}>{row}</Swipe> : <Fragment key={it.i}>{row}</Fragment>; })}
      </details>; })}</div>
  </Page>;
}
