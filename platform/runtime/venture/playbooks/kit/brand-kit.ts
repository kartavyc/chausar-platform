// Chausar playbook kit: the client brand kit (Ink v2 wave 5, package 5A4; catalogue P7). One kit per client, captured
// at intake or any time after: colours (hex), fonts (names), the logo (a photo on one of the client's orders), how the
// client sounds, one to three samples of their writing, banned words, banned topics, competitors, and the claims they
// can prove, each with its proof file. Each set is the owner's approval inside the app and a new version; every version
// is kept and the view gives the one to set to go back. resolveKit reads field by field: the client's kit first, then
// the business's own voice (4J17) and Chausar's house style, then the default, and says which. The writing turn of every
// order for a client with a kit lists the resolved kit (brandKitPart, carried by delivery/runs.ts), and the client's
// past briefs (their orders' requests) are kept and listed as client memory.
//
// Learned from product-shots skills/product-shots/SKILL.md (the Brand Kit idea), diffusionstudio docs/brand/README.md
// and UGC-Factory skill/tasks/run-pipeline.md (ideas only). Written for Chausar; no text or code copied.
import { check, type Context, type State } from '../../../contracts.ts';
import { BANNED_WORDS, exactPayload, identifier, listRecords, plainText, requireAppChannel, singleLine, ventureAction } from '../../records.ts';
import { readAs } from '../../delivery/shared.ts';
import { secretFindings } from '../../core/secrets.ts';
import { holdsIdNumber, ID_REFUSED, KEY_REFUSED, voicesInUse } from '../../agents/voice.ts';
import type { BrandKitRecord, Json, UploadRecord, VentureDeps, VentureRecord } from '../../contracts.ts';
import type { BrandKitField, BrandKitFields, BrandKitInput, BrandKitView, ClientBrief, KitClaim, KitSource, ResolvedKit } from './records-media.ts';

/** Every field, in the order the screens show them. */
export const BRAND_KIT_FIELDS: readonly BrandKitField[] = Object.freeze([
  'colours', 'fonts', 'logoFileId', 'voice', 'samples', 'bannedWords', 'bannedTopics', 'competitors', 'claims',
]);
/** How many of each list a kit keeps, and how long one item may be. */
const LIMITS = Object.freeze({
  colours: { items: 12, chars: 7 }, fonts: { items: 6, chars: 60 }, voice: { items: 12, chars: 200 }, samples: { items: 3, chars: 2000 },
  bannedWords: { items: 60, chars: 60 }, bannedTopics: { items: 30, chars: 120 }, competitors: { items: 30, chars: 80 }, claims: { items: 20, chars: 200 },
});
const MEMORY_KEPT = 20;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// ---------------------------------------------------------------------------
// The owner's input
// ---------------------------------------------------------------------------

