// Chausar venture launcher, agents (wave 6, package 6I1, D45): push-to-talk, as a chain. Speech to text through the
// owner's whisper.cpp on this computer (the setup of venture.transcription.set, Ink v2 wave 2) or Sarvam on the owner's
// own key; the words go back to the chat box unsent, as if typed; a chief answer is read aloud through
// build/speech-out.ts. The parts the fake engine shares are in talk-core.ts.
//
// The rules, held by code here:
// - A consent notice comes before the microphone first turns on (venture.talk.consent, by the notice's digest), and the
//   desktop shell lets the microphone open only for a session this file started (venture.talk.start, then
//   app/desktop/caption-permission.cjs checks venture.talk.get's session). Desktop only: the hosted tier says so.
// - One recording per session. It is written to a temporary folder for whisper.cpp and the folder is removed after, or
//   sent once to Sarvam; it is kept only when the owner chose to keep audio. The words are never kept here: they go to
//   the box, and the owner checks them and sends them like typed words, under the chat's own consent.
// - Nothing here approves anything. A spoken "yes" is text in the box; every approval is still a tap on its card.
// - Sarvam spends the owner's money: its dated price and a monthly limit (an owner setting) are approved once, by the
//   rate's digest, when the key is added; each recording's cost is computed by code in paise and counted against the
//   limit before it is sent; a failed answer keeps its cost counted, and nothing is retried.
// - Reading aloud speaks only receipt-checked text (talk-core.ts spokenFrom with the chief's own number guard): a
//   figure by its receipt's display, never a number the AI wrote. The quote comes first; the audio is played, not kept,
//   and is disclosed as an AI voice.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ChausarError, check, newId, type Context } from '../../contracts.ts';
import type { TalkHeard, TalkSaid, TalkSettingRecord, TalkStarted, TalkView, VentureDeps } from '../contracts.ts';
import { digest, exactPayload, listRecords, modelNumbers, requireAppChannel, ventureAction } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { hindiNumberWords } from '../delivery/harness/patches.ts';
import { guardedFetch } from '../core/net-guard.ts';
import { CHAUSAR_USER_AGENT } from '../build/fetch-policy.ts';
import { quotaRefusal } from '../build/publish-tiers.ts';
import { SPEECH_PROVIDERS, speechQuote, speechSay } from '../build/speech-out.ts';
import { narrationSpendQuote } from '../playbooks/narration-studio/spend.ts';
import { captionAudioBytes } from '../playbooks/translation-studio/caption-audio.ts';
import { parseTranscript } from '../playbooks/youtube/transcript.ts';
import {
  SARVAM_DEFAULT_CAP_MINOR, SARVAM_RATE_DIGEST, SARVAM_STT_PRICE, TALK_CONSENT_DIGEST, TALK_CONSENT_TEXT, TALK_SECONDS, TALK_SESSION_MS, TALK_WORDS,
  boxWords, monthOf, rupees, sarvamCostMinor, spokenFrom, wavMs, type TalkPart,
} from './talk-core.ts';

/** Where the owner's Sarvam key is kept (the vault's secret shelf); it never comes back to any screen. */
export const SARVAM_SECRET = 'speech:sarvam-stt' as const;
/** Sarvam's speech to text call, from its public API reference (fixture-tested: no key has run it). */
export const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';
export const SARVAM_STT_MODEL = 'saaras:v4';
/** The stock voice a chief answer is read in (Google's Indian English standard voice, licence in speech-out.ts). */
const READ_VOICE = 'en-IN-Standard-A';
const READ_LINE = 'An AI voice is reading Chausar\'s answer. The audio is played once and not kept.';

type Listen = 'whisper-local' | 'sarvam';
type Session = { id: string; owner: string; epoch: number; ventureId: string; provider: Listen; expires: number };
const sessions = new WeakMap<VentureDeps, Map<string, Session>>();

/** The open sessions of this engine; ones past their time are dropped, and all go when the workspace closes. */
function pool(deps: VentureDeps): Map<string, Session> {
  let map = sessions.get(deps);
  if (!map) {
    const made = new Map<string, Session>();
    map = made;
    sessions.set(deps, made);
    deps.closing?.signal.addEventListener('abort', () => made.clear(), { once: true });
  }
  for (const [id, session] of map) if (session.expires <= deps.clock().getTime()) map.delete(id);
  return map;
}

