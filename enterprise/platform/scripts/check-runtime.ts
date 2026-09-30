import { bundleWorkflowCode } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const bundle = await bundleWorkflowCode({
  workflowsPath: fileURLToPath(new URL('../src/workflows.ts', import.meta.url)),
});
console.log(JSON.stringify({
  checked: 'actual Temporal workflow bundling',
  sdk: '1.13.2',
  bytes: Buffer.byteLength(bundle.code),
  sha256: createHash('sha256').update(bundle.code).digest('hex'),
  note: 'Compilation evidence only; no server or workflow execution in this check',
}));
