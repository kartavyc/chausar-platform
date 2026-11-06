// Chausar delivery harness: the playbook kit's media tools (Ink v2 wave 5, package 5A4): assets.record notes where a
// file the run delivers came from (P8), and media.clean takes the location and camera data out of the order's clip on
// this computer (P9). Neither writes on its own: the run stores what they answered as Chausar's own asset records in
// its transaction (playbooks/kit/assets.ts storeRunAssets). tools-kit.ts lists them. Loaded while tools.ts is still
// being set up, so nothing here takes a value from tools.ts (as tools-kit.ts says): its refusals are the harness's own
// TOOL_FAILED, and the voice-consent check is loaded on use. Written for Chausar; nothing here is learned from an
// outside source.
import { basename } from 'node:path';
import { ChausarError } from '../../../contracts.ts';
import type { ToolName } from '../../contracts.ts';
import { localPathProblem } from '../../../local-paths.ts';
import { RIGHTS_LABELS } from '../rights.ts';
import type { Field, Spec, ToolEnv } from './tools.ts';
import type { FileLike } from './files.ts';
import type { AssetNote } from '../../playbooks/kit/assets.ts';
import type { AssetCost, AssetSource, DerivedUnit, SourceRef } from '../../playbooks/kit/records-media.ts';
import { cleanClip, clipHygiene, ffmpegOf } from '../../playbooks/kit/media-intake.ts';

type MediaToolName = Extract<ToolName, 'assets.record' | 'media.clean'>;

/** The harness's own refusal, which the agent reads. */
function fail(message: string): never { throw new ChausarError('TOOL_FAILED', message); }
const text = (about: string, max: number, required = true): Field => ({ type: 'text', required, max, about });
/** An order file by its short name (f1, f2, ...), as tools.ts names them. */
function fileOf(env: ToolEnv, alias: unknown): FileLike {
  const match = typeof alias === 'string' ? /^f(\d{1,2})$/.exec(alias) : null;
  const file = match ? env.files[parseInt(match[1], 10) - 1] : undefined;
  if (!file) fail(`There is no file ${JSON.stringify(alias)}. The files are: ${env.files.map((_, i) => `f${i + 1}`).join(', ') || 'none'}.`);
  return file!;
}

const SOURCES = Object.freeze(['client-file', 'generated', 'licensed-stock', 'unknown'] as const);
const UNITS: readonly DerivedUnit[] = Object.freeze(['captions', 'translation', 'dub', 'article', 'chapters']);
const PRACTICE = Object.freeze({ recorded: false, practice: true });

/** The client's rights recorded at intake, as a licence line; null when none were recorded. */
function rightsLicence(env: ToolEnv): string | null {
  const rights = env.intake?.rights;
  return rights ? `${RIGHTS_LABELS[rights.basis]} (${rights.holder})` : null;
}

const optional = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** What the agent named as the source, checked: each kind with the fields it needs. */
function sourceOf(env: ToolEnv, input: Record<string, any>): { source: AssetSource; digest: string | null; licence: string | null } {
  const kind = input.source as typeof SOURCES[number];
  const digest = optional(input.digest);
  if (digest !== null && !/^[0-9a-f]{64}$/.test(digest)) fail('digest is the file\'s sha256, 64 lower-case hex characters.');
  if (kind === 'client-file') {
    const file = fileOf(env, input.from);
    return { source: { kind, uploadId: file.id }, digest: file.digest, licence: rightsLicence(env) };
  }
  if (kind === 'generated') {
    const model = optional(input.model), prompt = optional(input.prompt);
    if (!model || !prompt) fail('A generated file needs the model that made it and the prompt it was given.');
    return { source: { kind, model: model!, prompt: prompt! }, digest, licence: optional(input.licence) };
  }
  if (kind === 'licensed-stock') {
    const provider = optional(input.provider), licenceId = optional(input.licenceId);
    if (!provider || !licenceId) fail('Licensed stock needs its provider and its licence id.');
    return { source: { kind, provider: provider!, licenceId: licenceId! }, digest, licence: optional(input.licence) };
  }
  return { source: { kind: 'unknown' }, digest, licence: null };
}

/** The receipt behind the cost, when the agent named one (w1); else not measured. */
function costOf(env: ToolEnv, alias: unknown): AssetCost {
  const name = optional(alias);
  if (name === null) return { kind: 'not-measured' };
  const match = /^w(\d{1,2})$/.exec(name);
  const receipt = match ? env.receipts[parseInt(match[1], 10) - 1] : undefined;
  if (!receipt) fail(`There is no receipt ${JSON.stringify(name)}. The receipts are: ${env.receipts.map((_, index) => `w${index + 1}`).join(', ') || 'none'}.`);
  return { kind: 'receipt', receiptId: receipt!.id };
}

/** What a derived unit was made from: the order's transcript, an order file (f1), or another asset by its id. */
function derivedOf(env: ToolEnv, input: Record<string, any>): AssetNote['derived'] {
  const unit = optional(input.unit);
  if (unit === null) return null;
  if (!UNITS.includes(unit as DerivedUnit)) fail(`unit is one of ${UNITS.join(', ')}.`);
  const from = optional(input.madeFrom);
  if (from === null) fail('A derived file names what it was made from: transcript, a file such as f1, or an asset id.');
  const source: SourceRef = from === 'transcript' ? { kind: 'transcript', orderId: '' }
    : /^f\d{1,2}$/.test(from!) ? { kind: 'upload', id: fileOf(env, from).id }
      : /^asset_[A-Za-z0-9_-]{1,80}$/.test(from!) ? { kind: 'asset', id: from! }
        : fail('madeFrom is transcript, a file such as f1, or an asset id.');
  return { unit: unit as DerivedUnit, source };
}

