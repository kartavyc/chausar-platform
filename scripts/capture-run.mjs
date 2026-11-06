#!/usr/bin/env node
// A safe first executable capture. Only this newly created sample business is used.
// Account-backed samples are separate live qualifications and are never run by tests.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { Engine } from '../platform/runtime/engine.ts';
import { refuseInsideRepo } from '../platform/runtime/run-root.mjs';
const args = process.argv.slice(2);
if (![3, 5].includes(args.length) || args[0] !== '--sample-business' || args[1] !== '--output' || !args[2] || (args.length === 5 && (args[3] !== '--codex' || !isAbsolute(args[4]) || /\.(cmd|bat|ps1)$/i.test(args[4])))) {
  process.stderr.write('Usage: node scripts/capture-run.mjs --sample-business --output <outside-checkout-folder> [--codex <native-program>]\n'); process.exit(2);
}
const output = refuseInsideRepo(args[2], { variable: '--output' });
const directory = await mkdtemp(join(tmpdir(), 'chausar-capture-sample-'));
const offline = async () => { throw new Error('This sample makes no model calls.'); };
const native = args[4] ? await import('./capture-native-sample.ts') : null;
const engine = new Engine({ directory, demo: true, storage: 'experimental-file', capture: { dir: output }, venture: { host: 'test', ...(native ? { agentRoute: native.sampleCodexRoute(args[4]) } : {}), modelTransport: { replay: true, http: offline, process: offline } } });
try {
  await engine.request('workspace.create', { name: 'Sample studio', passphrase: 'sample-capture-passphrase', demo: true });
  let operation;
  if (native) operation = { method: 'venture.delivery.run', payload: { orderId: await native.prepareNativeSample(engine) } };
  else {
    await engine.request('venture.create', { idea: 'A weekend photography studio in Pune for birthday parties and shop product photos.', countryCode: 'IN', workingName: 'Sample studio' });
    operation = { method: 'venture.client.add', payload: { name: 'Sample client', countryCode: 'IN' } };
  }
  const { path } = await engine.captureRequest(operation.method, operation.payload, 'sample business');
  process.stdout.write(`${path}\n`);
} finally { await engine.close(); await rm(directory, { recursive: true, force: true }); }
