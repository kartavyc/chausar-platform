// Chausar connectors: speech out (Ink v2 wave 5, package 5A6), text to speech on the owner's own provider key. A
// capability table names each provider's languages, its stock voices with the licence their output is used under, the
// most characters one call takes, and its price per character from the provider's own page with the day it was
// checked. Before any call: the voice is a stock voice with its licence. A consented voice (5A4,
// playbooks/kit/voice-consent.ts) has its consent checked and is then refused until a provider's own voice-cloning call
// is built; its consent id is never sent as a voice name; a provider with no dated price is refused (UNPRICED_CALL), never
// counted as free; the quote is shown first (QUOTE_FIRST until the caller shows it was seen), and the spend is reserved
// before the call and settled after (money/spend.ts paidCall), so the same text is never paid for twice. The output's
// asset note (5A4) records the provider, the voice and the text's digest. Labels are honest: every provider here needs
// a key, and Chausar has no place to take one in this build, so each is planned, with what it waits on and the manual
// path; their prices stay null until someone reads them on the provider's page on a build day. AI voices are disclosed
// by the playbooks that use them (5Q, 5J2). Written for Chausar; nothing here is learned from an outside source.
import { createHash } from 'node:crypto';
import { check, ChausarError, type Context } from '../../contracts.ts';
import type { SpendRate, VentureDeps } from '../contracts.ts';
import { exactPayload, formatMicros, readVenture } from '../records.ts';
import { guardedFetch } from '../core/net-guard.ts';
import { paidCall } from '../money/spend.ts';
import { requireVoiceConsent, checkVoiceUse, todayOf } from '../playbooks/kit/voice-consent.ts';
import type { AssetNote } from '../playbooks/kit/assets.ts';
import { quotaRefusal } from './publish-tiers.ts';
import { CHAUSAR_USER_AGENT } from './fetch-policy.ts';
import type { SpeechPrice, SpeechProvidersView, SpeechProviderView, SpeechQuote, SpeechVoice } from './records-connect.ts';

/** One provider: what the screens show, and how a call is made (null for a provider whose call is not written yet). */
export type SpeechProvider = Omit<SpeechProviderView, 'label'> & {
  request: ((text: string, voice: string, key: string) => { url: string; headers: Record<string, string>; body: string }) | null;
  audio: ((body: Buffer) => Buffer) | null;
};

const WAITS_ON_KEY = 'Chausar: a place in Connections to add your own key for it. Not in this build.';
const MANUAL = 'Make the audio in the provider\'s own site or console with your account, and add the file to the order.';
const NO_PRICE_NOTE = 'Its price is not filled in: nobody has read it on the provider\'s page on a build day, and Chausar never guesses a price.';

export const SPEECH_PROVIDERS: readonly SpeechProvider[] = Object.freeze([
  {
    id: 'google-tts', name: 'Google Cloud Text-to-Speech', languages: ['en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN'], maxChars: 5000,
    voices: [
      { id: 'hi-IN-Standard-A', name: 'Hindi, standard voice A', language: 'hi-IN', licence: 'Google\'s stock voice; its Cloud terms let you use the audio you make.' },
      { id: 'en-IN-Standard-A', name: 'Indian English, standard voice A', language: 'en-IN', licence: 'Google\'s stock voice; its Cloud terms let you use the audio you make.' },
    ],
    price: null, waitsOn: WAITS_ON_KEY, manualPath: MANUAL, note: `Many Indian languages on your own Google Cloud key. ${NO_PRICE_NOTE}`,
    // Cloud Text-to-Speech v1 text:synthesize, the key in its header; the answer's audioContent is base64.
    request: (text, voice, key) => ({
      url: 'https://texttospeech.googleapis.com/v1/text:synthesize', headers: { 'x-goog-api-key': key },
      body: JSON.stringify({ input: { text }, voice: { languageCode: voice.slice(0, 5), name: voice }, audioConfig: { audioEncoding: 'MP3' } }),
    }),
    audio: body => Buffer.from(String((JSON.parse(body.toString('utf8')) as { audioContent?: unknown }).audioContent ?? ''), 'base64'),
  },
  {
    id: 'sarvam-tts', name: 'Sarvam AI (Bulbul)', languages: ['hi-IN', 'en-IN', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'od-IN', 'pa-IN'], maxChars: 1500,
    voices: [{ id: 'anushka', name: 'Anushka', language: 'hi-IN', licence: 'Sarvam\'s stock voice; check its terms for commercial use of the audio.' }],
    price: null, waitsOn: WAITS_ON_KEY, manualPath: MANUAL, note: `Indian languages, made in India. Its call is not written yet: it is checked against Sarvam's own docs first. ${NO_PRICE_NOTE}`,
    request: null, audio: null,
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', languages: ['en-IN', 'hi-IN', 'ta-IN'], maxChars: 5000,
    voices: [{ id: 'default-stock', name: 'A stock voice from its library', language: 'en-IN', licence: 'ElevenLabs\' stock voice; its paid plans allow commercial use of the audio.' }],
    price: null, waitsOn: WAITS_ON_KEY, manualPath: MANUAL, note: `Natural voices; cloning needs the speaker's recorded consent. Its call is not written yet. ${NO_PRICE_NOTE}`,
    request: null, audio: null,
  },
]);