const DEFAULTS: Omit<TalkSettingRecord, keyof import('../contracts.ts').RecordBase<'venture-talk-setting'>> = {
  consentDigest: null, consentAt: null, keepAudio: false, listen: 'whisper-local', capMinor: SARVAM_DEFAULT_CAP_MINOR, rateDigest: null,
};
function settingOf(state: import('../../contracts.ts').State, ventureId: string) {
  return listRecords(state, 'venture-talk-setting', ventureId).at(-1) ?? null;
}
const consented = (setting: TalkSettingRecord | null) => setting?.consentDigest === TALK_CONSENT_DIGEST;
const hosted = (deps: VentureDeps) => deps.host === 'hosted-web';
const desktopOnly = (deps: VentureDeps) => check(!hosted(deps), 'TIER_UNAVAILABLE', TALK_WORDS.hosted);
const whisperReady = (deps: VentureDeps) => deps.services.speech?.localTranscriber() ?? { ready: false as const, reason: 'No whisper.cpp is set up on this computer.' };
const sarvamReady = (deps: VentureDeps, setting: TalkSettingRecord | null) => deps.secrets.has(SARVAM_SECRET) && setting?.rateDigest === SARVAM_RATE_DIGEST;

/** Paise spent on Sarvam this month: every recording sent or being sent counts, a failed one too (it may have been charged). */
function spentThisMonth(state: import('../../contracts.ts').State, ventureId: string, at: string): bigint {
  return listRecords(state, 'venture-talk-heard', ventureId).filter(row => row.provider === 'sarvam' && monthOf(row.at) === monthOf(at))
    .reduce((sum, row) => sum + BigInt(row.costMinor), 0n);
}

/** The screen's view: the notice, the services and their honest labels, this month's Sarvam spend, the open session. */
export function talkView(deps: VentureDeps, ctx: Context): TalkView {
  const { state, venture } = readAs(deps, ctx, 'read');
  const setting = settingOf(state, venture.id);
  const now = deps.clock().toISOString();
  const local = whisperReady(deps);
  const connected = sarvamReady(deps, setting);
  const capMinor = setting?.capMinor ?? SARVAM_DEFAULT_CAP_MINOR;
  const spent = String(spentThisMonth(state, venture.id, now));
  const google = SPEECH_PROVIDERS.find(provider => provider.id === 'google-tts')!;
  const speaks = !!google.request && !!google.price && deps.secrets.has('speech:google-tts');
  const session = [...pool(deps).values()].find(item => item.owner === ctx.memberId && item.epoch === ctx.epoch && item.ventureId === venture.id) ?? null;
  const given = consented(setting);
  return {
    desktop: !hosted(deps),
    consent: { given, stale: !!setting?.consentDigest && !given, text: TALK_CONSENT_TEXT, digest: TALK_CONSENT_DIGEST, at: given ? setting!.consentAt : null, keepAudio: setting?.keepAudio ?? false },
    listen: setting?.listen ?? 'whisper-local',
    whisper: { ready: local.ready, line: local.ready ? 'whisper.cpp is set up on this computer. Recordings stay here.' : local.reason },
    sarvam: {
      label: 'fixture-tested', connected, price: { ...SARVAM_STT_PRICE }, rateDigest: SARVAM_RATE_DIGEST,
      capMinor, cap: rupees(capMinor), spentMinor: spent, spent: rupees(spent),
      line: connected
        ? `Not tried live yet: Sarvam's call follows its public docs and hasn't run on a real key. ${rupees(spent)} of ${rupees(capMinor)} used this month.`
        : `Sarvam waits on your key. Its price is ${rupees(SARVAM_STT_PRICE.paisePerMinute)} a minute, read on its page on ${SARVAM_STT_PRICE.checkedOn}.`,
    },
    speak: { label: speaks ? 'write' : 'planned: write', line: speaks ? READ_LINE : TALK_WORDS.readOnScreen },
    session: session ? { id: session.id, expiresAt: new Date(session.expires).toISOString() } : null,
    recordings: listRecords(state, 'venture-talk-heard', venture.id).filter(row => row.audioBase64.length > 0).length,
    line: hosted(deps) ? TALK_WORDS.hosted : given ? TALK_WORDS.checkWords : TALK_WORDS.consent,
  };
}

