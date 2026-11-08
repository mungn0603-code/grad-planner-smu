import { defineConfig } from 'vite';
import vercel from './vercel.json' with { type: 'json' };
import smul from './api/smul.ts';

async function api(raw: unknown, res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }) {
  const req = raw as AsyncIterable<string> & { method: string; headers: Record<string, string | undefined> }; // @types/node 없이
  let body = ''; for await (const c of req) body += c;
  const r = await smul.fetch(new Request(`http://${req.headers.host}/api/smul`, { method: req.method,
    headers: { 'content-type': String(req.headers['content-type'] ?? ''), origin: String(req.headers.origin ?? '') }, ...(req.method === 'POST' ? { body } : {}) }));
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text());
}

export default defineConfig({
  base: './',                          // 정적 호스팅 어느 경로에 올려도 동작
  oxc: { jsx: { runtime: 'automatic' } },
  worker: { format: 'es' },            // 추천 Worker가 엔진의 top-level await를 쓴다
  // 배포(vercel.json)와 같은 보안 헤더로 미리보기. HSTS는 localhost에 걸지 않는다
  preview: { headers: Object.fromEntries(vercel.headers[0].headers.filter(h => h.key !== 'Strict-Transport-Security').map(h => [h.key, h.value])) },
  // 개발 서버·빌드 미리보기에서도 배포(Vercel 함수)와 같은 /api/smul을 쓴다
  plugins: [{ name: 'local-api', configureServer: s => { s.middlewares.use('/api/smul', api); }, configurePreviewServer: s => { s.middlewares.use('/api/smul', api); } }],
});
