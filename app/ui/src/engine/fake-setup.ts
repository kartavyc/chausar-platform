/**
 * The fake engine's answers for W4 4J21's screens, with the engine's codes, shapes, words and order:
 *   venture.owner.get / set      the owner profile (platform/runtime/venture/core/owner.ts, 4J9): a first name of 1 to
 *                                40 letters in any script, the services the business does not sell (at most 20 lines of
 *                                80), and Forget's backups line on the answer that takes a stored name back.
 *   venture.connectors.check     one row per connection the business has (build/connector-check.ts, 4J7): each AI key
 *                                answers (listing models is free), each bank account with a consent is skipped (no bank
 *                                provider is linked) with its end date; health counts Ready, Warnings and Blocking.
 *   venture.share.request        the client's file request link (build/file-requests.ts, 4J7): single use, 15 minutes,
 *                                with an address only on the hosted server; a temporary business is refused TRIAL_LIMIT.
 *   venture.settings.draft(s)    a settings form's unsent edits kept "Saved" in the vault (core/settings-drafts.ts, 4J2).
 * The rows are the fake's own sample connections; nothing here is a real check.
 */

import { EngineError, type ConnectorCardLite, type ConnectorCheckRow, type ConnectorGuideLite, type ConnectorLadder, type ConnectorChecksView, type FileRequestView, type ModelStatusLite, type OwnerView, type SettingsDraftView } from './types';
import type { W4DeskHost } from './fake-w4';
import GUIDES from './fixtures-guides.json';
import { POSTING_WORDS } from './fake-posting';

export const FAKE_4J21_METHODS: readonly string[] = [
  'venture.owner.get', 'venture.owner.set', 'venture.connectors.check', 'venture.share.request', 'venture.settings.draft', 'venture.settings.drafts',
];

/** The engine's words, word for word. */
const NAME_RULE = 'Your first name can have 1 to 40 letters, with spaces, dots, hyphens or apostrophes between letters, and nothing else.';
export const BACKUPS_LINE = 'Backups made before now still hold this person until those backups are deleted.';
const FIRST_NAME = /^\p{L}(?:[\p{L}\p{M} .-]|(?<=[\p{L}\p{M}])'(?=\p{L})|(?<=[\p{L}\p{M}])[\u{200C}\u{200D}])*$/u;
export const FILE_REQUEST_LINE = "The file goes straight to this server and is kept with this order. It never passes through the model's context.";
const NOT_SERVED = 'File request links open only on the hosted Chausar with a public address. Ask your client to send the file, and add it to the order yourself.';
const TRIAL_SEND_LINE = "A temporary business can't share links or send alerts from this server. Add your email to keep this business, then you can.";
const NO_BANK = 'No bank provider is linked; the consent is kept for when one is.';
const KEY_GONE = 'Chausar keeps your key only while the app is open, so it has none to check now.';
const KEY_FIX = 'Paste the key again under Connections, Your AI.';
const REPLAY = 'Chausar is answering from a synthetic recording here, not your AI provider, so there is nothing real to check.';
/**
 * The fields each settings form's real method takes, as the engine's core/settings-drafts.ts SETTINGS_FIELDS (4Z3: a draft
 * with any other field is refused here too, so a form that drafts one fails its test as it would fail the engine).
 */
export const SETTINGS_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'spend-policy': ['capUsd', 'askFirstUsd', 'cap', 'askFirst', 'rates', 'inrPerUsd', 'dailyCapUsd', 'dailyCap', 'alertPermille', 'agentCaps', 'writeCaps', 'currencyLead'],
  owner: ['firstName', 'excludedServices'],
  notifications: ['pausedUntil', 'quietHours', 'digest', 'push', 'tray'],
  goals: ['month', 'amount', 'amountMinor'],
  'posting-limits': ['connectorId', 'limits'],
  pipeline: ['weekdays', 'sendTime', 'caps', 'scoreRules'],
});
const SETTINGS_FORMS = new Set(Object.keys(SETTINGS_FIELDS));
const DRAFT_MAX_CHARS = 16_384;

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);

