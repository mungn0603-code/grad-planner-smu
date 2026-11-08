// 샘물 조회와 응답 변환: 이수과목 목록(UsrRecMatt/list.do) → 학생 정보(학적) → 이번 학기 수강 과목 → SM-CDR 이수현황 → 학점이수상황표 → 전적대학 인정학점.
// 응답에서 학점 계산에 쓰는 열만 남긴다(docs/decisions/0009). 응답 형식은 화면(src/paste.ts 등)이 읽는 그대로 둔다.
import { SMUL, T, UA, MSG, up, byStatus, header, session, wrap, type Jar } from './login.ts';

type Row = Record<string, unknown>;
const KEY = 'usrCPsnlInfoUpd-STD'; // 개인정보수정 메뉴 키. 이수과목·학생 정보 요청에도 이 키로 응답한다(사용자 시험으로 확인)
const byStdNo = (id: string) => `@d#=@d1#&@d1#tp=dm&_AUTH_MENU_KEY=${KEY}&@d1#strStdNo=${id}`; // id는 숫자 9자리로 검사한 값
// eXbuilder DataMap 본문(§6-3, cleopatra.js URLEncodedRequestBuilder와 같은 모양): DataMap마다 n = 1, 2…로 @dn#<필드>…, @d#=@dn#, @dn#=<DataMap id>, @dn#tp=dm
function dm(maps: Record<string, Record<string, unknown>>) {
  const b = new URLSearchParams();
  Object.entries(maps).forEach(([map, p], i) => {
    const d = `@d${i + 1}#`;
    for (const k in p) b.append(d + k, p[k] == null ? '' : String(p[k]));
    b.append('@d#', d); b.append(d, map); b.append(d + 'tp', 'dm');
  });
  b.append('_AUTH_MENU_KEY', KEY);
  return b.toString();
}

async function post(f: typeof fetch, jar: Jar, path: string, body: string): Promise<Record<string, any>> {
  const r = await f(SMUL + path, { method: 'POST', signal: AbortSignal.timeout(T),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA, cookie: header(jar) }, body });
  if (!r.ok) throw up(byStatus(r.status), MSG.fetch);
  const j = await r.json().catch(() => null);
  // 샘물 업무 오류(HTTP 200 + ERRMSGINFO, 예: 메뉴 권한)는 원인이 여러 가지라 UNKNOWN. 샘물은 줄바꿈을 글자 그대로 \n으로 보낸다
  if (j?.ERRMSGINFO) throw up('UNKNOWN_UPSTREAM_ERROR', String(j.ERRMSGINFO.ERRMSG).replace(/\\n|\n/g, ' '));
  if (!j) throw up('UNKNOWN_UPSTREAM_ERROR', MSG.fetch);
  return j;
}

// 성적이 확정된 과목(교과목이수확인 화면 usrSRecMatt). 이번 학기 수강 과목은 여기에 없다
async function records(f: typeof fetch, id: string, jar: Jar): Promise<Row[]> {
  const j = await post(f, jar, 'UsrRecMatt/list.do', byStdNo(id));
  if (!Array.isArray(j.dsRecMattList)) throw up('UNKNOWN_UPSTREAM_ERROR', MSG.fetch);
  return j.dsRecMattList;
}

// 학생 정보(dsStdInfoList). 이메일·연락처 등이 함께 오므로 아래 student()·current()가 쓰는 열만 읽는다
const stdInfo = async (f: typeof fetch, id: string, jar: Jar): Promise<Row> => (await post(f, jar, 'UsrSchMng/selectStdInfo.do', byStdNo(id))).dsStdInfoList?.[0] ?? {};
// 화면에 보일 이름·학과·입학구분·다전공만(학생정보 화면 usrEStudInfo 공개 화면 정의에서 열과 라벨 확인, 2026-10-27). 학과 값은 '대학 학과' 꼴이라 마지막 낱말을 쓴다.
// 다전공 열 값이 이름인지 코드인지는 실제 다전공 학생 응답으로 확인 불가라 그대로 보낸다. 국적은 내보내지 않고 유학생 여부만 보낸다
const lastWord = (v: unknown) => String(v ?? '').trim().split(/\s+/).pop() ?? '';
const MAJORS: [string, string][] = [['2전공', 'MJR_CD2'], ['3전공', 'MJR_CD3'], ['4전공', 'MJR_CD4'], ['부전공', 'MJR_CD_B1'], ['부전공', 'MJR_CD_B2'],
  ['연계전공', 'CONN_MJR_CD_1'], ['연계전공', 'CONN_MJR_CD_2'], ['융합전공', 'FUSE_MJR_1'], ['융합전공', 'FUSE_MJR_2'], ['마이크로전공', 'MICRO_MJR_1'], ['마이크로전공', 'MICRO_MJR_2'], ['마이크로전공', 'MICRO_MJR_3']];
