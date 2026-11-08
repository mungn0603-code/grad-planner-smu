// 이수 현황: 학기별 수강 기록. 학점 플래너와 같은 학기 카드 모양이고, 과목을 누르면 자세한 내용이 열린다
import { useState } from 'react';
import type { Item } from '../engine/audit.ts';
import { termOrd, termLabel, gpaText, type PageProps } from './state.ts';
import { Page, Loading, Empty, Caret } from './ui.tsx';

const OUT = { retake: '재수강 제외', dup: '중복 제외', fail: '미취득' } as const;

export function RecordPage({ s, dispatch, a, toast }: PageProps) {
  const [openI, setOpenI] = useState(-1);
  if (!s.es.length) return <Page title="이수 현황" narrow><Empty /></Page>;
  if (!a) return <Page title="이수 현황"><Loading /></Page>;
  const stat = (it: Item) => it.out ? ['unv', OUT[it.out]] : !it.planned ? ['ok', '이수'] : it.term && it.term === s.me.now ? ['null', '수강 중'] : ['null', '이수 예정'];
  const terms = [...new Set(a.items.map(it => it.term ?? ''))].sort((x, y) => termOrd(x || undefined) - termOrd(y || undefined));
  const sum = (its: Item[]) => +its.filter(it => !it.out).reduce((n, it) => n + it.cr, 0).toFixed(1);
  const all = a.items.filter(it => !it.out);
  return <Page title="이수 현황">
    <p className="small muted" style={{ marginTop: 0 }}>{a.gpa && <><b className="gpa">평점평균 {gpaText(a.gpa.gpa)}</b> / 4.5 ({a.gpa.cr}학점 기준) · </>}이수 {sum(all.filter(it => !it.planned))}학점 · 수강 중·이수 예정 {sum(all.filter(it => it.planned))}학점</p>
    {/* 학기마다 접는다. 이번 학기와 이수 예정 과목이 있는 학기만 펼친 채로 시작한다 */}
    <div className="terms">{terms.map(t => { const its = a.items.filter(it => (it.term ?? '') === t), tg = a.gpa?.terms[t];
      return <details className="term" key={t || 'none'} open={t === s.me.now || its.some(it => it.planned)}>
        <summary><b>{termLabel(t || undefined)}</b><span className="n">{tg && <>평점 <b className="gpa">{gpaText(tg.gpa)}</b> · </>}{its.length}과목 · {sum(its)}학점<Caret /></span></summary>
        {its.map(it => { const [cls, txt] = stat(it), open = openI === it.i, e = s.es[it.i];
          return <div className={'course' + (it.out ? ' fixed' : '') + (open ? ' open' : '')} key={it.i}>
            <button className="course-btn" aria-expanded={open} onClick={() => setOpenI(open ? -1 : it.i)}>{e?.grade && <b className="grade">{e.grade}</b>}{it.name} · {it.cr}
              <small>{cls !== 'ok' && <span className={'chip ' + cls}>{txt}</span>}{it.cat || '이수구분 없음'}</small></button>
            {open && <div className="alts small">
              <span>학수번호 {it.code ?? '—'}{e?.src ? ` · ${e.src === 'transfer' ? '편입 인정' : '학점교류'}` : ''}</span>
              {it.planned && !it.out && <button className="btn" onClick={() => { dispatch({ t: 'del', i: it.i }); setOpenI(-1); toast(`'${it.name}' 과목을 뺐습니다.`); }}>빼기</button>}
            </div>}</div>; })}
      </details>; })}</div>
    <p className="small muted">이수 기록을 고치거나 직접 과목을 넣으려면 <a className="lnk" href="#/my">마이페이지</a>를 이용하세요.</p>
  </Page>;
}
