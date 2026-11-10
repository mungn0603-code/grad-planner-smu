import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import handler, { courses, idDelay, LIMIT, state } from '../api/smul.ts';
import { rowsToEnrollments } from './paste.ts';

// 가짜 샘물: SSO 로그인 → (리다이렉트) → index.do → (리다이렉트) → '/' → 이수과목 목록 → 학생 정보·수강신청현황. 실제 값은 쓰지 않는다
// 비밀번호 'locked'는 SSO는 통과하고 통합정보시스템에 못 들어가는 잠김. opt.down이 있으면 모든 샘물 요청이 그 응답(또는 예외)이 된다
function fakeSmul(pw = 'pw', menuOk = true) {
  const calls: { url: string; method: string; cookie: string; body: string }[] = [];
  const opt: { down: null | (() => Response); recErr: boolean } = { down: null, recErr: false };
  const redirect = (to: string, cookie?: string) => new Response(null, { status: 302, headers: [['location', to], ...(cookie ? [['set-cookie', cookie + '; Path=/; HttpOnly']] : [])] as [string, string][] });
  const f = (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>, body = String(init.body ?? '');
    calls.push({ url, method: init.method ?? 'GET', cookie: h.cookie ?? '', body });
    if (opt.down) return opt.down();
    const given = new URLSearchParams(body).get('user_password');
    if (url === 'https://smsso.smu.ac.kr/Login.do') return given === pw ? redirect('/sso/ok', 'SSO=t1') : given === 'locked' ? redirect('/sso/ok', 'SSO=t2') : new Response('login form'); // 실패하면 로그인 화면 그대로
    if (url === 'https://smsso.smu.ac.kr/sso/ok') return new Response('ok');
    if (url === 'https://smul.smu.ac.kr/index.do') return h.cookie === 'SSO=t1' ? redirect('https://smul.smu.ac.kr/', 'JSESSIONID=s1') : new Response('login');
    if (url === 'https://smul.smu.ac.kr/') return new Response('main');
    if (url === 'https://smul.smu.ac.kr/UsrRecMatt/list.do') return Response.json(opt.recErr ? { ERRMSGINFO: { ERRMSG: '처리 중 오류' } } : { dsRecMattList: [
      { SCH_YEAR: '2024', SMT_NM: '1학기', SBJ_NO: 'HBJO2173', SBJ_NM: '컴퓨터프로그래밍Ⅰ(PBL)', CMP_DIV_NM: '1전선', CDT: 3, GRD_NM: 'A+', CULT_ARA_NM: '', NM: '홍길동', EMAIL: 'x@y' },
      { SCH_YEAR: '2024', SMT_NM: '하계계절학기', SBJ_NM: '타대 계절 교양', CMP_DIV_NM: '교선', CDT: 2, GRD_NM: 'P', CULT_ARA_NM: '균형교양' },
      { SCH_YEAR: '2026', SMT_NM: '2학기', SBJ_NO: 'HBJX0001', SBJ_NM: '성적 먼저 나온 과목', CMP_DIV_NM: '교선', CDT: 1, GRD_NM: 'P' },
    ] });
    if (url === 'https://smul.smu.ac.kr/UsrSchMng/selectStdInfo.do') return Response.json({ dsStdInfoList: [{ STDNO: '202300001', NM_KOR: '홍길동', EMAIL: 'x@y', CPNO: '010-0000', TMP_DEPT_MJR_NM: '융합공과대학 소프트웨어학과', ENTR_RCD_NM: '편입학', NAT_RCD_NM: '대한민국', BRTDY: '20000101', MJR_CD2: '', MJR_CD_B1: '경영학과', MICRO_MJR_1: 'AI 데이터 마이크로전공', CAMPUS_RCD: 'C2', ORG_CLS_RCD: 'O1' }] });
    if (url === 'https://smul.smu.ac.kr/UgdAllRecSch/list.do') return Response.json({ dmStdInfo: { strTotGetCdt: '9' }, dsSmtRecList: [], dsRcrdUnivRecgRecList: [{ CMP_DIV_NM: '교선', CDT: '30' }, { CMP_DIV_NM: '일선', CDT: 35 }, { CMP_DIV_NM: '', CDT: '' }] });
    if (url === 'https://smul.smu.ac.kr/UcrTlsnAplyChk/onLoad.do') return Response.json(menuOk
      ? { _METADATA_: { strDefSchYear: '2026', strDefSmtRcd: 'S20' }, dsSmtRcd: [{ CD: 'S10', CD_NM: '1학기' }, { CD: 'S20', CD_NM: '2학기' }] }
      : { ERRMSGINFO: { ERRMSG: '메뉴에 대한 접근권한이 없습니다' } });
    if (url === 'https://smul.smu.ac.kr/UcrTlsnAplyChk/list.do') return Response.json({ dsUcrTlsnAply: [
      { SCH_YEAR: '2026', SMT_RCD: 'S20', SBJ_NO: 'HBJW0001', SBJ_KOR_NM: '이산수학', CMP_DIV_NM: '1전심', CDT: 3, NM: '홍길동', CPNO: '010-0000', EMAIL: 'x@y' },
      { SCH_YEAR: '2026', SMT_RCD: 'S20', SBJ_NO: 'HBJX0001', SBJ_KOR_NM: '성적 먼저 나온 과목', CMP_DIV_NM: '교선', CDT: 1 },
    ] });
    if (url === 'https://smul.smu.ac.kr/UcdCdrCmpSch/list.do') return Response.json({
      dsCdrAplyPcnd: [{ CDR_CD: 'C1', CDR_NM: '웹 개발자 SM-CDR', CDR_CMP_YN: 'N', PROF_NMS: '김교수' }],
      dsNoSbjCmpPcnd: [{ PGM_NM: '상생플러스', CMP_YN: 'Y', CDR_NM: '웹 개발자 SM-CDR' }, { PGM_NM: '상명튜터링', CMP_YN: 'N' }, { PGM_NM: '상생플러스', CMP_YN: 'Y' }] });
    if (url === 'https://smul.smu.ac.kr/UgdCdtTable/list.do') return Response.json({ dsCmpDivRecList: [{ CMP_DIV_RCD: 'R1', CMP_DIV_NM: '1전선', GET_CDT: '3' }, { CMP_DIV_RCD: 'R2', CMP_DIV_NM: '교선', GET_CDT: 3 }],
      dsGrdtBaseInfo: [{ DEPT_NM: '소프트웨어학과', ENTR_DIV_NM: '신입', GRDT_CMP_CDT: '130', MJR_CDT: 75, MMJR_MJR_CDT: null, GP_AVG: '1.7' }],
      dsGyopilGetCdtList: [{ STDNO: '202300001', CULT_ARA_NM: '핵심교양', CULT_FULL_NM: '교필-핵심교양', GET_CDT: 2 }],
      dsCurStdTlsnList: [{ SBJ_NO: 'HBJW0001', CULT_ARA_NM: '', GET_SBJ_NO: '' }, { SBJ_NO: 'HBJO2173', CULT_ARA_NM: '', GET_SCH_YEAR: '2024', GET_SMT_NM: '1학기', GET_SBJ_NO: 'HBJO2173', RE_GRD_NM: 'C0', PROF_NM: '김교수' }] });
    return new Response('?', { status: 404 });
  }) as typeof fetch;
  return { f, calls, opt };
}