function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): void {
  if (Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !(key in p))) throw invalid('Send the required fields and nothing else.');
}

function singleLine(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || /[\n\r\t]/.test(value.trim()) || value.trim().length < 1 || value.trim().length > max) throw invalid(`${what} must be one line of 1 to ${max} characters.`);
  return value.trim();
}

interface Profile { firstName: string | null; excludedServices: string[] }
interface HeldDraft { business: string; form: string; values: unknown; at: string; clearedAt: string | null }

export class FakeSetupDesk {
  private readonly host: W4DeskHost;
  private readonly profiles = new Map<string, Profile>();
  private drafts: HeldDraft[] = [];
  private readonly lastCheck = new Map<string, ConnectorChecksView>();
  private seq = 0;
  /** Whether the open business is a temporary one on the hosted app (4J23), so its links are refused. */
  private readonly trial: () => boolean;

  constructor(host: W4DeskHost, options: { trial?: () => boolean } = {}) {
    this.host = host;
    this.trial = options.trial ?? (() => false);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.owner.get': exact(p, []); return this.view();
      case 'venture.owner.set': return this.setOwner(p);
      case 'venture.connectors.check': {
        exact(p, ['last']);
        if ('last' in p && p.last !== true) throw invalid('Send last as true, or nothing.');
        // 4J21: { last: true } reads the newest check, with no new read; null before any.
        if (p.last === true) return structuredClone(this.lastCheck.get(this.host.current()) ?? null);
        const view = this.check();
        this.lastCheck.set(this.host.current(), structuredClone(view));
        return view;
      }
      case 'venture.share.request': return this.fileRequest(p);
      case 'venture.settings.draft': return this.keepDraft(p);
      case 'venture.settings.drafts': exact(p, []); return this.listDrafts();
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** The open business's name (the engine sends its working name; the fake's samples keep one name each). */
  private businessName(): string {
    return this.host.businesses?.().find((business) => business.id === this.host.current())?.name ?? '';
  }

  private profile(): Profile {
    return this.profiles.get(this.host.current()) ?? { firstName: null, excludedServices: [] };
  }

  private view(): OwnerView {
    const profile = this.profile();
    return { firstName: profile.firstName, excludedServices: [...profile.excludedServices], businessName: this.businessName() };
  }

  private setOwner(p: Record<string, unknown>): OwnerView {
    exact(p, ['firstName', 'excludedServices']);
    if (Object.keys(p).length === 0) throw invalid('Send your first name, the services you do not sell, or both.');
    let firstName: string | null | undefined;
    if ('firstName' in p) {
      if (p.firstName === null) firstName = null;
      else {
        if (typeof p.firstName !== 'string') throw new EngineError('OWNER_NAME_INVALID', NAME_RULE);
        const name = p.firstName.trim().replace(/’/g, "'").replace(/ {2,}/g, ' ');
        if ([...name].length < 1 || [...name].length > 40 || !FIRST_NAME.test(name)) throw new EngineError('OWNER_NAME_INVALID', NAME_RULE);
        firstName = name;
      }
    }
    let services: string[] | undefined;
    if ('excludedServices' in p) {
      if (!Array.isArray(p.excludedServices)) throw invalid('Send the services you do not sell as a list.');
      if (p.excludedServices.length > 20) throw invalid('List at most 20 services you do not sell.');
      const seen = new Set<string>();
      services = [];
      for (const item of p.excludedServices) {
        const service = singleLine(item, 'Each service you do not sell', 80);
        const key = service.toLocaleLowerCase('en');
        if (seen.has(key)) continue;
        seen.add(key);
        services.push(service);
      }
    }
    const before = this.profile();
    const next: Profile = { firstName: firstName === undefined ? before.firstName : firstName, excludedServices: services ?? before.excludedServices };
    this.profiles.set(this.host.current(), next);
    this.clearDraft('owner', p);
    const removed = firstName === null && before.firstName !== null;
    return removed ? { ...this.view(), kept: [BACKUPS_LINE] } : this.view();
  }

