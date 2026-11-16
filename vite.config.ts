import { defineConfig, loadEnv } from 'vite';
import vercel from './vercel.json' with { type: 'json' };
import smul from './api/smul.ts';
import account from './api/account.ts';

type Handler = { fetch: (r: Request) => Promise<Response> };
// Vercel 함수(fetch 핸들러)를 개발 서버 미들웨어로. 경로·쿼리·인증 헤더를 그대로 넘긴다
const api = (h: Handler) => async (raw: unknown, res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }) => {
  const req = raw as AsyncIterable<string> & { method: string; originalUrl: string; headers: Record<string, string | undefined> }; // @types/node 없이
  let body = ''; for await (const c of req) body += c;
  const pass = ['content-type', 'origin', 'authorization'].flatMap(k => req.headers[k] ? [[k, String(req.headers[k])]] : []);
  const r = await h.fetch(new Request(`http://${req.headers.host}${req.originalUrl}`, { method: req.method, headers: Object.fromEntries(pass), ...(req.method === 'POST' ? { body } : {}) }));
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text());
};
const mount = (s: { middlewares: { use: (path: string, fn: ReturnType<typeof api>) => void } }) => { s.middlewares.use('/api/smul', api(smul)); s.middlewares.use('/api/account', api(account)); };

export default defineConfig(({ mode }) => {
  // 함수가 읽는 서버 비밀값(SUPABASE_URL 등)을 .env.local에서 process.env로(개발 서버에서만 쓰고 번들에는 넣지 않는다)
  const proc = (globalThis as { process?: { env: Record<string, string | undefined>; cwd: () => string } }).process;
  if (proc) Object.assign(proc.env, loadEnv(mode, proc.cwd(), ''), { ...proc.env });
  return {
  base: './',                          // 정적 호스팅 어느 경로에 올려도 동작
  oxc: { jsx: { runtime: 'automatic' } },
  worker: { format: 'es' },            // 추천 Worker가 엔진의 top-level await를 쓴다
  // 배포(vercel.json)와 같은 보안 헤더로 미리보기. HSTS는 localhost에 걸지 않는다
  preview: { headers: Object.fromEntries(vercel.headers[0].headers.filter(h => h.key !== 'Strict-Transport-Security').map(h => [h.key, h.value])) },
  // 개발 서버·빌드 미리보기에서도 배포(Vercel 함수)와 같은 /api/smul·/api/account를 쓴다
  plugins: [{ name: 'local-api', configureServer: mount, configurePreviewServer: mount }],
};});
