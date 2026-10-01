import { Platform } from 'react-native';
import { PhoneClient } from '../../../../platform/runtime/phone/client.ts';
import { CompanionController } from '../../shared/controller.ts';
import { createLiveCompanionController } from '../../shared/adapters.ts';
import type { LiveCompanionAdapters } from '../../shared/adapters.ts';
import { installPreviewCloneFallback, MemoryPreviewBriefCache, MemoryPreviewCredentials, PreviewPhoneTransport, previewIdentity, previewPicker, previewReceipts, syntheticDocumentCrypto } from '../../shared/preview.ts';

/** Native screen preview with synthetic fixtures. No real pairing, network or device key. */
export function createNativePreviewController() {
  installPreviewCloneFallback();
  const channel = Platform.OS === 'ios' ? 'ios' : 'android';
  const client = new PhoneClient({ channel, credentials: new MemoryPreviewCredentials(), cache: new MemoryPreviewBriefCache(), transport: new PreviewPhoneTransport(), crypto: syntheticDocumentCrypto });
  return new CompanionController({ client, identity: previewIdentity(channel), picker: previewPicker, receipts: previewReceipts, crypto: syntheticDocumentCrypto, mode: 'demo' });
}

/** Production host supplies protected keys/storage, picker, receipts and the wired relay transport. */
export const createNativeLiveController = (adapters: LiveCompanionAdapters) => createLiveCompanionController(adapters);
