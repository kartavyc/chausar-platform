/**
 * The fake engine's answers for brand kits, asset records and voice consent (Ink v2 wave 5, package 5A4), in the
 * engine's shapes, codes, order and words (platform/runtime/venture/playbooks/kit/brand-kit.ts, assets.ts,
 * voice-consent.ts): venture.brandKit.get and .set, venture.assets.list, .rerun and .reuse, venture.voiceConsent.record,
 * .revoke and .list, and Today's notice for a clip still holding its location data. A fresh fake starts empty; the
 * demo seeds one client's kit and three delivered files so the screens have something to show. Photos and recordings
 * come from venture.files.add (fake-work.ts), as the engine's do. The business's day is India's.
 */

import { EngineError } from './types';
import type {
  AssetCost, AssetSource, AssetView, AssetsView, AssetRerunView, AssetReuseView, BrandKitFields, BrandKitView, ClientLite, KitClaim, KitSource,
  OrderLite, QueueRow, ResolvedKit, UploadLite, VoiceConsentItem, VoiceConsentsView, VoiceConsentView,
} from './types';
import type { W4DeskHost } from './fake-w4';

const METHODS = new Set<string>([
  'venture.brandKit.get',
  'venture.brandKit.set',
  'venture.assets.list',
  'venture.assets.rerun',
  'venture.assets.reuse',
  'venture.voiceConsent.record',
  'venture.voiceConsent.revoke',
  'venture.voiceConsent.list',
]);

const FIELDS: readonly (keyof BrandKitFields)[] = ['colours', 'fonts', 'logoFileId', 'voice', 'samples', 'bannedWords', 'bannedTopics', 'competitors', 'claims'];
const LIMITS = {
  colours: { items: 12, chars: 7 }, fonts: { items: 6, chars: 60 }, voice: { items: 12, chars: 200 }, samples: { items: 3, chars: 2000 },
  bannedWords: { items: 60, chars: 60 }, bannedTopics: { items: 30, chars: 120 }, competitors: { items: 30, chars: 80 }, claims: { items: 20, chars: 200 },
} as const;
/** records.ts BANNED_WORDS: Chausar's house style. */
const HOUSE_BANNED = ['delve', 'leverage', 'robust', 'tapestry', 'underscore', 'testament'];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** The engine's key and id screens, in their plainest forms. */
const KEY = /\b(?:sk[-_][A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b/;
const CARD = /\b(?:\d[ -]?){13,19}\b/;
const KEY_REFUSED = 'That looks like a key. Keys go in Connections, never in your voice or an agent\'s persona.';
const ID_REFUSED = 'That looks like a card, bank account, Aadhaar or one-time code number. Chausar never keeps those here, so nothing was saved.';
const CLIP_HELD = 'This clip still has its location data, so it cannot go out. Add ffmpeg to this computer, then run the order again to clean it.';
/** fingerprint.ts staleLine: the unit and its source in the engine's words. */
const UNIT_WORDS: Readonly<Record<string, string>> = { narration: 'this narration', captions: 'these captions', translation: 'this translation', dub: 'this dub', article: 'this article', chapters: 'this chapter list' };
const SOURCE_WORDS: Readonly<Record<string, string>> = { transcript: 'The transcript', upload: 'The file', asset: 'The file' };
function staleLine(derived: NonNullable<AssetView['derived']>): string {
  const plural = derived.unit === 'captions';
  return `${SOURCE_WORDS[derived.source.kind]} changed after ${UNIT_WORDS[derived.unit]} ${plural ? 'were' : 'was'} made. Make ${plural ? 'them' : 'it'} again.`;
}

interface Kit extends BrandKitFields { id: string; at: string; clientId: string; version: number }
interface Asset {
  id: string; at: string; orderId: string; clientId: string; runId: string | null; toolCallId: string | null; name: string; fileDigest: string | null;
  source: AssetSource; licence: string | null; attribution: string | null; cost: AssetCost; consentId: string | null;
  state: AssetView['state']; hygiene: AssetView['hygiene']; derived: AssetView['derived']; supersededBy: string | null; supersedes: string | null; reusedFrom: string | null;
  /** The fake keeps no file bytes, so a derived unit's staleness is stored, as the demo sets it. */
  stale?: boolean;
}
interface Consent {
  id: string; at: string; speaker: string; recordingFileId: string; recordingDigest: string; transcript: string; statement: string; scope: string;
  until: string | null; version: number; revokedAt: string | null;
}
interface Book { kits: Kit[]; assets: Asset[]; consents: Consent[] }

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const localDay = (iso: string): string => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
const speakerKey = (name: string) => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !(key in p))) {
    throw invalid('Send the required fields and nothing else.');
  }
  return p;
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw invalid(`${field} must be a known identifier.`);
  return value;
}
function text(value: unknown, field: string, max: number, oneLine: boolean): string {
  if (typeof value === 'string' && oneLine && /[\n\r\t]/.test(value.trim())) throw invalid(`${field} must be one line.`);
  if (typeof value !== 'string') throw invalid(`${field} must be text.`);
  const out = value.replace(/\r\n/g, '\n').trim();
  if (out.length < 1 || out.length > max) throw invalid(`${field} must be between 1 and ${max} characters.`);
  return out;
}
function screened(value: string): string {
  if (KEY.test(value)) throw new EngineError('CHAT_KEY_REFUSED', KEY_REFUSED);
  if (CARD.test(value)) throw new EngineError('CHAT_KEY_REFUSED', ID_REFUSED);
  return value;
}

