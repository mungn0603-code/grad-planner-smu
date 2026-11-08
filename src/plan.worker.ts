// 추천(정수계획)을 화면 스레드 밖에서 돌린다. highs.wasm 위치는 빌드가 정한 URL로 넘긴다.
import wasmUrl from 'highs/runtime?url';
import { plan, initHighs, type PlanOpts } from '../engine/plan.ts';
import type { Ctx } from '../engine/audit.ts';
import type { Enrollment, Profile } from '../engine/types.ts';

export interface PlanReq { id: number; profile: Profile; enrollments: Enrollment[]; ctx: Ctx; opts: PlanOpts }

const ready = initHighs({ locateFile: () => wasmUrl });

onmessage = async (e: MessageEvent<PlanReq>) => {
  const { id, profile, enrollments, ctx, opts } = e.data;
  try {
    const solver = await ready;
    const { after, ...r } = plan(profile, enrollments, ctx, opts);
    postMessage({ id, solver, plan: { ...r, after: { programs: after.programs, warnings: after.warnings } } }); // 항목(Set·카탈로그 참조)은 보내지 않는다
  } catch (err) {
    postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