test('샘물: SSO → 통합정보시스템 순서로 로그인하고, 이수과목과 이번 학기 수강 과목에서 학점 계산 열만 남긴다', async () => {
  const { f, calls } = fakeSmul();
  const { rows, student, cdr, cmp, base, retake, recg } = await courses('202300001', 'pw', f);
  assert.deepEqual(base, { GRDT_CMP_CDT: 130, MJR_CDT: 75, GP_AVG: 1.7 });            // 기준학점은 숫자 열만, 학과명·입학구분·빈 값은 버린다
  assert.deepEqual(retake, [{ code: 'HBJO2173', year: '2024', sem: '1학기', prev: 'HBJO2173' }]); // 재수강 대상만, 성적·교수 이름은 내보내지 않는다
  assert.deepEqual(student, { name: '홍길동', dept: '소프트웨어학과', entr: '편입학', majors: [{ kind: '부전공', name: '경영학과' }, { kind: '마이크로전공', name: 'AI 데이터 마이크로전공' }], intl: false }); // 이메일·연락처·생년월일·국적 값은 내보내지 않는다
  assert.deepEqual(recg, [{ cat: '교선', cdt: 30 }, { cat: '일선', cdt: 35 }]);    // 전적대학 인정학점: 이수구분별 학점만, 빈 행은 버린다
  assert.deepEqual(cdr, { tracks: ['웹 개발자 SM-CDR'], done: ['상생플러스'] });       // 이수(Y)한 비교과만, 이름은 한 번씩. 교수 이름은 내보내지 않는다
  assert.deepEqual(cmp, { '1전선': 3, 교선: 3 });                                      // 학점이수상황표 이수구분별 취득학점만
  assert.deepEqual(calls.map(c => `${c.method} ${c.url}`), [
    'POST https://smsso.smu.ac.kr/Login.do', 'GET https://smsso.smu.ac.kr/sso/ok',   // 302 뒤에는 GET
    'GET https://smul.smu.ac.kr/index.do', 'GET https://smul.smu.ac.kr/',
    'POST https://smul.smu.ac.kr/UsrRecMatt/list.do',
    'POST https://smul.smu.ac.kr/UsrSchMng/selectStdInfo.do', 'POST https://smul.smu.ac.kr/UcrTlsnAplyChk/onLoad.do', 'POST https://smul.smu.ac.kr/UcrTlsnAplyChk/list.do',
    'POST https://smul.smu.ac.kr/UcdCdrCmpSch/list.do', 'POST https://smul.smu.ac.kr/UgdCdtTable/list.do', 'POST https://smul.smu.ac.kr/UgdAllRecSch/list.do',
  ]);
  assert.equal(calls[1].cookie, 'SSO=t1');                     // 리다이렉트 사이에 쿠키를 넘긴다
  assert.equal(calls[4].cookie, 'JSESSIONID=s1');              // 목록은 통합정보시스템 세션 쿠키로
  assert.equal(calls[4].body, '@d#=@d1#&@d1#tp=dm&_AUTH_MENU_KEY=usrCPsnlInfoUpd-STD&@d1#strStdNo=202300001');
  const q = new URLSearchParams(calls[7].body);                  // 수강신청현황: 화면처럼 기본 학기·캠퍼스·조직 코드로
  assert.deepEqual(['@d1#strSchYear', '@d1#strSmtRcd', '@d1#strSesRcd', '@d1#strStdNo', '@d1#strCampusRcd', '@d1#strOrgClsRcd', '@d1#', '_AUTH_MENU_KEY'].map(k => q.get(k)),
    ['2026', 'S20', 'CMN111.0000', '202300001', 'C2', 'O1', 'dmParam', 'usrCPsnlInfoUpd-STD']);
  const c = new URLSearchParams(calls[8].body);                  // SM-CDR 이수조회: DataMap 둘(dmParam·dmPgmDiv)
  assert.deepEqual(c.getAll('@d#'), ['@d1#', '@d2#']);
  assert.deepEqual(['@d1#strStdNo', '@d1#', '@d2#strPgmDiv', '@d2#', '@d2#tp'].map(k => c.get(k)), ['202300001', 'dmParam', 'ucdSCdrCmpSch', 'dmPgmDiv', 'dm']);
  const g = new URLSearchParams(calls[9].body);                  // 학점이수상황표: 화면처럼 학번·캠퍼스
  assert.deepEqual(['@d1#strStdNo', '@d1#strCampusRcd', '@d1#'].map(k => g.get(k)), ['202300001', 'C2', 'dmParam']);
  const r = new URLSearchParams(calls[10].body);                 // 전체성적조회: 화면처럼 학번·조직 코드
  assert.deepEqual(['@d1#strStdNo', '@d1#strOrgClsRcd', '@d1#'].map(k => r.get(k)), ['202300001', 'O1', 'dmParam']);
  assert.ok(['홍길동', 'x@y', '010-0000'].every(v => !JSON.stringify(rows).includes(v)));
  assert.deepEqual(rowsToEnrollments(rows).es, [
    { code: 'HBJO2173', name: '컴퓨터프로그래밍Ⅰ(PBL)', credits: 3, category: '1전선', grade: 'A+', term: '2024-1' },
    { name: '타대 계절 교양', credits: 2, category: '교선', grade: 'P', term: '2024-S', cultArea: '균형교양' }, // 이수 당시 교양영역은 cultArea로 받는다(area는 직접 고친 값)
    { code: 'HBJX0001', name: '성적 먼저 나온 과목', credits: 1, category: '교선', grade: 'P', term: '2026-2' },
    { code: 'HBJW0001', name: '이산수학', credits: 3, category: '1전심', term: '2026-2' },   // 성적이 이미 있는 과목은 수강 중에서 뺀다
  ]);
  assert.ok(rowsToEnrollments(rows).es.every(e => !('area' in e)));   // 가져오기는 area를 채우지 않는다
});

