// 회원제(/api/account, docs/decisions/0029). 브라우저 대신 Supabase Auth·표를 부른다. 함수 본체는 server/account.ts
// GET ?p=google|kakao&c=<PKCE challenge>  → 소셜 로그인 화면으로 보낸다
// POST { op: 'token', code, verifier } | { op: 'refresh', rt }             → 세션 { at, rt, exp }
// POST(Authorization: Bearer at) { op: 'load' } | { op: 'save', data } | { op: 'link', proof } | { op: 'quit' }
import { env } from '../server/smul/store.ts';
import { PROVIDERS, authorizeUrl, token, user, readProof, link, load, save, quit } from '../server/account.ts';

const json = (status: number, body: object) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const MAX = 512_000; // 저장값 크기 상한(바이트). 과목 수백 개도 100KB 안쪽

export default {
  async fetch(req: Request) {
    const e = env(), url = new URL(req.url);
    if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) return json(503, { error: '지금 로그인을 쓸 수 없습니다.' });
    if (req.method === 'GET') {
      const p = url.searchParams.get('p') ?? '', c = url.searchParams.get('c') ?? '';
      if (!(PROVIDERS as readonly string[]).includes(p) || !/^[\w-]{43}$/.test(c)) return json(400, { error: '잘못된 요청입니다.' });
      return Response.redirect(authorizeUrl(e, p, c, `${url.origin}/`), 302);
    }
    if (req.method !== 'POST') return json(405, { error: 'GET·POST만 받습니다.' });
    if ((req.headers.get('origin') ?? '').replace(/^https?:\/\//, '') !== url.host) return json(403, { error: '허용되지 않은 요청입니다.' });
    const text = await req.text();
    if (text.length > MAX) return json(413, { error: '저장할 정보가 너무 큽니다.' });
    let b: any; try { b = JSON.parse(text); } catch { return json(400, { error: '잘못된 요청입니다.' }); }
    try {
      if (b?.op === 'token' || b?.op === 'refresh') {
        const s = b.op === 'token'
          ? typeof b.code === 'string' && typeof b.verifier === 'string' ? await token(e, 'pkce', { auth_code: b.code, code_verifier: b.verifier }) : null
          : typeof b.rt === 'string' ? await token(e, 'refresh_token', { refresh_token: b.rt }) : null;
        return s ? json(200, s) : json(401, { error: '다시 로그인해 주세요.' });
      }
      const at = /^Bearer (\S+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
      const u = at ? await user(e, at) : null;
      if (!u) return json(401, { error: '다시 로그인해 주세요.' });
      switch (b?.op) {
        case 'load': return json(200, { provider: u.provider, ...await load(e, u.id) });
        case 'save': return json(200, { linked: await save(e, u.id, b.data) });
        case 'link': { const sno = await readProof(e, b.proof);
          if (!sno) return json(400, { error: '샘물에서 다시 가져와 주세요.' });
          await link(e, sno, u.id); return json(200, { linked: true }); }
        case 'quit': await quit(e, u.id); return json(200, {});
      }
      return json(400, { error: '잘못된 요청입니다.' });
    } catch (x) {
      console.error('account fail', b?.op, (x as Error).message); // 작업 이름과 상태만(계정·학번 없음)
      return json(503, { error: '지금 저장할 수 없습니다. 잠시 뒤 다시 시도해 주세요.' });
    }
  },
};
