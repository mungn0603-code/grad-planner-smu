// 남용·장애 방어(§6-5, docs/decisions/0010·0013): 샘물에 요청하기 전에 차단기·IP·학번 횟수를 보고, 끝나면 결과를 센다.
// 모든 횟수는 store.ts(Supabase smul_try)에 둔다. 설정이 없으면 로컬 개발에서는 건너뛰고 Vercel에서는 막는다.
// ① 전체 차단기(breaker.ts) ② IP: 1분 요청 10회, 최근 24시간(1시간 칸) 로그인 실패 50회. 그 IP만 막는다
// ③ 학번: 한 번에 하나만 샘물로(동시 요청 방지), 로그인 실패마다 늘어나는 대기(최대 cooldownSec). 성공하면 실패 기록을 지운다
import { SYS, type Kind } from './login.ts';
import { env, hmac, inc, del, counts, num, type Env } from './store.ts';
import { BREAKER, state, trip, close, probe } from './breaker.ts';

// 값은 검토용 초기 후보다(실제 이용량은 배포 전이라 확인 불가). 근거는 docs/decisions/0013
export const LIMIT = {
  ip: { n: 10, sec: 60 },
  ipFail: { n: 50, hours: 24 },
  id: { baseSec: 30, factor: 2, maxDelaySec: 120, cooldownAfter: 3, cooldownSec: 900, failSec: 86_400, leaseSec: 60 },
  ...BREAKER,
};
// k번째 로그인 실패 뒤 다음 시도까지 기다릴 초: 30·60초, 3번째부터 15분
export const idDelay = (k: number) => k >= LIMIT.id.cooldownAfter ? LIMIT.id.cooldownSec : Math.min(LIMIT.id.baseSec * LIMIT.id.factor ** (k - 1), LIMIT.id.maxDelaySec);

// 가져오기를 막을 때 학생에게 보이는 문구
const MSG = {
  ipMany: '요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.',
  idBusy: '이 학번으로 가져오기가 이미 진행 중입니다. 잠시 뒤 다시 시도해 주세요.',
  idWait: (t: string) => `이 학번으로 로그인 실패가 이어져 잠시 막았습니다. 샘물 비밀번호를 확인하고 ${t} 뒤 다시 시도해 주세요.`,
  limit: '지금 가져오기를 쓸 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
  ipDay: '이 네트워크에서 최근 24시간 동안 로그인 실패가 많아 가져오기를 막았습니다. 다른 네트워크에서 시도하거나 나중에 다시 시도해 주세요.',
  busy: '샘물 응답이 불안정해 가져오기 요청을 줄이고 있습니다. 잠시 뒤 다시 시도해 주세요.',
  paused: '샘물 서버 장애가 의심되어 학교 서버 보호를 위해 가져오기를 잠시 멈췄습니다. 몇 분 뒤 다시 시도해 주세요.',
};

// 자리 잡기: 행이 없을 때 처음 +1한 요청만 1을 받는다(on conflict가 행을 잠금). 주인이 죽어도 sec 뒤 만료된다
async function take(e: Env, k: string, sec: number, held: string[]) {
  if (await inc(e, k, sec) !== 1) return false;
  held.push(k); return true;
}
const wait = (until: string) => { const s = Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 1000)); return s < 60 ? `${s}초` : `${Math.ceil(s / 60)}분`; };

