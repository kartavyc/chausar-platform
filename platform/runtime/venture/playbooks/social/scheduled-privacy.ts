// Original Chausar S12 privacy hook. Forget removes the scheduled posting authority and its personal copy.
import type { VentureTx } from '../../records.ts';
import { removeRecords } from '../../network/people.ts';
export function eraseScheduledNaming(tx: VentureTx, handles: ReadonlySet<string>, mentions: (text: unknown) => boolean): void {
    const named = (text: string) => mentions(text) || [...handles].some(handle => text.toLowerCase().includes(handle.toLowerCase()));
    const posts = new Set<string>();
    for (const row of tx.list('venture-social-scheduled')) {
        if (!named(row.text + ' ' + (row.account ?? '')))
            continue;
        if (row.postId)
            posts.add(row.postId);
        tx.replace({ ...row, text: '', account: null, postId: null, postDigest: null, filesDigest: null, approvedDigest: null, approvedAt: null, approvedBy: null, state: 'cancelled', reason: 'This slot was cancelled because it named someone you asked Chausar to forget.' });
        tx.emit('desk.changed', { playbook: 'social-agency', id: row.id });
    }
    removeRecords(tx, record => record.kind === 'venture-connector-post' && posts.has(String(record.id)));
}