export const student = (x: Row) => {
  const nat = String(x.NAT_RCD_NM ?? '').trim();
  return { name: String(x.NM_KOR ?? ''), dept: lastWord(x.TMP_DEPT_MJR_NM), entr: String(x.ENTR_RCD_NM ?? '').trim(),
    majors: MAJORS.map(([kind, k]) => ({ kind, name: String(x[k] ?? '').trim() })).filter(m => m.name),
    ...(nat ? { intl: !/대한민국|한국|korea/i.test(nat) } : {}) }; // ponytail: 국적 이름 꼴 확인 불가. 한국 표기가 다르면 여기만 고친다
};

// 전적대학 인정학점(전체성적조회 화면 ugdSAllRecSch의 dsRcrdUnivRecgRecList, 공개 화면 정의로 확인). 편입생만 행이 있다. 이수구분별 학점만
export async function recg(f: typeof fetch, id: string, jar: Jar, info: Row): Promise<{ cat: string; cdt: number }[]> {
  const j = await post(f, jar, 'UgdAllRecSch/list.do', dm({ dmParam: { strStdNo: id, strStdNm: '', strOrgClsRcd: info.ORG_CLS_RCD } }));
  return (Array.isArray(j.dsRcrdUnivRecgRecList) ? j.dsRcrdUnivRecgRecList as Row[] : [])
    .map(x => ({ cat: String(x.CMP_DIV_NM ?? '').trim(), cdt: toNum(x.CDT) })).filter(x => Number.isFinite(x.cdt) && x.cdt > 0);
}

// 이번 학기 수강 과목(수강신청현황표 화면 ucrSTlsnAplyChk, §6-3). 화면처럼 기본 학년도·학기를 받고, 캠퍼스·조직 코드는 학생 정보에서 읽는다
async function current(f: typeof fetch, id: string, jar: Jar, info: Row): Promise<{ term: string; xs: Row[] }> {
  const ol = await post(f, jar, 'UcrTlsnAplyChk/onLoad.do', dm({})), m = ol._METADATA_ ?? {};
  const name = (ol.dsSmtRcd ?? []).find((c: Row) => c.CD === m.strDefSmtRcd)?.CD_NM ?? '';
  const t = await post(f, jar, 'UcrTlsnAplyChk/list.do', dm({ dmParam: { strSchYear: m.strDefSchYear, strSmtRcd: m.strDefSmtRcd, strSesRcd: 'CMN111.0000', strStdNo: id, strCampusRcd: info.CAMPUS_RCD, strOrgClsRcd: info.ORG_CLS_RCD } }));
  return { term: `${m.strDefSchYear} ${name}`, xs: t.dsUcrTlsnAply ?? [] };
}

// SM-CDR 이수현황(SM-CDR이수조회 화면 ucdSCdrCmpSch, 공개 화면 정의 /ui/app/ucd/ucdSCdrCmpSch.clx.js에서 요청·열 이름 확인).
// 신청한 트랙 이름(dsCdrAplyPcnd.CDR_NM)과 이수한 비교과 프로그램 이름(dsNoSbjCmpPcnd에서 CMP_YN='Y'인 PGM_NM, 화면도 이 값으로 개수를 센다)만 내보낸다
export async function cdr(f: typeof fetch, id: string, jar: Jar): Promise<{ tracks: string[]; done: string[] }> {
  const j = await post(f, jar, 'UcdCdrCmpSch/list.do', dm({ dmParam: { strStdNo: id, strEntrSchYear: '' }, dmPgmDiv: { strPgmDiv: 'ucdSCdrCmpSch' } }));
  if (!Array.isArray(j.dsCdrAplyPcnd) && !Array.isArray(j.dsNoSbjCmpPcnd)) throw up('UNKNOWN_UPSTREAM_ERROR', MSG.fetch);
  const names = (xs: unknown, ok: (x: Row) => boolean, k: string) => [...new Set((Array.isArray(xs) ? xs as Row[] : []).filter(ok).map(x => String(x[k] ?? '').trim()).filter(Boolean))];
  return { tracks: names(j.dsCdrAplyPcnd, () => true, 'CDR_NM'), done: names(j.dsNoSbjCmpPcnd, x => x.CMP_YN === 'Y', 'PGM_NM') };
}

