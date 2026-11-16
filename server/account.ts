// 회원제(docs/decisions/0029): Supabase Auth(구글·카카오) REST 호출, 계정별 저장 RPC.
// 브라우저는 Supabase를 직접 부르지 않는다(CSP connect-src 'self' 유지). 표는 service role만 쓴다(supabase/migrations/20261116180000_account_state.sql).
import type { Env } from './smul/store.ts';

export const PROVIDERS = ['google', 'kakao'] as const;

const call = (e: Env, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(`${e.SUPABASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(5000), headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY!, 'content-type': 'application/json', ...init.headers } });

// Supabase 기본 카카오 연결은 이메일(account_email)을 늘 같이 요청해 비즈 앱이 아니면 KOE205가 난다.
// 그래서 카카오는 직접 추가한 OIDC 연결(custom:kakao, 닉네임만 요청)로 보낸다(ADR 0029)
const AUTH_ID: Record<string, string> = { kakao: 'custom:kakao' };
export const providerName = (id: string) => id.replace(/^custom:/, '');
// 소셜 로그인 시작 주소(PKCE). redirect는 Supabase Redirect URLs에 있어야 한다
export const authorizeUrl = (e: Env, provider: string, challenge: string, redirect: string) =>
  `${e.SUPABASE_URL}/auth/v1/authorize?${new URLSearchParams({ provider: AUTH_ID[provider] ?? provider, redirect_to: redirect, code_challenge: challenge, code_challenge_method: 's256' })}`;

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
  return { id: j.id, provider: providerName(j.app_metadata?.provider ?? '') };
}
async function rpc(e: Env, fn: string, args: object) {
  const r = await call(e, `/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
export const load = (e: Env, uid: string): Promise<{ data: unknown; at: string | null }> => rpc(e, 'account_get', { p_user: uid });
export const save = (e: Env, uid: string, data: unknown) => rpc(e, 'account_put', { p_user: uid, p_data: data });
// 탈퇴: 사용자를 지우면 저장값은 외래 키로 같이 지워진다
export async function quit(e: Env, uid: string) {
  const r = await call(e, `/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`quit ${r.status}`);
}
