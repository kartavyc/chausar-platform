// Chausar playbook: Forget for the lesson desk (wave 6, package 6E2; the founder's DPDP rule). A forgotten parent or
// guardian takes every learner they pay for out of every batch, with each mark, score and message about them; a learner
// whose own name or contact matches the forgotten person goes too. Written for Chausar; nothing here is learned from an
// outside source.
import type { LessonBatchRecord } from '../../contracts.ts';
import type { VentureTx } from '../../records.ts';
import { withoutLearners } from './core.ts';

export function eraseLessons(tx: VentureTx, clientIds: ReadonlySet<string>, handles: ReadonlySet<string>, mentions: (value: unknown) => boolean): void {
  let changed = false;
  for (const record of tx.list('venture-lesson-batch')) {
    const named = (value: unknown) => { const text = JSON.stringify(value) ?? ''; return mentions(text) || [...handles].some(handle => handle.length >= 3 && text.toLowerCase().includes(handle.toLowerCase())); };
    const ids = new Set(record.batch.learners.filter(learner => clientIds.has(learner.guardianClientId) || named(learner)).map(learner => learner.id));
    for (const message of record.batch.messages) if (named(message.to) || named(message.text)) ids.add(message.learnerId);
    if (!ids.size) continue;
    tx.replace<LessonBatchRecord>({ ...record, batch: withoutLearners(record.batch, ids) });
    changed = true;
  }
  if (changed) tx.emit('desk.changed', { playbook: 'lesson-desk' });
}
