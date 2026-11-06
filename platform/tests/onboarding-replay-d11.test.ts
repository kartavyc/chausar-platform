import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { presetSpec } from '../runtime/venture/models/presets.ts';
import { replayEngineRun } from '../runtime/venture/replay/engine-run.ts';
function pdf(line: string): string {
  const content = 'BT /F1 11 Tf 72 720 Td (' + line + ') Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  return Buffer.from('%PDF-1.4\n' + objects.map((body, i) => (i + 1) + ' 0 obj\n' + body + '\nendobj\n').join('') + 'trailer\n<< /Root 1 0 R >>\n%%EOF\n').toString('base64');
}
for (const resume of [false, true]) test(resume ? 'sample resume PDF capture replays the actual onboarding file read and AI reply' : 'sample About-you capture replays its separate draft desk and AI reply', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-onboarding-capture-')); let calls = 0;
  const answer = { familyId: 'money-tax', offers: [{ name: 'Monthly books', line: 'Bank matching and a short report' }], countryCode: 'IN', evidence: 'India', reply: 'You keep books for small shops. I suggested monthly books to start.' };
  const engine = new Engine({ directory: join(root, 'data'), demo: true, storage: 'experimental-file', capture: { dir: join(root, 'captures') }, venture: { host: 'test', modelTransport: { replay: false, process: async () => { throw new Error('No process'); }, http: async () => { calls++; return { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 50 } }) }; } } } });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Onboarding sample', passphrase: 'sample-onboarding-passphrase', demo: true });
  await engine.request('venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: presetSpec('anthropic-haiku-5-5').consentDigest, apiKey: 'sample-only-provider-credential' });
  const payload = resume ? { attachment: { name: 'sample-resume.pdf', kind: 'resume-pdf', contentBase64: pdf('I keep books for small shops in India.') } } : { text: 'I keep books for small shops in India.' };
  const saved = await engine.captureRequest('venture.about.read', payload, 'sample business');
  assert.equal((saved.result as any).reply, answer.reply); assert.equal(calls, 1);
  const capture = JSON.parse(await readFile(saved.path, 'utf8'));
  assert.ok(capture.records.some((row: any) => row.kind === 'venture-model-call'));
  assert.deepEqual((await replayEngineRun(capture)).differences, []); assert.equal(calls, 1);
});
