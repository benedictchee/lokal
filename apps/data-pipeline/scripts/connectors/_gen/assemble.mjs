/**
 * Assemble workflow-generated connector modules into the tree.
 *
 * Usage: node _gen/assemble.mjs <path-to-workflow-output.json>
 * The JSON is the task output ({ result: { modules: [...] } } or { modules: [...] }).
 *
 * - Writes each module's code to tier<TIER>/<filename>.
 * - Rebuilds tierB/C/D/E index.ts to import + spread the generated arrays
 *   (Tier A index is hand-written and left untouched; atlas-obscura is preserved in Tier E).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // scripts/connectors

const inPath = process.argv[2];
if (!inPath) {
  console.error('usage: node _gen/assemble.mjs <workflow-output.json>');
  process.exit(1);
}
const parsed = JSON.parse(readFileSync(inPath, 'utf8'));
const modules = parsed.result?.modules ?? parsed.modules ?? [];
if (!modules.length) {
  console.error('no modules found in', inPath);
  process.exit(1);
}

// Hand-written extras to preserve per tier.
const HANDWRITTEN = {
  E: [{ exportName: 'tierEConnectors_atlas', filename: 'atlas-obscura.ts', importName: 'atlasObscura', spread: false }],
};

const byTier = {};
for (const m of modules) {
  if (!m?.code || !m?.filename || !m?.tier || !m?.exportName) {
    console.warn('skipping malformed module', m?.filename);
    continue;
  }
  // Agents sometimes return filename with a tier/ prefix — normalise to a bare basename.
  const base = m.filename.replace(/^tier[A-E]\//i, '').replace(/\.ts$/, '');
  m._base = base;
  const file = join(ROOT, `tier${m.tier}`, `${base}.ts`);
  writeFileSync(file, m.code.endsWith('\n') ? m.code : m.code + '\n');
  (byTier[m.tier] ??= []).push(m);
  console.log(`wrote tier${m.tier}/${base}.ts (${m.connectors?.length ?? '?'} connectors, export ${m.exportName})`);
}

// Rebuild indexes for B/C/D/E.
for (const tier of ['B', 'C', 'D', 'E']) {
  const mods = byTier[tier] ?? [];
  const importLines = [];
  const spreadParts = [];

  if (tier === 'E') {
    importLines.push(`import { atlasObscura } from './atlas-obscura.js';`);
    spreadParts.push('atlasObscura');
  }
  for (const m of mods) {
    importLines.push(`import { ${m.exportName} } from './${m._base}.js';`);
    spreadParts.push(`...${m.exportName}`);
  }
  if (!mods.length && tier !== 'E') {
    // leave the empty stub
    continue;
  }
  const idx = `import type { SourceConnector } from '../core/types.js';
${importLines.join('\n')}

export const tier${tier}Connectors: SourceConnector[] = [
  ${spreadParts.join(',\n  ')},
];
`;
  writeFileSync(join(ROOT, `tier${tier}`, 'index.ts'), idx);
  console.log(`rebuilt tier${tier}/index.ts (${spreadParts.length} sources)`);
}
console.log('done.');