  /** The rows in the engine's order: AI keys first, then bank accounts with a consent. */
  private check(): ConnectorChecksView {
    const rows: ConnectorCheckRow[] = [];
    const status = this.host.ask('venture.models.status', {}) as ModelStatusLite;
    const presets = (this.host.ask('venture.models.presets', {}) as { id: string; label: string; kind: string }[] | undefined) ?? [];
    const seen = new Set<string>();
    for (const connection of status.connections) {
      if (connection.status !== 'connected' || seen.has(connection.presetId)) continue;
      seen.add(connection.presetId);
      const preset = presets.find((item) => item.id === connection.presetId);
      if (!preset || (preset.kind !== 'anthropic-messages' && preset.kind !== 'openai-responses')) continue;
      rows.push(status.replay?.active
        ? { connectorId: `model:${preset.id}`, name: preset.label, outcome: 'skipped', line: REPLAY, account: null, expiresOn: null, fix: null }
        : !connection.keyLoaded
          ? { connectorId: `model:${preset.id}`, name: preset.label, outcome: 'failed', line: KEY_GONE, account: null, expiresOn: null, fix: KEY_FIX }
          : { connectorId: `model:${preset.id}`, name: preset.label, outcome: 'answered', line: `Your ${preset.label} key answered. Listing its models is free, so this check cost nothing.`, account: null, expiresOn: null, fix: null });
    }
    const ledger = this.host.ask('venture.bank.ledger', {}) as { accounts?: { label: string; consent: { daysLeft?: number; line?: string } | null }[] } | undefined;
    for (const account of ledger?.accounts ?? []) {
      if (!account.consent) continue;
      const ends = consentEnds(account.consent.line) ?? new Date(Date.parse(this.host.now()) + (account.consent.daysLeft ?? 0) * 86_400_000).toISOString().slice(0, 10);
      rows.push({ connectorId: 'bank-account', name: `Bank: ${account.label}`, outcome: 'skipped', line: NO_BANK, account: account.label, expiresOn: ends, fix: null });
    }
    const health = { ready: 0, warnings: 0, blocking: 0 };
    for (const row of rows) {
      if (row.outcome === 'failed') health.blocking += 1;
      else if (row.fix) health.warnings += 1;
      else if (row.outcome === 'answered') health.ready += 1;
    }
    return { at: this.host.now(), rows, health };
  }

  private fileRequest(p: Record<string, unknown>): FileRequestView {
    exact(p, ['orderId', 'note'], ['orderId']);
    if (this.trial()) throw new EngineError('TRIAL_LIMIT', TRIAL_SEND_LINE);
    if (typeof p.orderId !== 'string' || !p.orderId) throw invalid('Choose the order.');
    if (p.note !== undefined && p.note !== '') singleLine(p.note, 'The note', 300);
    const orders = this.host.ask('venture.order.list', {}) as { id: string; status?: string }[];
    const order = orders.find((item) => item.id === p.orderId);
    if (!order || order.status === 'cancelled') throw new EngineError('ORDER_NOT_FOUND', 'That order was not found, or it was cancelled.');
    const id = `filereq-${++this.seq}`;
    const expiresAt = new Date(Date.parse(this.host.now()) + 15 * 60_000).toISOString();
    const hosted = this.host.hosted();
    return {
      id, orderId: order.id, url: hosted ? `https://chausar.test/share/${'x'.repeat(28)}${String(this.seq).padStart(4, '0')}/upload` : null,
      ...(hosted ? {} : { reason: NOT_SERVED }), expiresAt, line: FILE_REQUEST_LINE,
    };
  }

