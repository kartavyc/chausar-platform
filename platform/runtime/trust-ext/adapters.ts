/**
 * Reads from other lanes for the trust screens, through their own engine methods as the same caller.
 * Every reply is checked here; a method that is not installed or refuses gives an empty answer, so a
 * trust view never fails because another lane is missing. Nothing here writes.
 */
import { ChausarError } from '../contracts.ts';
import type { State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';

const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));

/** The reply, or null when the method is not installed or refuses this caller. Other failures are bugs and throw. */
async function ask(host: ModuleHost, method: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  try { return await host.call(method, payload); } catch (error) { if (error instanceof ChausarError) return null; throw error; }
}

export type WritebackRow = { id: string; system: string; title: string; word: string; practice: boolean; at: string };
/** writeback.ledger: the writeback lane's record of outside changes, newest first. */
export async function writebackLedger(host: ModuleHost, limit = 1000): Promise<WritebackRow[]> {
  const reply = await ask(host, 'writeback.ledger', { limit });
  if (!Array.isArray(reply)) return [];
  return reply.flatMap(row => {
    if (!obj(row) || !str(row.id) || !str(row.system, 60) || !str(row.title, 300) || !str(row.word, 40) || !Array.isArray(row.steps)) return [];
    const step = (name: string) => row.steps.find((s: any) => obj(s) && s.name === name && iso(s.at))?.at as string | undefined;
    const at = step('done') ?? step('prepared'); if (!at) return [];
    return [{ id: row.id, system: row.system, title: row.title, word: row.word, practice: row.practice === true, at }];
  });
}

export type FollowUpConsent = { id: string; customerId: string; channel: 'email' | 'whatsapp'; destination: string; answer: string; at: string };
/** writeback.followUp.consents: every recorded answer, oldest first, as the writeback lane keeps them. */
export async function followUpConsents(host: ModuleHost): Promise<FollowUpConsent[]> {
  const reply = await ask(host, 'writeback.followUp.consents');
  if (!Array.isArray(reply)) return [];
  return reply.flatMap(c => obj(c) && str(c.id) && str(c.customerId, 100) && (c.channel === 'email' || c.channel === 'whatsapp') && str(c.destination, 300)
    && ['yes', 'no', 'not-asked', 'stopped'].includes(c.answer) && iso(c.at)
    ? [{ id: c.id, customerId: c.customerId, channel: c.channel, destination: c.destination, answer: c.answer, at: c.at }] : []);
}

export type PhoneChannel = { channel: 'whatsapp' | 'telegram' | 'mail'; enabled: boolean; optInAt: string | null };
/** phone.channels.list: the desktop side of each phone channel (the owner's opt-in). */
export async function phoneChannels(host: ModuleHost): Promise<PhoneChannel[]> {
  const reply = await ask(host, 'phone.channels.list');
  if (!obj(reply) || !Array.isArray(reply.channels)) return [];
  return reply.channels.flatMap((c: any) => obj(c) && ['whatsapp', 'telegram', 'mail'].includes(c.channel) && obj(c.desktop) && typeof c.desktop.enabled === 'boolean'
    && (c.desktop.optInAt === null || iso(c.desktop.optInAt)) ? [{ channel: c.channel, enabled: c.desktop.enabled, optInAt: c.desktop.optInAt }] : []);
}

export type HostedLeft = { id: string; at: string; kind: 'phone' | 'backup'; channel: string | null };
/**
 * Messages sent through the hosted relay and hosted backup uploads. hosted-link has no read method that
 * lists them one by one (`phone.messages.counts` asks the server for monthly totals), so its own audit
 * events in the shared activity log are the record. A send whose reply was lost is not audited there.
 */
export function hostedLeft(state: State): HostedLeft[] {
  return state.activity.flatMap((e): HostedLeft[] => e.event === 'hosted.relay.message' && iso(e.at) ? [{ id: e.id, at: e.at, kind: 'phone', channel: str(e.details?.channel, 20) ? e.details.channel : null }]
    : e.event === 'hosted.backup.uploaded' && iso(e.at) ? [{ id: e.id, at: e.at, kind: 'backup', channel: null }] : []);
}

