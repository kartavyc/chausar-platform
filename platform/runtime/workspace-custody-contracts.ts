// Keeping a business's vault key on this computer, automatic backups, and moving a business.
// Types, method names and fixed words only, so renderer tests can import it.
// Design: .b2c-work/KEYCHAIN-SPEC.md sections 2 to 10. Engine code: device-custody.ts, workspace-custody.ts, engine.ts.
export type IsoTime = string;
export type DeviceScheme = 'windows-dpapi' | 'macos-keychain' | 'linux-secret-service' | 'electron-safe-storage' | 'memory';
export type DeviceUnavailableReason = 'not-configured' | 'platform' | 'blocked' | 'no-keyring' | 'locked' | 'failed';
export type UnlockMode = 'this-computer' | 'passphrase';
export type RecoveryState = 'made' | 'not-made' | 'unknown';
/** D12: 'migration' is the file as it was before the ladder moved it, 'rollback-kept' the newer data kept by a rollback. Neither rotates. */
export type BackupKind = 'auto' | 'manual' | 'safety' | 'migration' | 'rollback-kept';

export const CUSTODY_METHODS = Object.freeze([
  'workspace.custody.get', 'workspace.list', 'workspace.backups.list', 'workspace.transfer.import',
  'workspace.custody.passphraseOn', 'workspace.custody.passphraseOff', 'workspace.custody.recoveryCode',
  'workspace.backups.create', 'workspace.backups.restore', 'workspace.transfer.export',
  // Ink v2 wave 4 (4J6): the owner starts a new never-contact list once the old one can no longer be checked.
  'workspace.custody.neverContactReset',
  // One-shot C4 task 38: the business name and day inside a move file, read with its code, before moving it here.
  'workspace.transfer.peek',
  // C5 task 24: Google Drive, built up to the OAuth client.
  'workspace.backups.drive.status', 'workspace.backups.drive.connect', 'workspace.backups.drive.disconnect',
  // One-shot C6: what a backup of the open business holds and what restoring it would take back (read only).
  'workspace.backups.inspect',
] as const);
export type CustodyMethod = typeof CUSTODY_METHODS[number];
/**
 * C5 tasks 21, 23: these name a path on this computer, so only the desktop's main process asks them, after its own file
 * or folder pick. They are in neither the window's allowlist nor the server's: a window can never name a path.
 */
export const CUSTODY_MAIN_ONLY_METHODS = Object.freeze(['workspace.import', 'workspace.backups.copyTo'] as const);
/** Answered before the vault check; they also answer with a vault open. */
export const CUSTODY_PRE_VAULT_METHODS: readonly CustodyMethod[] = Object.freeze(['workspace.custody.get', 'workspace.list', 'workspace.backups.list', 'workspace.transfer.import', 'workspace.transfer.peek']);
/** The owner, in the app (desktop channel, untainted), with a vault open. */
export const CUSTODY_APP_ONLY_METHODS: readonly CustodyMethod[] = Object.freeze(['workspace.custody.passphraseOn', 'workspace.custody.passphraseOff', 'workspace.custody.recoveryCode', 'workspace.backups.create', 'workspace.backups.restore', 'workspace.transfer.export', 'workspace.custody.neverContactReset', 'workspace.backups.drive.status', 'workspace.backups.drive.connect', 'workspace.backups.drive.disconnect', 'workspace.backups.inspect']);
/** These change which vault is open or replace its state: engine transitions. */
export const CUSTODY_TRANSITION_METHODS: readonly CustodyMethod[] = Object.freeze(['workspace.transfer.import', 'workspace.backups.restore']);
/** After one of these succeeds, an automatic backup is due at the next tick. */
export const BACKUP_AFTER_METHODS: readonly string[] = Object.freeze([
  'venture.create', 'venture.blueprint.accept', 'venture.blueprint.update', 'venture.invoice.issue', 'venture.payment.record',
  'venture.order.create', 'venture.order.deliver', 'venture.client.add', 'venture.models.connect', 'venture.build.link',
  'trust.update', 'members.add', 'members.revoke', 'sources.import', 'ontology.publish',
]);
export const AUTO_BACKUP = Object.freeze({ everyMs: 21_600_000, minGapMs: 120_000, keepRecent: 10, keepDailyDays: 14, keepWeeklyWeeks: 8, keepSafety: 5 });
export const TRANSFER = Object.freeze({ prefix: 'CHT-', length: 24, alphabet: '0123456789ABCDEFGHJKMNPQRSTVWXYZ', maxTextChars: 1_900_000 });
/**
 * A4 review (L3, hands-on row 113): a move file's name, by this computer's own date (never the UTC day). One-shot C4
 * task 38 (218.d1): its own extension, .chausar-move; a move file an older Chausar named .backup still opens (the
 * import reads the text, never the name).
 */
