// Stored CA sign-off: original Chausar implementation, CA11. Reuses the 2A2 calculator re-derivation.
import { check, type Context, type State } from '../../../contracts.ts';
import type { VentureDeps } from '../../contracts.ts';
import { digest, exactPayload, findRecord, identifier, listRecords, readVenture } from '../../records.ts';
import { rederiveCaReceipt } from './stored-receipt.ts';
import type { SignoffCheckView } from './records.ts';
function receiptOf(state: State, ventureId: string, id: string) {
    const row = findRecord(state, 'venture-work-receipt', id) ?? findRecord(state, 'venture-price-receipt', id);
    return row?.ventureId === ventureId ? row : null;
}
/** Freeze complete receipt content at signing, including the receipt's own declared digest. Missing legacy references stay explicit. */
export function signoffReceiptSnapshots(state: State, ventureId: string, ids: readonly string[]) {
    return ids.map(id => { const receipt = receiptOf(state, ventureId, id); return { id, digest: receipt ? digest(receipt) : null }; });
}
/** Read the stored signature and independently re-derive every CA calculation before claiming it is unchanged. */
export async function caSignoffGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SignoffCheckView> {
    const p = exactPayload(payload, ['id'], ['id']);
    const id = identifier(p.id, 'Sign-off');
    const { state, venture } = readVenture(deps, ctx);
    const signed = listRecords(state, 'venture-ca-firm', venture.id).find(row => row.entry === 'signoff' && row.id === id);
    check(signed?.entry === 'signoff', 'SIGNOFF_NOT_FOUND', 'That stored CA sign-off was not found.');
    let differs: SignoffCheckView['differs'] = null;
    const receipts = signed.receiptDigests ?? signed.receiptIds.map(id => ({ id, digest: null }));
    if (receipts.length !== signed.receiptIds.length || receipts.some((row, index) => row.id !== signed.receiptIds[index]))
        differs = { key: 'receipts', line: 'The signed receipt list has changed.' };
    for (const snapshot of receipts) {
        if (differs)
            break;
        const receipt = receiptOf(state, venture.id, snapshot.id);
        if (!snapshot.digest || !receipt || digest(receipt) !== snapshot.digest) {
            differs = { key: snapshot.id, line: 'This receipt is missing, changed or has no digest captured at signing.' };
            break;
        }
        if (receipt.kind === 'venture-work-receipt' && receipt.operation === 'ca.engine') {
            const again = rederiveCaReceipt(receipt);
            if (again.rederived !== 'same')
                differs = { key: snapshot.id, line: again.differs?.line ?? 'This calculator receipt could not be re-derived.' };
        }
    }
    return { id: signed.id, ca: { name: signed.caName, membershipNumber: signed.membershipNumber }, at: signed.at, decision: signed.decision, playbookHash: signed.playbookHash, workingDigest: signed.workingDigest, receipts, rederived: differs ? 'differs' : 'same', differs };
}
