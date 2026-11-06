import {currentScreencastProof} from '../../playbooks/youtube/screencast-source.ts';
import {wholeCount} from '../../playbooks/kit/count.ts';
// Chausar 5B2 tools. Original adapters over measured order records; no provider is implied by a compute result.
import { check } from '../../../contracts.ts';
import { pathToFileURL } from 'node:url';
import type { ToolName } from '../../contracts.ts';
import { findRecord, listRecords } from '../../records.ts';
import { boardEdit, domainError } from '../../playbooks/youtube/board-desk.ts';
import { currentBoard, boardFiles } from '../../playbooks/youtube/board-core.ts';
import { projectManifest } from '../../playbooks/youtube/project-folder.ts';
import { currentStyle, styleView } from '../../playbooks/youtube/style-desk.ts';
import { compareStyle } from '../../playbooks/youtube/style.ts';
import { measureLocalStyle, verifyFinishingFiles } from '../../playbooks/youtube/local-media.ts';
import { checkClips, type ClipPick } from '../../playbooks/youtube/clip-rules.ts';
import { planBroll, type BrollBeat } from '../../playbooks/youtube/broll.ts';
import { timedBeats } from '../../playbooks/youtube/beats.ts';
import type { Field, Spec, ToolEnv } from './tools.ts';

