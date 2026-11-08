// 횟수 저장소: Supabase 표 smul_try(k, n, until)와 RPC smul_try(+1)·smul_ok(삭제) (supabase/migrations/20261021131227_smul_try.sql).
// 키는 HMAC(SMUL_KEY_SECRET, 'id:학번'|'ip:IP'|'ipf:IP') — 학번은 10⁹가지뿐이라 그냥 해시는 되돌릴 수 있다.
export type Env = Record<string, string | undefined>;
export const env = (): Env => (globalThis as { process?: { env: Env } }).process?.env ?? {};
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export async function hmac(secret: string, v: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(v)));
}
async function rpc(e: Env, fn: string, args: object) { // apikey 헤더만으로 service role이 된다(새 비밀 키·예전 키 모두)
  const r = await fetch(`${e.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', signal: AbortSignal.timeout(3000),
    headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY!, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  const t = await r.text(); return t ? JSON.parse(t) : null; // void 함수(smul_ok)는 본문 없는 204
}
export const inc = (e: Env, k: string, sec: number): Promise<number> => rpc(e, 'smul_try', { p_key: k, p_sec: sec });
export const del = (e: Env, k: string) => rpc(e, 'smul_ok', { p_key: k });

export type Counts = Map<string, { n: number; until: string }>;
export const num = (c: Counts, k: string) => c.get(k)?.n ?? 0;
// 기한이 남은 행만 읽는다(service role은 RLS를 건너뛴다)
export async function counts(e: Env, keys: string[]): Promise<Counts> {
  const q = `k=in.(${keys.join(',')})&until=gt.${encodeURIComponent(new Date().toISOString())}&select=k,n,until`;
  const r = await fetch(`${e.SUPABASE_URL}/rest/v1/smul_try?${q}`, { signal: AbortSignal.timeout(3000), headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY! } });
  if (!r.ok) throw new Error(`read ${r.status}`);
  return new Map((await r.json() as { k: string; n: number; until: string }[]).map(x => [x.k, x]));
}