  private keepDraft(p: Record<string, unknown>): { form: string; at: string; line: string } {
    exact(p, ['form', 'values'], ['form', 'values']);
    if (typeof p.form !== 'string' || !SETTINGS_FORMS.has(p.form)) throw invalid('Choose a settings form Chausar knows.');
    if (p.values === null || typeof p.values !== 'object' || Array.isArray(p.values)) throw invalid("Send the form's values as fields.");
    // Only the fields the form's real method takes (the engine's exactPayload on SETTINGS_FIELDS).
    exact(p.values as Record<string, unknown>, SETTINGS_FIELDS[p.form]!);
    const text = JSON.stringify(p.values);
    if (text.length > DRAFT_MAX_CHARS) throw invalid('This draft is too large to keep.');
    const business = this.host.current();
    const at = this.host.now();
    const kept = this.drafts.find((draft) => draft.business === business && draft.form === p.form);
    if (kept) Object.assign(kept, { values: JSON.parse(text) as unknown, at, clearedAt: null });
    else this.drafts.push({ business, form: p.form, values: JSON.parse(text) as unknown, at, clearedAt: null });
    return { form: p.form, at, line: 'Saved' };
  }

  private listDrafts(): { drafts: SettingsDraftView[] } {
    const business = this.host.current();
    const drafts = this.drafts.filter((draft) => draft.business === business && !draft.clearedAt).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { drafts: drafts.map((draft) => ({ form: draft.form, values: structuredClone(draft.values), at: draft.at })) };
  }

  /** After a setting saved for real: its draft goes when it holds exactly the values just saved (clearSavedDraft). */
  private clearDraft(form: string, saved: unknown): void {
    const business = this.host.current();
    const same = (values: unknown) => canonical(values) === canonical(saved);
    for (const draft of this.drafts) if (draft.business === business && draft.form === form && !draft.clearedAt && same(draft.values)) draft.clearedAt = this.host.now();
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The end day the fake's consent line states ("Bank access ends on 13 Jan 2027, ..."), as the engine's expiresAt day. */
function consentEnds(line: string | undefined): string | null {
  const found = /ends on (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/.exec(line ?? '');
  const month = found ? MONTHS.indexOf(found[2]!) : -1;
  return found && month >= 0 ? `${found[3]}-${String(month + 1).padStart(2, '0')}-${found[1]!.padStart(2, '0')}` : null;
}

/** JSON with its keys in order, so two drafts with the same fields compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/**
 * venture.connectors.list's truth for the fake's cards (build/connector-truth.ts withTruth and build/guides.ts guideOf):
 * each mode's and posting mode's rung, the capability set and the guide. The fake has no evidence of a real read or a
 * confirmed post, so an available mode is "discovered" and a planned one "documented"; a desktop-only read on the
 * hosted server, and a planned browser mode that can't run there, are "unavailable".
 */
const DESKTOP_ONLY_READS = new Set(['tally', 'zoho-mail', 'google-workspace', 'google-calendar']);
type Truth = { guide: ConnectorGuideLite; capabilities: NonNullable<ConnectorCardLite['capabilities']> };
const TRUTH = GUIDES as unknown as Record<string, Truth | string>;

export function withTruth(cards: ConnectorCardLite[], hosted: boolean): ConnectorCardLite[] {
  return cards.map((card) => {
    const truth = TRUTH[card.id];
    const modes = card.modes.map((mode) => ({
      ...mode,
      ladder: (mode.status === 'planned' ? 'documented' : hosted && mode.mode === 'read' && DESKTOP_ONLY_READS.has(card.id) ? 'unavailable' : 'discovered') as ConnectorLadder,
    }));
    const sourcePosting = card.id === 'linkedin' ? card.postingOptions.map(option => option.mode === 'handoff' ? option : { ...option, status: 'planned' as const, qualification: 'unqualified' as const, what: POSTING_WORDS.linkedin, risk: null, requires: [], reason: POSTING_WORDS.linkedin }) : card.postingOptions;
    const posting = sourcePosting.map((option) => ({
      ...option,
      ladder: (option.status === 'available' ? 'discovered' : option.mode === 'owner-browser-session' && (hosted || /not built yet/i.test(option.reason ?? '')) ? 'unavailable' : 'documented') as ConnectorLadder,
    }));
    const chosen = card.posting ? posting.find((option) => option.mode === card.posting!.mode) : undefined;
    return {
      ...card, modes, postingOptions: posting, ...(chosen ? { posting: chosen } : {}),
      ...(truth && typeof truth === 'object' ? { guide: structuredClone(truth.guide), capabilities: structuredClone(truth.capabilities) } : {}),
    };
  });
}
