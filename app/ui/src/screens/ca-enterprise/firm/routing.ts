/**
 * Which address each CA console screen draws. These modules are looked up before every other
 * lane's (places/registry.ts), so each claims only addresses that never exist in the desktop
 * shell (bare Today is drawn by App itself outside the ca-firm shell), plus this lane's own
 * sub-places. Never trust/people, bare work, bare reports and the like.
 */
import type { Address } from '../../../app/presentation.ts';

export type FirmScreen =
  | 'today' | 'clients' | 'cosign' | 'many' | 'questions' | 'handover' | 'library' | 'invite' | 'firmname' | 'clientaccess' | 'cafirm';

const BY_SUB: Readonly<Record<string, Readonly<Record<string, FirmScreen>>>> = {
  work: { cosign: 'cosign', many: 'many', questions: 'questions' },
  reports: { handover: 'handover' },
  tools: { library: 'library', invite: 'invite' },
  trust: { firmname: 'firmname', clientaccess: 'clientaccess', cafirm: 'cafirm' },
};

export function firmScreenFor(address: Address): FirmScreen | null {
  if (address.place === 'today') return address.sub === undefined ? 'today' : null;
  if (address.place === 'clients') return 'clients';
  if (address.sub === undefined) return null;
  const subs = BY_SUB[address.place];
  return subs !== undefined && Object.hasOwn(subs, address.sub) ? subs[address.sub] ?? null : null;
}

export const FIRM_SCREENS: readonly FirmScreen[] = ['today', 'clients', 'cosign', 'many', 'questions', 'handover', 'library', 'invite', 'firmname', 'clientaccess', 'cafirm'];
