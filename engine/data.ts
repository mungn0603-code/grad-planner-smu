// 대학 데이터 조립: rules.json(구조·블록·정책) + sets.csv(프로그램×연도 범위×변형×숫자) → Univ.
// 파일 읽기는 호출하는 쪽이 한다(브라우저·Node 공용).
import type { Univ, ReqSet, When, Rule } from './types.ts';

// RFC 4180 최소 구현: 따옴표 안 쉼표·줄바꿈·"" 처리
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else f += ch;
  }
  row.push(f); if (row.some(x => x !== '')) rows.push(row);
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// sets.csv 한 행: program,from,to,with,admission,student,blocks(a+b),vars(k=v;k=v),src
export function setsFromCsv(text: string): ReqSet[] {
  return parseCsv(text).map(r => {
    const when: When = {};
    if (r.role) when.role = r.role as When['role'];
    if (r.with) when.with = r.with as When['with'];
    if (r.admission) when.admission = r.admission as When['admission'];
    if (r.student) when.student = r.student as When['student'];
    const vars = Object.fromEntries((r.vars || '').split(';').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k.trim(), Number(v)]; }));
    const rule: Rule = { all: r.blocks.split('+').map(b => ({ use: b.trim(), vars })) };
    return { program: r.program, years: [Number(r.from), Number(r.to)], ...(Object.keys(when).length ? { when } : {}), rule, src: r.src };
  });
}

export function assemble(rules: Omit<Univ, 'sets'> & { sets?: ReqSet[] }, setsCsv: string): Univ {
  return { ...rules, sets: [...(rules.sets || []), ...setsFromCsv(setsCsv)] };
}

// 과목명 비교 키: 공백·로마숫자 정리 → 대학/카탈로그별 꼬리표 제거 → 소문자
export function nameKey(n: string, strip: RegExp[]): string {
  let s = String(n || '').replace(/\s/g, '').replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II');
  for (const re of strip) s = s.replace(re, '');
  return s.toLowerCase();
}
