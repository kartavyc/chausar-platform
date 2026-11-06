

import { resolve } from 'node:path';

import { WorkspaceBackupV2Host } from '../workspace-backup-v2.ts';

import { EngineWorkspaceActivation } from '../workspace-activation-engine.ts';

import { check } from '../contracts.ts';

import { withVault, type Handler } from './admission.ts';
export const METHODS: Record<string, Handler> = {

"workspace.custody.get": async (internals, payload) => {
const method = "workspace.custody.get";
return internals.custodyView();
},
"workspace.backups.list": async (internals, payload) => {
const method = "workspace.backups.list";
return internals.backupList();
},
"workspace.transfer.import": async (internals, payload) => {
const method = "workspace.transfer.import";
return internals.privateOneStep('move-in', 'move', () => internals.transferImport(payload));
},
"workspace.transfer.peek": async (internals, payload) => {
const method = "workspace.transfer.peek";
return internals.transferPeek(payload);
},
"workspace.custody.passphraseOn": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.custody.passphraseOn";
internals.requireAppOwner(ctx);
return internals.custodySerial(() => internals.passphraseOn(payload));
}),
"workspace.custody.passphraseOff": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.custody.passphraseOff";
internals.requireAppOwner(ctx);
return internals.custodySerial(() => internals.passphraseOff(payload));
}),
"workspace.custody.recoveryCode": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.custody.recoveryCode";
internals.requireAppOwner(ctx);
return internals.custodySerial(() => internals.makeRecoveryCode(payload));
}),
"workspace.custody.neverContactReset": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.custody.neverContactReset";
internals.requireAppOwner(ctx);
return internals.custodySerial(() => internals.neverContactReset(payload));
}),
"workspace.backups.create": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backups.create";
internals.requireAppOwner(ctx);
return internals.custodySerial(() => internals.writeBackup('manual'));
}),
"workspace.backups.restore": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backups.restore";
internals.requireAppOwner(ctx);
return internals.privateOneStep('restore', 'restore', () => internals.custodySerial(() => internals.restoreManagedBackup(payload)));
}),
"workspace.backups.copyTo": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backups.copyTo";
internals.requireAppOwner(ctx);
return internals.custodySerial(() => internals.backupCopyTo(payload));
}),
"workspace.backups.drive.status": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backups.drive.status";
internals.requireAppOwner(ctx);
return internals.driveStatus();
}),
"workspace.backups.drive.connect": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backups.drive.connect";
internals.requireAppOwner(ctx);
return internals.driveOf().connect();
}),
"workspace.backups.drive.disconnect": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backups.drive.disconnect";
internals.requireAppOwner(ctx);
await internals.driveOf().disconnect();
return internals.custodySerial(() => internals.driveNote(null).then(() => internals.driveStatus()));
}),
"workspace.backups.inspect": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backups.inspect";
internals.requireAppOwner(ctx);
return internals.custodySerial(() => internals.inspectManagedBackup(payload));
}),
"workspace.transfer.export": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.transfer.export";
internals.requireAppOwner(ctx);
return internals.custodySerial(() => internals.transferExport(payload));
}),
"workspace.backup.v2.create": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backup.v2.create";
return internals.backupHost().create(ctx, internals.journalPayload(payload,
        ['destinationId', 'confirmed'], ['destinationId', 'confirmed'], 'INVALID_BACKUP_REQUEST') as Parameters<WorkspaceBackupV2Host['create']>[1]);
}),
"workspace.backup.v2.read": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backup.v2.read";
return internals.backupHost().read(ctx, internals.journalPayload(payload,
        ['backupId'], ['backupId'], 'INVALID_BACKUP_REQUEST') as Parameters<WorkspaceBackupV2Host['read']>[1]);
}),
"workspace.backup.v2.restoreInert": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backup.v2.restoreInert";
{
        const input = internals.journalPayload(payload, ['backupId', 'targetId', 'reviewedDigest', 'confirmed'],
          ['backupId', 'targetId', 'reviewedDigest', 'confirmed'], 'INVALID_BACKUP_REQUEST');
        check(input.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the exact reviewed archive and separate closed copy.');
        return internals.backupHost().restoreInert(ctx, { backupId: input.backupId as string, targetId: input.targetId as string, reviewedDigest: input.reviewedDigest as string });
      }
}),
"workspace.backup.v2.readRestored": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backup.v2.readRestored";
return internals.backupHost().readRestored(ctx, internals.journalPayload(payload,
        ['backupId', 'targetId', 'creationId', 'reviewedDigest'], ['backupId', 'targetId', 'creationId', 'reviewedDigest'], 'INVALID_BACKUP_REQUEST') as Parameters<WorkspaceBackupV2Host['readRestored']>[1]);
}),
"workspace.backup.v2.inspectRestored": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backup.v2.inspectRestored";
{
        const input = internals.journalPayload(payload, ['backupId', 'targetId', 'reviewedDigest'],
          ['backupId', 'targetId', 'reviewedDigest'], 'INVALID_BACKUP_REQUEST');
        const host = internals.backupHost(); const reviewed = await host.read(ctx, { backupId: input.backupId as string });
        check(input.reviewedDigest === reviewed.summary.archiveDigest, 'BACKUP_REVIEW_CHANGED', 'This backup changed since you looked. Look at it again before restoring.');
        const identity = await s.backupLocal.restoredIdentity(ctx, input.targetId);
        check(identity.archiveDigest === reviewed.summary.archiveDigest, 'BACKUP_TARGET_CHANGED', 'The reserved copy belongs to a different archive.');
        return host.readRestored(ctx, { backupId: input.backupId as string, targetId: identity.targetId,
          creationId: identity.creationId, reviewedDigest: reviewed.summary.archiveDigest });
      }
}),
"workspace.backup.v2.diagnostics": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backup.v2.diagnostics";
{
        internals.journalPayload(payload, [], [], 'INVALID_BACKUP_REQUEST'); internals.backupHost(); internals.backupCompleteOwner(ctx, store.read());
        return s.backupLocal.diagnostics();
      }
}),
"workspace.activation.target.create": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.activation.target.create";
{
        const input = internals.journalPayload(payload, ['targetId', 'confirmed'], ['targetId', 'confirmed'], 'INVALID_ACTIVATION_REQUEST');
        check(input.confirmed === true && typeof input.targetId === 'string', 'CONFIRMATION_REQUIRED', 'Confirm a new empty managed activation target.');
        return internals.activationHost().createTarget(ctx, input.targetId);
      }
}),
"workspace.activation.target.get": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.activation.target.get";
return internals.activationHost().inspectTarget(ctx,
        internals.journalPayload(payload, ['targetId'], ['targetId'], 'INVALID_ACTIVATION_REQUEST').targetId as string);
}),
"workspace.backup.activation.prepare": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backup.activation.prepare";
return internals.activationHost().bridge.prepare(ctx, internals.journalPayload(payload,
        ['backupId', 'materialId', 'inertTargetId', 'inertCreationId', 'candidateId', 'targetId', 'reviewedArchiveDigest', 'confirmed'],
        ['backupId', 'materialId', 'inertTargetId', 'inertCreationId', 'candidateId', 'targetId', 'reviewedArchiveDigest', 'confirmed'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['bridge']['prepare']>[1]);
}),
"workspace.backup.activation.inspect": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.backup.activation.inspect";
return (await internals.activationHost().bridge.inspect(ctx,
        internals.journalPayload(payload, ['candidateId'], ['candidateId'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['bridge']['inspect']>[1])).review;
}),
"workspace.activation.review": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.activation.review";
return internals.activationHost().activation.review(ctx, internals.journalPayload(payload,
        ['candidateId', 'reviewedDigest'], ['candidateId', 'reviewedDigest'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['activation']['review']>[1]);
}),
"workspace.activation.execute": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.activation.execute";
return internals.activationHost().activation.activate(ctx, internals.journalPayload(payload,
        ['candidateId', 'reviewedDigest', 'projectionDigest', 'activationId', 'confirmed'],
        ['candidateId', 'reviewedDigest', 'projectionDigest', 'activationId', 'confirmed'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['activation']['activate']>[1]);
}),
"workspace.activation.get": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.activation.get";
return internals.activationHost().activation.resolve(ctx, internals.journalPayload(payload,
        ['activationId'], ['activationId'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['activation']['resolve']>[1]);
}),
"workspace.interchange.export": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.interchange.export";
return s.interchange.export(ctx, internals.journalPayload(payload,
        ['destinationId', 'confirmed'], ['destinationId', 'confirmed'], 'INVALID_INTERCHANGE_REQUEST'));
}),
"workspace.interchange.prepare": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.interchange.prepare";
return s.interchange.prepare(ctx, internals.journalPayload(payload,
        ['exportId', 'candidateId', 'targetId'], ['exportId', 'candidateId', 'targetId'], 'INVALID_INTERCHANGE_REQUEST'));
}),
"workspace.interchange.review": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.interchange.review";
return s.interchange.review(ctx, internals.journalPayload(payload,
        ['candidateId', 'reviewedDigest'], ['candidateId', 'reviewedDigest'], 'INVALID_INTERCHANGE_REQUEST'));
}),
"workspace.interchange.discard": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.interchange.discard";
return s.interchange.discard(ctx, internals.journalPayload(payload,
        ['recordId', 'reviewedDigest'], ['recordId', 'reviewedDigest'], 'INVALID_INTERCHANGE_REQUEST'));
}),
"workspace.interchange.diagnostics": withVault(async (internals, payload, store, ctx, s) => {
const method = "workspace.interchange.diagnostics";
{
        internals.journalPayload(payload, [], [], 'INVALID_INTERCHANGE_REQUEST'); internals.interchangeOwner(ctx, store.read());
        return s.interchangeLocal.diagnostics();
      }
})
};