export const MOVE_EXTENSION = '.chausar-move';
export function moveFileName(at: Date): string {
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return `chausar-move-${day}${MOVE_EXTENSION}`;
}
const EXPORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * One-shot C4 task 36 (206.w1): the name an export of the whole business is offered under in the save dialog, from the
 * business's name and the day where the owner is: "Pune Frames, 3 Nov 2026.vault" (.json for a readable copy). Letters
 * a file name can't hold become spaces; an empty name reads "Chausar business".
 */
export function exportFileName(business: string, at: Date, timeZone: string, plaintext: boolean): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at).map(part => [part.type, part.value]));
  const name = business.replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Chausar business';
  return `${name}, ${Number(parts.day)} ${EXPORT_MONTHS[Number(parts.month) - 1]} ${parts.year}.${plaintext ? 'json' : 'vault'}`;
}
export const BUSINESS_LIST_MAX = 50;
export const BACKUP_LIST_MAX = 200;

export type ComputerCustodyView = {
  available: boolean;
  scheme: DeviceScheme | null;
  reason: DeviceUnavailableReason | null;
  /** True only when a real protect and unprotect round trip ran in this engine process. */
  checked: boolean;
  where: string;        // CUSTODY_WORDS.where[scheme], or the unavailable words
  loss: string | null;  // CUSTODY_WORDS.loss[scheme]
};
export type BusinessCustodyView = {
  folder: string;
  unlock: UnlockMode;
  recovery: RecoveryState;
  storage: 'experimental-file' | 'postgres';
  backups: { auto: boolean; count: number; newestAt: IsoTime | null; nextDueAt: IsoTime | null; lastError: string | null; copy: BackupCopyView | null };
  /** C4 task 36: the name the save dialog offers for an encrypted export today (exportFileName). */
  exportName?: string;
  /** C4 task 37: how many exports of this business are in Chausar's own exports folder (Delete keeps them). */
  exportsHere?: number;
  /** C4 task 38 (219.x1): when a move file was made, until the owner dismisses the line; null when none waits. */
  moveMadeAt?: IsoTime | null;
  /** C5 task 19: how big the business is, and the most it can be: past that a save is refused. */
  storeBytes: number; storeLimit: number;
};
/** C5 task 23: the drive or folder backups are copied to. folderName only: the window never holds a path. problem: in the owner's words. */
export type BackupCopyView = { folderName: string; lastCopiedAt: IsoTime | null; problem: string | null };
export type CustodyView = { computer: ComputerCustodyView; business: BusinessCustodyView | null };
export type BusinessOnComputer = {
  folder: string; name: string | null; demo: boolean | null; unlock: UnlockMode;
  opens: 'with-this-computer' | 'needs-passphrase' | 'key-missing';
  recovery: RecoveryState; openedAt: IsoTime | null; listedFrom: 'card' | 'folder';
};
export type BusinessList = { businesses: BusinessOnComputer[]; complete: boolean };
export type BackupView = {
  file: string;            // the name inside backups/, never a path
  kind: BackupKind; at: IsoTime; revision: number; bytes: number;
  name: string | null;     // from the card of the same vault id
  opensNow: boolean;       // its wrappers equal the business's current ones
  /** D12: the data version this computer noted when the file was written (custody/data-versions.json); absent when not noted, never a guess. */
  dataVersion?: number;
  /** D12: saved by a newer Chausar than this one, so it can't open here. */
  needsNewer?: true;
  /** C5 task 20: what came just before it, while the business is open. Worked out on reading, never written outside the vault. */
  after?: string;
};

/**
 * One-shot C6: what a backup of the open business holds (`counts`, the backup's own) and what changed since it was made
 * (`since`: restoring takes these back). Kinds and words come from venture/views/backup-diff.ts BACKUP_KIND_WORDS.
 */
export type BackupInspectView = {
  file: string; at: IsoTime;
  counts: { kind: string; words: string; count: number }[];
  since: { kind: string; words: string; added: number; changed: number; removed: number }[];
};

export type WorkspaceCreatePayload = { name: string; pack?: string; demo?: boolean; passphrase?: string; folder?: string | null };
export type WorkspaceCreateResult = { workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string };
  folder: string; unlock: UnlockMode; recoveryCode: string | null; recoveryKit: string | null; experimental: boolean };