test('샘물: 이번 학기 수강 과목을 못 가져와도(메뉴 권한 오류) 이수과목은 보낸다', async () => {
  const { f } = fakeSmul('pw', false);
  const { rows } = await courses('202300001', 'pw', f);
  assert.equal(rowsToEnrollments(rows).es.length, 3);
  assert.ok(!rows.some(r => r[0]?.startsWith('##')));
});

test('샘물: 비밀번호가 틀리면(로그인 화면으로 돌아오면) 401', async () => {
  const { f } = fakeSmul('other');
  await assert.rejects(courses('202300001', 'pw', f), { status: 401, message: /맞지 않습니다/ });
});

test('샘물 함수: 다른 출처·잘못된 학번은 샘물에 요청하지 않는다, 성공 응답은 저장하지 않게 한다', async () => {
  const req = (body: object, origin = 'https://app.test') => new Request('https://app.test/api/smul', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const real = globalThis.fetch, { f, calls } = fakeSmul();
  globalThis.fetch = f;
  try {
    assert.equal((await handler.fetch(req({ id: '202300001', pw: 'pw' }, 'https://evil.test'))).status, 403);
    assert.equal((await handler.fetch(req({ id: '2023', pw: 'pw' }))).status, 400);
    assert.equal((await handler.fetch(new Request('https://app.test/api/smul'))).status, 405);
    assert.equal(calls.length, 0);
    const ok = await handler.fetch(req({ id: '202300001', pw: 'pw' }));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const j = await ok.json();
    assert.equal(j.rows.length, 7);   // 머리글 + 이수 3 + 제목 + 머리글 + 수강 중 1
    assert.deepEqual(Object.keys(j.student), ['name', 'dept', 'entr', 'majors', 'intl']);
    assert.ok(!JSON.stringify(j).includes('x@y') && !JSON.stringify(j).includes('010-0000') && !JSON.stringify(j).includes('김교수') && !JSON.stringify(j).includes('20000101') && !JSON.stringify(j).includes('대한민국'));
  } finally { globalThis.fetch = real; }
});

// 가짜 Supabase(RPC smul_try·smul_ok, 표 읽기)를 가짜 샘물 앞에 붙인다. SQL처럼 기한(until)을 지키고, 시각은 가짜 시계(Date)를 따른다
function withLimit(rpcStatus = 200) {
  const s = fakeSmul(), store = new Map<string, { n: number; until: number }>(), rpcs: string[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    if (!url.startsWith('https://db.test/')) return s.f(url, init);
    rpcs.push(`${url} ${(init.headers as Record<string, string>).apikey} ${String(init.body ?? '')}`);
    if (rpcStatus !== 200) return new Response('{}', { status: rpcStatus });
    if (url.includes('/rest/v1/smul_try?')) {   // k=in.(a,b)&until=gt.…
      const ks = new URL(url).searchParams.get('k')!.slice(4, -1).split(',');
      return Response.json(ks.flatMap(k => { const x = store.get(k); return x && x.until > Date.now() ? [{ k, n: x.n, until: new Date(x.until).toISOString() }] : []; }));
    }
    const a = JSON.parse(String(init.body));
    if (url.endsWith('/smul_ok')) { store.delete(a.p_key); return new Response(null, { status: 204 }); } // void 함수: 실제 PostgREST는 본문 없는 204(2026-10-27 배포 로그로 확인)
    for (const [k, x] of store) if (x.until < Date.now()) store.delete(k);   // smul_try처럼 만료된 행부터 지운다
    const x = store.get(a.p_key);
    if (x) x.n++; else store.set(a.p_key, { n: 1, until: Date.now() + a.p_sec * 1000 });
    return Response.json(store.get(a.p_key)!.n);
  }) as typeof fetch;
  const set = (k: string, n: number, sec = 600) => store.set(k, { n, until: Date.now() + sec * 1000 });
  return { ...s, f, store, rpcs, set };
}
const h = async (v: string) => { // 함수와 같은 HMAC(시험 비밀값 'secret')
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(v)))].map(x => x.toString(16).padStart(2, '0')).join('');
};
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', SMUL_KEY_SECRET: 'secret', VERCEL: '1' };
const T0 = 1_800_000_000_000; // 관측 창(600초)과 1시간 칸의 시작에 맞춘 가짜 시각
const B = () => Math.floor(Date.now() / 1000 / LIMIT.win), H = () => Math.floor(Date.now() / 3_600_000);
type Req = (pw?: string, ip?: string, id?: string) => Request;
async function run(t: TestContext, env: Record<string, string>, f: typeof fetch, body: (req: Req) => Promise<void>) {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const real = globalThis.fetch, old = { ...process.env };
  Object.assign(process.env, env); globalThis.fetch = f;
  const req: Req = (pw = 'pw', ip = '1.2.3.4', id = '202300001') => new Request('https://app.test/api/smul', { method: 'POST', headers: { origin: 'https://app.test', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify({ id, pw }) });
  try { await body(req); } finally { globalThis.fetch = real; process.env = old; t.mock.timers.reset(); }
}
const sso = (x: { calls: { url: string; method: string }[] }) => x.calls.filter(c => c.method === 'POST' && c.url.endsWith('/Login.do')).length;
const err = async (r: Response) => (await r.json()).error as string;
const isProbe = (c: { url: string; cookie: string }) => c.url === 'https://smul.smu.ac.kr/' && c.cookie === '';

test('차단기 상태: 시스템 장애만 보고, 의심이면 줄이고 심각할 때만 연다(값은 LIMIT)', () => {
  const c = (o: Record<string, number>) => new Map(Object.entries(o).map(([k, n]) => [k, { n, until: '' }]));
  assert.equal(state(c({}), 1), 'closed');
  assert.equal(state(c({ 'all:sys:1': 4 }), 1), 'closed');                             // 장애 4회는 기준 미만
  assert.equal(state(c({ 'all:sys:1': 5, 'all:ok:1': 30 }), 1), 'closed');            // 5/35 = 14%
  assert.equal(state(c({ 'all:sys:1': 5, 'all:ok:1': 15 }), 1), 'throttled');         // 25%: 줄임
  assert.equal(state(c({ 'all:rl:1': 1, 'all:sys:1': 1, 'all:ok:1': 50 }), 1), 'throttled'); // 샘물이 429를 주면 줄임
  assert.equal(state(c({ 'all:sys:1': 9, 'all:ok:1': 11 }), 1), 'throttled');         // 45%: 멈추지는 않는다
  assert.equal(state(c({ 'all:sys:1': 19 }), 1), 'throttled');                         // 100%여도 19회면 멈추지 않는다
  assert.equal(state(c({ 'all:sys:1': 10, 'all:ok:1': 10 }), 1), 'trip');             // 20회·50%: 멈춤
  assert.equal(state(c({ 'all:sys:0': 20 }), 1), 'closed');                            // 지난 창은 보지 않는다
  assert.equal(state(c({ 'brk:open': 1, 'brk:half': 1 }), 1), 'open');
  assert.equal(state(c({ 'brk:half': 1 }), 1), 'half');
  assert.equal(state(c({ 'brk:ramp': 1 }), 1), 'throttled');                           // 닫은 뒤 단계적 재개
});

test('학번 잠금: 5번 실패마다 1분·5분·10분, 그 뒤로 30분 고정', () => {
  const d = Array.from({ length: 30 }, (_, i) => idDelay(i + 1));
  assert.deepEqual(d.filter(Boolean), [60, 300, 600, 1800, 1800, 1800]);
  assert.deepEqual(d.slice(0, 5), [0, 0, 0, 0, 60]);
  assert.equal(LIMIT.id.every, 5);
});

test('샘물 실패 분류: 상태 코드·예외를 분류하고, 근거 없는 응답은 UNKNOWN', async t => {
  t.mock.method(console, 'error', () => {});
  const cases: [() => Response, string, number][] = [
    [() => new Response('x', { status: 500 }), 'UPSTREAM_SERVER_ERROR', 503],
    [() => new Response('x', { status: 429 }), 'UPSTREAM_RATE_LIMITED', 503],
    [() => new Response('x', { status: 403 }), 'AUTHORIZATION_OR_ACCESS_BLOCK', 503],
    [() => new Response('x', { status: 404 }), 'UNKNOWN_UPSTREAM_ERROR', 502],
    [() => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }, 'UPSTREAM_CONNECTION_ERROR', 503],
    [() => { throw new DOMException('timeout', 'TimeoutError'); }, 'UPSTREAM_TIMEOUT', 504],
  ];
  for (const [down, kind, status] of cases) { const s = fakeSmul(); s.opt.down = down; await assert.rejects(courses('202300001', 'pw', s.f), { kind, status }); }
  await assert.rejects(courses('202300001', 'bad', fakeSmul().f), { kind: 'AUTH_REJECTED', status: 401 });
  await assert.rejects(courses('202300001', 'locked', fakeSmul().f), { kind: 'ACCOUNT_LOCKED', status: 423 });
  const s = fakeSmul(); s.opt.recErr = true;                                             // 로그인 뒤 샘물 업무 오류(ERRMSGINFO)
  await assert.rejects(courses('202300001', 'pw', s.f), { kind: 'UNKNOWN_UPSTREAM_ERROR', message: '처리 중 오류' });
});