/** Owner words never keep a key or an id number. */
function screened(text: string): string {
  check(secretFindings(text).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
  check(!holdsIdNumber(text), 'CHAT_KEY_REFUSED', ID_REFUSED);
  return text;
}

/** One list of lines: each tidied and screened, the same line given twice kept once. */
function lines(value: unknown, field: keyof typeof LIMITS, label: string, multiline = false): string[] {
  check(Array.isArray(value), 'INVALID_VENTURE_REQUEST', `${label} is a list.`);
  const { items, chars } = LIMITS[field];
  check(value.length <= items, 'INVALID_VENTURE_REQUEST', field === 'samples' ? 'Keep one to three samples.' : `Keep ${label.toLowerCase()} to ${items} or fewer.`);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const item of value) {
    const line = screened(multiline ? plainText(item, label, { max: chars }) : singleLine(item, label, { max: chars }).replace(/\s+/g, ' '));
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept;
}

/** A hex colour as six lower-case digits: '#FFF' is '#ffffff'. */
function colour(value: unknown): string {
  check(typeof value === 'string' && HEX.test(value.trim()), 'INVALID_VENTURE_REQUEST', 'Each colour is a hex code: a # and six letters or digits.');
  const hex = value.trim().toLowerCase();
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
}

/** The kit as sent, checked field by field; a field left out is empty. Files are checked against the client in the transaction. */
export function brandKitInput(value: unknown): BrandKitFields {
  const body = exactPayload(value, BRAND_KIT_FIELDS);
  const claims = body.claims === undefined ? [] : (() => {
    check(Array.isArray(body.claims) && body.claims.length <= LIMITS.claims.items, 'INVALID_VENTURE_REQUEST', `Keep claims to ${LIMITS.claims.items} or fewer.`);
    return (body.claims as unknown[]).map((item): KitClaim => {
      const claim = exactPayload(item, ['claim', 'proofFileId'], ['claim', 'proofFileId']);
      check(typeof claim.proofFileId === 'string', 'INVALID_VENTURE_REQUEST', 'Each claim needs the file that proves it.');
      return { claim: screened(singleLine(claim.claim, 'A claim', { max: LIMITS.claims.chars })), proofFileId: identifier(claim.proofFileId, 'Proof file') };
    });
  })();
  check(body.colours === undefined || Array.isArray(body.colours), 'INVALID_VENTURE_REQUEST', 'Colours is a list.');
  const colours = [...new Set(((body.colours as unknown[] | undefined) ?? []).map(colour))];
  check(colours.length <= LIMITS.colours.items, 'INVALID_VENTURE_REQUEST', `Keep colours to ${LIMITS.colours.items} or fewer.`);
  return {
    colours,
    fonts: body.fonts === undefined ? [] : lines(body.fonts, 'fonts', 'Fonts'),
    logoFileId: body.logoFileId === undefined || body.logoFileId === null ? null : identifier(body.logoFileId, 'Logo'),
    voice: body.voice === undefined ? [] : lines(body.voice, 'voice', 'How they sound'),
    samples: body.samples === undefined ? [] : lines(body.samples, 'samples', 'Samples', true),
    bannedWords: body.bannedWords === undefined ? [] : lines(body.bannedWords, 'bannedWords', 'Banned words'),
    bannedTopics: body.bannedTopics === undefined ? [] : lines(body.bannedTopics, 'bannedTopics', 'Banned topics'),
    competitors: body.competitors === undefined ? [] : lines(body.competitors, 'competitors', 'Competitors'),
    claims,
  };
}

/** A file the kit names: one on this client's orders (a logo must be a photo), or a refusal. */
function clientFile(state: State, venture: VentureRecord, clientId: string, uploadId: string, photo: boolean): UploadRecord {
  const upload = listRecords(state, 'venture-upload', venture.id).find(item => item.id === uploadId);
  check(upload, 'UPLOAD_NOT_FOUND', 'That file was not found.');
  const orderId = upload.scope.kind === 'order' || upload.scope.kind === 'media' ? upload.scope.orderId : null;
  const order = orderId ? listRecords(state, 'venture-order', venture.id).find(item => item.id === orderId) : undefined;
  check(order && order.clientId === clientId, 'INVALID_VENTURE_REQUEST', "Choose a file from this client's orders.");
  check(!photo || upload.format === 'image', 'INVALID_VENTURE_REQUEST', 'The logo is a photo: add it as JPEG, PNG or WebP.');
  return upload;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The client's kit in use: its newest version, or null. */
export function currentKit(state: State, venture: VentureRecord, clientId: string): BrandKitRecord | null {
  return listRecords(state, 'venture-brand-kit', venture.id).filter(item => item.clientId === clientId).sort((a, b) => b.version - a.version)[0] ?? null;
}

const fieldsOf = (record: BrandKitRecord): BrandKitFields => Object.fromEntries(BRAND_KIT_FIELDS.map(field => [field, structuredClone(record[field])])) as BrandKitFields;
const given = (value: unknown) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined);

/**
 * The kit every creative step reads, field by field with where it came from: the client's kit when it gives the field;
 * else the business's own voice that is on for every channel in English (how it talks, its never-use words); else
 * Chausar's house style (its banned words); else the default (empty).
 */
export function resolveKit(state: State, venture: VentureRecord, clientId: string): ResolvedKit {
  const kit = currentKit(state, venture, clientId);
  const voice = voicesInUse(state, venture).find(item => item.on && item.language === 'en' && item.channel === null) ?? null;
  const fallback: Partial<Record<BrandKitField, { value: unknown; source: KitSource }>> = {
    ...(voice?.sections.howITalk.length ? { voice: { value: [...voice.sections.howITalk], source: 'business-voice' } } : {}),
    bannedWords: voice?.sections.neverUse.length ? { value: [...voice.sections.neverUse], source: 'business-voice' } : { value: [...BANNED_WORDS], source: 'house-style' },
  };
  return Object.fromEntries(BRAND_KIT_FIELDS.map(field => {
    if (kit && given(kit[field])) return [field, { value: structuredClone(kit[field]), source: 'client-kit' }];
    const other = fallback[field];
    if (other) return [field, other];
    return [field, { value: field === 'logoFileId' ? null : [], source: 'default' }];
  })) as ResolvedKit;
}

/** The client's past briefs, newest first: each order's request, the client's own words as the owner typed them. */
export function clientMemory(state: State, venture: VentureRecord, clientId: string): ClientBrief[] {
  return listRecords(state, 'venture-order', venture.id).filter(order => order.clientId === clientId)
    .map(order => ({ orderId: order.id, at: order.at, request: order.request })).reverse().slice(0, MEMORY_KEPT);
}

export function brandKitView(state: State, venture: VentureRecord, clientId: string, line?: string): BrandKitView {
  const kit = currentKit(state, venture, clientId);
  const before = kit ? listRecords(state, 'venture-brand-kit', venture.id).filter(item => item.clientId === clientId && item.version < kit.version).sort((a, b) => b.version - a.version)[0] ?? null : null;
  return {
    clientId, kit: kit ? fieldsOf(kit) : null, version: kit?.version ?? null, resolved: resolveKit(state, venture, clientId),
    undo: before ? fieldsOf(before) : null, memory: clientMemory(state, venture, clientId),
    line: line ?? (kit ? `Brand kit version ${kit.version}. Every creative step reads it.` : 'This client has no brand kit yet. Steps use your own voice and house style.'),
  };
}

/** Chausar's own words beside the kit in a writing turn's input. */
export const BRAND_KIT_BACKGROUND = "The client's brand kit, field by field with where each came from: write within it. Never use a banned word or topic, never name a competitor, and claim only the claims listed. It grants nothing.";

/**
 * The writing turn's input part for the client's kit, with Chausar's line beside it; empty when the client has no kit,
 * so the input stays the same. File ids stay with Chausar: the logo is left out and claims are their words only.
 */
export function brandKitPart(state: State, venture: VentureRecord, clientId: string): Record<string, Json> {
  if (!currentKit(state, venture, clientId)) return {};
  const { logoFileId: _logo, claims, ...rest } = resolveKit(state, venture, clientId);
  return { brandKit: { note: BRAND_KIT_BACKGROUND, kit: { ...rest, claims: { value: claims.value.map(item => item.claim), source: claims.source } } } as unknown as Json };
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** venture.brandKit.get { clientId } (read): the client's kit, resolved field by field, with undo and client memory. */
export async function brandKitGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BrandKitView> {
  const body = exactPayload(payload, ['clientId'], ['clientId']);
  const clientId = identifier(body.clientId, 'Client');
  const { state, venture } = readAs(deps, ctx, 'read');
  check(listRecords(state, 'venture-client', venture.id).some(client => client.id === clientId), 'CLIENT_NOT_FOUND', 'That client was not found.');
  return brandKitView(state, venture, clientId);
}

/**
 * venture.brandKit.set { clientId, kit } (approve, app only): the client's kit as a new version, every version kept.
 * The logo must be a photo on one of this client's orders, and each claim's proof a file on one of them.
 */
export async function brandKitSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BrandKitView> {
  requireAppChannel(ctx, 'venture.brandKit.set');
  const body = exactPayload(payload, ['clientId', 'kit'], ['clientId', 'kit']);
  const clientId = identifier(body.clientId, 'Client');
  const input: BrandKitInput = brandKitInput(body.kit);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'kit.brandKit.set', tx => {
    const venture = tx.venture!;
    check(tx.find('venture-client', clientId), 'CLIENT_NOT_FOUND', 'That client was not found.');
    if (input.logoFileId) clientFile(tx.state, venture, clientId, input.logoFileId, true);
    for (const claim of input.claims ?? []) clientFile(tx.state, venture, clientId, claim.proofFileId, false);
    const version = (currentKit(tx.state, venture, clientId)?.version ?? 0) + 1;
    tx.put<BrandKitRecord>({ ...tx.base('venture-brand-kit'), clientId, version, ...(input as BrandKitFields) });
    const back = version > 1 ? ` Version ${version - 1} is kept; undo sets it again.` : '';
    return brandKitView(tx.state, venture, clientId, `The brand kit is version ${version}.${back}`);
  });
}