// 학점이수상황표(ugdSCdtTable, 공개 화면 정의 /ui/app/ugd/ugdSCdtTable.clx.js에서 요청·열 이름 확인, 실제 응답 구조는 2026-10-27 배포 로그로 확인).
// cmp: 이수구분별 취득학점(dsCmpDivRecList). base: 학생별 졸업 기준학점(dsGrdtBaseInfo)의 숫자 열(*_CDT·GP_AVG)만, 학과명 등은 버린다.
// retake: 이번 학기 수강 과목(dsCurStdTlsnList) 중 GET_* 값이 있는 행(재수강으로 대체될 예전 기록으로 추정, 의미 확인 전이라 판정에 쓰지 않음)
export type Ugd = { cmp: Record<string, number>; base?: Record<string, number>; retake: { code: string; year: string; sem: string; prev: string }[]; areas: string[] };
const toNum = (v: unknown) => parseFloat(String(v ?? ''));
export async function ugd(f: typeof fetch, id: string, jar: Jar, info: Row): Promise<Ugd> {
  const j = await post(f, jar, 'UgdCdtTable/list.do', dm({ dmParam: { strStdNo: id, strStdNm: '', strCampusRcd: info.CAMPUS_RCD } }));
  if (!Array.isArray(j.dsCmpDivRecList)) throw up('UNKNOWN_UPSTREAM_ERROR', MSG.fetch);
  const cmp: Record<string, number> = {};
  for (const x of j.dsCmpDivRecList as Row[]) { const k = String(x.CMP_DIV_NM ?? '').trim(), n = toNum(x.GET_CDT); if (k && Number.isFinite(n)) cmp[k] = (cmp[k] ?? 0) + n; }
  const b0 = (j.dsGrdtBaseInfo as Row[] | undefined)?.[0];
  const base = b0 && Object.fromEntries(Object.entries(b0).filter(([k, v]) => /_CDT$|^GP_AVG$/.test(k) && Number.isFinite(toNum(v))).map(([k, v]) => [k, toNum(v)]));
  const cur = Array.isArray(j.dsCurStdTlsnList) ? j.dsCurStdTlsnList as Row[] : [];
  const retake = cur.filter(x => x.GET_SBJ_NO).map(x => ({ code: String(x.SBJ_NO ?? ''), year: String(x.GET_SCH_YEAR ?? ''), sem: String(x.GET_SMT_NM ?? ''), prev: String(x.GET_SBJ_NO) }));
  const areas = [...(Array.isArray(j.dsGyopilGetCdtList) ? j.dsGyopilGetCdtList as Row[] : []).map(x => `${x.CULT_ARA_NM ?? ''}/${x.CULT_FULL_NM ?? ''}`), ...cur.map(x => String(x.CULT_ARA_NM ?? ''))];
  return { cmp, ...(base && Object.keys(base).length ? { base } : {}), retake, areas };
}