/** venture.talk.get {} (read). */
export async function talkGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TalkView> {
  exactPayload(payload ?? {}, []);
  return talkView(deps, ctx);
}

/**
 * venture.talk.consent { digest, keepAudio } or { withdraw: true } (approve, app only): agrees to the notice by the
 * digest of its words, with the owner's choice to keep audio (off by default). Withdrawing turns the microphone off and
 * deletes every recording kept.
 */
export async function talkConsentHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TalkView> {
  requireAppChannel(ctx, 'venture.talk.consent');
  const body = exactPayload(payload, ['digest', 'keepAudio', 'withdraw']);
  if (body.withdraw !== undefined) check(body.withdraw === true && body.digest === undefined && body.keepAudio === undefined, 'INVALID_VENTURE_REQUEST', 'Send withdraw alone.');
  else {
    check(typeof body.keepAudio === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say whether to keep recordings.');
    check(body.digest === TALK_CONSENT_DIGEST, 'APPROVAL_STALE', TALK_WORDS.stale);
  }
  readAs(deps, ctx, 'approve');
  await ventureAction(deps, ctx, 'approve', body.withdraw ? 'talk.consent.withdraw' : 'talk.consent', tx => {
    const venture = tx.venture!;
    const current = settingOf(tx.state, venture.id);
    const keep = { ...DEFAULTS, ...(current ? { listen: current.listen, capMinor: current.capMinor, rateDigest: current.rateDigest } : {}) };
    if (body.withdraw) {
      for (const row of listRecords(tx.state, 'venture-talk-heard', venture.id)) {
        if (row.audioBase64) tx.replace({ ...row, audioBase64: '', audioDigest: '', erasedAt: tx.now });
      }
      tx.put<TalkSettingRecord>({ ...tx.base('venture-talk-setting'), ...keep, consentDigest: null, consentAt: null, keepAudio: false });
    } else {
      tx.put<TalkSettingRecord>({ ...tx.base('venture-talk-setting'), ...keep, consentDigest: TALK_CONSENT_DIGEST, consentAt: tx.now, keepAudio: body.keepAudio as boolean });
    }
  });
  if (body.withdraw) for (const [id, session] of pool(deps)) if (session.owner === ctx.memberId) pool(deps).delete(id);
  return talkView(deps, ctx);
}

/**
 * venture.talk.setup (approve, app only): { listen: 'whisper-local' }; { listen: 'sarvam', key?, capMinor, rateDigest },
 * which approves Sarvam's dated rate (by its digest) and the owner's monthly limit in paise, the key needed once; or
 * { clearSarvam: true }, which removes the key and goes back to whisper.cpp.
 */
export async function talkSetupHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TalkView> {
  requireAppChannel(ctx, 'venture.talk.setup');
  const body = exactPayload(payload, ['listen', 'key', 'capMinor', 'rateDigest', 'clearSarvam']);
  let listen: Listen = 'whisper-local';
  if (body.clearSarvam !== undefined) {
    check(body.clearSarvam === true && Object.keys(body).length === 1, 'INVALID_VENTURE_REQUEST', 'Send clearSarvam alone.');
  } else if (body.listen === 'sarvam') {
    listen = 'sarvam';
    check(typeof body.capMinor === 'string' && /^\d{1,12}$/.test(body.capMinor), 'INVALID_AMOUNT', 'Give your monthly Sarvam limit in whole paise.');
    check(body.rateDigest === SARVAM_RATE_DIGEST, 'APPROVAL_STALE', 'Sarvam\'s price changed. Review it again before approving.');
    if (body.key !== undefined) check(typeof body.key === 'string' && body.key.length >= 8 && body.key.length <= 500 && !/\s/.test(body.key), 'INVALID_VENTURE_REQUEST', 'Paste your Sarvam API subscription key.');
    else check(deps.secrets.has(SARVAM_SECRET), 'TALK_NOT_READY', TALK_WORDS.noSarvam);
  } else {
    check(body.listen === 'whisper-local' && Object.keys(body).length === 1, 'INVALID_VENTURE_REQUEST', 'Choose whisper.cpp or Sarvam.');
  }
  readAs(deps, ctx, 'approve');
  await ventureAction(deps, ctx, 'approve', 'talk.setup', tx => {
    const current = settingOf(tx.state, tx.venture!.id);
    const base = { ...DEFAULTS, ...(current ? { consentDigest: current.consentDigest, consentAt: current.consentAt, keepAudio: current.keepAudio, capMinor: current.capMinor, rateDigest: current.rateDigest } : {}) };
    if (body.clearSarvam) tx.put<TalkSettingRecord>({ ...tx.base('venture-talk-setting'), ...base, listen: 'whisper-local', rateDigest: null });
    else if (listen === 'sarvam') tx.put<TalkSettingRecord>({ ...tx.base('venture-talk-setting'), ...base, listen, capMinor: body.capMinor as string, rateDigest: SARVAM_RATE_DIGEST });
    else tx.put<TalkSettingRecord>({ ...tx.base('venture-talk-setting'), ...base, listen });
  });
  if (body.clearSarvam) deps.secrets.delete(SARVAM_SECRET);
  else if (typeof body.key === 'string') deps.secrets.set(SARVAM_SECRET, body.key);
  return talkView(deps, ctx);
}

/**
 * venture.talk.start {} (prepare, app only, desktop only): opens one recording session after the notice was agreed and
 * with a service ready. The desktop shell lets the microphone open once for it.
 */
export async function talkStartHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TalkStarted> {
  requireAppChannel(ctx, 'venture.talk.start');
  exactPayload(payload ?? {}, []);
  desktopOnly(deps);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const setting = settingOf(state, venture.id);
  check(consented(setting), 'TALK_CONSENT_REQUIRED', setting?.consentDigest ? TALK_WORDS.stale : TALK_WORDS.consent);
  const provider: Listen = setting?.listen ?? 'whisper-local';
  check(provider === 'sarvam' ? sarvamReady(deps, setting) : whisperReady(deps).ready, 'TALK_NOT_READY', provider === 'sarvam' ? TALK_WORDS.noSarvam : TALK_WORDS.noWhisper);
  const map = pool(deps);
  for (const [id, session] of map) if (session.owner === ctx.memberId) map.delete(id);
  const session: Session = { id: newId('talk'), owner: ctx.memberId, epoch: ctx.epoch, ventureId: venture.id, provider, expires: deps.clock().getTime() + TALK_SESSION_MS };
  map.set(session.id, session);
  return { sessionId: session.id, expiresAt: new Date(session.expires).toISOString(), seconds: TALK_SECONDS, provider };
}

/** Sarvam's multipart body: the model, language detection, and the recording as a WAV file. */
function sarvamBody(audio: Uint8Array, boundary: string): Buffer {
  const field = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  return Buffer.concat([
    Buffer.from(field('model', SARVAM_STT_MODEL) + field('language_code', 'unknown')
      + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="talk.wav"\r\nContent-Type: audio/wav\r\n\r\n`, 'latin1'),
    Buffer.from(audio), Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
  ]);
}

/** One call to Sarvam on the owner's key; its answer's transcript, or a refusal in plain words. Never retried. */
async function sarvamTranscript(deps: VentureDeps, audio: Uint8Array, key: string): Promise<string> {
  const boundary = `chausar-${randomBytes(12).toString('hex')}`;
  const answer = await guardedFetch({
    url: SARVAM_STT_URL, method: 'POST', body: sarvamBody(audio, boundary), maxRedirects: 0, timeoutMs: 60_000, maxBytes: 256 * 1024,
    headers: { 'api-subscription-key': key, 'content-type': `multipart/form-data; boundary=${boundary}`, 'user-agent': CHAUSAR_USER_AGENT },
  }, deps.net ?? {});
  const text = answer.body.toString('utf8');
  const quota = quotaRefusal('Sarvam', answer.status, text);
  if (quota) throw quota;
  if (answer.status < 200 || answer.status > 299) throw new ChausarError('SPEECH_FAILED', `Sarvam answered ${answer.status}. Nothing was retried; the cost stays counted until you check your Sarvam usage.`);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ChausarError('SPEECH_FAILED', 'Sarvam sent an answer Chausar could not read. Nothing was retried.'); }
  const transcript = (parsed as { transcript?: unknown } | null)?.transcript;
  if (typeof transcript !== 'string') throw new ChausarError('SPEECH_FAILED', 'Sarvam sent no transcript. Nothing was retried.');
  return transcript;
}

/** The owner's whisper.cpp on one recording, in a temporary folder removed afterwards whatever happens. */
async function whisperTranscript(deps: VentureDeps, ctx: Context, audio: Uint8Array): Promise<string> {
  const speech = deps.services.speech;
  check(speech?.localTranscriber().ready, 'TALK_NOT_READY', TALK_WORDS.noWhisper);
  const folder = await mkdtemp(join(tmpdir(), 'chausar-talk-'));
  let hold: (() => void) | undefined;
  try {
    hold = deps.closing?.hold();
    const path = join(folder, 'talk.wav');
    await writeFile(path, audio, { flag: 'wx', mode: 0o600 });
    const heard = await speech.transcribeFile(ctx, { path, prompt: '', timeoutMs: 60_000, ...(deps.closing ? { signal: deps.closing.signal } : {}) });
    return parseTranscript(heard.srt).map(cue => cue.text).join(' ');
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    hold?.();
  }
}

/**
 * venture.talk.hear { sessionId, audioBase64 } (approve, app only, desktop only): the session's one recording, mono
 * 16 kHz PCM of up to twenty seconds, turned into words by the service chosen at start. The words come back for the
 * chat box; they are not sent, kept or read as an approval. The recording is kept only when the owner chose to keep it.
 */
export async function talkHearHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TalkHeard> {
  requireAppChannel(ctx, 'venture.talk.hear');
  desktopOnly(deps);
  const body = exactPayload(payload, ['sessionId', 'audioBase64'], ['sessionId', 'audioBase64']);
  const { venture } = readAs(deps, ctx, 'approve');
  const map = pool(deps);
  const session = typeof body.sessionId === 'string' ? map.get(body.sessionId) : undefined;
  check(session && session.owner === ctx.memberId && session.epoch === ctx.epoch && session.ventureId === venture.id, 'TALK_SESSION_EXPIRED', TALK_WORDS.session);
  map.delete(session.id); // one recording per session, whatever happens next
  const audio = captionAudioBytes(body.audioBase64);
  const durationMs = wavMs(audio.length);
  check(durationMs > 0, 'INVALID_AUDIO', TALK_WORDS.nothing);
  const settingNow = () => settingOf(deps.store.read(), venture.id);
  check(consented(settingNow()), 'TALK_CONSENT_REQUIRED', TALK_WORDS.consent);
  const kept = (keep: boolean) => keep ? { audioBase64: Buffer.from(audio).toString('base64'), audioDigest: digest(Buffer.from(audio).toString('base64')) } : { audioBase64: '', audioDigest: '' };

  if (session.provider === 'whisper-local') {
    const words = boxWords(await whisperTranscript(deps, ctx, audio));
    check(words, 'TALK_NOTHING_HEARD', TALK_WORDS.nothing);
    const setting = settingNow();
    check(consented(setting), 'TALK_CONSENT_REQUIRED', TALK_WORDS.consent);
    await ventureAction(deps, ctx, 'approve', 'talk.heard', tx => {
      tx.put({ ...tx.base('venture-talk-heard'), provider: 'whisper-local', durationMs, costMinor: '0', phase: 'done', ...kept(setting!.keepAudio), erasedAt: null });
    });
    return { text: words, provider: 'whisper-local', kept: setting!.keepAudio, cost: null, line: TALK_WORDS.checkWords };
  }

  const key = deps.secrets.get(SARVAM_SECRET);
  check(key && sarvamReady(deps, settingNow()), 'TALK_NOT_READY', TALK_WORDS.noSarvam);
  const cost = sarvamCostMinor(durationMs);
  const row = await ventureAction(deps, ctx, 'approve', 'talk.sarvam.reserve', tx => {
    const setting = settingOf(tx.state, tx.venture!.id);
    check(consented(setting) && setting!.rateDigest === SARVAM_RATE_DIGEST, 'TALK_NOT_READY', TALK_WORDS.noSarvam);
    check(spentThisMonth(tx.state, tx.venture!.id, tx.now) + BigInt(cost) <= BigInt(setting!.capMinor), 'TALK_CAP_REACHED', TALK_WORDS.cap);
    return tx.put({ ...tx.base('venture-talk-heard'), provider: 'sarvam', durationMs, costMinor: cost, phase: 'sending', audioBase64: '', audioDigest: '', erasedAt: null });
  });
  let words: string;
  try {
    words = boxWords(await sarvamTranscript(deps, audio, key));
  } catch (error) {
    await ventureAction(deps, ctx, 'approve', 'talk.sarvam.failed', tx => { tx.replace({ ...tx.find('venture-talk-heard', row.id)!, phase: 'failed' }); });
    throw error;
  }
  const setting = settingNow();
  // Nothing heard: the call is counted as done (it may be charged), and no audio is kept for it, as with whisper.cpp.
  const keep = !!words && consented(setting) && setting!.keepAudio;
  await ventureAction(deps, ctx, 'approve', 'talk.sarvam.done', tx => { tx.replace({ ...tx.find('venture-talk-heard', row.id)!, phase: 'done', ...kept(keep) }); });
  check(words, 'TALK_NOTHING_HEARD', TALK_WORDS.nothing);
  return { text: words, provider: 'sarvam', kept: keep, cost: { minor: cost, figure: rupees(cost) }, line: TALK_WORDS.checkWords };
}

/** The chief's own number guard (chief/answer.ts labels such words a model estimate): digits, number words, Hindi number words. */
export const talkNumberGuard = (text: string) => modelNumbers(text) || hindiNumberWords(text).length > 0;

/**
 * venture.talk.say { threadId, messageId, quoted?, approvedRateDigest? } (approve, app only): reads one answer from
 * Chausar aloud, only its receipt-checked words. Without a quote it returns the words and the quote (nothing is sent);
 * with the quote's digest it makes the audio once through speech-out.ts on the owner's Google key and returns it to
 * play. Without that key it says to read on screen.
 */
export async function talkSayHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TalkSaid> {
  requireAppChannel(ctx, 'venture.talk.say');
  const body = exactPayload(payload, ['threadId', 'messageId', 'quoted', 'approvedRateDigest'], ['threadId', 'messageId']);
  const { state, venture } = readAs(deps, ctx, 'approve');
  const message = listRecords(state, 'venture-chief-message', venture.id).find(item => item.id === body.messageId && item.threadId === body.threadId && item.from === 'chief');
  check(message, 'TALK_NOT_FOUND', TALK_WORDS.notFound);
  const spoken = spokenFrom(message.parts as TalkPart[], message.worked?.length ?? 0, talkNumberGuard);
  check(spoken, 'TALK_NOT_FOUND', TALK_WORDS.notFound);
  const google = SPEECH_PROVIDERS.find(provider => provider.id === 'google-tts')!;
  // The same test as the view's label: the call written, a dated price, and the owner's key.
  if (!google.request || !google.price || !deps.secrets.has('speech:google-tts')) return { spoken, quote: null, audioBase64: null, line: TALK_WORDS.readOnScreen };
  const priced = narrationSpendQuote(speechQuote(google, READ_VOICE, spoken), listRecords(state, 'venture-spend-policy', venture.id));
  const quote = { chars: priced.chars, figure: priced.figure, checkedOn: priced.price.checkedOn, textDigest: priced.textDigest, rateDigest: priced.spend.rateDigest };
  if (body.quoted === undefined) return { spoken, quote, audioBase64: null, line: READ_LINE };
  check(typeof body.quoted === 'string' && (body.approvedRateDigest === undefined || typeof body.approvedRateDigest === 'string'), 'INVALID_VENTURE_REQUEST', 'Send the quote you saw.');
  const made = await speechSay(deps, ctx, {
    provider: 'google-tts', voice: { stock: READ_VOICE }, text: spoken, quoted: body.quoted,
    ...(typeof body.approvedRateDigest === 'string' ? { approvedRateDigest: body.approvedRateDigest } : {}), ref: `talk:${message.id}:${deps.clock().getTime()}`,
  });
  return { spoken, quote, audioBase64: made.audio.toString('base64'), line: READ_LINE };
}