export class FakeKitMediaDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private readonly books: Record<string, Book> = {};
  private seq = 0;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  /** Internal seller import after its exact owner-approved quote. */
  recordSellerAsset(asset:Asset):void { this.book().assets.push(clone(asset)); }
  eraseSellerAssets(ids:readonly string[]):void { this.book().assets=this.book().assets.filter(asset=>!ids.includes(asset.id)); }

  handles(method: string): boolean {
    return METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const answer = this.answer(method, p ?? {});
    this.syncRows();
    return answer;
  }

  // -------------------------------------------------------------------------
  // Records of the open business
  // -------------------------------------------------------------------------

  private clients(): ClientLite[] { return this.host.ask('venture.client.list', {}) as ClientLite[]; }
  private orders(): OrderLite[] { return this.host.ask('venture.order.list', {}) as OrderLite[]; }
  private files(): UploadLite[] { return this.host.ask('venture.files.list', {}) as UploadLite[]; }
  private nextId(prefix: string): string { return `${prefix}_${(++this.seq).toString(36)}`; }

  private book(): Book {
    const business = this.host.current();
    const held = this.books[business];
    if (held) return held;
    const made: Book = { kits: [], assets: [], consents: [] };
    this.books[business] = made;
    if (!this.fresh) this.seed(made);
    return made;
  }

  /** The demo: the newest order's client's kit and three files on that order. */
  private seed(book: Book): void {
    const order = [...this.orders()].sort((a, b) => b.at.localeCompare(a.at))[0];
    const client = order ? this.clients().find((item) => item.id === order.clientId) : undefined;
    if (!client || !order) return;
    const at = this.host.now();
    book.kits.push({
      id: this.nextId('brandkit'), at, clientId: client.id, version: 1, colours: [], fonts: ['Mukta'], logoFileId: null,
      voice: ['Warm, short sentences', 'Speaks to families'], samples: ['Fresh every morning, made the way we always have.'], bannedWords: ['cheap'],
      bannedTopics: ['politics'], competitors: [], claims: [],
    });
    const base = { orderId: order.id, clientId: client.id, runId: null, toolCallId: null, attribution: null, consentId: null, supersededBy: null, supersedes: null, reusedFrom: null, derived: null };
    book.assets.push(
      { ...base, id: this.nextId('asset'), at, name: 'thumbnail.png', fileDigest: 'ab'.repeat(32), source: { kind: 'generated', model: 'image-model-2', prompt: 'A calm desk with a ledger' }, licence: 'Generated under the provider\'s terms, yours to use', cost: { kind: 'not-measured' }, state: 'ready', hygiene: { state: 'not-media', removed: [] } },
      { ...base, id: this.nextId('asset'), at, name: 'background.mp3', fileDigest: null, source: { kind: 'unknown' }, licence: null, cost: { kind: 'not-measured' }, state: 'ready', hygiene: { state: 'not-media', removed: [] } },
      { ...base, id: this.nextId('asset'), at, name: 'reel.mov', fileDigest: null, source: { kind: 'client-file', uploadId: null }, licence: `The client's own footage (${client.name})`, cost: { kind: 'not-measured' }, state: 'ready', hygiene: { state: 'held', removed: [] } },
    );
  }

  private today(): string { return localDay(this.host.now()); }

  // -------------------------------------------------------------------------
  // Brand kits
  // -------------------------------------------------------------------------

  private currentKit(clientId: string): Kit | null {
    return this.book().kits.filter((kit) => kit.clientId === clientId).sort((a, b) => b.version - a.version)[0] ?? null;
  }
  private fields(kit: Kit): BrandKitFields { return Object.fromEntries(FIELDS.map((field) => [field, clone(kit[field])])) as unknown as BrandKitFields; }

  private resolved(clientId: string): ResolvedKit {
    const kit = this.currentKit(clientId);
    let voice: { howITalk: string[]; neverUse: string[] } | null = null;
    try {
      const view = this.host.ask('venture.voice.get', {}) as { voices: { language: string; channel: string | null; on: boolean; sections: { howITalk: string[]; neverUse: string[] } }[] };
      voice = view.voices.find((item) => item.on && item.language === 'en' && item.channel === null)?.sections ?? null;
    } catch { voice = null; }
    const given = (value: unknown) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined);
    return Object.fromEntries(FIELDS.map((field) => {
      if (kit && given(kit[field])) return [field, { value: clone(kit[field]), source: 'client-kit' as KitSource }];
      if (field === 'voice' && voice?.howITalk.length) return [field, { value: [...voice.howITalk], source: 'business-voice' as KitSource }];
      if (field === 'bannedWords') return [field, voice?.neverUse.length ? { value: [...voice.neverUse], source: 'business-voice' as KitSource } : { value: [...HOUSE_BANNED], source: 'house-style' as KitSource }];
      return [field, { value: field === 'logoFileId' ? null : [], source: 'default' as KitSource }];
    })) as unknown as ResolvedKit;
  }

  private kitView(clientId: string, line?: string): BrandKitView {
    const kit = this.currentKit(clientId);
    const before = kit ? this.book().kits.filter((item) => item.clientId === clientId && item.version < kit.version).sort((a, b) => b.version - a.version)[0] ?? null : null;
    const memory = this.orders().filter((order) => order.clientId === clientId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20)
      .map((order) => ({ orderId: order.id, at: order.at, request: order.request }));
    return {
      clientId, kit: kit ? this.fields(kit) : null, version: kit?.version ?? null, resolved: this.resolved(clientId), undo: before ? this.fields(before) : null, memory,
      line: line ?? (kit ? `Brand kit version ${kit.version}. Every creative step reads it.` : 'This client has no brand kit yet. Steps use your own voice and house style.'),
    };
  }

  private requireClient(clientId: string): void {
    if (!this.clients().some((client) => client.id === clientId)) throw new EngineError('CLIENT_NOT_FOUND', 'That client was not found.');
  }

  private lines(value: unknown, field: keyof typeof LIMITS, label: string, multiline = false): string[] {
    if (!Array.isArray(value)) throw invalid(`${label} is a list.`);
    const { items, chars } = LIMITS[field];
    if (value.length > items) throw invalid(field === 'samples' ? 'Keep one to three samples.' : `Keep ${label.toLowerCase()} to ${items} or fewer.`);
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const item of value) {
      const line = screened(multiline ? text(item, label, chars, false) : text(item, label, chars, true).replace(/\s+/g, ' '));
      if (seen.has(line.toLowerCase())) continue;
      seen.add(line.toLowerCase());
      kept.push(line);
    }
    return kept;
  }

  private kitInput(value: unknown): BrandKitFields {
    const body = exact(value as Record<string, unknown>, FIELDS);
    let claims: KitClaim[] = [];
    if (body.claims !== undefined) {
      if (!Array.isArray(body.claims) || body.claims.length > LIMITS.claims.items) throw invalid(`Keep claims to ${LIMITS.claims.items} or fewer.`);
      claims = (body.claims as Record<string, unknown>[]).map((item) => {
        const claim = exact(item, ['claim', 'proofFileId'], ['claim', 'proofFileId']);
        if (typeof claim.proofFileId !== 'string') throw invalid('Each claim needs the file that proves it.');
        return { claim: screened(text(claim.claim, 'A claim', LIMITS.claims.chars, true)), proofFileId: id(claim.proofFileId, 'Proof file') };
      });
    }
    if (body.colours !== undefined && !Array.isArray(body.colours)) throw invalid('Colours is a list.');
    const colours = [...new Set(((body.colours as unknown[] | undefined) ?? []).map((value) => {
      if (typeof value !== 'string' || !HEX.test(value.trim())) throw invalid('Each colour is a hex code: a # and six letters or digits.');
      const hex = value.trim().toLowerCase();
      return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
    }))];
    if (colours.length > LIMITS.colours.items) throw invalid(`Keep colours to ${LIMITS.colours.items} or fewer.`);
    return {
      colours, fonts: body.fonts === undefined ? [] : this.lines(body.fonts, 'fonts', 'Fonts'),
      logoFileId: body.logoFileId === undefined || body.logoFileId === null ? null : id(body.logoFileId, 'Logo'),
      voice: body.voice === undefined ? [] : this.lines(body.voice, 'voice', 'How they sound'),
      samples: body.samples === undefined ? [] : this.lines(body.samples, 'samples', 'Samples', true),
      bannedWords: body.bannedWords === undefined ? [] : this.lines(body.bannedWords, 'bannedWords', 'Banned words'),
      bannedTopics: body.bannedTopics === undefined ? [] : this.lines(body.bannedTopics, 'bannedTopics', 'Banned topics'),
      competitors: body.competitors === undefined ? [] : this.lines(body.competitors, 'competitors', 'Competitors'),
      claims,
    };
  }

  private clientFile(clientId: string, uploadId: string, photo: boolean): void {
    const upload = this.files().find((file) => file.id === uploadId);
    if (!upload) throw new EngineError('UPLOAD_NOT_FOUND', 'That file was not found.');
    const orderId = upload.scope.kind === 'order' || upload.scope.kind === 'media' ? upload.scope.orderId : null;
    const order = orderId ? this.orders().find((item) => item.id === orderId) : undefined;
    if (!order || order.clientId !== clientId) throw invalid("Choose a file from this client's orders.");
    if (photo && upload.format !== 'image') throw invalid('The logo is a photo: add it as JPEG, PNG or WebP.');
  }

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  private block(asset: Asset): AssetView['blocked'] {
    if (asset.state === 'requested') return { code: 'ASSET_NOT_MADE', line: `${asset.name} was asked for again and is not made yet. Run the order again, or reuse the old file.` };
    if (asset.state === 'consent-withdrawn') return { code: 'CONSENT_WITHDRAWN', line: `${asset.name} was made with a voice whose consent was withdrawn. Take it out.` };
    if (asset.consentId !== null) {
      const consent = this.book().consents.find(item => item.id === asset.consentId);
      if (!consent || consent.revokedAt !== null) return { code: 'CONSENT_WITHDRAWN', line: `${asset.name} was made with a voice whose consent was withdrawn. Take it out.` };
      if (consent.until !== null && consent.until < this.today()) return { code: 'CONSENT_REQUIRED', line: `${asset.name} was made with ${consent.speaker}'s voice, whose consent ended on ${consent.until}. Record their consent again, or take it out.` };
    }
    if (asset.source.kind === 'unknown' || asset.licence === null) return { code: 'ASSET_LICENCE_UNKNOWN', line: `${asset.name} has no known licence. Record where it came from, or take it out.` };
    if (asset.hygiene.state === 'held') return { code: 'MEDIA_NOT_CLEAN', line: `${asset.name} still has its location data. Clean it before it goes out.` };
    if (asset.stale && asset.derived) return { code: 'DERIVED_STALE', line: staleLine(asset.derived) };
    return null;
  }

  private assetView(asset: Asset): AssetView {
    const { stale, ...body } = asset;
    const source = asset.source;
    const sourceLine = source.kind === 'client-file' ? (source.uploadId ? "Your client's file" : "Your client's file on this computer")
      : source.kind === 'generated' ? `Made by ${source.model}` : source.kind === 'licensed-stock' ? `Stock from ${source.provider} (licence ${source.licenceId})` : 'Source unknown';
    const costLine = asset.cost.kind === 'receipt' ? 'Cost on its receipt' : asset.cost.kind === 'reused' ? 'Reused, no new cost' : 'Cost not measured';
    return { ...clone(body), stale: !!stale, blocked: this.block(asset), sourceLine, costLine };
  }

  private findAsset(value: unknown): Asset {
    const assetId = id(value, 'Asset');
    const asset = this.book().assets.find((item) => item.id === assetId);
    if (!asset) throw new EngineError('ASSET_NOT_FOUND', 'That file was not found.');
    return asset;
  }

  // -------------------------------------------------------------------------
  // Voice consent
  // -------------------------------------------------------------------------

  private consentState(consent: Consent): VoiceConsentItem['state'] {
    if (consent.revokedAt !== null) return 'revoked';
    if (this.book().consents.some((item) => speakerKey(item.speaker) === speakerKey(consent.speaker) && item.version > consent.version)) return 'replaced';
    return consent.until !== null && consent.until < this.today() ? 'expired' : 'current';
  }
  private consentItem(consent: Consent): VoiceConsentItem {
    return { ...clone(consent), state: this.consentState(consent), assetsMade: this.book().assets.filter((asset) => asset.consentId === consent.id).length };
  }

  // -------------------------------------------------------------------------
  // Methods
  // -------------------------------------------------------------------------

  private answer(method: string, p: Record<string, unknown>): unknown {
    const book = this.book();
    switch (method) {
      case 'venture.brandKit.get': {
        const body = exact(p, ['clientId'], ['clientId']);
        const clientId = id(body.clientId, 'Client');
        this.requireClient(clientId);
        return this.kitView(clientId);
      }
      case 'venture.brandKit.set': {
        const body = exact(p, ['clientId', 'kit'], ['clientId', 'kit']);
        const clientId = id(body.clientId, 'Client');
        const input = this.kitInput(body.kit);
        this.requireClient(clientId);
        if (input.logoFileId) this.clientFile(clientId, input.logoFileId, true);
        for (const claim of input.claims) this.clientFile(clientId, claim.proofFileId, false);
        const version = (this.currentKit(clientId)?.version ?? 0) + 1;
        book.kits.push({ id: this.nextId('brandkit'), at: this.host.now(), clientId, version, ...input });
        const back = version > 1 ? ` Version ${version - 1} is kept; undo sets it again.` : '';
        return this.kitView(clientId, `The brand kit is version ${version}.${back}`);
      }
      case 'venture.assets.list': {
        const body = exact(p, ['orderId', 'clientId']);
        const orderId = body.orderId === undefined ? null : id(body.orderId, 'Order');
        const clientId = body.clientId === undefined ? null : id(body.clientId, 'Client');
        const assets = book.assets.filter((asset) => (orderId === null || asset.orderId === orderId) && (clientId === null || asset.clientId === clientId))
          .map((asset) => this.assetView(asset)).reverse();
        const blocked = assets.filter((asset) => asset.supersededBy === null && asset.blocked).length;
        const files = assets.length === 1 ? '1 file' : `${assets.length} files`;
        const view: AssetsView = {
          assets,
          line: !assets.length ? 'No delivered files recorded yet.' : blocked ? `${files}. ${blocked} ${blocked === 1 ? 'needs' : 'need'} you before it can go out.` : `${files}, each with where it came from.`,
        };
        return view;
      }
      case 'venture.assets.rerun': {
        const body = exact(p, ['id'], ['id']);
        const old = this.findAsset(body.id);
        if (old.supersededBy !== null) throw new EngineError('ASSET_REFUSED', `${old.name} was already made again. Run the newest one again instead.`);
        if (old.source.kind !== 'generated') throw new EngineError('ASSET_REFUSED', `${old.name} was not generated, so there is nothing to run again.`);
        if (old.state !== 'ready') throw new EngineError('ASSET_REFUSED', old.state === 'consent-withdrawn' ? `${old.name} was made with a voice whose consent was withdrawn. It is not made again.` : `${old.name} is not made yet.`);
        const next: Asset = {
          ...clone(old), id: this.nextId('asset'), at: this.host.now(), runId: null, toolCallId: null, fileDigest: null, cost: { kind: 'not-measured' },
          state: 'requested', hygiene: { state: 'not-media', removed: [] }, supersededBy: null, supersedes: old.id, reusedFrom: null, stale: false,
        };
        book.assets.push(next);
        old.supersededBy = next.id;
        const view: AssetRerunView = { asset: this.assetView(next), superseded: this.assetView(old), line: `${old.name} is asked for again, with the same request. The old one is kept; the order's next run makes the new one.` };
        return view;
      }
      case 'venture.assets.reuse': {
        const body = exact(p, ['id', 'orderId'], ['id', 'orderId']);
        const asset = this.findAsset(body.id);
        const orderId = id(body.orderId, 'Order');
        const order = this.orders().find((item) => item.id === orderId);
        if (!order) throw new EngineError('ORDER_NOT_FOUND', 'That order was not found.');
        if (order.clientId !== asset.clientId) throw new EngineError('ASSET_REFUSED', `${asset.name} belongs to another client's work. Chausar never moves one client's files to another.`);
        if (asset.supersededBy !== null) throw new EngineError('ASSET_REFUSED', `${asset.name} was made again. Reuse the newest one.`);
        const blocked = this.block(asset);
        if (blocked) throw new EngineError(blocked.code, blocked.line);
        const root = asset.reusedFrom ?? asset.id;
        if (book.assets.some((item) => item.orderId === orderId && item.supersededBy === null && (item.id === root || item.reusedFrom === root))) {
          throw new EngineError('ASSET_REFUSED', `${asset.name} is already on that order.`);
        }
        const linked: Asset = { ...clone(asset), id: this.nextId('asset'), at: this.host.now(), orderId, runId: null, toolCallId: null, cost: { kind: 'reused', assetId: root }, supersededBy: null, supersedes: null, reusedFrom: root };
        book.assets.push(linked);
        const view: AssetReuseView = { asset: this.assetView(linked), line: `${asset.name} is on the order too, reused at no new cost.` };
        return view;
      }
      case 'venture.voiceConsent.record': {
        const fields = ['speaker', 'recordingFileId', 'transcript', 'statement', 'scope', 'until'];
        const body = exact(p, fields, fields);
        const speaker = screened(text(body.speaker, 'Speaker', 80, true));
        const recordingFileId = id(body.recordingFileId, 'Recording');
        const transcript = screened(text(body.transcript, 'What the recording says', 2000, false));
        const statement = screened(text(body.statement, 'The consent statement', 1000, false));
        const scope = screened(text(body.scope, 'What the consent covers', 200, true));
        if (body.until !== null && !(typeof body.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.until))) throw invalid('Until must be a date like 2026-10-15.');
        const until = body.until as string | null;
        if (until !== null && until < this.today()) throw invalid('Until is in the past. Choose today or a later date, or no end.');
        const recording = this.files().find((file) => file.id === recordingFileId);
        if (!recording || recording.format !== 'audio' || book.consents.some(item => item.recordingFileId === recordingFileId && item.revokedAt !== null)) throw invalid('Choose the audio recording of the consent, added to the order.');
        const version = Math.max(0, ...book.consents.filter((item) => speakerKey(item.speaker) === speakerKey(speaker)).map((item) => item.version)) + 1;
        const consent: Consent = { id: this.nextId('voiceconsent'), at: this.host.now(), speaker, recordingFileId, recordingDigest: recording.id, transcript, statement, scope, until, version, revokedAt: null };
        book.consents.push(consent);
        const back = version > 1 ? ` Version ${version - 1} is kept and no longer used.` : '';
        const view: VoiceConsentView = { consent: this.consentItem(consent), line: `${speaker}'s consent is recorded, version ${version}.${back}` };
        return view;
      }
      case 'venture.voiceConsent.revoke': {
        const body = exact(p, ['id'], ['id']);
        const consentId = id(body.id, 'Consent');
        const target = book.consents.find((item) => item.id === consentId);
        if (!target) throw new EngineError('CONSENT_NOT_FOUND', 'That consent was not found.');
        if (target.revokedAt !== null) throw invalid(`${target.speaker}'s consent is already withdrawn.`);
        const versions = book.consents.filter((item) => speakerKey(item.speaker) === speakerKey(target.speaker));
        for (const version of versions) if (version.revokedAt === null) version.revokedAt = this.host.now();
        const ids = new Set(versions.map((item) => item.id));
        const made = book.assets.filter((asset) => asset.consentId !== null && ids.has(asset.consentId) && asset.state !== 'consent-withdrawn');
        for (const asset of made) asset.state = 'consent-withdrawn';
        const marked = made.length ? ` ${made.length === 1 ? '1 file made with it is' : `${made.length} files made with it are`} marked consent withdrawn.` : '';
        const view: VoiceConsentView = { consent: this.consentItem(target), line: `${target.speaker}'s consent is withdrawn. Nothing uses their voice from now on.${marked}` };
        return view;
      }
      case 'venture.voiceConsent.list': {
        exact(p, []);
        const consents = book.consents.map((consent) => this.consentItem(consent)).reverse();
        const current = consents.filter((item) => item.state === 'current').length;
        const view: VoiceConsentsView = {
          consents,
          line: consents.length ? `${current} current ${current === 1 ? 'consent' : 'consents'}. A voice is used only with its speaker's current consent.` : 'No voice consents yet. A voice is used only with its speaker\'s consent.',
        };
        return view;
      }
      default:
        throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    }
  }

  /** Today's notice for each held clip (views/probes.ts noticeRows, playbooks/kit/media-intake.ts mediaNoticeRows). */
  private syncRows(): void {
    const business = this.host.current();
    if (!business) return;
    const mine = (row: QueueRow) => row.businessId === business && row.id.startsWith(`${business}:media:`);
    const name = this.host.rows().find((row) => row.businessId === business)?.businessName ?? '';
    const made: QueueRow[] = this.book().assets.filter((asset) => asset.hygiene.state === 'held' && asset.supersededBy === null).map((asset) => {
      const row = {
        id: `${business}:media:${asset.id}`, businessId: business, businessName: name, kind: 'notice' as const,
        title: 'A clip still has its location data', line: CLIP_HELD, createdAt: asset.at,
        actions: [{ id: 'later' as const, label: 'Later', primary: false }, { id: 'open' as const, label: 'Open Assets', primary: true }],
      };
      return { ...row, digest: this.host.digest({ ...row, version: asset.id }) } as QueueRow;
    });
    const before = this.host.rows().filter(mine).map((row) => row.digest).join();
    if (before === made.map((row) => row.digest).join()) return;
    this.host.setRows([...this.host.rows().filter((row) => !mine(row)), ...made]);
  }
}
