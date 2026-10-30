// Chausar 5B1: typed transcript edits. Tomada (AGPL), ideas only; no source copied.
import { createHash } from 'node:crypto';
import { check, ChausarError } from '../../../contracts.ts';

export type EditWord = { id: string; text: string; startMs: number; endMs: number };
export type WordRange = { from: string; to: string };
export type EditOp =
  | ({ kind: 'cut' | 'restore' | 'clip' | 'hook' } & WordRange)
  | ({ kind: 'zoom'; scale: number } & WordRange)
  | { kind: 'layout'; value: 'wide' | 'vertical' | 'square' }
  | { kind: 'captions'; profile: 'web' | 'broadcast' | 'vertical' }
  | { kind: 'title'; text: string };
export type EditDocument = {
  durationMs: number;
  words: EditWord[];
  cuts: (WordRange & { startMs: number; endMs: number; manual?: boolean })[];
  settings: { title?: string; layout?: string; captions?: string; hook?: WordRange; clips?: WordRange[]; zooms?: (WordRange & { scale: number })[] };
};
export type EditResult = {
  document: EditDocument; undo: EditDocument; digest: string;
  applied: { index: number; op: EditOp }[];
  refused: { index: number; code: string }[];
  removedMs: number; removedShare: number; removedPercent: number; addedMs: number; addedShare: number; addedPercent: number; summary: string;
};
/** The exact document fingerprint bound to the owner's second ask. */
export function editDigest(document: EditDocument): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}
/** Refuses corrupt timings and duplicate ids instead of guessing a range. */
export function validateEditDocument(document: EditDocument): void {
  check(document && Number.isSafeInteger(document.durationMs) && document.durationMs > 0 && document.durationMs <= 86400000
    && Array.isArray(document.words) && document.words.length <= 50000 && Array.isArray(document.cuts) && document.cuts.length <= 10000
    && document.settings && typeof document.settings === 'object', 'EDIT_INVALID', 'Give a timed transcript and its current edits.');
  const ids = new Set<string>();
  let previous = 0;
  for (const word of document.words) {
    check(word && typeof word.id === 'string' && /^[\w-]{1,80}$/.test(word.id) && !ids.has(word.id) && typeof word.text === 'string' && word.text.length > 0 && word.text.length <= 200
      && Number.isSafeInteger(word.startMs) && Number.isSafeInteger(word.endMs) && word.startMs >= previous && word.endMs > word.startMs && word.endMs <= document.durationMs,
    'EDIT_INVALID', 'Every word needs a distinct id and measured times inside the footage.');
    ids.add(word.id); previous = word.endMs;
  }
  let end = 0;
  for (const cut of [...document.cuts].sort((a, b) => a.startMs - b.startMs)) {
    check(Number.isSafeInteger(cut.startMs) && Number.isSafeInteger(cut.endMs) && cut.startMs >= end && cut.endMs > cut.startMs && cut.endMs <= document.durationMs,
      'EDIT_INVALID', 'The saved cuts overlap or have invalid times.');
    end = cut.endMs;
  }
}
const invalid = (code: string): never => { throw new ChausarError(code, 'This operation cannot be applied to these words.'); };
/** Apply each whole operation to a copy. One request is one undo item; no footage is overwritten. */
export function applyEditOps(document: EditDocument, ops: readonly EditOp[], options: { confirmedDigest?: string } = {}): EditResult {
  validateEditDocument(document);
  check(Array.isArray(ops) && ops.length <= 40, 'EDIT_TOO_MANY', 'Use at most forty operations in one request.');
  const digest = editDigest(document);
  if (options.confirmedDigest !== undefined) check(options.confirmedDigest === digest, 'EDIT_STALE', 'The edit changed. Read it and confirm the new request.');
  const next = structuredClone(document);
  const applied: EditResult['applied'] = [], refused: EditResult['refused'] = [];
  for (const [index, op] of ops.entries()) {
    try {
      if (!op || typeof op !== 'object' || Array.isArray(op)) invalid('EDIT_INVALID');
      const fields: Record<string, string[]> = { cut: ['kind', 'from', 'to'], restore: ['kind', 'from', 'to'], clip: ['kind', 'from', 'to'], hook: ['kind', 'from', 'to'], zoom: ['kind', 'from', 'to', 'scale'], layout: ['kind', 'value'], captions: ['kind', 'profile'], title: ['kind', 'text'] };
      const allowed = fields[op.kind];
      if (!allowed || Object.keys(op).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(op, key))) invalid('EDIT_INVALID');
      let range: { startMs: number; endMs: number } | null = null;
      if ('from' in op) {
        const from = next.words.findIndex(word => word.id === op.from), to = next.words.findIndex(word => word.id === op.to);
        if (from < 0 || to < 0) invalid('EDIT_WORD_UNKNOWN');
        if (from > to) invalid('EDIT_INVALID');
        range = { startMs: next.words[from]!.startMs, endMs: next.words[to]!.endMs };
      }
      switch (op.kind) {
        case 'cut':
          if (!range) invalid('EDIT_INVALID');
          if (next.cuts.some(cut => cut.startMs < range!.endMs && cut.endMs > range!.startMs)) invalid('EDIT_CUT_OVERLAP');
          next.cuts.push({ from: op.from, to: op.to, ...range!, manual: true });
          next.cuts.sort((a, b) => a.startMs - b.startMs);
          break;
        case 'restore': {
          if (!range) invalid('EDIT_INVALID');
          const at = next.cuts.findIndex(cut => cut.startMs <= range!.startMs && cut.endMs >= range!.endMs);
          if (at < 0) invalid('EDIT_NOT_CUT');
          const prior = next.cuts[at]!;
          next.cuts.splice(at, 1);
          const fromIndex = next.words.findIndex(word => word.id === op.from), toIndex = next.words.findIndex(word => word.id === op.to);
          if (prior.startMs < range!.startMs) next.cuts.push({ ...prior, to: next.words[fromIndex - 1]?.id ?? op.from, endMs: range!.startMs });
          if (prior.endMs > range!.endMs) next.cuts.push({ ...prior, from: next.words[toIndex + 1]?.id ?? op.to, startMs: range!.endMs });
          next.cuts.sort((a, b) => a.startMs - b.startMs); break;
        }
        case 'zoom':
          if (!range || !Number.isFinite(op.scale) || op.scale < 1 || op.scale > 3) invalid('EDIT_INVALID');
          (next.settings.zooms ??= []).push({ from: op.from, to: op.to, scale: op.scale }); break;
        case 'clip':
          if (!range) invalid('EDIT_INVALID');
          (next.settings.clips ??= []).push({ from: op.from, to: op.to }); break;
        case 'hook':
          if (!range) invalid('EDIT_INVALID');
          next.settings.hook = { from: op.from, to: op.to }; break;
        case 'layout':
          if (!['wide', 'vertical', 'square'].includes(op.value)) invalid('EDIT_INVALID');
          next.settings.layout = op.value; break;
        case 'captions':
          if (!['web', 'broadcast', 'vertical'].includes(op.profile)) invalid('EDIT_INVALID');
          next.settings.captions = op.profile; break;
        case 'title':
          if (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 100 || /[\u0000-\u001f]/.test(op.text)) invalid('EDIT_INVALID');
          next.settings.title = op.text.trim(); break;
        default: invalid('EDIT_INVALID');
      }
      applied.push({ index, op: structuredClone(op) });
    } catch (error) {
      if (!(error instanceof ChausarError)) throw error;
      refused.push({ index, code: error.code });
    }
  }
  const removedMs = next.cuts.reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0);
  const priorMs = document.cuts.reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0);
  const addedMs = Math.max(0, removedMs - priorMs);
  check(addedMs * 5 <= document.durationMs || options.confirmedDigest === digest, 'EDIT_ASK_AGAIN', `This removes ${Math.round(addedMs * 10000 / document.durationMs) / 100}% of the footage. Confirm this exact edit first.`);
  const count = applied.filter(item => item.op.kind === 'cut').length;
  const seconds = Math.round(addedMs / 100) / 10;
  return { document: next, undo: structuredClone(document), digest: editDigest(next), applied, refused, removedMs, removedShare: removedMs / document.durationMs, removedPercent: Math.round(removedMs * 10000 / document.durationMs) / 100, addedMs, addedShare: addedMs / document.durationMs, addedPercent: Math.round(addedMs * 10000 / document.durationMs) / 100,
    summary: `Cut ${count} ${count === 1 ? 'passage' : 'passages'}, ${seconds} s shorter.` };
}
/** Restore the complete pre-request snapshot as one undo step. */
export function undoEdit(result: EditResult): EditDocument { return structuredClone(result.undo); }
