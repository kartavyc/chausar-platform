import { PhoneClient } from '../../../platform/runtime/phone/client.ts';
import { EncryptedBriefCache } from '../../../platform/runtime/phone/cache.ts';
import { CompanionController, CompanionAdapterError } from './controller.ts';
import { openBrowserBriefStore } from './adapters.ts';
import { MemoryPreviewCredentials, PreviewPhoneTransport, previewIdentity, previewPicker, previewReceipts } from './preview.ts';

/** Loopback UI preview only. Encrypted briefs persist; synthetic session authority stays in memory. */
export async function createWebPreviewController() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) throw new CompanionAdapterError('storage');
  const store = await openBrowserBriefStore(globalThis.indexedDB, globalThis.crypto);
  const cache = new EncryptedBriefCache({ storage: store.storage, keys: store.keys, crypto: globalThis.crypto });
  const transport = new PreviewPhoneTransport({ provisionCache: store.provision });
  const client = new PhoneClient({ channel: 'web', credentials: new MemoryPreviewCredentials(), cache, transport, crypto: globalThis.crypto });
  return new CompanionController({ client, identity: previewIdentity('web'), picker: previewPicker, receipts: previewReceipts, crypto: globalThis.crypto, mode: 'demo', requestId: () => `request_${globalThis.crypto.randomUUID().replaceAll('-', '_')}` });
}
