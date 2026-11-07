// Node 전용: data/<univ>/ 폴더를 읽어 엔진 컨텍스트로. (브라우저는 같은 파일을 fetch해서 assemble에 넘긴다)
import fs from 'node:fs';
import path from 'node:path';
import { assemble } from './data.ts';
import type { Ctx } from './audit.ts';
import type { Catalog } from './types.ts';

export function loadUniv(dir: string): Ctx {
  const rules = JSON.parse(fs.readFileSync(path.join(dir, 'rules.json'), 'utf8'));
  const univ = assemble(rules, fs.readFileSync(path.join(dir, 'sets.csv'), 'utf8'));
  const catalogs: Record<string, Catalog> = {};
  for (const f of fs.readdirSync(path.join(dir, 'gen')).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'gen', f), 'utf8'));
    if (c.editions) catalogs[c.id] = c;
  }
  return { univ, catalogs };
}
export const ROOT = path.resolve(import.meta.dirname, '..');
