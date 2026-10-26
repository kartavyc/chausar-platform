// Keeping a business's vault key on this computer, automatic backups, and moving a business.
// Types, method names and fixed words only, so renderer tests can import it.
// Design: .b2c-work/KEYCHAIN-SPEC.md sections 2 to 10. Engine code: device-custody.ts, workspace-custody.ts, engine.ts.
export type IsoTime = string;
export type DeviceScheme = 'windows-dpapi' | 'macos-keychain' | 'linux-secret-service' | 'electron-safe-storage' | 'memory';
export type DeviceUnavailableReason = 'not-configured' | 'platform' | 'blocked' | 'no-keyring' | 'locked' | 'failed';
export type UnlockMode = 'this-computer' | 'passphrase';
export type RecoveryState = 'made' | 'not-made' | 'unknown';
export type BackupKind = 'auto' | 'manual' | 'safety';

export const CUSTODY_METHODS = Object.freeze([
  'workspace.custody.get', 'workspace.list', 'workspace.backups.list', 'workspace.transfer.import',
  'workspace.custody.passphraseOn', 'workspace.custody.passphraseOff', 'workspace.custody.recoveryCode',
  'workspace.backups.create', 'workspace.backups.restore', 'workspace.transfer.export',
  // Ink v2 wave 4 (4J6): the owner starts a new never-contact list once the old one can no longer be checked.
  'workspace.custody.neverContactReset',
] as const);
export type CustodyMethod = typeof CUSTODY_METHODS[number];
/** Answered before the vault check; they also answer with a vault open. */
export const CUSTODY_PRE_VAULT_METHODS: readonly CustodyMethod[] = Object.freeze(['workspace.custody.get', 'workspace.list', 'workspace.backups.list', 'workspace.transfer.import']);
/** The owner, in the app (desktop channel, untainted), with a vault open. */
export const CUSTODY_APP_ONLY_METHODS: readonly CustodyMethod[] = Object.freeze(['workspace.custody.passphraseOn', 'workspace.custody.passphraseOff', 'workspace.custody.recoveryCode', 'workspace.backups.create', 'workspace.backups.restore', 'workspace.transfer.export', 'workspace.custody.neverContactReset']);
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
  backups: { auto: boolean; count: number; newestAt: IsoTime | null; nextDueAt: IsoTime | null; lastError: string | null };
};
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
  'workspace.transfer.export': { passphrase?: string };
  /** confirmation: the open business's name, typed by the owner. */
  'workspace.custody.neverContactReset': { confirmation: string };
};
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
  'workspace.transfer.export': { fileName: string; text: string; transferCode: string; bytes: number };
  'workspace.custody.neverContactReset': { line: string };
};

export const CUSTODY_ERRORS = Object.freeze([
  'DEVICE_KEYS_UNAVAILABLE', 'DEVICE_KEY_FAILED', 'PASSPHRASE_REQUIRED', 'PASSPHRASE_WRONG', 'CUSTODY_UNCHANGED',
  'TRANSFER_CODE_WRONG', 'TRANSFER_INVALID', 'TRANSFER_TOO_LARGE', 'TRANSFER_SAME_BUSINESS',
  'BACKUP_NOT_FOUND', 'BACKUP_OTHER_BUSINESS', 'SYNC_NEEDS_PASSPHRASE',
  /** Its words are CUSTODY_WORDS.lock.safetyBackupFailed. */
  'SAFETY_BACKUP_FAILED',
  /** 4J6: the never-contact list can't be checked (NEVER_CONTACT_LOST), or still checks so there is nothing to reset. */
  'NEVER_CONTACT_LOST', 'NEVER_CONTACT_OK',
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
    BACKUP_NOT_FOUND: 'That backup is not in the backups folder.',
    BACKUP_OTHER_BUSINESS: 'This backup belongs to another business.',
    SYNC_NEEDS_PASSPHRASE: 'Device sync needs a business locked with a passphrase.',
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
