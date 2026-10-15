/**
 * SH-08 as words and steps, pure: from a checked `todayx.updates` reply and the run the person
 * started, which sentence shows, which steps are done, and whether Update is offered. No React,
 * no bridge. The engine decides the state; this file never guesses one it was not given.
 */
import type { UpdateRefusal, UpdatesReply } from '../bridge/todayx-contract.ts';

/** The run the person started with Update: steps in words, then the outcome. */
export type UpdateRun =
  | { readonly phase: 'idle' }
  | { readonly phase: 'checking' }
  | { readonly phase: 'saving' }
  | { readonly phase: 'restart' }
  | { readonly phase: 'refused'; readonly why: UpdateRefusal };

export type UpdateStep = { readonly key: 'SH-08.step.checking' | 'SH-08.step.saving' | 'SH-08.step.updating'; readonly state: 'done' | 'now' | 'waiting' };

/** The three steps, while a run is under way. "Saving a copy" and "Updating" are one call to the release lane. */
export function updateSteps(run: UpdateRun): readonly UpdateStep[] {
  if (run.phase !== 'checking' && run.phase !== 'saving') return [];
  const checking = run.phase === 'checking';
  return [
    { key: 'SH-08.step.checking', state: checking ? 'now' : 'done' },
    { key: 'SH-08.step.saving', state: checking ? 'waiting' : 'now' },
    { key: 'SH-08.step.updating', state: checking ? 'waiting' : 'now' },
  ];
}

/** The one sentence for the state, as a text key, and its values. */
export function updateSentence(reply: UpdatesReply, run: UpdateRun): { readonly key: string; readonly values?: Readonly<Record<string, string>> } | null {
  if (run.phase === 'restart') return { key: 'SH-08.restart' };
  if (run.phase === 'refused') {
    if (run.why === 'manual') return { key: reply.platform === 'mac' ? 'SH-08.mac-unsigned' : 'SH-08.manual' };
    const key = { 'not-signed': 'SH-08.refused.not-signed', older: 'SH-08.refused.older', withdrawn: 'SH-08.refused.withdrawn',
      'older-than-vault': 'SH-08.older-than-vault', 'owner-only': 'SH-08.owner-only', failed: 'SH-08.failed' }[run.why];
    return { key };
  }
  switch (reply.state) {
    case 'not-built': return null;
    case 'not-configured': return { key: 'SH-08.not-configured' };
    case 'current': return { key: 'SH-08.current' };
    case 'ready': return { key: 'SH-08.ready', values: { version: reply.candidate ?? '' } };
    case 'restart': return { key: 'SH-08.restart' };
    case 'rolled-back': return { key: 'SH-08.rolled-back' };
    case 'older-than-vault': return { key: 'SH-08.older-than-vault' };
    case 'update-needed': return { key: 'SH-08.update-needed' };
  }
}

/** Update is offered only for a ready candidate, to a seat that may update, when no run is under way or finished. */
export function updateOffered(reply: UpdatesReply, run: UpdateRun): boolean {
  return reply.state === 'ready' && reply.canUpdate && (run.phase === 'idle' || (run.phase === 'refused' && run.why === 'failed'));
}

/** Today's "Update ready. Your data is saved first." row: present when an update is ready; Update offered to a seat that may update. */
export function todayUpdateRow(reply: UpdatesReply | null): { readonly can: ReadonlyArray<'update'> } | undefined {
  if (reply === null || reply.state !== 'ready') return undefined;
  return { can: reply.canUpdate ? ['update'] : [] };
}
