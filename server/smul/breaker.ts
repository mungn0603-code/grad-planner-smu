// 전체 차단기(docs/decisions/0013): 샘물 시스템 장애(SYS)만 센다. 분모는 성공 + SYS(비밀번호 오류·잠김·UNKNOWN·접근 거부는 분자·분모 모두에서 뺀다)
// 닫힘 → (장애 의심) 줄임: 분당 요청·동시 요청 제한 → (심각) 열림: 모두 멈춤 → 대기 뒤 반쯤 열림: 비밀번호 없는 시험 요청 + 한 번에 하나 → 성공 n번이면 줄임 단계를 거쳐 닫힘
import { SMUL, T, UA } from './login.ts';
import { inc, del, num, type Counts, type Env } from './store.ts';

// 값은 검토용 초기 후보다(실제 이용량은 배포 전이라 확인 불가). 학번·IP 제한 값과 함께 limit.ts LIMIT로 내보낸다
export const BREAKER = {
  win: 600,                                                  // 장애 관측 창(고정 창, 초)
  throttle: { minSys: 5, rate: 0.2, perMin: 20, slots: 2 },  // 장애 의심: SYS 5회·20% 이상이거나 샘물이 429를 주면
  open: { minCalls: 20, rate: 0.5, sec: 300, maxSec: 600, tripSec: 3600 }, // 심각: 20회 이상·50% 이상. 1시간 안에 다시 열리면 대기 두 배(최대 10분)
  half: { ok: 2, sec: 86_400 },                              // 반쯤 열림: 성공 2번이면 닫음. 시험이 끝날 때까지 유지
  rampSec: 600,                                              // 닫은 뒤 10분은 줄임 단계로 재개
};

export type State = 'closed' | 'throttled' | 'open' | 'half' | 'trip';
// 차단기 상태. b는 관측 창 번호(시각 / win). 'trip'은 지금 열어야 한다는 뜻
export function state(c: Counts, b: number): State {
  if (c.has('brk:open')) return 'open';
  if (c.has('brk:half')) return 'half';
  const sys = num(c, `all:sys:${b}`), calls = num(c, `all:ok:${b}`) + sys, { open: o, throttle: t } = BREAKER;
  if (calls >= o.minCalls && sys / calls >= o.rate) return 'trip';
  if (c.has('brk:ramp') || num(c, `all:rl:${b}`) > 0 || (sys >= t.minSys && sys / calls >= t.rate)) return 'throttled';
  return 'closed';
}

// 열기. 열린 동안 쌓인 관측은 지우고, 대기 뒤 반쯤 열림으로 간다. 기한이 새로 잡히게 옛 행부터 지운다(limit.ts record의 대기 키와 같은 이유)
export async function trip(e: Env, b: number) {
  const n = await inc(e, 'brk:trips', BREAKER.open.tripSec), sec = Math.min(BREAKER.open.sec * 2 ** (n - 1), BREAKER.open.maxSec);
  await Promise.all(['brk:open', 'brk:half', 'brk:ok', 'brk:ramp', `all:ok:${b}`, `all:sys:${b}`, `all:rl:${b}`].map(k => del(e, k)));
  await Promise.all([inc(e, 'brk:open', sec), inc(e, 'brk:half', sec + BREAKER.half.sec)]);
  console.error('smul breaker open', `sec=${sec}`, `trips=${n}`);
}
export async function close(e: Env) {
  await Promise.all(['brk:half', 'brk:ok', 'brk:ramp'].map(k => del(e, k)));
  await inc(e, 'brk:ramp', BREAKER.rampSec);
  console.info('smul breaker closed');
}
// 반쯤 열림 시험: 비밀번호 없이 샘물 첫 화면만 한 번 요청한다(학생 계정으로 로그인하지 않는다). 2xx·3xx면 응답하는 것으로 본다
export const probe = () => fetch(SMUL, { redirect: 'manual', signal: AbortSignal.timeout(T), headers: { 'user-agent': UA } })
  .then(r => { void r.body?.cancel(); return r.status < 400; }, () => false);
