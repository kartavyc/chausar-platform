import {currentScreencastProof} from './screencast-source.ts';
// Chausar 5B2 review board. Original integration; editor workflow ideas only from the cited catalogue.
import { localApp, commandOf, commandLine, runApprovedLocalApp } from '../../build/local-apps.ts';
import { pathToFileURL } from 'node:url';
import { check, ChausarError, type State } from '../../../contracts.ts';
import type { YoutubeEditRecord } from '../../contracts.ts';
import type { DeskHandler } from '../desk-types.ts';
import { digest, exactPayload, findRecord, listRecords, requireAppChannel, ventureAction } from '../../records.ts';
import { readAs } from '../../delivery/shared.ts';
import { requireRights } from '../../delivery/rights.ts';
import { localDayAt } from '../../local-day.ts';
import { localPathProblem } from '../../../local-paths.ts';
import { requireCurrentWordSource } from './bound-source.ts';
import { prepareBoard, currentBoard, decideOutput, changePublishing, requestOutputChange, boardFiles } from './board-core.ts';
import { projectManifest } from './project-folder.ts';
import { toSrt, toVtt } from '../kit/captions.ts';
import { editDigest } from './edit-ops.ts';
import { checkClips, type ClipPick } from './clip-rules.ts';
import { timedBeats } from './beats.ts';
import { planBroll, approveBroll, reviewBroll, type BrollBeat } from './broll.ts';
import { recordClipPage } from './clips.ts';
import { spokenCounters,textLegibility } from './helpers.ts';
import { makeFrameGrid, measureFinishing, extractAudio, mediaHash, verifyFinishingFiles } from './local-media.ts';
import { finishingAdditions, type FinishingExtraInput } from './finishing-extra.ts';
import { compareInterchange, type FrameRate } from './interchange.ts';
import type { PUBLISH_LIMITS } from './publishing.ts';

