import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runRoot } from '../../runtime/run-root.mjs';
import { assertCaptureText } from '../../runtime/venture/replay/capture.ts';
/** CI retains genuine engine output from injected sample ports, never a claim of live provider qualification. */
export async function retainReplaySample(name: string, capture: unknown): Promise<void> {
  if (!process.env.CI) return;
  if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid sample name');
  const text = JSON.stringify(capture, null, 2); assertCaptureText(text);
  const directory = runRoot('replay-samples'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'injected-' + name + '.capture.json'), text + '\n');
}
