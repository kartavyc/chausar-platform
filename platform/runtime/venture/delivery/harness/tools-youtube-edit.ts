import {wholeCount} from '../../playbooks/kit/count.ts';
// Chausar 5B1 tools. Tomada (AGPL), Kimo (MIT), FilmCraft (MIT/Apache-2.0), ideas only; original adapters.
import { check } from '../../../contracts.ts';
import type { ToolName } from '../../contracts.ts';
import { findRecord, listRecords } from '../../records.ts';
import { requireCurrentWordSource } from '../../playbooks/youtube/bound-source.ts';
import { requireRights } from '../rights.ts';
import { localDayAt } from '../../local-day.ts';
import { applyEditOps, type EditOp } from '../../playbooks/youtube/edit-ops.ts';
import { cleanTranscript, wordsAfterTrim } from '../../playbooks/youtube/clean.ts';
import { youtubeCaptions } from '../../playbooks/youtube/captions.ts';
import { scriptCoverage } from '../../playbooks/youtube/coverage.ts';
import { applyDictionaryFixes, type DictionaryFix } from '../../playbooks/youtube/dictionary.ts';
import { parseTranscript } from '../../playbooks/youtube/transcript.ts';
import type { CaptionProfileId } from '../../playbooks/kit/captions.ts';
import type { Field, Spec, ToolEnv } from './tools.ts';

type EditToolName = Extract<ToolName, 'youtube.editOps' | 'youtube.clean' | 'youtube.captions' | 'youtube.coverage' | 'youtube.dictionary'>;
const text = (about: string, max = 120, required = true): Field => ({ type: 'text', required, max, about });
function session(env: ToolEnv, id: string) {
  check(env.runRef.kind === 'delivery', 'WORD_TIMES_REQUIRED', 'Measured word editing runs on a real order after the owner imports the word-time file.');
  const state = env.deps.store.read(), run = findRecord(state, 'venture-delivery-run', env.runRef.runId);
  const edit = findRecord(state, 'venture-youtube-edit', id);
  check(edit && run && edit.ventureId === env.ventureId && edit.orderId === run.orderId, 'EDIT_NOT_FOUND', 'Choose the edit document on this order.');
  requireRights({ id: 'assemble', clipping: true }, env.intake ?? null, localDayAt(env.now(), { code: 'IN' }));
  requireCurrentWordSource(state, edit);
  return edit;
}
function json<T>(value: unknown): T {
  check(typeof value === 'string' && value.length <= 12000, 'INVALID_VENTURE_REQUEST', 'Give a JSON list within the tool limit.');
  try { return JSON.parse(value) as T; } catch { check(false, 'INVALID_VENTURE_REQUEST', 'Give a valid JSON list.'); }
}
export const YOUTUBE_EDIT_TOOLS: Readonly<Record<EditToolName, Spec>> = Object.freeze({
  'youtube.editOps': { name: 'youtube.editOps', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Previews typed edits on measured word ids. Each operation applies whole or refuses. A large removal waits on the owner; no file is changed.',
    input: { editId: text('The edit document on this order.'), ops: text('JSON list of typed operations on word ids.', 12000) },
    async run(env, input) { const edit = session(env, input.editId); return { result: applyEditOps(edit.document, json<EditOp[]>(input.ops)) }; } },
  'youtube.clean': { name: 'youtube.clean', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Suggests cleanup from measured audio and word times, with a code-written summary. Missing measurements never become guessed cuts.',
    input: { editId: text('The edit document on this order.') },
    async run(env, input) { const edit = session(env, input.editId); return { result: cleanTranscript({ ...edit.source, document: edit.document }) }; } },
  'youtube.captions': { name: 'youtube.captions', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Groups SRT and VTT captions from stored word times and reports findings by code and cue id.',
    input: { editId: text('The edit document on this order.'), profile: { type: 'enum', required: true, values: ['web', 'broadcast', 'vertical'], about: 'The caption profile.' } },
    async run(env, input) { const edit = session(env, input.editId); const { editDigest } = await import('../../playbooks/youtube/edit-ops.ts'); const current = editDigest(edit.document); return { result: youtubeCaptions({ words: wordsAfterTrim(edit.document), profile: input.profile as CaptionProfileId, sourceDigest: current, currentDigest: current }) }; } },
  'youtube.coverage': { name: 'youtube.coverage', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Measures how much of the supplied script was spoken, with missing passages, nearby word ids, retakes and actual extra words.',
    input: { editId: text('The edit document on this order.'), scriptFile: text('The script as an SRT or VTT file, f1 for example.') },
    async run(env, input) { const edit = session(env, input.editId); const match = /^f(\d+)$/.exec(input.scriptFile); const file = match ? env.files[wholeCount(match[1]) - 1] : null;
      check(file && file.format === 'transcript', 'SCRIPT_FILE_REQUIRED', 'Add the script as an SRT or VTT transcript file.');
      const script = parseTranscript(Buffer.from(file.contentBase64, 'base64').toString('utf8')).map(cue => cue.text).join(' ');
      check(script.length > 0, 'SCRIPT_FILE_REQUIRED', 'This script file contains no readable passages.'); return { result: scriptCoverage(script, wordsAfterTrim(edit.document)) }; } },
  'youtube.dictionary': { name: 'youtube.dictionary', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Checks indexed name corrections against the exact before text and your names list. Only changes at ninety percent similarity or more are proposed.',
    input: { editId: text('The edit document on this order.'), fixes: text('JSON list of index, before and after corrections.', 12000) },
    async run(env, input) { const edit = session(env, input.editId); const terms = listRecords(env.deps.store.read(), 'venture-youtube-dictionary', env.ventureId).at(-1)?.terms ?? [];
      return { result: applyDictionaryFixes(edit.document.words.map(word => word.text), terms, json<DictionaryFix[]>(input.fixes)) }; } },
});