const keyOf = (id: string) => `speech:${id}` as const;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** A provider as the screens show it: write only when its call is written and the owner's key is here, else planned. */
function viewOf(deps: VentureDeps, provider: SpeechProvider): SpeechProviderView {
  const { request: _request, audio: _audio, ...rest } = provider;
  const ready = !!provider.request && deps.secrets.has(keyOf(provider.id));
  return { ...structuredClone(rest), label: ready ? 'write' : 'planned: write' };
}

/** venture.speechOut.providers {} (read): the capability table with each provider's honest label. */
export async function speechProviders(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SpeechProvidersView> {
  exactPayload(payload ?? {}, []);
  readVenture(deps, ctx);
  const providers = SPEECH_PROVIDERS.map(provider => viewOf(deps, provider));
  const ready = providers.filter(provider => provider.label === 'write').length;
  return { providers, line: ready ? `${ready} of these can make speech on your key.` : 'Each needs your own key, which Chausar cannot take yet. Make audio in the provider\'s own site meanwhile.' };
}

/** The quote for one call: characters, the cost in micro US dollars rounded up, the price it came from, the text's digest. */
export function speechQuote(provider: SpeechProvider, voice: string, text: string): SpeechQuote {
  const price: SpeechPrice | null = provider.price;
  if (!price || !price.checkedOn || !/^\d{1,15}$/.test(price.microsPerMillionChars)) {
    throw new ChausarError('UNPRICED_CALL', `${provider.name} has no dated price, so Chausar will not call it: an unknown price is never counted as free. Add its price from its own page first.`);
  }
  const chars = [...text].length;
  const micros = String((BigInt(chars) * BigInt(price.microsPerMillionChars) + 999_999n) / 1_000_000n);
  return { provider: provider.id, voice, chars, micros, figure: formatMicros(micros), price: { ...price }, textDigest: sha(text) };
}

/** The voice of a call: a stock voice with its licence, or a consented voice (5A4); anything else is refused. */
export type SpeechVoiceChoice = { stock: string } | { consentId: string; speaker: string };

/** What a call made: the audio, its digest, the quote it was made at, and the asset note the run stores (5A4). */
export type SpeechMade = { audio: Buffer; digest: string; quote: SpeechQuote; asset: AssetNote };

/**
 * One speech call, all checks first: the provider is ready (its call written, the owner's key here), the text fits one
 * call, the voice is allowed, the price is dated and the quote was seen (quoted: the quote's textDigest). Then the spend
 * is reserved, the provider called through the network guard, and the spend settled. A quota answer is QUOTA_REACHED in
 * the provider's words. The caller keeps the audio as a file of the order.
 */
export async function speechSay(
  deps: VentureDeps, ctx: Context, input: { provider: string; voice: SpeechVoiceChoice; text: string; quoted?: string; ref?: string },
  providers: readonly SpeechProvider[] = SPEECH_PROVIDERS,
): Promise<SpeechMade> {
  const provider = providers.find(item => item.id === input.provider);
  check(provider, 'INVALID_VENTURE_REQUEST', 'Choose one of the speech providers.');
  check(typeof input.text === 'string' && input.text.trim().length > 0, 'INVALID_VENTURE_REQUEST', 'Give the words to speak.');
  if ([...input.text].length > provider.maxChars) throw new ChausarError('SPEECH_TOO_LONG', `${provider.name} takes at most ${provider.maxChars} characters a call. Split the text.`);
  const key = deps.secrets.get(keyOf(provider.id));
  if (!provider.request || !provider.audio || !key) throw new ChausarError('SPEECH_PLANNED', `${provider.name} is planned. It waits on ${provider.waitsOn ?? 'its key'} Until then: ${provider.manualPath ?? MANUAL}`);
  const { state, venture } = readVenture(deps, ctx);
  if (!('stock' in input.voice)) {
    // A consented voice: its consent is checked (5A4), and then refused, because no provider's own voice-cloning call
    // is built yet. The consent id is never sent anywhere as a voice name.
    const consent = requireVoiceConsent(state, venture, input.voice.consentId, todayOf(venture, deps.clock()));
    checkVoiceUse(input.voice.speaker, consent.speaker);
    throw new ChausarError('VOICE_NOT_ALLOWED', `${consent.speaker}'s consent is recorded, but ${provider.name}'s voice-cloning call is not built yet. Use one of its stock voices.`);
  }
  const stock: SpeechVoice | undefined = provider.voices.find(item => item.id === (input.voice as { stock: string }).stock);
  if (!stock) throw new ChausarError('VOICE_NOT_ALLOWED', 'Use one of the provider\'s stock voices, with its licence.');
  const voiceId = stock.id, licence = stock.licence, consentId: string | null = null;
  const quote = speechQuote(provider, voiceId, input.text);
  if (input.quoted !== quote.textDigest) throw new ChausarError('QUOTE_FIRST', `Show the quote first: ${quote.chars} characters with ${provider.name} costs about ${quote.figure} at its price of ${quote.price.checkedOn}.`);
  const item = `connector:speech-${provider.id}`;
  const rate: SpendRate = {
    item, unit: 'per-call', inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: quote.micros, source: quote.price.source,
    checkedOn: quote.price.checkedOn, confirmed: false, by: 'list',
  };
  const audio = await paidCall(deps, ctx, {
    key: `speech:${provider.id}:${voiceId}:${quote.textDigest.slice(0, 32)}${input.ref ? `:${input.ref}` : ''}`, item, label: `Speech from ${provider.name}`,
    payer: 'You, on your own provider key', draftDigest: quote.textDigest, connector: provider.id, list: rate,
  }, async () => {
    const call = provider.request!(input.text, voiceId, key);
    const answer = await guardedFetch({
      url: call.url, method: 'POST', body: call.body, maxRedirects: 0, timeoutMs: 60_000, maxBytes: 20 * 1024 * 1024,
      headers: { 'content-type': 'application/json', 'user-agent': CHAUSAR_USER_AGENT, ...call.headers },
    }, deps.net ?? {});
    const body = answer.body.toString('utf8');
    const quota = quotaRefusal(provider.name, answer.status, body);
    if (quota) throw quota;
    if (answer.status < 200 || answer.status > 299) throw new ChausarError('NET_FAILED', `${provider.name} answered ${answer.status}. The cost stays held until you check your provider's usage.`);
    return { value: provider.audio!(answer.body), billedMicros: null };
  });
  check(audio.length > 0, 'NET_FAILED', `${provider.name} sent no audio.`);
  const digest = createHash('sha256').update(audio).digest('hex');
  return {
    audio, digest, quote,
    asset: {
      name: `speech-${quote.textDigest.slice(0, 12)}.mp3`, fileDigest: digest,
      source: { kind: 'generated', model: `${provider.id}:${voiceId}`, prompt: `text sha256 ${quote.textDigest}` },
      licence, attribution: null, cost: { kind: 'not-measured' }, consentId, hygiene: { state: 'not-media', removed: [] }, derived: null,
    },
  };
}