export type HostedAccount = {
  state: 'not-configured' | 'demo' | 'not-paired' | 'paired';
  plan: 'free' | 'paid' | null;
  /** The paired hosted account, so a plan seen as paid is tied to that account only. */
  accountId: string | null;
  refreshedAt: string | null;
  entitlements: { backup: boolean; worker: boolean; relay: boolean; allowance: boolean } | null;
};
/**
 * hosted.status (TR-14): whether the hosted link is set up and paired, and the plan and entitlements it cached at its
 * last account refresh. Never reaches the hosted service. Absent, refused or not understood reads as not configured.
 */
export async function hostedAccount(host: ModuleHost): Promise<HostedAccount> {
  const none: HostedAccount = { state: 'not-configured', plan: null, accountId: null, refreshedAt: null, entitlements: null };
  const reply = await ask(host, 'hosted.status');
  if (!obj(reply) || typeof reply.configured !== 'boolean' || typeof reply.paired !== 'boolean') return none;
  if (reply.demo === true) return { ...none, state: 'demo' };
  if (!reply.configured) return none;
  if (!reply.paired) return { ...none, state: 'not-paired' };
  const accountId = obj(reply.pairing) && typeof reply.pairing.accountId === 'string' && reply.pairing.accountId.length > 0 ? reply.pairing.accountId : null;
  const account = reply.account;
  if (!obj(account) || !['free', 'paid'].includes(account.plan) || !iso(account.refreshedAt) || !obj(account.entitlements)) return { ...none, state: 'paired', accountId };
  const e = account.entitlements, on = (v: unknown) => v === true;
  return { state: 'paired', plan: account.plan, accountId, refreshedAt: account.refreshedAt,
    entitlements: { backup: on(e.backup), worker: on(e.worker), relay: on(e.relay), allowance: on(e.allowance) } };
}

/** jobsx.autonomy: the preset the jobs lane holds, or null when that lane does not answer. */
export async function autonomyPreset(host: ModuleHost): Promise<string | null> {
  const reply = await ask(host, 'jobsx.autonomy');
  return obj(reply) && ['ask-everything', 'routine', 'all-but-always-waits', 'custom'].includes(reply.preset) ? reply.preset : null;
}

/**
 * modelsx.meters as merged gives per-route budgets and totals, but no voice minutes (models-ext states
 * that minutes used are not measured) and no month's spend. These two fields, `voice.minutesThisMonth`
 * and `totals.spendThisMonthMinor`, are read only if models-ext adds them; until then each is null,
 * minutes show "not counted yet" and the month's spend is summed from this computer's model receipts.
 */
export async function modelMeters(host: ModuleHost): Promise<{ minutesThisMonth: number | null; spendThisMonthMinor: string | null }> {
  // An optional enrichment: a fault in another lane's meters never stops the Models screen.
  const reply = await ask(host, 'modelsx.meters').catch(() => null);
  if (!obj(reply)) return { minutesThisMonth: null, spendThisMonthMinor: null };
  // models-ext round 4: `month: { spendMinor, voiceMinutesMs, ... }` for the current calendar month (model plus voice spend).
  const month = obj(reply.month) ? reply.month : null;
  const ms = month?.voiceMinutesMs, spend = month?.spendMinor;
  const msOk = typeof ms === 'number' ? Number.isSafeInteger(ms) && ms >= 0 : typeof ms === 'string' && /^\d{1,15}$/.test(ms);
  // Minutes to one decimal, rounded down, from whole milliseconds: a display of a meter, not a figure with a receipt.
  return { minutesThisMonth: msOk ? Math.floor(Number(ms) / 6000) / 10 : null,
    spendThisMonthMinor: typeof spend === 'string' && /^\d{1,20}$/.test(spend) ? BigInt(spend).toString() : null };
}
