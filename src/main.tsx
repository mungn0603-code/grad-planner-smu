// 앱 뼈대: 상태(useReducer + 기기 저장), 데이터 불러오기, 상단 메뉴·해시 화면 전환. 화면은 화면별 파일(home·join·reqs·plan·record·my). 레이아웃은 docs/wireframe-smu.html.
import { StrictMode, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { audit, type Audit, type Ctx } from '../engine/audit.ts';
import type { Univ } from '../engine/types.ts';
import { loadUniv, loadCtx, primaries, yearsOf } from './data.ts';
import { blank, toProfile, type State, type Action } from './state.ts';
import { Icon } from './ui.tsx';
import { HomePage, TermsPage } from './home.tsx';
import { JoinPage } from './join.tsx';
import { ResultPage } from './reqs.tsx';
import { PlanPage } from './plan.tsx';
import { RecordPage } from './record.tsx';
import { MyPage } from './my.tsx';

const KEY = 'credit-planner.v1';
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가(사생활 모드 등) */ } } };

// 첫 버전과 같은 주소·같은 키로 배포해서 학생 기기에 첫 버전 저장값이 남아 있다(이슈 #32).
// 이수 형태(mode) 다전공·부전공 → 과목 데이터 없는 'ext' 프로그램(첫 버전과 같은 판정), 옛 모양의 전공제도 계획은 버린다
function migrate(j: any) {
  const { mode, ...me } = j.me;
  if (!me.ext) me.ext = mode === 'double' ? [{ id: 'ext', role: 'second' }] : mode === 'minor' ? [{ id: 'ext', role: 'minor' }] : [];
  return { ...j, me, whatif: Array.isArray(j.whatif?.ext) ? j.whatif : undefined };
}
function init(): State {
  const b = blank();
  try { const j = JSON.parse(store.get(KEY) || 'null'); if (j?.me) { const m = migrate(j); return { ...b, ...m, me: { ...b.me, ...m.me, univ: b.me.univ } }; } } catch { /* 깨진 저장값은 버린다 */ }
  return b;
}
function reduce(s: State, a: Action): State {
  switch (a.t) {
    case 'me': return { ...s, me: { ...s.me, ...a.v } };
    case 'add': return { ...s, es: [...s.es, ...a.es] };
    case 'del': return { ...s, es: s.es.filter((_, i) => i !== a.i) };
    case 'edit': return { ...s, es: s.es.map((e, i) => (i === a.i ? Object.fromEntries(Object.entries({ ...e, ...a.v }).filter(([, v]) => v !== undefined)) : e)) };
    case 'opt': return { ...s, ...a.v };
    case 'load': return a.s;
    case 'clear': return { ...s, es: [] };
  }
}

