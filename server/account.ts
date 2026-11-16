// 회원제(docs/decisions/0029): Supabase Auth(구글·카카오) REST 호출, 학번 연결 증명, 연결·저장 RPC.
// 브라우저는 Supabase를 직접 부르지 않는다(CSP connect-src 'self' 유지). 표는 service role만 쓴다(supabase/migrations/20261116120000_account.sql).
import { hmac, type Env } from './smul/store.ts';

export const PROVIDERS = ['google', 'kakao'] as const;
const LINK_SEC = 600; // 샘물 성공 뒤 10분 안에 로그인하면 연결

// 샘물 가져오기에 성공한 학번의 증명: '학번.만료(초).서명'. SMUL_KEY_SECRET이 없으면(로컬 개발) 만들지 않는다
export async function makeProof(e: Env, sno: string, now = Date.now()) {
  if (!e.SMUL_KEY_SECRET) return undefined;
  const exp = Math.floor(now / 1000) + LINK_SEC;
  return `${sno}.${exp}.${await hmac(e.SMUL_KEY_SECRET, `link:${sno}:${exp}`)}`;
}
// 맞으면 학번, 아니면 null
export async function readProof(e: Env, proof: unknown, now = Date.now()) {
  const m = typeof proof === 'string' ? /^(\d{9})\.(\d{10})\.([0-9a-f]{64})$/.exec(proof) : null;
  if (!m || !e.SMUL_KEY_SECRET || +m[2] * 1000 < now) return null;
  const want = await hmac(e.SMUL_KEY_SECRET, `link:${m[1]}:${m[2]}`);
  let d = 0; for (let i = 0; i < 64; i++) d |= want.charCodeAt(i) ^ m[3].charCodeAt(i); // 글자마다 같은 시간에 비교
  return d ? null : m[1];
}
export const snoKey = (e: Env, sno: string) => hmac(e.SMUL_KEY_SECRET!, `acct:${sno}`);

const call = (e: Env, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(`${e.SUPABASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(5000), headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY!, 'content-type': 'application/json', ...init.headers } });

// 소셜 로그인 시작 주소(PKCE). redirect는 Supabase Redirect URLs에 있어야 한다
export const authorizeUrl = (e: Env, provider: string, challenge: string, redirect: string) =>
  `${e.SUPABASE_URL}/auth/v1/authorize?${new URLSearchParams({ provider, redirect_to: redirect, code_challenge: challenge, code_challenge_method: 's256' })}`;

export type Session = { at: string; rt: string; exp: number };
// grant: pkce(로그인 직후 code 교환) 또는 refresh_token. 실패하면 null
export async function token(e: Env, grant: 'pkce' | 'refresh_token', body: object): Promise<Session | null> {
  const r = await call(e, `/auth/v1/token?grant_type=${grant}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) return null;
  const j = await r.json() as { access_token: string; refresh_token: string; expires_at?: number; expires_in: number };
  return { at: j.access_token, rt: j.refresh_token, exp: j.expires_at ?? Math.floor(Date.now() / 1000) + j.expires_in };
}
// 토큰 주인. 만료·위조면 null
export async function user(e: Env, at: string): Promise<{ id: string; provider: string } | null> {
  const r = await call(e, '/auth/v1/user', { headers: { authorization: `Bearer ${at}` } });
  if (!r.ok) return null;
  const j = await r.json() as { id: string; app_metadata?: { provider?: string } };
  return { id: j.id, provider: j.app_metadata?.provider ?? '' };
}
async function rpc(e: Env, fn: string, args: object) {
  const r = await call(e, `/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
export const link = async (e: Env, sno: string, uid: string) => rpc(e, 'account_link', { p_key: await snoKey(e, sno), p_user: uid });
export const load = (e: Env, uid: string): Promise<{ linked: boolean; data: unknown; at: string | null }> => rpc(e, 'account_load', { p_user: uid });
export const save = (e: Env, uid: string, data: unknown): Promise<boolean> => rpc(e, 'account_save', { p_user: uid, p_data: data });
// 탈퇴: 사용자를 지우면 연결·저장값은 외래 키로 같이 지워진다
export async function quit(e: Env, uid: string) {
  const r = await call(e, `/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`quit ${r.status}`);
}
