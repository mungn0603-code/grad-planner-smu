// 여러 화면이 같이 쓰는 작은 부품: 탭 고르기, 스위치, 아이콘, 불러오는 중, 빈 화면, 접기, 화면 틀, 창, 로그인 버튼, 밀어서 담기·빼기
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { login } from './account.ts';

// 과목 줄을 왼쪽으로 밀면 오른쪽에서 버튼 하나(담기·빼기)가 들어온다. 줄은 움직이지 않아 짧은 과목명도 가려지지 않는다. 터치에서만 밀리고,
// 같은 동작은 줄을 눌러 여는 칸에도 둔다(밀기만으로 숨기지 않는다, docs/decisions/0034). 세로 스크롤과 겹치지 않게 먼저 움직인 방향으로 정한다
const SW = 76;
export function Swipe({ label, tone, onAct, children }: { label: string; tone: 'add' | 'del'; onAct: () => void; children: ReactNode }) {
  const [x, setX] = useState(0), g = useRef<{ x0: number; y0: number; dx: number; dir?: 'h' | 'v' } | null>(null), moved = useRef(false);
  const end = () => { const s = g.current; g.current = null; if (s?.dir === 'h') setX(s.dx < -SW / 2 ? -SW : 0); };
  return <div className={'swipe' + (x ? ' shown' : '')}>
    <button type="button" className={'swipe-act ' + tone} tabIndex={-1} aria-hidden={!x} onClick={() => { setX(0); onAct(); }}
      style={{ transform: `translateX(${SW + x}px)`, transition: g.current?.dir === 'h' ? 'none' : undefined }}>{label}</button>
    <div className="swipe-body"
      onPointerDown={e => { if (e.pointerType === 'mouse') return; moved.current = false; g.current = { x0: e.clientX - x, y0: e.clientY, dx: x }; }}
      onPointerMove={e => { const s = g.current; if (!s) return; const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
        if (!s.dir) { if (Math.abs(dx - x) < 8 && Math.abs(dy) < 8) return; s.dir = Math.abs(dx - x) > Math.abs(dy) ? 'h' : 'v'; if (s.dir === 'h') { moved.current = true; e.currentTarget.setPointerCapture(e.pointerId); } }
        if (s.dir === 'h') { s.dx = Math.max(-SW, Math.min(0, dx)); setX(s.dx); } }}
      onPointerUp={end} onPointerCancel={end}
      onClickCapture={e => { if (moved.current || x) { e.stopPropagation(); e.preventDefault(); moved.current = false; if (x) setX(0); } }}>
      {children}
    </div>
  </div>;
}

export function Seg<T extends string>({ items, value, onChange, label }: { items: [T, string][]; value: T; onChange: (v: T) => void; label?: string }) {
  const box = useRef<HTMLDivElement>(null), th = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const place = () => { const b = box.current?.querySelector<HTMLElement>('[aria-selected="true"]'); if (b && th.current) { th.current.style.width = b.offsetWidth + 'px'; th.current.style.transform = `translateX(${b.offsetLeft}px)`; } };
    place(); addEventListener('resize', place); return () => removeEventListener('resize', place);
  }, [value]);
  return <div className="seg" role="tablist" aria-label={label} ref={box}><span className="thumb" ref={th} />
    {items.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={v === value} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export const Switch = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) =>
  <label className="switch"><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} aria-label={label} /><i /></label>;
export const Icon = ({ id, size }: { id: string; size?: number }) => <svg style={size ? { width: size, height: size } : undefined} aria-hidden="true"><use href={`#i-${id}`} /></svg>;
// 기다리는 동안 요약 상자 모양(큰 숫자·막대·줄)을 미리 그려 둔다. 막대 길이는 줄마다 다르게(styles.css .sk)
export const Loading = () => <div className="sk" role="status" aria-label="불러오는 중"><i /><i /><i /><i /><i /></div>;
// 수강 기록이 없을 때의 빈 화면(로그인 전 계산기·플래너·이수 현황 공통)
export const Empty = () => <div className="box empty"><p>아직 수강 기록이 없어요.</p><a className="cta blue" href="#/join">샘물에서 가져오기</a></div>;
export const Caret = ({ corner }: { corner?: boolean }) => <svg className={'caret' + (corner ? ' corner' : '')} aria-hidden="true"><use href="#i-right" /></svg>;

// 닫힌 채로 시작하는 토글. 안의 내용은 열 때 그린다(관련 과목처럼 무거운 목록)
export function Fold({ title, className, children }: { title: ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className={'fold' + (className ? ' ' + className : '')} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><span>{title}</span><Caret /></summary>{open && <div className="fold-body">{children}</div>}</details>;
}

// 화면 틀: 사진 배너(제목) + 흰 본문
export function Page({ title, sub, narrow, children }: { title: string; sub?: ReactNode; narrow?: boolean; children: ReactNode }) {
  return <>
    <div className="hero sub"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div></div>
    <div className="white"><div className={'wrap' + (narrow ? ' narrow' : '')}>{children}</div></div>
  </>;
}

// 네이티브 dialog 창. open이 바뀌면 열고 닫는다(Esc·바깥 클릭으로 닫힘)
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return <dialog className="modal" ref={ref} onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="mh"><b>{title}</b><button className="icon-btn" onClick={onClose} aria-label="닫기"><Icon id="x" /></button></div>
    <div className="mb">{open && children}</div>
  </dialog>;
}

// 구글·카카오 로그인 버튼(ADR 0029). 마이페이지 계정 칸·시작 화면·계산기 위 권유에서 같이 쓴다
export const LoginButtons = () => <span className="row"><button className="btn sns google" onClick={() => login('google')}><GoogleMark />구글</button>
  <button className="btn sns kakao" onClick={() => login('kakao')}><KakaoMark />카카오</button></span>;
// 각 회사의 로그인 버튼 안내에 맞춘 표시(구글 G, 카카오 말풍선)
const GoogleMark = () => <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>;
const KakaoMark = () => <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#000" d="M12 3C6.48 3 2 6.52 2 10.86c0 2.8 1.86 5.26 4.66 6.65l-.95 3.48c-.08.3.26.54.52.37l4.15-2.75c.53.07 1.07.11 1.62.11 5.52 0 10-3.52 10-7.86S17.52 3 12 3z" /></svg>;
