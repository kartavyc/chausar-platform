// Transcripts for the YouTube channel playbook. A client sends the transcript of the footage as an SRT or VTT file;
// it joins the order as a transcript (venture.files.add, tested with the delivery wiring). The agent lists it and reads
// it as timed lines with segment ids, never as a table, and the auditor counts that read. The YouTube draft checks read
// an attached transcript: the retention check runs on it, and the chapter check knows how long the talk runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Deliverable, VentureDeps } from '../runtime/venture/contracts.ts';
import { digest } from '../runtime/venture/records.ts';
import type { FileLike } from '../runtime/venture/delivery/harness/files.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { auditStep } from '../runtime/venture/delivery/judge/auditor.ts';
import { runFlagshipChecks } from '../runtime/venture/playbooks/draft-checks.ts';

const stamp = (ms: number) => {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
/** An SRT file with one line every five seconds up to endMs, each said for 4.8 seconds; gapAt adds a silence there. */
function srt(endMs: number, gapAt: number | null = null): string {
  const blocks: string[] = [];
  let at = 0;
  for (let index = 0; at < endMs; index += 1) {
    if (gapAt !== null && at === gapAt) at += 3000;
    const words = `Segment ${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))} explains the fees`;
    blocks.push(`${index + 1}\n${stamp(at)} --> ${stamp(at + 4800)}\n${words}`);
    at += 5000;
  }
  return `${blocks.join('\n\n')}\n`;
}
const transcript = (name: string, text: string): FileLike => ({
  id: `upload_${name.replace(/\W/g, '_')}`, name, format: 'transcript', bytes: Buffer.byteLength(text), digest: digest(text),
  contentBase64: Buffer.from(text).toString('base64'), clientData: true,
});
const csv = (name: string, text: string): FileLike => ({ ...transcript(name, text), format: 'csv' });

function toolEnv(files: FileLike[]): ToolEnv {
  return {
    deps: { services: {} } as unknown as VentureDeps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year',
    runRef: { kind: 'rehearsal', scenarioId: 'youtube', episode: 0 }, files, tables: [], receipts: [], dictionary: [],
    sandbox: undefined, now: () => '2026-10-21T10:00:00.000Z', allowed: [],
  };
}
const call = (env: ToolEnv, tool: string, input: unknown) => callTool(env, ['files.list', 'files.read'], 1, 0, { tool, input: JSON.stringify(input) });
const result = (outcome: Awaited<ReturnType<typeof call>>) => {
  assert.ok(outcome.record.envelope.ok, JSON.stringify(outcome.record.envelope));
  return outcome.record.envelope.result as any;
};
const refusal = (outcome: Awaited<ReturnType<typeof call>>) => (outcome.record.envelope.ok ? '' : outcome.record.envelope.error.message);

test('the agent lists a transcript and reads its timed lines by segment id, never as a table; the auditor counts the read', async () => {
  const env = toolEnv([csv('notes.csv', 'Topic,Minute\nFees,1\n'), transcript('episode.srt', srt(20000))]);
  const listed = result(await call(env, 'files.list', {}));
  assert.deepEqual(listed.files[1], { file: 'f2', name: 'episode.srt', format: 'transcript', tables: [], segments: 4 });
  const read = await call(env, 'files.read', { target: 'f2', part: 'pages' });
  const lines = result(read);
  assert.equal(lines.file, 'f2');
  assert.deepEqual(lines.segments[0], { id: 'seg-1', at: '0:00', text: 'Segment aa explains the fees' });
  assert.deepEqual(lines.segments.map((segment: any) => segment.id), ['seg-1', 'seg-2', 'seg-3', 'seg-4']);
  assert.equal(auditStep(env, read).audited, true, 'reading the transcript is a step the auditor counts');
  assert.match(refusal(await call(env, 'files.read', { target: 'f2', part: 'sample' })), /f2 is a transcript\. Read its timed lines with part pages\./);
  assert.match(refusal(await call(env, 'files.read', { target: 'f1', part: 'pages' })), /f1 is a table/);
});

const text = (line: string) => ({ kind: 'text' as const, text: line, ref: '' as const });
const PACKAGE = {
  title: 'Episode package: hidden bank fees', questionsForClient: [],
  sections: [
    { heading: 'Summary', parts: ['Hook: Why your savings shrink before you notice, and how to stop it.', 'Hook: Your bank charges you for things you never asked for. Here is how to stop it.'].map(text) },
    { heading: 'Title and thumbnail', parts: ['Title: Hidden bank fees cost you 5 things a year', 'Thumbnail: STOP PAYING THIS'].map(text) },
    { heading: 'Description and chapters', parts: ['Description: A plain guide to the bank fees the client named.', '0:00 Why fees matter', '1:30 The fees to check', '4:00 How to stop them'].map(text) },
    { heading: 'Next steps', parts: [text('You watch the cut, then you or the client publish it.')] },
  ],
} as unknown as Deliverable;
const OWN = { basis: 'own-footage' as const, holder: 'Asha Rao', reference: null, scope: null, expiresOn: null, recordedAt: '2026-10-21T10:00:00.000Z', recordedBy: 'owner' };
const checks = async (files: FileLike[]) => Object.fromEntries((await runFlagshipChecks({
  flagship: 'youtube', offerKey: 'episode-package', servedBy: 'model', deliverable: PACKAGE, request: 'One episode on hidden bank fees.',
  intake: { rights: OWN, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null },
  files, receipts: [], known: [], mode: 'client', today: '2026-10-21', dateOrder: 'day-month-year', finishing: null,
})).map(item => [item.check, item]));

test('the YouTube checks read an attached transcript: retention runs on it, and the chapters know how long the talk runs', async () => {
  const none = await checks([csv('notes.csv', 'Topic,Minute\nFees,1\n')]);
  assert.equal(none['retention-risk'].outcome, 'not-run');
  assert.equal(none['retention-risk'].detail, 'not run: no transcript for this order.');
  assert.equal(none.chapters.outcome, 'pass');

  const clean = await checks([transcript('episode.srt', srt(270000))]);
  assert.equal(clean['retention-risk'].outcome, 'pass', clean['retention-risk'].detail);
  assert.equal(clean.chapters.outcome, 'pass', clean.chapters.detail);

  const silent = await checks([transcript('episode.srt', srt(270000, 60000))]);
  assert.equal(silent['retention-risk'].outcome, 'fail');
  assert.match(silent['retention-risk'].detail, /0:03 of silence at 0:59\./);

  // The talk ends five seconds after the last chapter starts, so that chapter is too short to show.
  const short = await checks([transcript('episode.vtt', `WEBVTT\n\n${srt(245000).replace(/,(\d{3})/g, '.$1')}`)]);
  assert.equal(short.chapters.outcome, 'fail');
  assert.match(short.chapters.detail, /The last chapter, at 4:00, is shorter than ten seconds\./);
});