test('샘물 함수: 비밀번호 오류·잠김은 차단기를 열지 않고, 여러 IP로 나눠도 IP마다·학번마다 센다', async t => {
  const x = withLimit();
  t.mock.method(console, 'error', () => {});
  await run(t, ENV, x.f, async req => {
    for (let i = 0; i < 25; i++) assert.equal((await handler.fetch(req(i % 2 ? 'bad' : 'locked', `10.0.${i}.1`, String(202300100 + i)))).status, i % 2 ? 401 : 423);
    assert.equal(sso(x), 25);
    assert.ok(!x.store.has('brk:open') && !x.store.has(`all:sys:${B()}`));
    assert.equal(x.store.get(`${await h('ipf:10.0.1.1')}:${H()}`)?.n, 1);
    assert.equal(x.store.get('idf:' + await h('id:202300101'))?.n, 1);
    assert.equal((await handler.fetch(req())).status, 200);                              // 다른 학생은 그대로
  });
});

test('샘물 함수: 성공은 실패 수를 늘리지 않고 학번 실패 기록을 지운다. 학번·IP 원문은 보내지 않는다', async t => {
  const x = withLimit();
  t.mock.method(console, 'error', () => {});
  await run(t, ENV, x.f, async req => {
    assert.equal((await handler.fetch(req('bad'))).status, 401);
    const ipf = `${await h('ipf:1.2.3.4')}:${H()}`, id = await h('id:202300001');
    assert.equal(x.store.get(ipf)?.n, 1);
    t.mock.timers.tick(30_000);
    assert.equal((await handler.fetch(req())).status, 200);
    assert.equal(x.store.get(ipf)?.n, 1);                                                // 성공은 IP 실패에 더하지 않는다
    assert.ok(!x.store.has('idf:' + id) && !x.store.has('idl:' + id));                   // 학번 실패 기록·자리를 지웠다
    assert.equal(x.store.get(`all:ok:${B()}`)?.n, 1);
    assert.ok(x.rpcs.every(r => !r.includes('202300001') && !r.includes('1.2.3.4') && r.includes(' svc ')));  // 원문 대신 HMAC, service 키는 apikey로
  });
});

