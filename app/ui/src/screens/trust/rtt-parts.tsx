/**
 * Pieces the Keys, Machines and sync, Hosted backup and "This computer" screens share: the plain sentence for the
 * refusals of the methods they draw over (hosted-link, connectors-ext, jobs-ext, release, core-sync-jobs), and
 * the outcome line of one change.
 */
import type { Language } from '../../app/presentation.ts';
import type { Sent } from './kit/engine.ts';
import { Refusal } from './common';
import { words } from '../../places/types.ts';
import { rtt } from './rtt.ts';
import { COMMON } from './words.ts';
import s from './Trust.module.css';

/** Codes from other lanes' methods, each with this lane's sentence. Anything else falls back to the Trust refusals. */
const CODES: Readonly<Record<string, string>> = {
  HOSTED_NOT_CONFIGURED: 'RTT.hosted.notConfigured', HOSTED_NOT_PAIRED: 'RTT.hosted.notPaired', HOSTED_UNREACHABLE: 'RTT.hosted.unreachable',
  HOSTED_REPLY_INVALID: 'RTT.hosted.replyInvalid', PLAN_REQUIRED: 'RTT.hosted.planRequired', BACKUP_KEY_MISSING: 'RTT.hosted.keyMissing',
  BACKUP_KEY_INVALID: 'RTT.hosted.keyInvalid', HOSTED_BACKUP_INVALID: 'RTT.hosted.backupInvalid', BACKUP_TOO_LARGE: 'RTT.hosted.tooLarge',
  WAKE_TIMER_UNAVAILABLE: 'RTT.vault.wakeUnavailable', SHELL_UNAVAILABLE: 'RTT.vault.loginDesktop', START_AT_LOGIN_UNSUPPORTED: 'RTT.vault.loginUnsupported',
  START_AT_LOGIN_COMMAND_FAILED: 'RTT.vault.loginFailed', START_AT_LOGIN_PATH_UNSAFE: 'RTT.vault.loginPathUnsafe', SERVICE_UNAVAILABLE: 'RTT.vault.loginDesktop', OPEN_DESKTOP: 'RTT.vault.loginDesktop',
  DRIVE_SIGN_IN_REQUIRED: 'RTT.devices.signInRequired', DRIVE_ALREADY_CONNECTED: 'RTT.devices.alreadyConnected', DRIVE_FOLDER_NOT_FOUND: 'RTT.devices.folderNotFound',
  SYNC_WORKSPACE_MISMATCH: 'RTT.devices.otherWorkspace', SYNC_ACCESS_DENIED: 'RTT.devices.accessDenied', SYNC_UNAVAILABLE: 'RTT.devices.attachment.unavailable',
  SYNC_TRANSPORT_CONFIGURED: 'RTT.devices.attachment.host-transport',
  CREDENTIAL_STORE_REQUIRED: 'RTT.keys.storeOff', CREDENTIAL_INVALID: 'RTT.keys.badKey',
};

export function RttRefusal({ code, language }: { code: string; language: Language }) {
  const key = CODES[code];
  if (key === undefined) return <Refusal code={code} language={language} />;
  return <p className={s.problem} role="status">{rtt(language)(key)}</p>;
}

/** Saving, the screen's own sentence when done, or the refusal. */
export function Said<T>({ sent, done, language }: { sent: Sent<T>; done: (value: T) => string; language: Language }) {
  if (sent.kind === 'idle') return null;
  if (sent.kind === 'sending') return <Sending language={language} />;
  if (sent.kind === 'refused') return <RttRefusal code={sent.code} language={language} />;
  return <p className={s.status} role="status">{done(sent.value)}</p>;
}

function Sending({ language }: { language: Language }) {
  return <p className={s.quiet} role="status">{words(COMMON, language).sending}</p>;
}