// 학점 계산에 쓰는 열만 내보낸다(src/paste.ts rowsToEnrollments가 머리글로 읽는다). 수강 중 과목은 '## <학기> 수강 중' 제목 줄 아래 따로 붙인다.
// 교양영역(CULT_ARA_NM)은 '교양영역' 열로 보낸다(이수 당시 학교 값). 판정은 rules.json cultAreas로 영역(균형·인문 등)을 정하고 카탈로그 영역보다 우선한다
const pick = (x: Row, ks: string[]) => ks.map(k => (x[k] == null ? '' : String(x[k])));
// 이수·수강 목록에 '전적대학 인정학점' 행이 따로 섞여 오면(편입생) 인정학점 조회(recg)와 이중으로 잡힌다. recg를 받았을 때만 이 행을 뺀다
export const isRecgRow = (x: Row) => /^전적대학\s*인정/.test(String(x.SBJ_NM ?? x.SBJ_KOR_NM ?? '').trim());
export function toRows(recs: Row[], cur?: { term: string; xs: Row[] } | null): string[][] {
  const rows = [['년도', '학기', '학수번호', '교과목명', '이수구분', '학점', '성적', '교양영역'], ...recs.map(x => pick(x, ['SCH_YEAR', 'SMT_NM', 'SBJ_NO', 'SBJ_NM', 'CMP_DIV_NM', 'CDT', 'GRD_NM', 'CULT_ARA_NM']))];
  const seen = new Set(recs.map(x => `${x.SCH_YEAR} ${x.SMT_NM} ${x.SBJ_NO}`)); // 성적이 이미 나온 과목은 빼고
  const xs = (cur?.xs ?? []).filter(x => !seen.has(`${cur!.term} ${x.SBJ_NO}`));
  if (xs.length) rows.push([`## ${cur!.term} 수강 중`], ['학수번호', '교과목명', '이수구분', '학점'], ...xs.map(x => pick(x, ['SBJ_NO', 'SBJ_KOR_NM', 'CMP_DIV_NM', 'CDT'])));
  return rows;
}

export async function courses(id: string, pw: string, f: typeof fetch = fetch): Promise<{ rows: string[][]; student: ReturnType<typeof student>; cdr?: Awaited<ReturnType<typeof cdr>>; cmp?: Record<string, number>; base?: Record<string, number>; retake?: Ugd['retake']; recg?: Awaited<ReturnType<typeof recg>> }> {
  const jar = await session(f, id, pw).catch(wrap('login'));
  const recs = await records(f, id, jar).catch(wrap('fetch'));
  // 학생 정보·수강 중 과목은 못 가져와도 이수과목은 보낸다
  const info = await stdInfo(f, id, jar).catch(e => { console.error('smul info', (e as Error).name, (e as Error).message); return {} as Row; });
  const cur = await current(f, id, jar, info).catch(e => { console.error('smul current', (e as Error).name, (e as Error).message); return null; });
  const cd = await cdr(f, id, jar).catch(e => { console.error('smul cdr', (e as Error).name, (e as Error).message); return null; });
  const ug = await ugd(f, id, jar, info).catch(e => { console.error('smul cmp', (e as Error).name, (e as Error).message); return null; });
  const rc = await recg(f, id, jar, info).catch(e => { console.error('smul recg', (e as Error).name, (e as Error).message); return null; });
  const st = student(info);
  console.info('smul ok', `records=${recs.length}`, `noGrade=${recs.filter(x => !x.GRD_NM).length}`, `current=${cur ? cur.xs.length : 'error'}`, `cdr=${cd ? `${cd.tracks.length}/${cd.done.length}` : 'error'}`,
    `cmp=${ug ? Object.keys(ug.cmp).length : 'error'}`, `base=${ug?.base ? Object.keys(ug.base).length : 0}`, `retake=${ug?.retake.length ?? 0}`, `recg=${rc ? rc.length : 'error'}`,
    `entr=${st.entr || '-'}`, `majors=${st.majors.map(m => m.kind).join('+') || '-'}`); // 개수와 학적 구분 이름만 남긴다(학과·전공 이름은 남기지 않음)
  // 영역 대응표를 만들기 위한 교양영역 이름 종류(과목 분류 이름이라 개인정보가 아니다). 이수 기록·교필 영역별·수강 중 과목에서 모은다
  console.info('smul areas', JSON.stringify([...new Set([...recs.map(x => String(x.CULT_ARA_NM ?? '')), ...(ug?.areas ?? [])])].filter(a => a && a !== '/').sort()));
  const dup = rc?.length ? (x: Row) => !isRecgRow(x) : () => true;
  return { rows: toRows(recs.filter(dup), cur && { ...cur, xs: cur.xs.filter(dup) }), student: st, ...(cd ? { cdr: cd } : {}), ...(ug ? { cmp: ug.cmp, retake: ug.retake, ...(ug.base ? { base: ug.base } : {}) } : {}), ...(rc ? { recg: rc } : {}) };
}
