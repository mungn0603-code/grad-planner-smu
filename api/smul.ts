// 상명대 샘물 이수과목 가져오기(POST /api/smul): 학생이 넣은 학번·비밀번호로 서버가 대신 로그인한다(학교 허가 2026-10-21, docs/ARCHITECTURE.md §6-5).
// Vercel 함수 진입 파일. api/의 파일마다 함수가 하나씩 생기므로 나머지는 server/smul/에 두고 import한다(Vercel이 함께 묶는다, ADR 0025).
// 로그인 login.ts · 조회·응답 변환 parse.ts · 횟수 제한 limit.ts · 차단기 breaker.ts · 횟수 저장소 store.ts
import { MSG, type Fail } from '../server/smul/login.ts';
import { courses } from '../server/smul/parse.ts';
import { limit, record } from '../server/smul/limit.ts';

export { courses } from '../server/smul/parse.ts';
export { LIMIT, idDelay } from '../server/smul/limit.ts';
export { state } from '../server/smul/breaker.ts';

const json = (status: number, body: object) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(req: Request) {
    if (req.method !== 'POST') return json(405, { error: 'POST만 받습니다.' });
    const origin = req.headers.get('origin') ?? '';
    if (origin.replace(/^https?:\/\//, '') !== new URL(req.url).host) return json(403, { error: '허용되지 않은 요청입니다.' }); // 다른 사이트에서 이 주소를 부르지 못하게
    const b = await req.json().catch(() => null);
    const id = typeof b?.id === 'string' ? b.id.trim() : '', pw = typeof b?.pw === 'string' ? b.pw : '';
    if (!/^\d{9}$/.test(id) || !pw || pw.length > 100) return json(400, { error: '학번(숫자 9자리)과 비밀번호를 확인해 주세요.' });
    const g = await limit(req, id);
    if ('block' in g) return json(g.block[0], { error: g.block[1] });
    // 샘물로 다시 보내지 않는다(재시도는 비밀번호를 한 번 더 내는 것이라 샘물 실패 횟수를 늘릴 수 있다)
    const [status, body, kind] = await courses(id, pw).then(out => [200, out, null] as const,
      (e: Fail) => [e.status ?? 503, { error: e.status ? e.message : MSG.login }, e.kind ?? 'UNKNOWN_UPSTREAM_ERROR'] as const);
    if (kind) console.error('smul fail', kind, status); // 분류와 상태만(학번·IP 없음)
    await record(g.gate, kind);
    return json(status, body);
  },
};