test('샘물 함수: IP 최근 24시간 로그인 실패 49회는 통과, 50회면 그 IP만 막는다', async t => {
  const x = withLimit();
  t.mock.method(console, 'error', () => {});
  await run(t, ENV, x.f, async req => {
    const k = await h('ipf:5.5.5.5');
    x.set(`${k}:${H()}`, 30, 90_000); x.set(`${k}:${H() - 23}`, 19, 90_000); x.set(`${k}:${H() - 24}`, 100, 90_000); // 24시간보다 오래된 칸은 세지 않는다
    assert.equal((await handler.fetch(req('pw', '5.5.5.5'))).status, 200);              // 49회
    x.set(`${k}:${H()}`, 31, 90_000);
    const before = x.calls.length, r = await handler.fetch(req('pw', '5.5.5.5'));       // 50회
    assert.equal(r.status, 429);
    assert.match(await err(r), /24시간/);
    assert.equal(x.calls.length, before);                                                // 샘물로 나가지 않았다
    assert.equal((await handler.fetch(req('pw', '6.6.6.6'))).status, 200);              // 다른 IP는 그대로
  });
});

test('샘물 함수: 학번 5번 실패마다 잠금(1분·5분·10분·30분 고정), IP를 바꿔도 학번으로 세고 다른 학번으로 번지지 않는다', async t => {
  const x = withLimit();
  t.mock.method(console, 'error', () => {});
  let ip = 0;
  await run(t, ENV, x.f, async req => {
    for (const [lock, wait] of [['1분', 60_000], ['5분', 300_000], ['10분', 600_000], ['30분', 1_800_000], ['30분', 1_800_000]] as const) {
      for (let i = 0; i < 5; i++) assert.equal((await handler.fetch(req('bad', `9.9.9.${ip++}`))).status, 401); // 1~4번째 실패는 잠그지 않는다
      const r = await handler.fetch(req('pw', `9.9.9.${ip++}`));
      assert.equal(r.status, 429); assert.match(await err(r), new RegExp(lock));
      assert.equal((await handler.fetch(req('pw', `9.9.8.${ip}`, '202300002'))).status, 200); // 다른 학번은 그대로
      t.mock.timers.tick(wait);
    }
    assert.equal(sso(x), 25 + 5);
  });
});