export type WorkspaceOpenPayload = { folder?: string; path?: string; passphrase?: string };
export type WorkspaceRecoverPayload = { folder: string; recoveryCode: string; passphrase?: string };
export type WorkspaceRestorePayload = { backupFile: string; folder?: string | null; passphrase?: string; recoveryCode?: string };
export type WorkspaceStatusAdditions = { unlock?: UnlockMode; closedByOwner?: boolean };

export type CustodyPayloads = {
  'workspace.custody.get': Record<string, never>;
  'workspace.list': Record<string, never>;
  'workspace.backups.list': Record<string, never>;
  'workspace.transfer.import': { fileText: string; transferCode: string; passphrase?: string };
  'workspace.custody.passphraseOn': { passphrase: string };
  'workspace.custody.passphraseOff': { passphrase: string };
  'workspace.custody.recoveryCode': { passphrase?: string };
  'workspace.backups.create': Record<string, never>;
  'workspace.backups.restore': { file: string; confirmed: true };
  /** dismiss (C4 task 38): takes away the "Move file made" line; nothing else changes. */
  'workspace.transfer.export': { passphrase?: string } | { dismiss: true };
  'workspace.transfer.peek': { fileText: string; transferCode: string };
  /** confirmation: the open business's name, typed by the owner. */
  'workspace.custody.neverContactReset': { confirmation: string };
  'workspace.backups.drive.status': Record<string, never>;
  'workspace.backups.drive.connect': Record<string, never>;
  'workspace.backups.drive.disconnect': Record<string, never>;
  'workspace.backups.inspect': { file: string };
};
export type DriveStatus = { state: 'not-connected' | 'connecting' | 'connected'; lastCopiedAt: IsoTime | null; problem: string | null };
export type CopyImportPayload = { file: string; passphrase?: string; recoveryCode?: string; restore?: boolean };
export type CopyImportResult = { workspace: WorkspaceCreateResult['workspace']; folder: string; unlock: UnlockMode; restored?: boolean };
export type CustodyResults = {
  'workspace.custody.get': CustodyView;
  'workspace.list': BusinessList;
  'workspace.backups.list': { backups: BackupView[]; more: boolean };
  'workspace.transfer.import': { workspace: WorkspaceCreateResult['workspace']; folder: string; unlock: UnlockMode };
  'workspace.custody.passphraseOn': { custody: CustodyView; recoveryCode: string | null };
  'workspace.custody.passphraseOff': { custody: CustodyView };
  'workspace.custody.recoveryCode': { custody: CustodyView; recoveryCode: string };
  'workspace.backups.create': BackupView;
  'workspace.backups.restore': { workspace: WorkspaceCreateResult['workspace']; restoredFrom: BackupView; safety: BackupView };
  'workspace.transfer.export': { fileName: string; text: string; transferCode: string; bytes: number } | { dismissed: true };
  'workspace.transfer.peek': { name: string; movedOutAt: IsoTime | null };
  'workspace.custody.neverContactReset': { line: string };
  'workspace.backups.drive.status': DriveStatus;
  'workspace.backups.drive.connect': { state: 'connecting'; url: string };
  'workspace.backups.drive.disconnect': DriveStatus;
  'workspace.backups.inspect': BackupInspectView;
};

export const CUSTODY_ERRORS = Object.freeze([
  'DEVICE_KEYS_UNAVAILABLE', 'DEVICE_KEY_FAILED', 'PASSPHRASE_REQUIRED', 'PASSPHRASE_WRONG', 'CUSTODY_UNCHANGED',
  'TRANSFER_CODE_WRONG', 'TRANSFER_INVALID', 'TRANSFER_TOO_LARGE', 'TRANSFER_SAME_BUSINESS', 'TRANSFER_FAILED',
  'BACKUP_NOT_FOUND', 'BACKUP_OTHER_BUSINESS', 'SYNC_NEEDS_PASSPHRASE',
  /** Its words are CUSTODY_WORDS.lock.safetyBackupFailed. */
  'SAFETY_BACKUP_FAILED',
  /** 4J6: the never-contact list can't be checked (NEVER_CONTACT_LOST), or still checks so there is nothing to reset. */
  'NEVER_CONTACT_LOST', 'NEVER_CONTACT_OK',
  /** C5 task 21: an exported copy that can't come in as asked. */
  'IMPORT_READABLE', 'IMPORT_INVALID', 'IMPORT_ALREADY_HERE', 'IMPORT_CLOSE_FIRST',
  /** C5 task 24. */
  'DRIVE_NOT_SET_UP', 'DRIVE_RECONNECT',
] as const);

/** DEVICE_KEYS_UNAVAILABLE carries CUSTODY_WORDS.unavailable[reason] as its message and `reason` on the error.
 * Over the desktop IPC only the code and message travel, so the renderer can find the reason by its words. */
