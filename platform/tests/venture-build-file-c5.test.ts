// C5 task 35: the brief by file. The owner saves website-brief.md (exactly the brief) with the note file each builder
// reads for the brief id: AGENTS.md for Lovable, replit.md for Replit. The same gates as the link, and no direct
// hand-off: nothing goes to Lovable or Replit from here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { LIMITS, briefFileOf, builderNote, planHandoff } from '../runtime/venture/build/handoff.ts';
import { VENTURE_METHODS } from '../runtime/venture/contracts.ts';

const require = createRequire(import.meta.url);
const { saveBriefFile } = require('../../app/desktop/brief-save.cjs');

const brief = { briefId: 'chb_12ab34cd', markdown: '## Business\nA sample brief.\n\n## Done means\n- [ ] Pages load.' };

test('the file holds exactly the brief, with the note file its builder reads', () => {
  const lovable = briefFileOf('lovable', brief);
  assert.deepEqual(lovable.map(file => file.name), ['website-brief.md', 'AGENTS.md']);
  assert.equal(lovable[0]!.text, brief.markdown);
  assert.equal(lovable[1]!.text, builderNote(brief.briefId));
  assert.match(lovable[1]!.text, /^chausar-brief-id: chb_12ab34cd\nMoney numbers come from Chausar\. Do not compute totals or tax\.\n$/);
  assert.deepEqual(briefFileOf('replit', brief).map(file => file.name), ['website-brief.md', 'replit.md']);
});

test('only Lovable and Replit take a file; Bolt and v0 stay on the clipboard', () => {
  for (const builder of ['bolt', 'v0', 'cursor']) assert.throws(() => briefFileOf(builder as never, brief), (error: { code?: string }) => error.code === 'INVALID_VENTURE_REQUEST');
});

test('a brief too long for a link still has its file', () => {
  const long = { briefId: 'chb_long', markdown: Array.from({ length: LIMITS.replitEncodedSafe * 2 }, (_, at) => `word${at * 7919}`).join(' ') };
  assert.equal(planHandoff('replit', long.markdown).mode, 'copy');
  assert.equal(briefFileOf('replit', long)[0]!.text, long.markdown);
});

test('the method is in the contract', () => {
  assert.ok((VENTURE_METHODS as readonly string[]).includes('venture.build.briefFile'));
});

// ---- the desktop save ----
const sender = {};
function deps(folder: string, chosen: string | null, calls: { method: string; payload: unknown }[]) {
  return {
    window: { webContents: sender }, documents: folder,
    assertTrustedSender() {},
    publicError: (error: { code?: string; message?: string }) => ({ code: error.code, message: error.message }),
    dialog: { showSaveDialog: async () => (chosen === null ? { canceled: true } : { canceled: false, filePath: chosen }) },
    engine: {
      request: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        if (method === 'venture.build.briefFile') return { handoffId: 'handoff_1', builder: 'lovable', files: briefFileOf('lovable', brief), notes: [] };
        return {};
      },
    },
  };
}

test('desktop: both files land beside each other, and the hand-off is marked only after they did', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-brief-'));
  try {
    const calls: { method: string; payload: unknown }[] = [];
    const reply = await saveBriefFile({}, { builder: 'lovable' }, deps(folder, join(folder, 'website-brief.md'), calls));
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.result, { saved: true, name: 'website-brief.md', companion: 'AGENTS.md' });
    assert.equal(await readFile(join(folder, 'website-brief.md'), 'utf8'), brief.markdown);
    assert.equal(await readFile(join(folder, 'AGENTS.md'), 'utf8'), builderNote(brief.briefId));
    assert.deepEqual(calls.map(call => call.method), ['venture.build.briefFile', 'venture.build.handoffOpened']);
    assert.deepEqual(calls[1]!.payload, { handoffId: 'handoff_1' });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('desktop: an AGENTS.md already in that folder is left alone, and nothing is saved', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-brief-'));
  try {
    await writeFile(join(folder, 'AGENTS.md'), 'the repo\'s own');
    const calls: { method: string; payload: unknown }[] = [];
    const reply = await saveBriefFile({}, { builder: 'lovable' }, deps(folder, join(folder, 'website-brief.md'), calls));
    assert.equal(reply.ok, false);
    assert.equal(reply.error.code, 'EXPORT_EXISTS');
    assert.match(reply.error.message, /AGENTS\.md/);
    assert.equal(await readFile(join(folder, 'AGENTS.md'), 'utf8'), 'the repo\'s own');
    assert.deepEqual((await readdir(folder)).sort(), ['AGENTS.md']);
    assert.deepEqual(calls.map(call => call.method), ['venture.build.briefFile']);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('desktop: cancelling saves nothing and marks nothing; a stranger builder never reaches the engine', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-brief-'));
  try {
    const calls: { method: string; payload: unknown }[] = [];
    assert.deepEqual(await saveBriefFile({}, { builder: 'lovable' }, deps(folder, null, calls)), { ok: true, result: null });
    assert.deepEqual(await readdir(folder), []);
    assert.deepEqual(calls.map(call => call.method), ['venture.build.briefFile']);
    const refused = await saveBriefFile({}, { builder: 'bolt' }, deps(folder, null, calls));
    assert.equal(refused.ok, false);
    assert.equal(calls.length, 1);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
