// 회원제 브라우저 쪽(docs/decisions/0029): 구글·카카오 로그인(PKCE), 세션 보관·갱신, 불러오기·저장·학번 연결. 서버는 api/account.ts
// 세션은 localStorage, PKCE verifier·돌아갈 화면·샘물 연결 증명은 sessionStorage(이 탭에서만)
export type Provider = 'google' | 'kakao';
export type Acct = { provider: string; linked: boolean };
type Session = { at: string; rt: string; exp: number };

const SK = 'credit-planner.session', VK = 'credit-planner.pkce', BK = 'credit-planner.back', PK = 'credit-planner.link';
const get = (st: Storage, k: string) => { try { return st.getItem(k); } catch { return null; } };
const set = (st: Storage, k: string, v: string | null) => { try { v == null ? st.removeItem(k) : st.setItem(k, v); } catch { /* 저장 불가 */ } };
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 로그인 화면으로 보낸다. 돌아오면 지금 화면으로
export async function login(p: Provider) {
  const v = b64url(crypto.getRandomValues(new Uint8Array(32)));
  set(sessionStorage, VK, v); set(sessionStorage, BK, location.hash);
  location.href = `/api/account?p=${p}&c=${b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))}`;
}
export const logout = () => { set(localStorage, SK, null); set(sessionStorage, PK, null); };
// 샘물 가져오기가 준 연결 증명을 둔다(로그인 상태면 다음 저장 때, 아니면 로그인한 뒤 연결)
export const keepProof = (p: unknown) => { if (typeof p === 'string') set(sessionStorage, PK, p); };
export const hasProof = () => !!get(sessionStorage, PK);

async function post(body: object, at?: string) {
  const r = await fetch('/api/account', { method: 'POST', headers: { 'content-type': 'application/json', ...(at ? { authorization: `Bearer ${at}` } : {}) }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? '지금 저장할 수 없습니다.'), { status: r.status });
  return j;
}
// 만료 1분 전이면 갱신. 갱신이 거절되면 로그아웃
async function access(): Promise<string | null> {
  let s: Session | null = null; try { s = JSON.parse(get(localStorage, SK) || 'null'); } catch { /* 깨진 값 */ }
  if (!s) return null;
  if (s.exp - 60 > Date.now() / 1000) return s.at;
  try { s = await post({ op: 'refresh', rt: s.rt }) as Session; set(localStorage, SK, JSON.stringify(s)); return s.at; }
  catch (x) { if ((x as { status?: number }).status === 401) logout(); return null; }
}
const authed = async (body: object) => { const at = await access(); if (!at) throw Object.assign(new Error('다시 로그인해 주세요.'), { status: 401 }); return post(body, at); };

// 첫 화면: 로그인에서 돌아왔으면 code를 세션으로 바꾸고, 로그인돼 있으면 계정 상태와 저장값을 받는다.
// 이 탭에 샘물 연결 증명이 남아 있으면 이 기기 값이 더 새것이라 저장값을 돌려주지 않는다(곧 저장이 덮어쓴다)
export async function start(): Promise<{ acct: Acct | null; data?: unknown; error?: string }> {
  const q = new URLSearchParams(location.search), code = q.get('code'), v = get(sessionStorage, VK);
  let error: string | undefined;
  if (code || q.has('error')) {
    history.replaceState(null, '', location.pathname + (get(sessionStorage, BK) || ''));
    set(sessionStorage, VK, null); set(sessionStorage, BK, null);
    if (code && v) { try { set(localStorage, SK, JSON.stringify(await post({ op: 'token', code, verifier: v }))); } catch { error = '로그인하지 못했습니다. 다시 시도해 주세요.'; } }
    else error = '로그인하지 못했습니다. 다시 시도해 주세요.';
  }
  if (!(await access())) return { acct: null, error };
  try {
    const j = await authed({ op: 'load' });
    return { acct: { provider: j.provider, linked: j.linked }, data: j.linked && !get(sessionStorage, PK) ? j.data ?? undefined : undefined, error };
  } catch { return { acct: (await access()) ? { provider: '', linked: false } : null, error }; }
}
// 저장. 연결 증명이 있으면 먼저 연결한다. 연결 여부를 돌려준다
export async function push(data: unknown): Promise<boolean> {
  const proof = get(sessionStorage, PK);
  if (proof) { await authed({ op: 'link', proof }).catch(x => { if ((x as { status?: number }).status === 400) set(sessionStorage, PK, null); throw x; }); set(sessionStorage, PK, null); }
  return (await authed({ op: 'save', data })).linked;
}
export async function quit() { await authed({ op: 'quit' }); logout(); }
