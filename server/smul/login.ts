// 샘물 로그인과 실패 분류: SSO 로그인 → 통합정보시스템 세션 쿠키(학교 허가 2026-10-21, docs/ARCHITECTURE.md §6-5).
// 학번·비밀번호는 이 요청 안에서만 쓰고 저장·기록하지 않는다.
export const SSO = 'https://smsso.smu.ac.kr/Login.do', SMUL = 'https://smul.smu.ac.kr/', T = 10_000;
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'; // 브라우저 UA

// 학생에게 보이는 샘물 오류 문구(가져오기를 막을 때의 문구는 limit.ts)
export const MSG = {
  auth: '학번 또는 샘물 비밀번호가 맞지 않습니다.',
  attempts: '샘물 로그인에 여러 번 실패해 잠겼습니다. 샘물에서 비밀번호를 초기화한 뒤 다시 시도해 주세요.',
  unknown: '샘물 로그인을 마치지 못했습니다. 샘물에 직접 로그인해 비밀번호 변경 안내 등이 있는지 확인한 뒤 다시 시도해 주세요.',
  login: '지금 샘물 로그인 서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
  fetch: '샘물에서 수강 기록을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  loginTimeout: '샘물 로그인 서버가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.',
  fetchTimeout: '샘물이 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.',
};

// 샘물 실패 분류(docs/decisions/0013). 전체 차단기는 SYS만 센다. 상태 코드만으로 원인을 정할 근거가 없으면 UNKNOWN으로 둔다
export type Kind = 'AUTH_REJECTED' | 'ACCOUNT_LOCKED' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_CONNECTION_ERROR' | 'UPSTREAM_SERVER_ERROR'
  | 'UPSTREAM_RATE_LIMITED' | 'AUTHORIZATION_OR_ACCESS_BLOCK' | 'UNKNOWN_UPSTREAM_ERROR';
export const SYS: Kind[] = ['UPSTREAM_TIMEOUT', 'UPSTREAM_CONNECTION_ERROR', 'UPSTREAM_SERVER_ERROR', 'UPSTREAM_RATE_LIMITED'];
export class Fail extends Error { status: number; kind: Kind; constructor(status: number, message: string, kind: Kind) { super(message); this.status = status; this.kind = kind; } }
export const up = (kind: Kind, message: string) => new Fail(kind === 'UPSTREAM_TIMEOUT' ? 504 : kind === 'UNKNOWN_UPSTREAM_ERROR' ? 502 : 503, message, kind);
// 429는 요청 제한, 5xx는 샘물(또는 앞단) 오류, 401·403은 인증 밖 접근 거부로 본다. 그 밖(404 등)은 근거가 없어 UNKNOWN
export const byStatus = (s: number): Kind => s === 429 ? 'UPSTREAM_RATE_LIMITED' : s >= 500 ? 'UPSTREAM_SERVER_ERROR' : s === 401 || s === 403 ? 'AUTHORIZATION_OR_ACCESS_BLOCK' : 'UNKNOWN_UPSTREAM_ERROR';

export type Jar = Map<string, string>;
export const header = (j: Jar) => [...j].map(([k, v]) => `${k}=${v}`).join('; ');

// fetch는 리다이렉트 사이에 쿠키를 넘기지 않으므로 직접 따라간다. 도메인 구분 없이 이름으로 모으고, 307·308이 아니면 GET으로 바꾼다
async function go(f: typeof fetch, url: string, init: { method: string; headers?: Record<string, string>; body?: string }, send: Jar) {
  const got: Jar = new Map();
  for (let hop = 0; hop < 20; hop++) {
    const c = header(new Map([...send, ...got]));
    const r = await f(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(T), headers: { ...init.headers, 'user-agent': UA, ...(c ? { cookie: c } : {}) } });
    for (const s of r.headers.getSetCookie()) { const kv = s.split(';')[0], i = kv.indexOf('='); if (i > 0) got.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (!loc) return { r, url, got };
    await r.body?.cancel();
    url = new URL(loc, url).href;
    if (r.status !== 307 && r.status !== 308) init = { method: 'GET' };
  }
  throw new Error('too many redirects');
}

// SSO 로그인 → 통합정보시스템 세션 쿠키. 최종 주소로 판정한다(로그인 화면으로 돌아오면 비밀번호 오류, 통합정보시스템에 못 들어가면 잠김).
// 최종 응답이 2xx가 아니면 상태 코드로 분류한다. 예전에는 '비밀번호 장기 미변경'(423)으로 봤지만 실제 응답으로 확인한 적이 없어 UNKNOWN으로 바꿨다
export async function session(f: typeof fetch, id: string, pw: string): Promise<Jar> {
  const login = await go(f, SSO, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: new URLSearchParams({ user_id: id, user_password: pw }).toString() }, new Map());
  if (!login.r.ok) { const k = byStatus(login.r.status); throw up(k, k === 'UNKNOWN_UPSTREAM_ERROR' ? MSG.unknown : MSG.login); }
  if (login.url === SSO) throw new Fail(401, MSG.auth, 'AUTH_REJECTED');
  const s = await go(f, SMUL + 'index.do', { method: 'GET' }, login.got);
  if (!s.r.ok) { const k = byStatus(s.r.status); throw up(k, k === 'UNKNOWN_UPSTREAM_ERROR' ? MSG.unknown : MSG.login); }
  if (s.url !== SMUL) throw new Fail(423, MSG.attempts, 'ACCOUNT_LOCKED'); // 잠김 판정은 실제 잠긴 계정으로 확인 불가
  return s.got;
}

// 로그인·조회 중 Fail이 아닌 예외를 분류한다
export const wrap = (step: 'login' | 'fetch') => (e: unknown): never => {
  if (e instanceof Fail) throw e;
  const x = e as Error & { cause?: { code?: string } };
  console.error('smul', step, x.name, x.message, x.cause?.code ?? ''); // 학번·비밀번호는 오류에 들어 있지 않다
  if (x.name === 'TimeoutError') throw up('UPSTREAM_TIMEOUT', step === 'login' ? MSG.loginTimeout : MSG.fetchTimeout);
  // fetch는 연결 실패(DNS·거부·끊김)를 TypeError('fetch failed', cause)로 던진다. 리다이렉트 초과 등 나머지는 UNKNOWN
  throw up(x.name === 'TypeError' && x.cause ? 'UPSTREAM_CONNECTION_ERROR' : 'UNKNOWN_UPSTREAM_ERROR', MSG[step]);
};