export type Gate = { idKey: string; ipKey: string | null; b: number; h: number; half: boolean; held: string[] } | null;
type Check = { block: [number, string] } | { gate: Gate };
async function check(e: Env, req: Request, id: string, held: string[]): Promise<Check> {
  const s = e.SMUL_KEY_SECRET!, now = Date.now(), b = Math.floor(now / 1000 / LIMIT.win), h = Math.floor(now / 3_600_000);
  const ip = e.VERCEL ? req.headers.get('x-forwarded-for')?.split(',')[0].trim() : undefined; // Vercel이 덮어쓴 값만 믿는다(공식 문서). 그 밖(로컬 개발)에서는 IP 제한을 건너뛴다
  const ipKey = ip ? await hmac(s, 'ipf:' + ip) : null, ipFails = ipKey ? Array.from({ length: LIMIT.ipFail.hours }, (_, i) => `${ipKey}:${h - i}`) : [];
  const c = await counts(e, ['brk:open', 'brk:half', 'brk:ramp', `all:ok:${b}`, `all:sys:${b}`, `all:rl:${b}`, ...ipFails]);
  const st = state(c, b);
  if (st === 'trip') { await trip(e, b); return { block: [503, MSG.paused] }; }
  if (st === 'open') return { block: [503, MSG.paused] };
  if (ipFails.reduce((t, k) => t + num(c, k), 0) >= LIMIT.ipFail.n) { console.error('smul ip fail limit'); return { block: [429, MSG.ipDay] }; }
  if (ip && await inc(e, await hmac(s, 'ip:' + ip), LIMIT.ip.sec) > LIMIT.ip.n) return { block: [429, MSG.ipMany] };
  if (st === 'throttled' && await inc(e, 'all:rate', 60) > LIMIT.throttle.perMin) return { block: [503, MSG.busy] };
  const idKey = await hmac(s, 'id:' + id); // IP에서 막힌 요청은 학번 기록을 건드리지 않는다
  if (!await take(e, 'idl:' + idKey, LIMIT.id.leaseSec, held)) return { block: [429, MSG.idBusy] };
  const w = (await counts(e, ['idw:' + idKey])).get('idw:' + idKey); // 자리를 잡은 뒤 읽어야 앞 요청이 남긴 대기를 놓치지 않는다
  if (w) return { block: [429, MSG.idWait(wait(w.until))] };
  if (st !== 'closed') {
    let got = false;
    for (let i = 0; i < (st === 'half' ? 1 : LIMIT.throttle.slots) && !got; i++) got = await take(e, 'slot:' + i, LIMIT.id.leaseSec, held);
    if (!got) return { block: [503, st === 'half' ? MSG.paused : MSG.busy] };
    if (st === 'half' && !await probe()) { await trip(e, b); return { block: [503, MSG.paused] }; }
  }
  return { gate: { idKey, ipKey, b, h, half: st === 'half', held } };
}
const release = (e: Env, held: string[]) => Promise.all(held.map(k => del(e, k))).catch(x => console.error('smul release', (x as Error).message));
// 막으면 block: [상태, 문구]. 통과면 결과를 기록할 키(설정 없이 건너뛰면 null). 저장소 장애면 막는다(학생 계정 잠금 방지가 먼저)
export async function limit(req: Request, id: string): Promise<Check> {
  const e = env();
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SMUL_KEY_SECRET'].filter(k => !e[k]);
  if (missing.length) {
    if (e.VERCEL) { console.error('smul limit not configured', missing.join(',')); return { block: [503, MSG.limit] }; } // 값은 남기지 않고 빠진 이름만
    return { gate: null };
  }
  const held: string[] = [];
  const r = await check(e, req, id, held).catch((x): Check => { console.error('smul limit', (x as Error).name, (x as Error).message); return { block: [503, MSG.limit] }; });
  if ('block' in r) await release(e, held);
  return r;
}
// 결과 기록. 기록 실패는 응답을 바꾸지 않는다. 잡은 자리(학번·동시 요청)는 마지막에 놓는다
export async function record(g: Gate, kind: Kind | null) {
  if (!g) return;
  const e = env();
  try {
    if (!kind) {
      await Promise.all([inc(e, `all:ok:${g.b}`, LIMIT.win), del(e, 'idf:' + g.idKey)]);
      if (g.half && await inc(e, 'brk:ok', LIMIT.half.sec) >= LIMIT.half.ok) await close(e);
    } else if (SYS.includes(kind)) {
      await Promise.all([inc(e, `all:sys:${g.b}`, LIMIT.win), ...(kind === 'UPSTREAM_RATE_LIMITED' ? [inc(e, `all:rl:${g.b}`, LIMIT.win)] : [])]);
      if (g.half) await trip(e, g.b);
    } else if (kind === 'AUTH_REJECTED' || kind === 'ACCOUNT_LOCKED') {
      // 끝난 앞 대기 행을 먼저 지운다(읽기는 우리 시계로 만료를 보지만 smul_try는 DB 시계로 지워서, 시계가 어긋나면 옛 기한이 남는다)
      const [k] = await Promise.all([inc(e, 'idf:' + g.idKey, LIMIT.id.failSec), del(e, 'idw:' + g.idKey), ...(g.ipKey ? [inc(e, `${g.ipKey}:${g.h}`, (LIMIT.ipFail.hours + 1) * 3600)] : [])]);
      await inc(e, 'idw:' + g.idKey, idDelay(k));
    } else await inc(e, `all:${kind === 'UNKNOWN_UPSTREAM_ERROR' ? 'unk' : 'blk'}:${g.b}`, LIMIT.win); // 차단기 근거로 쓰지 않고 따로 센다
  } catch (x) { console.error('smul record', (x as Error).message); }
  await release(e, g.held);
}