const PAGES = { '': '홈', join: '샘물 가져오기', result: '학점 계산기', plan: '학점 플래너', record: '이수 현황', my: '마이페이지', terms: '이용안내' } as const;
type Page = keyof typeof PAGES;
const MENU: Page[] = ['plan', 'result', 'record', 'my'];
const TAB: Record<string, string> = { result: '계산기', plan: '플래너', record: '이수 현황', my: '내 정보' }; // 탭바 글자(짧게)
const pageOf = (): Page => { const h = location.hash.replace(/^#\/?/, ''); return h in PAGES ? (h as Page) : ''; };

function App() {
  const [s, dispatch] = useReducer(reduce, undefined, init);
  useEffect(() => store.set(KEY, JSON.stringify(s)), [s]);

  // ── 데이터: 대학(상명 천안 고정) → 프로그램 카탈로그 ──
  const [univ, setUniv] = useState<Univ | null>(null), [ctx, setCtx] = useState<Ctx | null>(null), [err, setErr] = useState('');
  useEffect(() => { let off = false; setUniv(null); setCtx(null); setErr('');
    if (s.me.univ) loadUniv(s.me.univ).then(u => { if (!off) setUniv(u); }, e => { console.error(e); setErr(String(e)); });
    return () => { off = true; }; }, [s.me.univ]);
  useEffect(() => { // 학과·연도 기본값(데이터에 있는 값으로)
    if (!univ) return;
    const ps = primaries(univ), program = ps.some(p => p.id === s.me.program) ? s.me.program : ps[0]?.id ?? '';
    const year = s.me.year || yearsOf(univ, program)[0] || new Date().getFullYear();
    if (program !== s.me.program || year !== s.me.year) dispatch({ t: 'me', v: { program, year } });
  }, [univ, s.me.program, s.me.year]);
  const profile = useMemo(() => (univ && s.me.program && univ.programs[s.me.program] ? toProfile(s.me, univ) : null), [univ, s.me]);
  const progKey = profile?.programs.map(p => p.id).join() ?? '';
  useEffect(() => { let off = false;
    if (univ && profile) loadCtx(univ, profile.programs.map(p => p.id)).then(c => { if (!off) setCtx(c); }, e => { console.error(e); setErr(String(e)); });
    return () => { off = true; }; }, [univ, progKey]); // eslint-disable-line
  const a = useMemo((): Audit | Error | null => {
    if (!ctx || !profile || ctx.univ !== univ) return null;
    try { return audit(profile, s.es, ctx); } catch (e) { console.error(e); return e as Error; }
  }, [ctx, profile, s.es, univ]);
  const auditOk = a instanceof Error ? null : a;

  // ── 화면 전환 ──
  const [page, setPage] = useState<Page>(pageOf);
  useEffect(() => { const on = () => setPage(pageOf()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  useEffect(() => { document.title = page ? `${PAGES[page]} · 학점플래너` : '학점플래너 · 상명대 천안캠퍼스'; scrollTo(0, 0); }, [page]);

  // ── 알림 ──
  const [msg, setMsg] = useState(''), timer = useRef(0);
  const toast = (m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(''), 3200); };

  const props = { s, dispatch, univ, ctx, profile, a: auditOk, toast };
  return <>
    <Sprite />
    <nav className="top"><div className="in">
      <a className="logo" href="#/"><img src="./logo.jpg" alt="상명대학교" width="140" height="40" /><b>학점플래너</b></a>
      <ul>
        {MENU.map(k => <li key={k}><a href={`#/${k}`} aria-current={k === page ? 'page' : undefined}>{PAGES[k]}</a></li>)}
        <li className="who">{s.me.name ? <a href="#/my"><b>{s.me.name}</b>님</a> : <a href="#/join" aria-current={page === 'join' ? 'page' : undefined}>시작하기</a>}</li>
      </ul>
    </div></nav>
    <main key={page} className="view">
      {(err || (a instanceof Error && s.es.length > 0)) && <div className="callout top-callout">{err ? '정보를 불러오지 못했습니다. 새로고침해 주세요.' : '졸업요건을 계산하지 못했습니다. 새로고침해 주세요.'}</div>}
      {page === '' ? <HomePage start={s.es.length ? '#/plan' : '#/join'} />
        : page === 'join' ? <JoinPage {...props} /> : page === 'result' ? <ResultPage {...props} /> : page === 'plan' ? <PlanPage {...props} /> : page === 'record' ? <RecordPage {...props} />
        : page === 'my' ? <MyPage {...props} /> : <TermsPage />}
    </main>
    {/* 휴대폰: 주 메뉴를 아래 탭바로(Material 내비게이션 바·iOS 탭바, 3~5개 목적지) */}
    <nav className="tabbar" aria-label="주 메뉴">{MENU.map(k => <a key={k} href={`#/${k}`} aria-current={k === page ? 'page' : undefined}><Icon id={k} />{TAB[k]}</a>)}</nav>
    <footer><a href="#/terms">이용안내</a></footer>
    <div className={'toast' + (msg ? ' show' : '')} role="status" aria-live="polite">{msg}</div>
  </>;
}

const Sprite = () => <svg style={{ display: 'none' }} aria-hidden="true">
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></symbol>
  <symbol id="i-right" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></symbol>
  <symbol id="i-swap" viewBox="0 0 24 24"><path d="M7 4 3 8l4 4M3 8h14m0 12 4-4-4-4m4 4H7" /></symbol>
  <symbol id="i-result" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2m3 0h3m-8 4h2m3 0h3" /></symbol>
  <symbol id="i-plan" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16M9 3v4m6-4v4" /></symbol>
  <symbol id="i-record" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></symbol>
  <symbol id="i-my" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></symbol>
</svg>;

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