type B2Name = Extract<ToolName, 'youtube.style' | 'youtube.clips' | 'youtube.broll' | 'youtube.beats' | 'youtube.export'>;
const text = (about: string, max = 120, required = true): Field => ({ type: 'text', required, max, about });
function session(env: ToolEnv, id: string) {
  check(env.runRef.kind === 'delivery', 'WORD_TIMES_REQUIRED', 'Use the measured edit document on a real order.');
  const state = env.deps.store.read(), run = findRecord(state, 'venture-delivery-run', env.runRef.runId);
  check(run && run.ventureId === env.ventureId, 'EDIT_NOT_FOUND', 'Choose a live delivery in this business.');
  const result = boardEdit(state, env.ventureId, id, env.now());
  check(result.edit.orderId === run.orderId, 'EDIT_NOT_FOUND', 'Choose the edit document on this order.');
  return { state, ...result };
}
function json<T>(value: unknown): T {
  check(typeof value === 'string' && value.length <= 12000, 'INVALID_VENTURE_REQUEST', 'Give JSON within the tool limit.');
  try { return JSON.parse(value) as T; } catch { check(false, 'INVALID_VENTURE_REQUEST', 'Give valid JSON.'); }
}
/** Domain checks always reach the harness with the same refusal codes as the owner desk. */
const wrap = (work: Spec['run']): Spec['run'] => async (env, input) => { try { return await work(env, input); } catch (error) { domainError(error); } };
export const YOUTUBE_B2_TOOLS: Readonly<Record<B2Name, Spec>> = Object.freeze({
  'youtube.style': { name: 'youtube.style', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Reads a measured style card and compares the current footage using local ffmpeg. References must already be measured by the owner; no face measurement is invented.',
    input: { editId: text('The measured edit on this order.'), styleId: text('The saved style card made from two or three owned reference videos.') },
    run: wrap(async (env, input) => {
      const { edit, order } = session(env, input.editId), card = await currentStyle(env.deps, env.ventureId, input.styleId);
      check(order.intake?.cutFile, 'MEDIA_FILE_REQUIRED', 'Set the local footage path on this order first.');
      const measured = await measureLocalStyle(env.deps, order.intake.cutFile, edit.document.words.map(word => word.text).join(' '), true);
      const fresh = session(env, input.editId);
      check(JSON.stringify(fresh.edit) === JSON.stringify(edit) && fresh.order.intake?.cutFile === order.intake.cutFile, 'DERIVED_STALE', 'The current edit changed during measurement.');
      await currentStyle(env.deps, env.ventureId, card.id);
      return { result: { style: styleView(card), metrics: measured.metrics, findings: compareStyle(card.card, measured.metrics) } };
    }) },
  'youtube.clips': { name: 'youtube.clips', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Checks one to three sentence-bound clips from saved word ids, duration, overlap, hook, new first line, overlay time and loop. Returns a preview for the review board.',
    input: { editId: text('The measured edit on this order.'), picks: text('JSON clip picks: from, to, hook, firstLine, overlayMs and loopTo.', 12000), format: { type: 'enum', required: true, values: ['shorts', 'clip'], about: 'The house duration profile.' } },
    run: wrap(async (env, input) => { const { edit } = session(env, input.editId); return { result: checkClips(edit.document.words, json<ClipPick[]>(input.picks), input.format as 'shorts' | 'clip') }; }) },
  'youtube.broll': { name: 'youtube.broll', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Plans b-roll on recorded words using current owned or licensed assets. Removed beats stay removed. Approval and owner frame-grid review remain separate; nothing is fetched.',
    input: { editId: text('The measured edit on this order.'), beats: text('JSON beats: id, wordId, assetId, kind, delayMs, durationMs. Concept cards use a null assetId.', 12000) },
    run: wrap(async (env, input) => { const { state, edit } = session(env, input.editId); const assets = listRecords(state, 'venture-asset', env.ventureId).filter(asset => asset.orderId === edit.orderId); return { result: planBroll(edit.document.words, json<BrollBeat[]>(input.beats), assets, edit.board?.removedBroll ?? []) }; }) },
  'youtube.beats': { name: 'youtube.beats', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Times the lines you wrote at a declared speaking rate; flags a hook over three seconds, a beat over four seconds and a missing loop. Buckets are four, six or eight seconds.',
    input: { editId: text('The measured edit on this order.'), lines: text('JSON list of spoken lines.', 10000), loopBack: text('The exact opening line the ending loops back to.', 1000), wordsPerMinute: text('Speaking rate from sixty to three hundred words per minute.', 3), bucket: { type: 'enum', required: true, values: ['4', '6', '8'], about: 'Duration bucket, in seconds.' } },
    run: wrap(async (env, input) => { session(env, input.editId); return { result: timedBeats(json<string[]>(input.lines), input.loopBack, wholeCount(input.wordsPerMinute), wholeCount(input.bucket) as 4 | 6 | 8) }; }) },
  'youtube.export': { name: 'youtube.export', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Returns exact individually approved handoff files and their hashes. Does not create a folder, render a video or publish. The owner uses Save project in the desktop app.',
    input: { editId: text('The current edit whose output board the owner approved.') },
    run: wrap(async (env, input) => {
      const { edit, order, state } = session(env, input.editId);
      currentBoard(edit.board, edit.document);
      check(order.intake?.cutFile && edit.board.timeline.ranges.every(range => range.source === pathToFileURL(order.intake!.cutFile!).href), 'DERIVED_STALE', 'The footage path changed. Prepare the outputs again.');
      if (edit.board.broll) { const rebuilt = planBroll(edit.document.words, edit.board.broll.beats, listRecords(state, 'venture-asset', env.ventureId).filter(asset => asset.orderId === edit.orderId), edit.board.removedBroll ?? []); check(rebuilt.digest === edit.board.broll.digest, 'DERIVED_STALE', 'A b-roll source changed. Prepare its plan again.'); }
      await verifyFinishingFiles(edit.board,order.intake.cutFile);
      const fresh=session(env,input.editId);
      check(JSON.stringify(fresh.edit)===JSON.stringify(edit)&&fresh.order.intake?.cutFile===order.intake.cutFile,'DERIVED_STALE','The edit changed while checking the finished files.');
      const files = boardFiles(edit.board);
      const screencast=currentScreencastProof(fresh.state,env.ventureId,fresh.order,fresh.edit,env.now());
      return { result: { orderId: edit.orderId, ...(screencast?{screencast}:{}), files, manifest: projectManifest(files), capability: 'handoff', line: 'Editor instructions and approved text only. Save the project in the desktop app, then finish or post in your editor.' } };
    }) },
});