test('샘물 함수: 같은 학번 동시 요청은 IP가 달라도 하나만 샘물로 나간다', async t => {
  const x = withLimit();
  t.mock.method(console, 'error', () => {});
  await run(t, ENV, x.f, async req => {
    x.set('idf:' + await h('id:202300001'), 4, 90_000);                                   // 다음 실패가 5번째(잠금)
    const rs = await Promise.all(['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5'].map(ip => handler.fetch(req('bad', ip))));
    assert.deepEqual(rs.map(r => r.status).sort(), [401, 429, 429, 429, 429]);
    assert.equal(sso(x), 1);
    assert.ok(![...x.store.keys()].some(k => k.startsWith('idl:')));                     // 잡은 자리를 모두 놓았다
  });
});

test('샘물 함수: 장애가 기준 미만이면 그대로, 의심이면 분당 요청·동시 요청을 줄인다', async t => {
  const x = withLimit();
  await run(t, ENV, x.f, async req => {
    x.set(`all:sys:${B()}`, 4);
    assert.equal((await handler.fetch(req('pw', '1.1.1.1'))).status, 200);
    assert.ok(!x.rpcs.some(r => r.includes('slot:')));                                   // 줄임 단계가 아니다
    x.set(`all:sys:${B()}`, 5); x.set(`all:ok:${B()}`, 15);
    assert.equal((await handler.fetch(req('pw', '2.2.2.2'))).status, 200);
    assert.ok(x.rpcs.some(r => r.includes('"slot:0"')) && !x.store.has('slot:0'));       // 동시 요청 자리를 잡고 놓았다
    x.set('slot:0', 1, 60); x.set('slot:1', 1, 60);
    let before = x.calls.length, r = await handler.fetch(req('pw', '3.3.3.3'));
    assert.equal(r.status, 503); assert.match(await err(r), /줄이고/);
    assert.equal(x.calls.length, before);
    x.store.delete('slot:0'); x.store.delete('slot:1'); x.set('all:rate', LIMIT.throttle.perMin, 60);
    before = x.calls.length; r = await handler.fetch(req('pw', '4.4.4.4'));
    assert.equal(r.status, 503); assert.match(await err(r), /줄이고/);
    assert.equal(x.calls.length, before);
    assert.ok(!x.store.has('brk:open'));                                                 // 멈추지는 않았다
  });
});

