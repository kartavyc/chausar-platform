// Chausar playbook kit: brand kits, asset records and voice consent (Ink v2 wave 5, package 5A4; catalogue P7, P8, P9,
// P10). The record bodies and the methods' answers, replacing 5-0's placeholders here, never in contracts.ts. Types
// only. Written for Chausar; nothing here is learned from an outside source.
import type { IsoDate, IsoTime } from '../../contracts.ts';

// ---------------------------------------------------------------------------
// Brand kits (P7)
// ---------------------------------------------------------------------------

/** A claim the client can prove, with the order file that proves it. */
export type KitClaim = { claim: string; proofFileId: string };
/** Every field of a brand kit. Lists are empty and the logo null when the client gave none. */
export type BrandKitFields = {
  /** Colours as hex, '#1f6f43'. */
  colours: string[];
  /** Font names, as the client writes them. */
  fonts: string[];
  /** The logo: an order file (venture-upload) of this client's, or null. */
  logoFileId: string | null;
  /** How the client sounds, in their words, one line each. */
  voice: string[];
  /** One to three samples of the client's own writing. */
  samples: string[];
  bannedWords: string[];
  bannedTopics: string[];
  competitors: string[];
  claims: KitClaim[];
};
export type BrandKitField = keyof BrandKitFields;
/** venture-brand-kit: one version of one client's kit. Every version is kept; the newest is in use. */
export type BrandKitBody = BrandKitFields & { clientId: string; version: number };
/** venture.brandKit.set's kit, as the owner sends it: any of the fields; a field left out is empty. */
export type BrandKitInput = Partial<BrandKitFields>;
/** Where a resolved field came from: the client's kit, the business voice (4J17), Chausar's house style, or the default. */
export type KitSource = 'client-kit' | 'business-voice' | 'house-style' | 'default';
/** A brand kit field by field, each with where it came from (client kit first, then the business, then the default). */
export type ResolvedKit = { [K in BrandKitField]: { value: BrandKitFields[K]; source: KitSource } };
/** A past brief of the client's: an order's request, kept as client memory. */
export type ClientBrief = { orderId: string; at: IsoTime; request: string };
/** venture.brandKit.get's and .set's answer. */
export type BrandKitView = {
  clientId: string;
  /** The kit in use (its newest version), or null when the client has none. */
  kit: BrandKitFields | null;
  version: number | null;
  /** The kit every creative step reads, field by field with its source. */
  resolved: ResolvedKit;
  /** The version before the one in use, to set to go back; null at the first. */
  undo: BrandKitInput | null;
  /** The client's past briefs, newest first: client memory. */
  memory: ClientBrief[];
  line: string;
};

// ---------------------------------------------------------------------------
// Asset records (P8) and stale by fingerprint (P10)
// ---------------------------------------------------------------------------

/**
 * Where a delivered file came from. A file whose source nobody recorded is 'unknown', and blocks Accept. A client's file
 * with no uploadId is one on this computer that the order named (a clip cleaned by media.clean).
 */
export type AssetSource =
  | { kind: 'client-file'; uploadId: string | null }
  | { kind: 'generated'; model: string; prompt: string }
  | { kind: 'licensed-stock'; provider: string; licenceId: string }
  | { kind: 'unknown' };
/** What the file cost: a receipt, not measured, or nothing new because it was reused. */
export type AssetCost = { kind: 'receipt'; receiptId: string } | { kind: 'not-measured' } | { kind: 'reused'; assetId: string };
/** A unit made from another file, which goes stale when that file changes (P10). */
export type DerivedUnit = 'narration' | 'captions' | 'translation' | 'dub' | 'article' | 'chapters';
/** The file a derived unit was made from: an upload, another asset, or the order's transcript (its newest). */
export type SourceRef = { kind: 'upload'; id: string } | { kind: 'asset'; id: string } | { kind: 'transcript'; orderId: string };
/** Location and camera data on a photo or clip: removed, still there (held for the owner), or not a photo or clip. */
export type AssetHygiene = { state: 'clean' | 'held' | 'not-media'; removed: string[] };
/**
 * venture-asset: one file a run delivers. 'requested': Rerun asked for it again and it is not made yet. 'consent-withdrawn':
 * made with a voice whose consent was revoked, so it is never used again.
 */
export type AssetBody = {
  orderId: string;
  clientId: string;
  runId: string | null;
  /** The assets.record call that recorded it, or null when a method did. */
  toolCallId: string | null;
  name: string;
  /** sha256 of the file's bytes, or null while it is requested. */
  fileDigest: string | null;
  source: AssetSource;
  /** The licence in plain words, or null when it is unknown. */
  licence: string | null;
  attribution: string | null;
  cost: AssetCost;
  /** A voice consent (venture-voice-consent) the file was made with, or null. */
  consentId: string | null;
  state: 'ready' | 'requested' | 'consent-withdrawn';
  hygiene: AssetHygiene;
  derived: { unit: DerivedUnit; source: SourceRef; sourceDigest: string } | null;
  supersededBy: string | null;
  supersedes: string | null;
  reusedFrom: string | null;
};
/** One asset as the screens read it, with why it would block Accept now. */
export type AssetView = AssetBody & {
  id: string;
  at: IsoTime;
  stale: boolean;
  /** Why Accept would refuse this file now (unknown licence, stale, consent withdrawn, held, not made), or null. */
  blocked: { code: string; line: string } | null;
  /** The source in plain words: "Your client's file", "Made by gpt-image-1", "Stock from Pexels (licence px-1)". */
  sourceLine: string;
  costLine: string;
};
/** venture.assets.list's answer: newest first. */
export type AssetsView = { assets: AssetView[]; line: string };
/** venture.assets.rerun's answer: the new asset, asked for again, and the one it supersedes (kept). */
export type AssetRerunView = { asset: AssetView; superseded: AssetView; line: string };
/** venture.assets.reuse's answer: the asset linked into the other order, with no new cost. */
export type AssetReuseView = { asset: AssetView; line: string };

// ---------------------------------------------------------------------------
// Voice consent (P9)
// ---------------------------------------------------------------------------

/**
 * venture-voice-consent: one version of a person's consent to use their voice (and to appear in client work), with the
 * reference recording (an order file), what it says, the statement they agreed to, the scope, and until when. Every
 * version is kept; only the newest of a speaker's is ever in use, and a revoked one stops every later use.
 */
export type VoiceConsentBody = {
  speaker: string;
  recordingFileId: string;
  recordingDigest: string;
  transcript: string;
  statement: string;
  scope: string;
  until: IsoDate | null;
  version: number;
  revokedAt: IsoTime | null;
};
/** current: the newest, not revoked, not past until. replaced: a newer version exists. */
export type VoiceConsentState = 'current' | 'expired' | 'revoked' | 'replaced';
export type VoiceConsentItem = VoiceConsentBody & { id: string; at: IsoTime; state: VoiceConsentState; assetsMade: number };
/** venture.voiceConsent.record's and .revoke's answer. */
export type VoiceConsentView = { consent: VoiceConsentItem; line: string };
/** venture.voiceConsent.list's answer: newest first. */
export type VoiceConsentsView = { consents: VoiceConsentItem[]; line: string };
