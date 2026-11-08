// 추천(정수계획)을 Worker로 돌리고, 학생이 고른 바꾸기를 추천 행에 덮어쓴다
import type { Audit } from '../engine/audit.ts';
import type { Plan } from '../engine/plan.ts';
import type { PlanReq } from './plan.worker.ts';

export type PlanMsg = { id: number; solver?: boolean; plan?: Omit<Plan, 'after'> & { after: Pick<Audit, 'programs' | 'warnings'> }; error?: string };
let worker: Worker | null = null, seq = 0;
export function runPlan(req: Omit<PlanReq, 'id'>): Promise<PlanMsg> {
  worker ??= new Worker(new URL('./plan.worker.ts', import.meta.url), { type: 'module' });
  const w = worker, id = ++seq;
  return new Promise(res => { const on = (e: MessageEvent<PlanMsg>) => { if (e.data.id !== id) return; w.removeEventListener('message', on); res(e.data); };
    w.addEventListener('message', on); w.postMessage({ ...req, id }); });
}

// 고른 바꾸기를 추천 행에 덮어쓴다(지금 계획에 없는 바꾸기는 무시)
export function applySwaps(P: NonNullable<PlanMsg['plan']>, swaps: Record<string, string>) {
  return P.rows.map(r => { const k = `${r.term}|${r.code}`, alt = P.alts[k]?.find(x => x.code === swaps[k]);
    return { ...r, k, orig: r, ...(alt ? { code: alt.code, name: alt.name, cr: alt.cr, cat: alt.cat, swapped: true } : { swapped: false }) }; });
}
