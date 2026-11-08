// 바뀐 자리만 굴러가는 숫자(졸업까지 남은 학점). stageshow kit의 Count(MIT, benjitaylor/skills)를 줄여 옮김: 단위 상자·StillContext 뺌.
// 바뀐 숫자만 오른쪽 자리부터 굴러가고, 같은 숫자와 소수점은 그대로 둔다. 움직임 줄이기 설정이면 바로 바뀐다(styles.css .count)
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const STRIP = '012345678901234567890123456789'.split(''), MID = 10;
const digitsR = (t: string) => [...t].reverse().filter(c => c >= '0' && c <= '9').map(Number);

export function Count({ value, duration = 700, stagger = 45 }: { value: number; duration?: number; stagger?: number }) {
  const el = useRef<HTMLSpanElement>(null), text = String(value), ds = digitsR(text);
  const [idx, setIdx] = useState(() => ds.map(d => MID + d));
  const shown = useRef({ text, value, idx }); shown.current.idx = idx;
  const homing = useRef(false);

  useLayoutEffect(() => { // 줄(0~9 세 벌)을 값이 바뀐 방향으로 가장 짧게 돌린다
    const node = el.current, prev = shown.current;
    if (!node || prev.text === text) return;
    const before = digitsR(prev.text), up = value >= prev.value;
    const next = ds.map((d, c) => { const was = before[c], at = prev.idx[c];
      if (was === undefined || at === undefined) return MID + d;
      return was === d ? at : up ? at + ((d - was + 10) % 10) : at - ((was - d + 10) % 10); });
    node.querySelectorAll<HTMLElement>('.count-strip').forEach(s => void getComputedStyle(s).transform);
    node.setAttribute('data-rolling', '');
    shown.current = { text, value, idx: next }; setIdx(next);
  }, [text, value]); // eslint-disable-line

  useEffect(() => { // 다 굴러간 뒤 전환 없이 가운데 벌로 되돌린다(다음에 9→0을 넘겨도 줄 끝을 벗어나지 않게)
    const node = el.current; if (!node?.hasAttribute('data-rolling')) return;
    const id = setTimeout(() => { node.setAttribute('data-snap', ''); homing.current = true;
      const home = ds.map(d => MID + d); shown.current.idx = home; setIdx(home); node.removeAttribute('data-rolling'); }, duration + stagger * ds.length + 60);
    return () => clearTimeout(id);
  }, [idx]); // eslint-disable-line

  useLayoutEffect(() => { const node = el.current; if (!node || !homing.current) return; homing.current = false;
    node.querySelectorAll<HTMLElement>('.count-strip').forEach(s => void getComputedStyle(s).transform); node.removeAttribute('data-snap'); }, [idx]);

  let col = ds.length;
  return <span ref={el} className="count" aria-label={text}>{[...text].map((c, i) => {
    if (c < '0' || c > '9') return <span key={`s${i}`} aria-hidden="true">{c}</span>;
    const k = --col, at = idx[k] ?? MID + +c;
    return <span key={`d${k}`} className="count-d" aria-hidden="true"><span className="count-strip" style={{ transform: `translateY(${-at}em)`, transitionDuration: `${duration}ms`, transitionDelay: `${k * stagger}ms` }}>
      {STRIP.map((n, j) => <span key={j}>{n}</span>)}</span></span>;
  })}</span>;
}
