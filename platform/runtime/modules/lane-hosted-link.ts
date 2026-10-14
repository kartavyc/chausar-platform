import type { EngineModule } from './types.ts';
import * as hosted from '../hosted-link/service.ts';
import * as drive from '../hosted-link/drive-sync.ts';
import * as documents from '../hosted-link/documents.ts';
import { allowanceCredential, allowanceRevoke } from '../hosted-link/allowance-credential.ts';
import * as extras from '../hosted-link/relay-extras.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const hostedLinkModule: EngineModule = {
  id: 'hosted-link',
  hostOptions: input => ({ ...hosted.hostOptions(input), ...drive.driveHostOptions(input) }),
  methods: {
    'hosted.status': { permission: 'read', handler: hosted.status },
    'hosted.pair.start': { permission: 'admin', external: true, handler: hosted.pairStart },
    'hosted.pair.finish': { permission: 'admin', external: true, handler: hosted.pairFinish },
    'hosted.unpair': { permission: 'admin', handler: hosted.unpair },
    'hosted.account.refresh': { permission: 'read', external: true, handler: hosted.accountRefresh },
    'phone.channels.list': { permission: 'read', handler: hosted.channelsList },
    'phone.channels.set': { permission: 'admin', external: true, handler: hosted.channelsSet },
    'phone.templates.preview': { permission: 'read', handler: hosted.templatesPreview },
    'phone.messages.counts': { permission: 'read', external: true, handler: hosted.messageCounts },
    'phone.messages.send': { permission: 'admin', external: true, handler: hosted.messageSend },
    'phone.relay.collect': { permission: 'admin', external: true, handler: hosted.relayCollect },
    'phone.verify': { permission: 'read', external: true, handler: extras.phoneVerify },
    'hosted.messageStatuses': { permission: 'read', external: true, handler: extras.messageStatuses },
    'hosted.businessHook.set': { permission: 'admin', external: true, handler: extras.businessHookSet },
    'hosted.backup.upload': { permission: 'admin', external: true, handler: hosted.backupUpload },
    'hosted.backup.list': { permission: 'read', external: true, handler: hosted.backupList },
    'hosted.backup.restore': { permission: 'admin', external: true, handler: hosted.backupRestore },
    'hosted.backup.exportKey': { permission: 'admin', handler: hosted.backupExportKey },
    'hosted.allowance.status': { permission: 'read', external: true, handler: hosted.allowanceStatus },
    'hosted.allowanceCredential': { permission: 'admin', external: true, handler: allowanceCredential },
    'hosted.allowanceRevoke': { permission: 'admin', external: true, handler: allowanceRevoke },
    'hosted.worker.status': { permission: 'read', external: true, handler: hosted.workerStatus },
    'hosted.worker.set': { permission: 'admin', external: true, handler: hosted.workerSet },
    'hosted.worker.dueDates': { permission: 'admin', external: true, handler: hosted.workerDueDates },
    'hosted.worker.deleteData': { permission: 'admin', external: true, handler: hosted.workerDeleteData },
    'hosted.drive.connect': { permission: 'admin', external: true, handler: drive.driveConnect },
    'hosted.drive.status': { permission: 'read', handler: drive.driveStatus },
    'hosted.drive.disconnect': { permission: 'admin', handler: drive.driveDisconnect },
    'phone.documents.register': { permission: 'admin', external: true, handler: documents.documentsRegister },
    'phone.documents.collect': { permission: 'admin', external: true, handler: documents.documentsCollect },
    'phone.documents.list': { permission: 'read', handler: documents.documentsList },
    'phone.documents.preview': { permission: 'admin', handler: documents.documentsPreview },
    'phone.documents.discard': { permission: 'admin', handler: documents.documentsDiscard },
  },
  purge: (state, reason) => hosted.purgeOffers(state, reason) + documents.purgeDocuments(state, reason),
  tick: async (ctx, host) => {
    try { drive.reattach(host, ctx); } catch { /* the next status call reports it */ }
    return [...await documents.tickDocuments(ctx, host), ...await hosted.tickCollect(ctx, host)];
  },
};
