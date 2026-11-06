// Chausar venture launcher, core (Ink v2 wave 4, package 4J2; W3's O22): autosave for settings forms. A form's unsent
// edits are kept in the vault as the owner types (venture.settings.draft answers "Saved"), never in browser storage,
// so after a crash the screen can offer "Recover unsaved changes from 18:42?" from venture.settings.drafts. A draft
// takes only the fields the form's real method takes, and never keeps a key, a card or account number, an Aadhaar
// number or an OTP (the shared screen reads every string). It is cleared only when the form's real setting method
// succeeded with exactly the draft's values (the host calls clearSavedDraft after it answered); a save with other
// values, or one that failed, leaves it as it was. A cleared draft keeps no values, and a draft older than 30 days is
// no longer offered and is blanked the next time the member saves one.
import { authorize, check, type Context } from '../../contracts.ts';
import { canonical } from '../../actions.ts';
import { currentVenture, digest, exactPayload, listRecords, ventureAction } from '../records.ts';
import type { Json, SettingsDraftRecord, SettingsDraftSaved, SettingsDraftsView, VentureDeps, VentureMethod } from '../contracts.ts';
import { screenReadback } from './secrets.ts';

/** Each settings form and the method that saves it for real. */
export const SETTINGS_FORMS: Readonly<Record<string, VentureMethod>> = Object.freeze({
  'spend-policy': 'venture.spend.policy.set',
  owner: 'venture.owner.set',
  notifications: 'venture.notify.settings',
  goals: 'venture.goals.set',
  'posting-limits': 'venture.posting.limits.set',
  pipeline: 'venture.pipeline.settings',
});
/** The fields each form's real method takes (its payload in contracts.ts), and nothing else. */
export const SETTINGS_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'spend-policy': ['capUsd', 'askFirstUsd', 'cap', 'askFirst', 'rates', 'inrPerUsd', 'dailyCapUsd', 'dailyCap', 'alertPermille', 'agentCaps', 'writeCaps', 'currencyLead'],
  owner: ['firstName', 'excludedServices'],
  notifications: ['pausedUntil', 'quietHours', 'digest', 'push', 'tray'],
  goals: ['month', 'amount', 'amountMinor'],
  'posting-limits': ['connectorId', 'limits'],
  pipeline: ['weekdays', 'sendTime', 'caps', 'scoreRules'],
});
/** The most a draft's values may take, as canonical JSON. */
export const DRAFT_MAX_CHARS = 16_384;
/** How long a draft is offered for recovery. */
export const DRAFT_DAYS = 30;
export const SAVED_LINE = 'Saved';
export const SECRET_LINE = 'A draft never keeps a key, a card or account number, an Aadhaar number or an OTP. Take it out, and Chausar keeps the rest as you type.';

const DAY_MS = 24 * 60 * 60_000;
const expired = (record: SettingsDraftRecord, nowIso: string) => Date.parse(record.at) + DRAFT_DAYS * DAY_MS < Date.parse(nowIso);

/** The form a setting method saves, or null when it saves none. */
export function formOfMethod(method: string): string | null {
  return Object.entries(SETTINGS_FORMS).find(([, saves]) => saves === method)?.[0] ?? null;
}

/** Every string in the values, at any depth, field names included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { out.push(key); strings(item, out); }
  return out;
}

/** venture.settings.draft { form, values } (prepare): keeps the member's unsent edits of one form, replacing the last ones. */
export async function settingsDraftHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SettingsDraftSaved> {
  const body = exactPayload(payload, ['form', 'values'], ['form', 'values']);
  check(typeof body.form === 'string' && Object.hasOwn(SETTINGS_FORMS, body.form), 'INVALID_VENTURE_REQUEST', 'Choose a settings form Chausar knows.');
  const form = body.form;
  check(body.values !== null && typeof body.values === 'object' && !Array.isArray(body.values), 'INVALID_VENTURE_REQUEST', "Send the form's values as fields.");
  // Only the fields the form's real method takes.
  exactPayload(body.values, SETTINGS_FIELDS[form]);
  let text: string;
  try { text = canonical(body.values); } catch { check(false, 'INVALID_VENTURE_REQUEST', "The form's values must be plain fields."); }
  check(text!.length <= DRAFT_MAX_CHARS, 'INVALID_VENTURE_REQUEST', 'This draft is too large to keep.');
  check(strings(body.values).every(item => screenReadback(item).found.length === 0), 'DRAFT_HOLDS_SECRET', SECRET_LINE);
  const values = JSON.parse(text!) as Json;
  return ventureAction(deps, ctx, 'prepare', 'settings.draft', tx => {
    const mine = tx.list('venture-settings-draft').filter(record => record.by === ctx.memberId);
    // Drafts past their 30 days keep nothing.
    for (const old of mine) if (old.form !== form && !old.clearedAt && expired(old, tx.now)) tx.replace<SettingsDraftRecord>({ ...old, values: {}, clearedAt: tx.now });
    const kept = mine.find(record => record.form === form);
    const stored = kept
      ? tx.replace<SettingsDraftRecord>({ ...kept, values, at: tx.now, clearedAt: null })
      : tx.put<SettingsDraftRecord>({ ...tx.base('venture-settings-draft'), form, values, by: ctx.memberId, clearedAt: null });
    return { form, at: stored.at, line: SAVED_LINE };
  });
}

/** venture.settings.drafts {} (read): the member's unsent drafts of the last 30 days, newest first, with when each was kept. */
export async function settingsDraftsHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SettingsDraftsView> {
  exactPayload(payload ?? {}, []);
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  const now = deps.clock().toISOString();
  const drafts = venture ? listRecords(state, 'venture-settings-draft', venture.id).filter(record => record.by === ctx.memberId && !record.clearedAt && !expired(record, now)) : [];
  return { drafts: drafts.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).map(record => ({ form: record.form, values: record.values, at: record.at })) };
}

/**
 * After a setting method succeeded: clears the member's draft of that form when it holds exactly the values just saved,
 * keeping none of them. Never throws and never writes when nothing matches.
 */
export async function clearSavedDraft(deps: VentureDeps, ctx: Context, method: string, payload: unknown): Promise<boolean> {
  const form = formOfMethod(method);
  if (!form) return false;
  let saved: string;
  try { saved = digest(payload ?? {}); } catch { return false; }
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return false;
  const match = (record: SettingsDraftRecord) => record.form === form && record.by === ctx.memberId && !record.clearedAt && digest(record.values) === saved;
  if (!listRecords(state, 'venture-settings-draft', venture.id).some(match)) return false;
  try {
    return await ventureAction(deps, ctx, 'prepare', 'settings.draft.clear', tx => {
      const kept = tx.list('venture-settings-draft').find(match);
      if (!kept) return false;
      tx.replace<SettingsDraftRecord>({ ...kept, values: {}, clearedAt: tx.now });
      return true;
    });
  } catch {
    return false;
  }
}
