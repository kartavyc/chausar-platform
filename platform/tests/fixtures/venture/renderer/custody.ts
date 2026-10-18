// Sample custody results for the renderer tests (keychain custody, the renderer package). A synthetic recording:
// written by hand against platform/runtime/workspace-custody-contracts.ts, never captured from a live engine, and
// holding no real secret. The codes below only have the shape of the engine's codes.
import type {
  BackupView, BusinessList, BusinessOnComputer, ComputerCustodyView, CustodyView, DeviceUnavailableReason, UnlockMode,
} from '../../../../runtime/workspace-custody-contracts.ts';
import { CUSTODY_WORDS } from '../../../../runtime/workspace-custody-contracts.ts';

export const RECOVERY_CODE = 'CHR-Synthetic0recovery0code0for0tests0only0AaBb';
export const MOVE_CODE = 'CHT-0123456789ABCDEFGHJKMNPQ';
export const MOVE_TEXT = '{"backupFormat":"chausar.backup.v1","synthetic":true}';

export const computerWindows: ComputerCustodyView = {
  available: true, scheme: 'windows-dpapi', reason: null, checked: true,
  where: CUSTODY_WORDS.where['windows-dpapi'], loss: CUSTODY_WORDS.loss['windows-dpapi'],
};
export function computerUnavailable(reason: DeviceUnavailableReason): ComputerCustodyView {
  return { available: false, scheme: null, reason, checked: false, where: CUSTODY_WORDS.unavailable[reason], loss: null };
}
export function custodyView(options: { unlock?: UnlockMode; recovery?: 'made' | 'not-made' | 'unknown'; computer?: ComputerCustodyView; open?: boolean; lastError?: string | null; storage?: 'experimental-file' | 'postgres' } = {}): CustodyView {
  const computer = options.computer ?? computerWindows;
  if (options.open === false) return { computer, business: null };
  return {
    computer,
    business: {
      folder: 'leeds-shift-walkers', unlock: options.unlock ?? 'this-computer', recovery: options.recovery ?? 'made', storage: options.storage ?? 'experimental-file',
      backups: { auto: true, count: 3, newestAt: '2026-10-18T09:30:00.000Z', nextDueAt: '2026-10-18T15:30:00.000Z', lastError: options.lastError ?? null },
    },
  };
}

export const leeds: BusinessOnComputer = {
  folder: 'leeds-shift-walkers', name: 'Leeds Shift Walkers', demo: false, unlock: 'this-computer', opens: 'with-this-computer',
  recovery: 'not-made', openedAt: '2026-10-18T09:30:00.000Z', listedFrom: 'card',
};
export const ledger: BusinessOnComputer = {
  folder: 'ledger-cafe-books', name: 'Ledger Cafe Books', demo: false, unlock: 'passphrase', opens: 'needs-passphrase',
  recovery: 'made', openedAt: '2026-10-17T18:00:00.000Z', listedFrom: 'card',
};
export const oldVault: BusinessOnComputer = {
  folder: 'main', name: null, demo: null, unlock: 'passphrase', opens: 'needs-passphrase', recovery: 'unknown', openedAt: null, listedFrom: 'folder',
};
export const missingKey: BusinessOnComputer = {
  folder: 'pune-books', name: 'Pune Books', demo: false, unlock: 'this-computer', opens: 'key-missing', recovery: 'made', openedAt: '2026-10-10T08:00:00.000Z', listedFrom: 'card',
};
/** The longest row at rest: a sixty-character name. */
export const longest: BusinessOnComputer = {
  ...leeds, folder: 'northumberland-neighbourhood-companions', name: "Northumberland Neighbourhood Companions for Retired Neighbours".slice(0, 60),
};
export const list = (businesses: BusinessOnComputer[], complete = true): BusinessList => ({ businesses, complete });

export const backups: BackupView[] = [
  { file: 'chausar-ws_demo-1760779800000-auto.backup', kind: 'auto', at: '2026-10-18T09:30:00.000Z', revision: 14, bytes: 48_211, name: 'Leeds Shift Walkers', opensNow: true },
  { file: 'chausar-ws_demo-1760772600000-safety.backup', kind: 'safety', at: '2026-10-18T07:30:00.000Z', revision: 12, bytes: 47_960, name: 'Leeds Shift Walkers', opensNow: true },
  { file: 'chausar-ws_demo-1760690000000.backup', kind: 'manual', at: '2026-10-17T08:33:20.000Z', revision: 9, bytes: 46_002, name: 'Leeds Shift Walkers', opensNow: false },
];
