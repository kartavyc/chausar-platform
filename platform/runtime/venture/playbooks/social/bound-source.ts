// Original Chausar source binding, independent of delivery orchestration.
import { check, type State } from '../../../contracts.ts';
import type { OrderRecord, VentureRecord } from '../../contracts.ts';
import { listRecords } from '../../records.ts';
import { socialSourceText } from './source-text.ts';
export function boundSocialSource(state: State, venture: VentureRecord, order: OrderRecord): string {
    const upload = listRecords(state, 'venture-upload', venture.id).find(file => file.id === order.intake?.fields?.sourceFile);
    check(upload && (upload.scope.kind === 'order' || upload.scope.kind === 'media') && upload.scope.orderId === order.id && upload.contentBase64, 'UPLOAD_NOT_FOUND', 'Add the source transcript to this order.');
    return socialSourceText(upload.format, Buffer.from(upload.contentBase64, 'base64').toString('utf8'));
}