test('샘물 함수: 샘물 장애가 이어지면 줄임 단계를 거쳐 심각할 때만 모두 멈춘다', async t => {
  const x = withLimit(), log = t.mock.method(console, 'error', () => {});
  x.opt.down = () => new Response('err', { status: 500 });
  await run(t, ENV, x.f, async req => {
    const msgs: string[] = [];
    for (let i = 0; i < 25; i++) { const r = await handler.fetch(req('pw', `10.1.${i}.1`, String(202300200 + i))); assert.equal(r.status, 503); msgs.push(await err(r)); }
    assert.equal(sso(x), 20);                                                             // 20회·100%가 된 뒤(21번째부터) 샘물로 나가지 않는다
    assert.ok(msgs.slice(0, 20).every(m => /연결할 수 없습니다/.test(m)) && msgs.slice(20).every(m => /멈췄/.test(m)));
    assert.ok(x.store.has('brk:open'));
    assert.ok(x.rpcs.some(r => r.includes('"slot:0"')));                                  // 장애 5회 뒤부터는 줄임 단계였다
    assert.ok(log.mock.calls.some(c => c.arguments[0] === 'smul breaker open'));
  });
});

test('샘물 함수: 복구는 대기 뒤 비밀번호 없는 시험 요청과 한 번에 하나로 확인하고, 성공 2번이면 줄임 단계로 다시 연다', async t => {
  const x = withLimit();
  t.mock.method(console, 'error', () => {});
  await run(t, ENV, x.f, async req => {
    x.set(`all:sys:${B()}`, 20);
    assert.match(await err(await handler.fetch(req())), /멈췄/);                         // 열림(5분)
    t.mock.timers.tick(299_000);
    assert.equal((await handler.fetch(req())).status, 503);
    t.mock.timers.tick(2_000);
    x.set('slot:0', 1, 60);                                                               // 반쯤 열림: 시험 중이면 다른 요청은 기다린다
    assert.match(await err(await handler.fetch(req('pw', '2.2.2.2', '202300002'))), /멈췄/);
    x.store.delete('slot:0');
    const before = x.calls.length;
    assert.equal((await handler.fetch(req())).status, 200);
    const mine = x.calls.slice(before);
    assert.ok(isProbe(mine[0]) && mine[1].url.endsWith('/Login.do'));                     // 시험 요청(쿠키·비밀번호 없음)이 먼저
    assert.ok(x.store.has('brk:half'));                                                   // 한 번으로는 닫지 않는다
    assert.equal((await handler.fetch(req('pw', '3.3.3.3', '202300003'))).status, 200);
    assert.ok(!x.store.has('brk:half') && x.store.has('brk:ramp'));                       // 닫고 줄임 단계로 재개
    const n = x.rpcs.length;
    assert.equal((await handler.fetch(req('pw', '4.4.4.4', '202300004'))).status, 200);
    assert.ok(x.rpcs.slice(n).some(r => r.includes('"slot:0"')));                         // 줄임 단계는 동시 요청 자리를 쓴다
    assert.ok(!x.calls.slice(-9).some(isProbe));                                          // 닫힌 뒤에는 시험 요청을 하지 않는다
  });
});