/** The consent a voice file was made with, checked as current now (voice-consent.ts, loaded on use). */
async function consentOf(env: ToolEnv, value: unknown): Promise<string | null> {
  const id = optional(value);
  if (id === null) return null;
  if (!env.deps) fail('Voice consent cannot be checked here.');
  const { requireVoiceConsent, todayOf } = await import('../../playbooks/kit/voice-consent.ts');
  const { currentVenture } = await import('../../records.ts');
  const state = env.deps.store.read();
  const venture = currentVenture(state);
  if (!venture) fail('Start a business first.');
  return requireVoiceConsent(state, venture!, id, todayOf(venture!, env.now ? env.now() : env.deps.clock())).id;
}

export const MEDIA_TOOLS: Readonly<Record<MediaToolName, Spec>> = Object.freeze({
  'assets.record': {
    // Its real effect is a write to Chausar's own asset records, declared in policy/effects.ts and let through the taint
    // latch as an internal record (policy/taint.ts INTERNAL_SUGGESTIONS); the coarse label has no word for that.
    name: 'assets.record', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Records where a file you deliver came from: your client\'s file (from f1), generated (model and prompt), licensed stock (provider and licence id) or unknown, with its licence, credit and cost (a receipt such as w1). A file with no known licence cannot be accepted.',
    input: {
      file: text('The file you deliver, by its name, such as thumbnail.png.', 120),
      source: { type: 'enum', required: true, values: SOURCES, about: 'Where it came from: client-file, generated, licensed-stock or unknown.' },
      from: text("For client-file: the order's file it is, such as f1.", 12, false),
      model: text('For generated: the model that made it.', 80, false),
      prompt: text('For generated: the prompt it was given.', 500, false),
      provider: text('For licensed-stock: the library it came from.', 80, false),
      licenceId: text('For licensed-stock: the licence id the library gave.', 80, false),
      licence: text('The licence in plain words, for generated or stock.', 200, false),
      attribution: text('The credit the licence asks for, if any.', 200, false),
      cost: text('The receipt of what it cost, such as w1, when there is one.', 12, false),
      digest: text("The file's sha256, when you have it.", 64, false),
      voice: text('For a file made with a person\'s voice: the consent it was made with.', 80, false),
      unit: { type: 'enum', required: false, values: UNITS, about: 'For a file made from another: captions, translation, dub, article or chapters.' },
      madeFrom: text('For a derived file: transcript, a file such as f1, or an asset id.', 90, false),
    },
    async run(env, input) {
      if (env.runRef.kind !== 'delivery') return { result: PRACTICE };
      const name = String(input.file ?? '').replace(/\s+/g, ' ').trim();
      if (!name || /[\\/]/.test(name)) fail('file is the file\'s name only, such as thumbnail.png.');
      const { source, digest, licence } = sourceOf(env, input);
      const note: AssetNote = {
        name, fileDigest: digest, source, licence, attribution: optional(input.attribution), cost: costOf(env, input.cost),
        consentId: await consentOf(env, input.voice), hygiene: { state: 'not-media', removed: [] }, derived: derivedOf(env, input),
      };
      const line = note.licence === null
        ? `Recorded. ${name} has no known licence, so the owner cannot accept the draft until where it came from is recorded.`
        : `Recorded where ${name} came from.`;
      return { result: { recorded: true, asset: structuredClone(note), line } as never };
    },
  },
  'media.clean': {
    // It writes one new file beside the order's clip on this computer, never over it; policy/effects.ts declares that
    // write, so on a real order it waits for the owner like any write.
    name: 'media.clean', effect: 'compute', tier: 'code', endsTurn: false,
    summary: "Removes the location and camera data from the order's clip on this computer, into a new file beside it. With no ffmpeg here the clip is held, and the owner is told.",
    input: {},
    async run(env) {
      if (env.runRef.kind !== 'delivery') return { result: PRACTICE };
      if (!env.deps || env.deps.host === 'hosted-web') fail('Clips are cleaned in the desktop app.');
      const clip = env.intake?.cutFile ?? null;
      if (!clip) fail('This order names no clip on this computer.');
      const problem = localPathProblem(clip);
      if (problem) fail(`The clip: ${problem}`);
      const cleaned = await cleanClip(ffmpegOf(env.deps), clip!);
      if (cleaned.status === 'failed') fail(cleaned.line);
      const note: AssetNote = {
        name: basename(cleaned.status === 'cleaned' ? cleaned.output : clip!), fileDigest: null, source: { kind: 'client-file', uploadId: null },
        licence: rightsLicence(env), attribution: null, cost: { kind: 'not-measured' }, consentId: null, hygiene: clipHygiene(cleaned), derived: null,
      };
      const line = cleaned.status === 'cleaned' ? `Cleaned: ${note.name} has no location or camera data.` : cleaned.line;
      return { result: { recorded: true, cleaned: cleaned.status === 'cleaned', ...(cleaned.status === 'cleaned' ? { output: cleaned.output } : {}), asset: structuredClone(note), line } as never };
    },
  },
});