export function boardEdit(state: State, ventureId: string, id: string, now: string) {
  const edit = findRecord(state, 'venture-youtube-edit', id);
  check(edit && edit.ventureId === ventureId, 'EDIT_NOT_FOUND', 'That edit is not in this business.');
  requireCurrentWordSource(state, edit);
  const order = findRecord(state, 'venture-order', edit.orderId);
  check(order && order.ventureId === ventureId && order.status !== 'cancelled', 'ORDER_NOT_FOUND', 'Choose an open order in this business.');
  requireRights({ id: 'assemble', clipping: true }, order.intake ?? null, localDayAt(now, { code: 'IN' }));
  return { edit, order };
}
function sourcePath(path: unknown): string {
  check(typeof path === 'string' && !localPathProblem(path), 'MEDIA_FILE_REQUIRED', 'Set the full local footage path on this order.');
  return path;
}
export function boardView(edit: YoutubeEditRecord) {
  return { id: edit.id, orderId: edit.orderId, digest: digest(edit), board: structuredClone(edit.board ?? null) };
}
function checkedBoard(edit: YoutubeEditRecord, path: unknown) {
  currentBoard(edit.board, edit.document);
  check(edit.board.timeline.ranges.every(range => range.source === pathToFileURL(sourcePath(path)).href), 'DERIVED_STALE', 'The footage path changed. Prepare the outputs again.');
  return edit.board;
}
function assets(state: State, ventureId: string, orderId: string) {
  return listRecords(state, 'venture-asset', ventureId).filter(asset => asset.orderId === orderId);
}
function currentBroll(state: State, ventureId: string, edit: YoutubeEditRecord) {
  const board = edit.board;
  check(board?.broll, 'BROLL_APPROVAL_REQUIRED', 'Prepare and approve the b-roll plan first.');
  const rebuilt = planBroll(edit.document.words, board.broll.beats, assets(state, ventureId, edit.orderId), board.removedBroll ?? []);
  check(rebuilt.digest === board.broll.digest, 'DERIVED_STALE', 'A b-roll asset or its licence changed. Prepare and approve the plan again.');
  check(board.broll.approvedDigest === board.broll.digest, 'BROLL_APPROVAL_REQUIRED', 'Approve the exact beat plan before making a frame grid.');
  return board.broll;
}
/** Convert browser-safe domain refusals to the engine's public error type. */
export function domainError(error: unknown): never {
  if (error instanceof ChausarError) throw error;
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw new ChausarError(error.code, error.message);
  throw error;
}
export const boardDesk: DeskHandler = {
  async list(deps, ctx, payload) {
    exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']);
    const filter = exactPayload(payload.filter ?? {}, ['orderId']);
    const { state, venture } = readAs(deps, ctx, 'read');
    return { playbook: 'youtube', kind: 'board', rows: listRecords(state, 'venture-youtube-edit', venture.id).filter(edit => filter.orderId === undefined || edit.orderId === filter.orderId).map(boardView), line: 'Review each output before saving a project. Publishing remains a manual handoff.' };
  },
  async get(deps, ctx, payload) {
    exactPayload(payload, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']);
    const { state, venture } = readAs(deps, ctx, 'read');
    const { edit } = boardEdit(state, venture.id, payload.id, deps.clock().toISOString());
    return { playbook: 'youtube', kind: 'board', item: boardView(edit), digest: digest(edit) };
  },
  async act(deps, ctx, payload) {
    try {
      requireAppChannel(ctx, 'venture.desk.act');
      exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload', 'digest']);
      const { state, venture } = readAs(deps, ctx, 'approve');
      const original = boardEdit(state, venture.id, payload.id, deps.clock().toISOString());
      check(payload.digest === digest(original.edit), 'APPROVAL_STALE', 'This output board changed. Open it again before approving.');
      const body = payload.payload;
      let grid: Awaited<ReturnType<typeof makeFrameGrid>> | undefined;
      let scan: Awaited<ReturnType<typeof measureFinishing>> | undefined;
      let source: Awaited<ReturnType<typeof measureFinishing>> | undefined;
      if (payload.action !== 'prepare') checkedBoard(original.edit, original.order.intake?.cutFile);
      if(payload.action==='export') await verifyFinishingFiles(original.edit.board!,sourcePath(original.order.intake?.cutFile));
      if (payload.action === 'audio') {
        const p=exactPayload(body,['file','url']);
        const result=await extractAudio(deps,p as {file?:string;url?:string});
        const fresh=boardEdit(deps.store.read(),venture.id,payload.id,deps.clock().toISOString());
        check(digest(fresh.edit)===payload.digest,'DERIVED_STALE','The edit changed during audio extraction.');
        return {playbook:'youtube',kind:'board',id:payload.id,result,line:result.note};
      }
      if (payload.action === 'editor-run') {
        exactPayload(body, []);
        const command = await ventureAction(deps, ctx, 'approve', 'youtube.board.editor.claim', tx => {
          const { edit, order } = boardEdit(tx.state, venture.id, payload.id, tx.now);
          check(payload.digest === digest(edit), 'APPROVAL_STALE', 'This board changed. Read the command again before approving.');
          const board = checkedBoard(edit, order.intake?.cutFile);
          check(board.editorCommand, 'LOCAL_APP_APPROVAL_REQUIRED', 'Preview an exact editor command before approving it.');
          const command = structuredClone(board.editorCommand);
          tx.replace({ ...edit, board: { ...board, editorCommand: null } });
          tx.emit('desk.changed', { playbook: 'youtube', kind: 'board', id: edit.id });
          return command;
        });
        const result = await runApprovedLocalApp(deps, ctx, command);
        return { playbook: 'youtube', kind: 'board', id: payload.id, result: { ...result, capability: 'write' }, line: result.line };
      }
      if (payload.action === 'grid') {
        const p = exactPayload(body, ['assetId', 'file'], ['assetId', 'file']);
        const plan = currentBroll(state, venture.id, original.edit);
        const asset = plan.assetBindings.find(asset => asset.id === p.assetId);
        check(asset?.fileDigest && typeof p.file === 'string', 'BROLL_LICENCE_REQUIRED', 'Choose a file matching an asset in this approved plan.');
        grid = await makeFrameGrid(deps, p.file, asset.fileDigest);
      }
      if (payload.action === 'finishing') {
        const p = exactPayload(body, ['file', 'platform', 'boxes', 'commentaryMs'], ['file', 'platform', 'boxes']);
        scan = await measureFinishing(deps, sourcePath(p.file));
        source = await measureFinishing(deps, sourcePath(original.order.intake?.cutFile));
        check(await mediaHash(sourcePath(p.file))===scan.sourceDigest&&await mediaHash(sourcePath(original.order.intake?.cutFile))===source.sourceDigest,'DERIVED_STALE','The source or finished file changed while the checks ran.');
      }
      const result = await ventureAction(deps, ctx, 'approve', 'youtube.board.change', tx => {
        const { edit, order } = boardEdit(tx.state, venture.id, payload.id, tx.now);
        check(payload.digest === digest(edit), 'APPROVAL_STALE', 'This board changed while the local check ran. Nothing changed.');
        if (payload.action === 'prepare') {
          const p = exactPayload(body, ['rate', 'publishing'], ['rate', 'publishing']);
          const captions = edit.captions?.sourceDigest === editDigest(edit.document) ? { srt: toSrt(edit.captions.cues), vtt: toVtt(edit.captions.cues) } : null;
          const board = prepareBoard(edit.document, pathToFileURL(sourcePath(order.intake?.cutFile)).href, p.rate as FrameRate, p.publishing as { platform: keyof typeof PUBLISH_LIMITS; text: string }[], captions);
          // Removed beat ids are permanent tombstones for this edit, even when outputs are regenerated.
          board.removedBroll = edit.board?.removedBroll ?? [];
          const saved = tx.replace({ ...edit, board });
          tx.emit('desk.changed', { playbook: 'youtube', kind: 'board', id: edit.id });
          return boardView(saved);
        }
        let board = structuredClone(checkedBoard(edit, order.intake?.cutFile));
        if (payload.action === 'editor-command') {
          const p = exactPayload(body, ['app', 'args'], ['app', 'args']);
          const app = localApp(p.app), args = commandOf(p.args);
          board.editorCommand = { app: app.id, args, line: commandLine(app, args) + ' --yes' };
        } else if (payload.action === 'decide') {
          const p = exactPayload(body, ['outputId', 'decision'], ['outputId', 'decision']);
          board = decideOutput(board, p.outputId as string, p.decision as 'approved' | 'discarded');
        } else if (payload.action === 'publishing') {
          const p = exactPayload(body, ['outputId', 'text'], ['outputId', 'text']);
          board = changePublishing(board, p.outputId as string, p.text as string);
        } else if (payload.action === 'request') {
          const p = exactPayload(body, ['outputId', 'words'], ['outputId', 'words']);
          board = requestOutputChange(board, p.outputId as string, p.words as string);
        } else if (payload.action === 'clips') {
          const p = exactPayload(body, ['picks', 'format'], ['picks', 'format']);
          board.clips = checkClips(edit.document.words, p.picks as ClipPick[], p.format as 'shorts' | 'clip');
        } else if (payload.action === 'beats') {
          const p = exactPayload(body, ['lines', 'wordsPerMinute', 'bucket', 'loopBack'], ['lines', 'wordsPerMinute', 'bucket', 'loopBack']);
          board.beats = timedBeats(p.lines as string[], p.loopBack as string, p.wordsPerMinute as number, p.bucket as 4 | 6 | 8);
        } else if (payload.action === 'broll-plan') {
          const p = exactPayload(body, ['beats'], ['beats']);
          board.broll = planBroll(edit.document.words, p.beats as BrollBeat[], assets(tx.state, venture.id, edit.orderId), board.removedBroll ?? []);
          board.grids = {}; board.reviews = {};
        } else if (payload.action === 'broll-approve') {
          const p = exactPayload(body, ['planDigest'], ['planDigest']);
          check(board.broll, 'BROLL_APPROVAL_REQUIRED', 'Prepare the beat plan first.');
          const rebuilt = planBroll(edit.document.words, board.broll.beats, assets(tx.state, venture.id, edit.orderId), board.removedBroll ?? []);
          check(rebuilt.digest === board.broll.digest, 'DERIVED_STALE', 'A b-roll asset changed. Prepare the plan again.');
          board.broll = approveBroll(board.broll, p.planDigest as string);
        } else if (payload.action === 'broll-remove') {
          const p = exactPayload(body, ['beatId'], ['beatId']);
          check(board.broll?.beats.some(beat => beat.id === p.beatId), 'BROLL_INVALID', 'Choose a beat in this plan.');
          board.removedBroll = [...new Set([...(board.removedBroll ?? []), p.beatId as string])];
          board.broll = planBroll(edit.document.words, board.broll!.beats.filter(beat => beat.id !== p.beatId), assets(tx.state, venture.id, edit.orderId), board.removedBroll);
          board.grids = {}; board.reviews = {};
        } else if (payload.action === 'grid') {
          const p = exactPayload(body, ['assetId', 'file'], ['assetId', 'file']);
          const plan = currentBroll(tx.state, venture.id, edit);
          const asset = plan.assetBindings.find(asset => asset.id === p.assetId);
          check(asset?.fileDigest && grid, 'BROLL_LICENCE_REQUIRED', 'Choose this approved asset.');
          board.grids = { ...board.grids, [asset.id]: { ...grid, assetId: asset.id, sourceDigest: asset.fileDigest } };
          if (board.reviews) delete board.reviews[asset.id];
        } else if (payload.action === 'grid-review') {
          const p = exactPayload(body, ['assetId', 'gridDigest', 'answers'], ['assetId', 'gridDigest', 'answers']);
          currentBroll(tx.state, venture.id, edit);
          const viewed = board.grids?.[p.assetId as string];
          check(viewed && viewed.digest === p.gridDigest, 'BROLL_REVIEW_REQUIRED', 'Open this exact frame grid before answering its questions.');
          const reviewed = reviewBroll(board.broll!, p.answers as Parameters<typeof reviewBroll>[1]);
          board.reviews = { ...board.reviews, [viewed.assetId]: { ...reviewed, gridDigest: viewed.digest } };
        } else if (payload.action === 'finishing') {
          const p = exactPayload(body, ['file', 'platform', 'boxes', 'commentaryMs'], ['file', 'platform', 'boxes']);
          check(scan && source, 'MEDIA_SCAN_FAILED', 'The local scans did not finish.');
          check(order.intake?.cutFile === original.order.intake?.cutFile, 'DERIVED_STALE', 'The source path changed during measurement.');
          board.finishingBinding={sourceFile:sourcePath(order.intake?.cutFile),sourceDigest:source.sourceDigest,file:sourcePath(p.file),fileDigest:scan.sourceDigest};
          board.finishing = finishingAdditions({ source: source.frame, delivery: scan.frame, measured: scan.measured, durationMs: scan.durationMs, platform: p.platform as FinishingExtraInput['platform'], boxes: p.boxes as FinishingExtraInput['boxes'], compilation: order.intake?.rights?.basis !== 'own-footage', commentaryMs: p.commentaryMs as number | undefined });
        } else if (payload.action === 'clip-page') {
          const p=exactPayload(body,['clipIndex','fields'],['clipIndex','fields']);
          check(Number.isInteger(p.clipIndex)&&Number(p.clipIndex)>=1&&Number(p.clipIndex)<=3,'CLIP_PAGE_INVALID','Choose clip one, two or three.');
          const text=recordClipPage(p.fields),id='clip-page-'+p.clipIndex;
          board.outputs=board.outputs.filter(row=>row.id!==id);
          board.outputs.push({id,kind:'page',path:'metadata/clip-'+p.clipIndex+'.html',text,decision:'pending',request:null});
        } else if(payload.action==='helpers') {
          const p=exactPayload(body,['fontPx','width'],['fontPx','width']);
          return {counters:spokenCounters(edit.document.words),legibility:textLegibility(p.fontPx as number,p.width as number)};
        } else if (payload.action === 'returned-xml') {
          const p = exactPayload(body, ['xml'], ['xml']);
          return { comparison: compareInterchange(board.timeline, p.xml as string), applied: false };
        } else if (payload.action === 'export') {
          exactPayload(body, []);
          if (board.broll) currentBroll(tx.state, venture.id, edit);
          const files = boardFiles(board);
          const screencast=currentScreencastProof(tx.state,venture.id,order,edit,tx.now);
          return { orderId: edit.orderId, editId: edit.id, digest: digest(edit), ...(screencast?{screencast}:{}), files, manifest: projectManifest(files), capability: 'handoff', line: 'Editor instructions and approved text only. Open the folder and finish or post in your chosen app.' };
        } else throw new ChausarError('EDIT_ACTION_UNKNOWN', 'Choose an output board action this desk supports.');
        const saved = tx.replace({ ...edit, board });
        tx.emit('desk.changed', { playbook: 'youtube', kind: 'board', id: edit.id });
        return boardView(saved);
      });
      return { playbook: 'youtube', kind: 'board', id: payload.id, result, line: 'Output board saved. No footage was overwritten or published.' };
    } catch (error) { domainError(error); }
  },
};
