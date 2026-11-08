// 수강 기록 가져오기: 샘물 응답 표(api/smul.ts toRows) → 행 → Enrollment.
// 머리글 이름으로 열을 찾는다.
// 여러 표(학기별 성적·시간표)는 표마다 머리글을 다시 읽고, 표 앞의 '## <제목>' 줄에서 학기를 읽는다.
import type { Enrollment } from '../engine/types.ts';
import { termOrd } from '../engine/audit.ts';

const COLS: [keyof Cols, RegExp][] = [
  ['code', /학수번호|과목코드|교과목번호|과목번호|교과코드/], ['name', /교과목명|과목명|교과목$/], ['credits', /^학점$|이수학점|^학점\(|학점수/],
  ['category', /이수구분|과목구분|^구분$/], ['cultArea', /^교양영역$/], ['area', /영역/], ['grade', /등급|^성적$|성적등급|평가/], ['year', /년도|연도/], ['sem', /^학기$|학기구분/], ['term', /수강학기|년도\/?학기|연도\/?학기/],
  // cultArea(교양영역): 샘물 이수 당시 값. 판정은 Univ.cultAreas로 영역을 정한다(area는 직접 고친 값)
];
interface Cols { code?: number; name?: number; credits?: number; category?: number; cultArea?: number; area?: number; grade?: number; year?: number; sem?: number; term?: number }
const isHeader = (r: string[]) => r.some(c => COLS[0][1].test(c.replace(/\s/g, '')) || COLS[1][1].test(c.replace(/\s/g, '')));

// '2024' + '1학기' / '2024-1' / '2024년 2학기' / '2024 하계' → '2024-1' '2024-2' '2024-S' '2024-W'
export function parseTerm(s: string): string | undefined {
  const m = s.match(/(20\d\d)\D*?(1|2|여름|하계|겨울|동계)/); if (!m) return;
  return `${m[1]}-${({ '1': '1', '2': '2', 여름: 'S', 하계: 'S', 겨울: 'W', 동계: 'W' } as Record<string, string>)[m[2]]}`;
}

export function rowsToEnrollments(rows: string[][]): { es: Enrollment[]; skipped: number; header: boolean } {
  const es: Enrollment[] = [];
  let col: Cols | null = null, skipped = 0, header = false;
  let ctx: string | undefined, year = '';             // 표 제목의 학기, 학년도가 위 행에만 있는 표(병합 셀) 대비
  for (const r of rows) {
    if (r.length === 1 && /^##(\s|$)/.test(r[0])) { ctx = parseTerm(r[0]); col = null; continue; } // 북마클릿이 표마다 넣는 제목 줄
    if (isHeader(r)) {
      col = {}; year = ''; header = true;
      r.forEach((c, i) => { const k = COLS.find(([key, re]) => col![key] == null && re.test(c.replace(/\s/g, ''))); if (k) col![k[0]] = i; });
      continue;
    }
    if (!col) { const t = r.filter(Boolean).length <= 2 ? parseTerm(r.join(' ')) : undefined; if (t) ctx = t; continue; } // 머리글 앞 '2024학년도 1학기' 같은 줄
    const at = (k: keyof Cols) => (col![k] == null ? '' : (r[col![k]!] ?? '').trim());
    const code = at('code').replace(/\s/g, '').toUpperCase(), name = at('name'), cr = parseFloat(at('credits'));
    if (at('year')) year = at('year');
    if (!code && !name) { skipped++; continue; }
    if (/^(합계|소계|계|총계)$/.test(name)) { skipped++; continue; }
    const term = parseTerm(at('term')) ?? parseTerm(`${year} ${at('sem')}`) ?? ctx;
    es.push({ ...(code ? { code } : {}), ...(name ? { name } : {}), ...(Number.isFinite(cr) ? { credits: cr } : {}),
      ...(at('category') ? { category: at('category') } : {}), ...(at('area') ? { area: at('area') } : {}), ...(at('cultArea') ? { cultArea: at('cultArea') } : {}), ...(at('grade') ? { grade: at('grade') } : {}), ...(term ? { term } : {}) });
  }
  return { es, skipped, header };
}

// 입학 학기부터 현재 학기 전까지 정규학기 중 수강 기록이 하나도 없는 학기 = 휴학으로 본다(군휴학 포함)
// ponytail: 기록 없는 학기를 휴학으로 추정. 학적 변동(휴·복학) 기록을 샘물에서 받게 되면 그 값으로 바꾼다
export function guessLeaves(es: Enrollment[], year: number, now: string): string[] {
  if (!year || !now) return [];
  const has = new Set(es.map(e => e.term)), out: string[] = [];
  for (let y = year; y <= +now.slice(0, 4); y++) for (const t of [`${y}-1`, `${y}-2`]) if (termOrd(t) < termOrd(now) && !has.has(t)) out.push(t);
  return out;
}
