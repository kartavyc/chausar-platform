import type { EngineModule } from './types.ts';
import * as hosted from '../hosted-link/service.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const hostedLinkModule: EngineModule = {
  id: 'hosted-link',
  hostOptions: hosted.hostOptions,
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
    'hosted.backup.upload': { permission: 'admin', external: true, handler: hosted.backupUpload },
    'hosted.backup.list': { permission: 'read', external: true, handler: hosted.backupList },
    'hosted.backup.restore': { permission: 'admin', external: true, handler: hosted.backupRestore },
    'hosted.backup.exportKey': { permission: 'admin', handler: hosted.backupExportKey },
    'hosted.allowance.status': { permission: 'read', external: true, handler: hosted.allowanceStatus },
    'hosted.worker.status': { permission: 'read', external: true, handler: hosted.workerStatus },
    'hosted.worker.set': { permission: 'admin', external: true, handler: hosted.workerSet },
    'hosted.worker.dueDates': { permission: 'admin', external: true, handler: hosted.workerDueDates },
    'hosted.worker.deleteData': { permission: 'admin', external: true, handler: hosted.workerDeleteData },
  },
  purge: (state, reason) => hosted.purgeOffers(state, reason),
  tick: (ctx, host) => hosted.tickCollect(ctx, host),
};
