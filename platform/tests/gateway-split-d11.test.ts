// D11a task 6: gateway.ts is split by provider route and concern. Rule: no gateway file over 400 lines, and gateway.ts
// still exports every name it exported before, so no importer changes. Every gateway* test is the behaviour proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').length - (readFileSync(file, 'utf8').endsWith('\n') ? 1 : 0);

function gatewayFiles(): string[] {
  const files = [join(runtime, 'gateway.ts')];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts')) files.push(path);
    }
  };
  try { walk(join(runtime, 'gateway')); } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
  return files;
}

test('no gateway file is over 400 lines', () => {
  const over = gatewayFiles().map(file => [file.slice(runtime.length).replace(/\\/g, '/'), lines(file)] as const).filter(([, count]) => count > 400);
  assert.deepEqual(over, []);
});

test('the gateway is split: gateway.ts routes, and each provider route has its own module', () => {
  const names = gatewayFiles().map(file => file.slice(runtime.length).replace(/\\/g, '/')).sort();
  for (const wanted of ['gateway/providers/cli.ts', 'gateway/providers/http.ts', 'gateway/providers/ollama.ts', 'gateway/providers/openai.ts']) assert.ok(names.includes(wanted), wanted);
});

test('gateway.ts still exports every value it exported before the split', async () => {
  const gateway = await import('../runtime/gateway.ts');
  assert.deepEqual(Object.keys(gateway).sort(), ['DEFAULT_OPERATIONS', 'ModelGateway', 'businessSelectionSchema', 'cliArguments', 'defaultProcess', 'operationCatalog', 'planSchema', 'validateEndpoint', 'validatePlan']);
});
