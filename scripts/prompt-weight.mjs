// D2 task 14: what each AI task carries, measured with fixture A of platform/tests/prompt-weight/tasks.ts: the fixed
// instructions, the changing input and the answer schema, in characters, and the share that is fixed (the part a
// provider's prompt cache can reuse). Prints a table and writes a receipt (default: the run root's
// prompt-weight/prompt-weight.json, never inside the checkout; D3).
// `--write-baseline` writes the numbers as platform/tests/baselines/prompt-weight.json, the budget that only shrinks
// (a raise goes to the founder in the pull request, with its reason).
//
// Usage (from the repo root): node scripts/prompt-weight.mjs [--output <file.json>] [--write-baseline]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputFile } from '../platform/runtime/run-root.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let output; let baseline = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--write-baseline') baseline = true;
  else if (args[index] === '--output' && args[index + 1]) output = args[++index];
  else if (args[index].startsWith('--output=')) output = args[index].slice('--output='.length);
  else throw new Error('Usage: node scripts/prompt-weight.mjs [--output <file.json>] [--write-baseline]');
}

export async function measure() {
  const { FIXTURES, REGISTRY } = await import('../platform/tests/prompt-weight/tasks.ts');
  return REGISTRY.map(builder => {
    const built = builder.build(FIXTURES.A);
    const instructionChars = built.instructions.length;
    const inputChars = built.input === undefined ? null : JSON.stringify(built.input).length;
    const schemaChars = built.schema === undefined ? null : JSON.stringify(built.schema).length;
    const tools = built.input && typeof built.input === 'object' && !Array.isArray(built.input) ? built.input.tools : undefined;
    const total = instructionChars + (inputChars ?? 0) + (schemaChars ?? 0);
    return { name: builder.name, purpose: builder.purpose, site: builder.site, instructionChars, inputChars, schemaChars,
      ...(builder.name === 'agent-turn' && tools !== undefined ? { toolManifestChars: JSON.stringify(tools).length } : {}),
      fixedSharePercent: inputChars === null ? null : Math.round((instructionChars + (schemaChars ?? 0)) * 100 / total) };
  });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const rows = await measure();
  const pad = (value, width) => String(value ?? '-').padStart(width);
  console.log(`${'builder'.padEnd(22)}${pad('instructions', 13)}${pad('input', 8)}${pad('schema', 8)}${pad('fixed %', 9)}`);
  for (const row of rows) console.log(`${row.name.padEnd(22)}${pad(row.instructionChars, 13)}${pad(row.inputChars, 8)}${pad(row.schemaChars, 8)}${pad(row.fixedSharePercent, 9)}`);
  const destination = outputFile(output, { name: 'prompt-weight', file: 'prompt-weight.json' });
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify({ schema: 'chausar.prompt-weight.v1', at: new Date().toISOString(), fixture: 'A', rows }, null, 2)}\n`, 'utf8');
  if (baseline) {
    const budget = Object.fromEntries(rows.map(row => [row.name, { instructionChars: row.instructionChars, inputChars: row.inputChars, schemaChars: row.schemaChars,
      ...(row.toolManifestChars !== undefined ? { toolManifestChars: row.toolManifestChars } : {}) }]));
    await writeFile(resolve(root, 'platform/tests/baselines/prompt-weight.json'), `${JSON.stringify(budget, null, 2)}\n`, 'utf8');
  }
}
