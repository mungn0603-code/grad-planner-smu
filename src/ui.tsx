// 여러 화면이 같이 쓰는 작은 부품: 탭 고르기, 스위치, 아이콘, 불러오는 중, 빈 화면, 접기, 화면 틀, 창
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

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
export const Empty = () => <div className="box empty"><p>아직 수강 기록이 없습니다.</p><a className="cta blue" href="#/join">샘물에서 가져오기</a></div>;
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
