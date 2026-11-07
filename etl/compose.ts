// 새 판(예: 2027)을 카탈로그에 붙일 때 대응표(Equiv)를 다시 쓴다. 엔진은 "그 판 과목 → 최신 판 과목" 한 단계만 보므로
// 새 판이 최신이 되면 옛 판들의 대응을 (옛 대응) ∘ (직전 판 → 새 판 변경분)으로 합성해 둔다. 데이터만 바뀌고 엔진은 그대로.
import type { Catalog, Equiv, Row } from '../engine/types.ts';

// delta: 직전 최신 판 코드 → 새 판 코드. 적지 않은 코드는 새 판에 같은 코드가 있으면 그대로, 없으면 폐지([])
export function addEdition(cat: Catalog, ed: string, rows: Row[], delta: Equiv[]): Catalog {
  const eds = Object.keys(cat.editions).sort(), prev = eds[eds.length - 1];
  if (!(ed > prev)) throw new Error(`새 판 ${ed}는 최신 판 ${prev}보다 뒤여야 함(과거 판 추가는 addPastEdition)`);
  const inNew = new Set(rows.map(r => r.c)), d = new Map(delta.flatMap(e => e.from.map(f => [f, e] as [string, Equiv])));
  const step = (t: string) => d.get(t)?.to ?? (inNew.has(t) ? [t] : []);
  const old = new Map<string, Equiv>(); for (const e of cat.equiv || []) for (const f of e.from) for (const x of e.ed || eds) old.set(x + '|' + f, e);
  const out = new Map<string, Equiv>();
  const put = (from: string, to: string[], kind: string | undefined, x: string) => {
    if (to.length === 1 && to[0] === from) return;
    const k = `${from}>${to.join('+')}>${kind ?? ''}`; if (out.has(k)) out.get(k)!.ed!.push(x); else out.set(k, { from: [from], to, ...(kind ? { kind } : {}), ed: [x] });
  };
  for (const x of eds) for (const c of new Set(cat.editions[x].map(r => r.c))) {
    const e = old.get(x + '|' + c), to = [...new Set((e?.to ?? [c]).flatMap(step))];
    put(c, to, x === prev ? d.get(c)?.kind : (e?.kind ?? d.get(c)?.kind), x);
  }
  return { ...cat, editions: { ...cat.editions, [ed]: rows }, equiv: [...out.values()] };
}

// 과거 판(예: 2021) 추가: 최신 판은 그대로라 기존 대응은 안 바뀐다. 그 판의 대응만 더한다
export function addPastEdition(cat: Catalog, ed: string, rows: Row[], map: Equiv[]): Catalog {
  if (cat.editions[ed]) throw new Error(`판 ${ed} 이미 있음`);
  return { ...cat, editions: { ...cat.editions, [ed]: rows }, equiv: [...(cat.equiv || []), ...map.map(e => ({ ...e, ed: [ed] }))] };
}