export const CUSTODY_WORDS = Object.freeze({
  where: Object.freeze({
    'windows-dpapi': 'Windows keeps the key for your login on this computer.',
    'macos-keychain': 'Your Mac keeps the key in your login keychain.',
    'linux-secret-service': 'Your desktop keyring keeps the key for your login.',
    'electron-safe-storage': 'The Chausar app keeps the key with your computer login.',
    memory: 'A test keeps the key in memory.',
  }),
  loss: Object.freeze({
    'windows-dpapi': 'Reinstalling Windows, or a password reset by someone else, can lose the key.',
    'macos-keychain': 'Erasing your Mac, or resetting its login keychain, can lose the key.',
    'linux-secret-service': 'Resetting your keyring, or reinstalling, can lose the key.',
    'electron-safe-storage': 'Reinstalling, or resetting your login, can lose the key.',
    memory: 'Stopping the test loses the key.',
  }),
  unavailable: Object.freeze({
    'not-configured': 'This app keeps businesses with a passphrase.',
    platform: "Chausar can't keep the key safe on this kind of computer, so it asks for a passphrase.",
    blocked: "Windows wouldn't let Chausar use its protected storage here, so Chausar asks for a passphrase.",
    'no-keyring': 'This computer has no keyring Chausar can use, so Chausar asks for a passphrase.',
    locked: 'Your keychain is locked or not open to Chausar, so Chausar asks for a passphrase.',
    failed: "This computer's protected storage didn't answer, so Chausar asks for a passphrase.",
  }),
  errors: Object.freeze({
    PASSPHRASE_REQUIRED: 'This business is locked with a passphrase. Type it to open.',
    DEVICE_KEY_FAILED: "This computer's key didn't open your business. Use your recovery code, or a backup with it.",
    PASSPHRASE_WRONG: "That passphrase doesn't match.",
    CUSTODY_UNCHANGED: "It's already set that way.",
    TRANSFER_CODE_WRONG: "That code doesn't open this file. Check it and try again.",
    TRANSFER_INVALID: "This isn't a Chausar move file.",
    TRANSFER_TOO_LARGE: 'This file is bigger than Chausar can take in one go.',
    TRANSFER_SAME_BUSINESS: 'This business is already on this computer. Open it from the list.',
    TRANSFER_FAILED: "Chausar couldn't finish moving your business here, so nothing was kept. Try again.",
    BACKUP_NOT_FOUND: 'That backup is not in the backups folder.',
    BACKUP_OTHER_BUSINESS: 'This backup belongs to another business.',
    SYNC_NEEDS_PASSPHRASE: 'Device sync needs a business locked with a passphrase.',
    IMPORT_READABLE: "A readable copy can't come back in, since anyone could have changed it. Use the encrypted copy.",
    IMPORT_INVALID: "This isn't a Chausar copy, or part of it has changed.",
    IMPORT_ALREADY_HERE: 'This business is already on this computer. Restore it from this copy instead?',
    IMPORT_CLOSE_FIRST: 'This copy is of another business. Close this one first, then open the copy from the list of businesses.',
    IMPORT_NEEDS_SECRET: 'This copy opens with its passphrase or its recovery code.',
    DRIVE_NOT_SET_UP: "Google Drive needs Chausar's Google sign-in set up first. Until then, pick your Google Drive folder under Keep a copy on a drive.",
    DRIVE_RECONNECT: 'Connect Google Drive again.',
  }),
  /** C5 task 23: why the last copy didn't reach the drive or folder. */
  copy: Object.freeze({
    missing: "The drive isn't plugged in. The next copy goes when it is.",
    denied: "Chausar can't write to that folder. Pick another one.",
    full: 'That drive is full. The next copy goes when it has room.',
    failed: "The last copy didn't reach that folder. Chausar tries again at the next tick.",
  }),
  /** Words for changing the lock and for opening, beside the errors above. */
  lock: Object.freeze({
    /** DEVICE_KEY_FAILED when opening a this-computer business and the computer's protected storage didn't answer. */
    keyNotAnswering: "This computer's protected storage didn't answer. Try again, or use your recovery code.",
    /** SAFETY_BACKUP_FAILED: a lock change with no recovery code yet needs its safety copy first. */
    safetyBackupFailed: "Chausar couldn't save a copy of your business first, so nothing changed. Make a recovery code, then try again.",
    /** Show before turning the passphrase on while `recovery` is 'not-made'. A recovery code made now doesn't open older copies. */
    outsideCopies: 'Copies you saved outside Chausar before now will stop opening after this change. Chausar updates the copies in its own backups and exports folders.',
  }),
});
