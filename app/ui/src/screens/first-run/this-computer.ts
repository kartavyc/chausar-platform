/**
 * This computer, before and around the vault: the disk check (FR-03), the language and view
 * saved for this device (FR-01, SH-06), the workspace folders that exist (FR-01, SH-02) and the
 * recovery contact (FR-13, SH-02). Every reply is validated before it is used; a method this
 * engine does not have yet is "not built", never a guess.
 *
 * The device choices are two words, never workspace data. First run writes them only once the
 * vault exists (FR-01: nothing is stored before); the host may read them at start.
 */

import type { PlaceRpc } from '../../places/types.ts';
import {
  isDeviceChoices, isDiskCheckReply, isRecoveryContactReply, isWorkspaceFoldersReply,
  type DeviceLanguage, type DeviceView, type DiskCheckReply, type RecoveryContactReply, type WorkspaceFolder,
} from '../../bridge/todayx-contract.ts';
import { failureOf, type JourneyFailure } from './journey-contracts.ts';

/** Any named-request port: the journey's, the host's `controller.places`, or a place's `rpc`. */
export type ComputerPort = Pick<PlaceRpc, 'request'>;

export type Read<T> = { readonly kind: 'known'; readonly value: T } | JourneyFailure;
async function read<T>(rpc: ComputerPort, method: string, payload: Record<string, unknown>, valid: (value: unknown) => value is T): Promise<Read<T>> {
  try {
    const reply = await rpc.request(method, payload);
    return valid(reply) ? { kind: 'known', value: reply } : { kind: 'refused', code: 'INVALID_REPLY' };
  } catch (error) { return failureOf(error); }
}

/* ------------------------------------------------------------------ the disk check */

export const readDiskCheck = (rpc: ComputerPort) => read(rpc, 'todayx.diskCheck', {}, isDiskCheckReply);

/** The FR-03 line for a disk check. */
export function diskLineKey(reply: DiskCheckReply): string {
  if (reply.disk === 'encrypted') return 'FR-03.disk.encrypted';
  if (reply.disk === 'unknown') return 'FR-03.disk.unknown';
  return reply.platform === 'windows' ? 'FR-03.disk.off.windows' : reply.platform === 'macos' ? 'FR-03.disk.off.macos' : 'FR-03.disk.off.other';
}
/** Linux with no safe keyring: the passphrase is asked each time. */
export const keyringLineKey = (reply: DiskCheckReply): string | null => reply.keyring === 'none' ? 'FR-03.keyring.none' : null;

/* ------------------------------------------------------------------ language and view */

/** The saved choices, or null when nothing was saved or this engine cannot say. */
export async function readDeviceChoices(rpc: ComputerPort): Promise<{ readonly language: DeviceLanguage; readonly view: DeviceView } | null> {
  const result = await read(rpc, 'todayx.device.get', {}, isDeviceChoices);
  if (result.kind !== 'known' || !result.value.saved || result.value.language === null || result.value.view === null) return null;
  return { language: result.value.language, view: result.value.view };
}

/** Save both words for this computer. Never throws: a missing method only means they are not kept. */
export async function saveDeviceChoices(rpc: ComputerPort, language: DeviceLanguage, view: DeviceView): Promise<'saved' | 'not-built' | 'refused'> {
  const result = await read(rpc, 'todayx.device.set', { language, view }, isDeviceChoices);
  return result.kind === 'known' ? 'saved' : result.kind;
}

/* ------------------------------------------------------------------ workspace folders */

/** The folders on this computer, main first; empty when there are none or this engine cannot say. */
export async function readWorkspaceFolders(rpc: ComputerPort): Promise<readonly WorkspaceFolder[]> {
  const result = await read(rpc, 'todayx.workspaces', {}, isWorkspaceFoldersReply);
  return result.kind === 'known' ? result.value.folders : [];
}

/* ------------------------------------------------------------------ the recovery contact */

/** Starting recovery through the contact. Today the engine always refuses: the relay is not deployed. */
export async function askRecoveryContact(rpc: ComputerPort, folder: string): Promise<JourneyFailure> {
  try { await rpc.request('todayx.recoveryContact.request', { folder }); return { kind: 'refused', code: 'INVALID_REPLY' }; }
  catch (error) { return failureOf(error); }
}
/** The words for that answer. */
export function askLineKey(failure: JourneyFailure): string {
  if (failure.kind === 'not-built') return 'SH-02.contact.notBuilt';
  return failure.code === 'RECOVERY_CONTACT_RELAY_REQUIRED' ? 'SH-02.contact.relay' : 'SH-02.contact.refused';
}

export const readRecoveryContact = (rpc: ComputerPort) => read(rpc, 'todayx.recoveryContact.get', {}, isRecoveryContactReply);
export const saveRecoveryContact = (rpc: ComputerPort, contact: { readonly name: string; readonly reach: string } | null): Promise<Read<RecoveryContactReply>> =>
  read(rpc, 'todayx.recoveryContact.set', { contact: contact === null ? null : { name: contact.name, reach: contact.reach } }, isRecoveryContactReply);
