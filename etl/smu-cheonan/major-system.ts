// 전공제도 데이터(ADR 0024)를 rules.json·sets.csv에 넣는다.
// 다시 돌려도 같은 결과가 나온다: 이 도구가 만든 세트(src에 MARK)는 지우고 다시 만들고, 이수구분·블록·정책은 같은 값으로 덮어쓴다.
// 사용: node etl/smu-cheonan/major-system.ts
import fs from 'node:fs';
import { parseCsv } from '../../engine/data.ts';

const DIR = new URL('../../data/smu-cheonan/', import.meta.url);
const MARK = '[ADR 0024]';
const rules = JSON.parse(fs.readFileSync(new URL('rules.json', DIR), 'utf8'));
const csv = fs.readFileSync(new URL('sets.csv', DIR), 'utf8');
const [head, ...lines] = csv.split('\n').filter(Boolean);
const keep = lines.filter(l => !l.includes(MARK));
const rows = parseCsv([head, ...keep].join('\n'));

// 1. 다전공·부전공 이수구분의 종류(학교 2026-2 이수구분 정정 안내의 코드). 종류로 학생이 고른 프로그램에 과목을 배정한다
const FAM: Record<string, string[]> = {
  'm2.dept': ['2학기', '2전선'],
  'm2.linked': ['연필', '연선', '2연필', '2연선'],
  'm2.fusion': ['융필', '융선', '2융필', '2융선'],
  'm2.minor': ['1부심', '1부선', '2부심', '2부선'],
};
for (const [tag, cats] of Object.entries(FAM)) for (const c of cats) rules.categories[c] = ['major2', tag];
rules.policy.assign = {
  tag: 'major2',
  by: {
    second: { tag: 'm2.dept', cat: '2전선' },
    minor: { tag: 'm2.minor', cat: '1부선' },
    linked: { tag: 'm2.linked', cat: '연선' },
    fusion: { tag: 'm2.fusion', cat: '융선' },
    ism: { tag: 'm2.dept', cat: '2전선' }, // 자기설계융합전공 과목의 성적표 이수구분은 확인 불가 → 다전공과 같게 둔다
  },
};

// 2. 자기설계융합전공: 학교 카탈로그가 없고 교육과정은 학생이 넣는다(Profile.own, id 'ism')
rules.programs.ism = { name: '자기설계융합전공', catalogs: [], kind: 'ism' };

// 3. 블록: 프로그램마다 배정된 과목 학점, 편입생 교양 영역, 한국어졸업인증, 마이크로전공 겹침 금지
const depts = Object.keys(rules.programs).filter(id => rules.programs[id].college);
for (const id of [...depts, 'ism']) rules.blocks[`m2.${id}`] = { id: 'm2', label: '전공 학점', credits: '$need', of: { tags: [`@${id}`] } };
rules.blocks['gearea.transfer'] = { id: 'gearea', label: '교양 필수 영역(편입생 기준 확인 필요)', check: 'transfer.gearea',
  hint: '편입생에게 이 기준이 같은지 학점플래너 데이터로는 알 수 없습니다. 샘물 학점이수상황표에서 확인하고, 충족했으면 켜 주세요.' };
for (const lv of [4, 3]) rules.blocks[`topik.${lv}`] = { id: 'topik', label: `한국어졸업인증(TOPIK ${lv}급 이상)`, check: 'topik', min: lv,
  hint: `외국인특별전형 입학생은 한국어능력시험(TOPIK) ${lv}급 이상 성적으로 한국어졸업인증을 받아야 졸업합니다.` };
rules.blocks['md.all'].disjoint = true;

// 4. 외국인특별전형 한국어졸업인증: 예·능계열 3급(예술대학·디자인대학·스포츠 학과, 사용자 결정 2026-11-08), 나머지 4급
const art = depts.filter(id => /예술대학|디자인대학/.test(rules.programs[id].college) || /^sport/.test(id));
rules.policy.extra = [
  { when: { student: 'international' }, use: 'topik.3', programs: art },
  { when: { student: 'international' }, use: 'topik.4', programs: depts.filter(id => !art.includes(id)) },
];

// 5. 세트
const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const line = (r: Record<string, string>) => [r.program, r.role, r.from, r.to, r.with, r.admission, r.student, r.blocks, r.vars, q(r.src)].join(',');
const setVars = (v: string, o: Record<string, number>) => {
  const m = new Map(v.split(';').filter(Boolean).map(kv => kv.split('=') as [string, string]));
  for (const [k, x] of Object.entries(o)) if (m.has(k)) m.set(k, String(x));
  return [...m].map(([k, x]) => `${k}=${x}`).join(';');
};
const out: string[] = [];
for (const r of rows.filter(r => r.role === 'primary' && r.with === 'single')) {
  const base = { ...r, with: 'exempt' };
  out.push(line({ ...base, vars: setVars(r.vars, { deep: 0, ext: 0 }),
    src: `${MARK} 심화전공 이수 제외 대상(학사안내 advancedDegree.do): 심화전공 숫자에서 전공심화만 0 · ${r.src}` }));
  out.push(line({ ...base, admission: 'transfer', blocks: r.blocks.replace(/gearea\.[a-z_]+/, 'gearea.transfer'), vars: setVars(r.vars, { major: 60, deep: 0, ext: 0 }),
    src: `${MARK} 편입생: 심화전공 이수 불가, 전공 60(2024학년도 편입생 오리엔테이션, 교무처 학사운영팀) · ${r.src}` }));
  out.push(line({ ...base, admission: 'bachelor', blocks: r.blocks.split('+').filter(b => !b.startsWith('gearea.')).join('+'),
    vars: setVars(r.vars, { total: 65, major: 60, deep: 0, ge: 0, ext: 0 }),
    src: `${MARK} 학사편입: 총 65 = 전공 60 + 5, 전적대 인정 없음(같은 자료)` }));
}
const yrs = ['2022', '2026'];
for (const id of depts) {
  out.push(line({ program: id, role: 'second', from: yrs[0], to: yrs[1], with: '', admission: '', student: '', blocks: `m2.${id}`, vars: 'need=36',
    src: `${MARK} 다전공(2,3전공) 전공 36(천안 2026학년도 입학자 졸업이수학점표, credits.do 763380) · 학번별 다전공 36은 V44 units.json req와 같음` }));
  out.push(line({ program: id, role: 'minor', from: yrs[0], to: yrs[1], with: '', admission: '', student: '', blocks: `m2.${id}`, vars: 'need=21',
    src: `${MARK} 부전공(2,3전공) 전공 21(같은 표)` }));
}
out.push(line({ program: 'ism', role: 'second', from: yrs[0], to: yrs[1], with: '', admission: '', student: '', blocks: 'm2.ism', vars: 'need=36',
  src: `${MARK} 자기설계융합전공을 다전공으로 이수 시 36(학사안내 multiMajor3.do)` }));

fs.writeFileSync(new URL('rules.json', DIR), JSON.stringify(rules, null, 1) + '\n');
fs.writeFileSync(new URL('sets.csv', DIR), [head, ...keep, ...out].join('\n') + '\n');
console.log(`세트 ${out.length}개, 학과 ${depts.length}개(예·능 ${art.length}개)`);
