/**
 * Assemble workflow-generated browser-strategy modules.
 * Usage: node _gen/browser-assemble.mjs <workflow-output.json>
 *
 * Writes each module to browser/<filename> and rewrites the @generated markers in
 * browser/strategies.ts to import + spread every generated BrowserStrategy[] array.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROWSER_DIR = join(__dirname, '..', 'browser');

const inPath = process.argv[2];
if (!inPath) { console.error('usage: node _gen/browser-assemble.mjs <output.json>'); process.exit(1); }
const parsed = JSON.parse(readFileSync(inPath, 'utf8'));
const modules = parsed.result?.modules ?? parsed.modules ?? [];
if (!modules.length) { console.error('no modules in', inPath); process.exit(1); }

const imports = [];
const spreads = [];
for (const m of modules) {
  if (!m?.code || !m?.filename || !m?.exportName) { console.warn('skip malformed', m?.filename); continue; }
  const base = m.filename.replace(/^.*\//, '').replace(/\.ts$/, '');
  writeFileSync(join(BROWSER_DIR, `${base}.ts`), m.code.endsWith('\n') ? m.code : m.code + '\n');
  imports.push(`import { ${m.exportName} } from './${base}.js';`);
  spreads.push(`  ...${m.exportName},`);
  console.log(`wrote browser/${base}.ts (${m.strategies?.length ?? '?'} strategies, ${m.skipped?.length ?? 0} skipped) export ${m.exportName}`);
}

const stratPath = join(BROWSER_DIR, 'strategies.ts');
let src = readFileSync(stratPath, 'utf8');
src = src.replace('// @generated-browser-imports', imports.join('\n'));
src = src.replace('  // @generated-browser-spreads', spreads.join('\n'));
writeFileSync(stratPath, src);
console.log(`rewrote browser/strategies.ts with ${spreads.length} generated modules`);