test('샘물 함수: 시험 요청이 실패하면 학생 비밀번호를 보내지 않고 더 오래(10분) 기다린다', async t => {
  const x = withLimit();
  t.mock.method(console, 'error', () => {});
  await run(t, ENV, x.f, async req => {
    x.set(`all:sys:${B()}`, 20);
    await handler.fetch(req());                                                           // 첫 열림 5분
    t.mock.timers.tick(301_000);
    x.opt.down = () => new Response('err', { status: 500 });
    const before = sso(x), r = await handler.fetch(req());
    assert.equal(r.status, 503); assert.match(await err(r), /멈췄/);
    assert.equal(sso(x), before);                                                         // 로그인하지 않았다
    assert.ok(isProbe(x.calls.at(-1)!));
    assert.equal(x.store.get('brk:open')!.until - Date.now(), 600_000);                    // 1시간 안 두 번째 열림: 두 배
    t.mock.timers.tick(599_000);
    assert.equal((await handler.fetch(req())).status, 503);
    t.mock.timers.tick(2_000); x.opt.down = null;
    assert.equal((await handler.fetch(req())).status, 200);                               // 다시 시험 → 통과
  });
});

test('샘물 함수: 알 수 없는 응답은 따로 세고 분류를 로그에 남기며, 차단기·IP·학번 실패에 넣지 않는다', async t => {
  const x = withLimit(), log = t.mock.method(console, 'error', () => {});
  x.opt.down = () => new Response('?', { status: 404 });
  await run(t, ENV, x.f, async req => {
    for (let i = 0; i < 25; i++) assert.equal((await handler.fetch(req('pw', `10.2.${i}.1`, String(202300300 + i)))).status, 502);
    assert.equal(x.store.get(`all:unk:${B()}`)?.n, 25);
    assert.ok(!x.store.has(`all:sys:${B()}`) && !x.store.has('brk:open'));
    assert.ok(![...x.store.keys()].some(k => k.startsWith('idf:') || k.startsWith('idw:')));
    assert.ok(log.mock.calls.some(c => c.arguments[0] === 'smul fail' && c.arguments[1] === 'UNKNOWN_UPSTREAM_ERROR' && c.arguments[2] === 502));
    assert.ok(log.mock.calls.every(c => !/2023003|10\.2\./.test(JSON.stringify(c.arguments))));   // 로그에 학번·IP 없음
  });
});

test('샘물 함수: 같은 IP는 1분 10회까지, Vercel 밖에서는 x-forwarded-for를 믿지 않는다, 저장소 장애·Vercel 설정 누락이면 막는다', async t => {
  t.mock.method(console, 'error', () => {});
  const x = withLimit();
  await run(t, ENV, x.f, async req => {
    for (let i = 0; i < 10; i++) await handler.fetch(req('bad', '9.9.9.9', String(202300100 + i)));
    const before = x.calls.length, r = await handler.fetch(req('pw', '9.9.9.9'));
    assert.equal(r.status, 429); assert.match(await err(r), /1분/);
    assert.equal(x.calls.length, before);
  });
  const x2 = withLimit(), { VERCEL: _, ...local } = ENV, ipf = await h('ipf:1.2.3.4');
  await run(t, local, x2.f, async req => {
    assert.equal((await handler.fetch(req('bad'))).status, 401);
    assert.ok(!x2.store.has(await h('ip:1.2.3.4')) && ![...x2.store.keys()].some(k => k.startsWith(ipf)));
  });
  const x3 = withLimit(500);
  await run(t, ENV, x3.f, async req => { assert.equal((await handler.fetch(req())).status, 503); assert.equal(x3.calls.length, 0); });
  const x4 = withLimit();
  await run(t, { VERCEL: '1' }, x4.f, async req => { assert.equal((await handler.fetch(req())).status, 503); assert.equal(x4.calls.length, 0); });
});

test('샘물: 수강 중 목록의 전적대학 인정학점 행은 인정학점 조회(recg)와 겹치므로 recg가 있을 때 뺀다', async () => {
  const { f } = fakeSmul();
  const base = f as (u: string, i: RequestInit) => Promise<Response>;
  const g = (async (u: string, i: RequestInit) => u.endsWith('UcrTlsnAplyChk/list.do')
    ? Response.json({ dsUcrTlsnAply: [{ SBJ_NO: '', SBJ_KOR_NM: '전적대학 인정학점', CMP_DIV_NM: '1전선', CDT: 20 }, { SBJ_NO: 'HBJW0001', SBJ_KOR_NM: '이산수학', CMP_DIV_NM: '1전심', CDT: 3 }] })
    : base(u, i)) as typeof fetch;
  const { rows, recg } = await courses('202300001', 'pw', g);
  assert.equal(recg?.length, 2);
  assert.ok(!rows.some(r => r.includes('전적대학 인정학점')));
  assert.ok(rows.some(r => r.includes('이산수학')));
});
