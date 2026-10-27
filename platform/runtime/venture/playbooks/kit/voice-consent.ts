// Chausar playbook kit: voice consent (Ink v2 wave 5, package 5A4; catalogue P9). A person's consent to use their voice,
// and to appear in client work, is a versioned record: the reference recording (an order file), what it says, the
// statement they agreed to, the scope and until when. Only the newest version of a speaker's is ever in use. Any call
// that sends a voice to a cloning or synthesis provider asks requireVoiceConsent first (CONSENT_REQUIRED without a
// current one); a step that names voice A never uses voice B (VOICE_MISMATCH, no silent substitution); a real person
// named in client work needs a current consent at intake (requirePeopleConsent). Revoking withdraws every version of
// that speaker's consent, and every file made with it is marked "consent withdrawn" and never used again.
//
// Learned from BaoCut voices-copy.ts (source-available, learn only) and LocalText2Voice services/temporary-assets
// (idea only): the reference recording beside its text and the statement. No code from either.
import { check, type Context, type State } from '../../../contracts.ts';
import { exactPayload, identifier, isoDate, listRecords, plainText, requireAppChannel, singleLine, ventureAction } from '../../records.ts';
import { readAs } from '../../delivery/shared.ts';
import { localDayAt } from '../../local-day.ts';
import { secretFindings } from '../../core/secrets.ts';
import { holdsIdNumber, ID_REFUSED, KEY_REFUSED } from '../../agents/voice.ts';
import type { IsoDate, OrderRecord, UploadRecord, VentureDeps, VentureRecord, VoiceConsentRecord } from '../../contracts.ts';
import type { IntakePerson } from './define.ts';
import type { VoiceConsentItem, VoiceConsentState, VoiceConsentsView, VoiceConsentView } from './records-media.ts';

/** A speaker's name compared without case or extra spaces: "Asha  Rao" and "asha rao" are one person. */
export const speakerKey = (name: string): string => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** The business's own date today, for until. */
export const todayOf = (venture: VentureRecord, now: Date | string): IsoDate => localDayAt(now, venture.country);

/** Where one consent stands today: withdrawn, replaced by a newer version, past its until, or current. */
export function consentState(state: State, record: VoiceConsentRecord, today: IsoDate): VoiceConsentState {
  if (record.revokedAt !== null) return 'revoked';
  const newer = listRecords(state, 'venture-voice-consent', record.ventureId)
    .some(item => speakerKey(item.speaker) === speakerKey(record.speaker) && item.version > record.version);
  if (newer) return 'replaced';
  return record.until !== null && record.until < today ? 'expired' : 'current';
}

/** The speaker's consent in use today, or null: their newest version, not withdrawn and not past its until. */
export function currentConsent(state: State, venture: VentureRecord, speaker: string, today: IsoDate): VoiceConsentRecord | null {
  const all = listRecords(state, 'venture-voice-consent', venture.id).filter(item => speakerKey(item.speaker) === speakerKey(speaker));
  const newest = all.sort((a, b) => b.version - a.version)[0];
  return newest && consentState(state, newest, today) === 'current' ? newest : null;
}

/** One consent as the screens read it, with how many files were made with it. */
function itemOf(state: State, record: VoiceConsentRecord, today: IsoDate): VoiceConsentItem {
  const { kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, ...body } = record;
  const assetsMade = listRecords(state, 'venture-asset', record.ventureId).filter(asset => asset.consentId === record.id).length;
  return { ...body, state: consentState(state, record, today), assetsMade };
}

/**
 * The consent a voice call may use, or CONSENT_REQUIRED: the consent named must be a speaker's current one. A replaced,
 * withdrawn or expired consent, or none, refuses: a voice never goes to a cloning or synthesis provider without it.
 */
export function requireVoiceConsent(state: State, venture: VentureRecord, consentId: string | null, today: IsoDate): VoiceConsentRecord {
  const record = consentId === null ? undefined : listRecords(state, 'venture-voice-consent', venture.id).find(item => item.id === consentId);
  check(record, 'CONSENT_REQUIRED', 'This voice has no consent on record. Record the speaker\'s consent before their voice goes to a voice provider.');
  const now = consentState(state, record, today);
  check(now === 'current', 'CONSENT_REQUIRED', {
    revoked: `${record.speaker} withdrew their consent. Their voice is not used again.`,
    replaced: `${record.speaker}'s consent has a newer version. Use that one.`,
    expired: `${record.speaker}'s consent ended on ${record.until}. Record it again before their voice is used.`,
    current: '',
  }[now]);
  return record;
}

/** A step that names one voice never uses another: VOICE_MISMATCH, with no silent substitution. */
export function checkVoiceUse(named: string, used: string): void {
  check(speakerKey(named) === speakerKey(used), 'VOICE_MISMATCH', `This step names ${named}'s voice, not ${used}'s. Chausar never swaps one voice for another.`);
}

/** Both checks a voice call makes before anything is sent: the voice is the one the step named, and its consent is current. */
export function voiceForCall(state: State, venture: VentureRecord, call: { stepVoice: string; consentId: string | null; today: IsoDate }): VoiceConsentRecord {
  const consent = requireVoiceConsent(state, venture, call.consentId, call.today);
  checkVoiceUse(call.stepVoice, consent.speaker);
  return consent;
}

/**
 * Every real person named in client work has a current consent recorded for them at intake, or CONSENT_REQUIRED names
 * the first who does not. consentId is the consent the owner picked for them; it must be that person's own.
 */
export function requirePeopleConsent(state: State, venture: VentureRecord, people: readonly { name: string; consentId: string | null }[], today: IsoDate): void {
  for (const person of people) {
    const record = person.consentId === null ? null : listRecords(state, 'venture-voice-consent', venture.id).find(item => item.id === person.consentId) ?? null;
    const ok = !!record && speakerKey(record.speaker) === speakerKey(person.name) && consentState(state, record, today) === 'current';
    check(ok, 'CONSENT_REQUIRED', `${person.name} appears in this work. Record their consent before the order starts.`);
  }
}

/** The people an order's intake names as seen or heard in the work (kit intake fields of kind 'people'). */
export function orderPeople(order: Pick<OrderRecord, 'intake'>): IntakePerson[] {
  const people: IntakePerson[] = [];
  for (const value of Object.values(order.intake?.fields ?? {})) {
    if (!Array.isArray(value)) continue;
    for (const item of value as unknown[]) {
      if (item && typeof item === 'object' && typeof (item as IntakePerson).name === 'string') {
        const person = item as IntakePerson;
        people.push({ name: person.name, consentId: typeof person.consentId === 'string' ? person.consentId : null });
      }
    }
  }
  return people;
}

/**
 * Every person the order names still has their consent, checked again at each run's start and at Accept, not only at
 * intake: someone who withdraws between two stages of a chain stops the work. CONSENT_REQUIRED names them.
 */
export function requireOrderPeopleConsent(state: State, venture: VentureRecord, order: Pick<OrderRecord, 'intake'>, today: IsoDate): void {
  const people = orderPeople(order);
  if (people.length) requirePeopleConsent(state, venture, people, today);
}

/**
 * Why a file made with a voice cannot go out now, read from that consent's state today, or null: withdrawn (or gone)
 * is CONSENT_WITHDRAWN, past its until is CONSENT_REQUIRED. A file stored after its consent was withdrawn is caught
 * here as well as one made before.
 */
export function madeWithConsentBlock(state: State, venture: VentureRecord, file: { name: string; consentId: string | null }, today: IsoDate): { code: string; line: string } | null {
  if (file.consentId === null) return null;
  const record = listRecords(state, 'venture-voice-consent', venture.id).find(item => item.id === file.consentId);
  if (!record || record.revokedAt !== null) return { code: 'CONSENT_WITHDRAWN', line: `${file.name} was made with a voice whose consent was withdrawn. Take it out.` };
  if (record.until !== null && record.until < today) {
    return { code: 'CONSENT_REQUIRED', line: `${file.name} was made with ${record.speaker}'s voice, whose consent ended on ${record.until}. Record their consent again, or take it out.` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** The owner's words never keep a key or an id number. */
function screened(text: string): string {
  check(secretFindings(text).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
  check(!holdsIdNumber(text), 'CHAT_KEY_REFUSED', ID_REFUSED);
  return text;
}

/**
 * venture.voiceConsent.record { speaker, recordingFileId, transcript, statement, scope, until } (approve, app only): a
 * new version of the speaker's consent. The recording is an audio file added to one of this business's orders; its
 * digest is kept, so a changed file is a different recording.
 */
export async function voiceConsentRecordHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VoiceConsentView> {
  requireAppChannel(ctx, 'venture.voiceConsent.record');
  const fields = ['speaker', 'recordingFileId', 'transcript', 'statement', 'scope', 'until'];
  const body = exactPayload(payload, fields, fields);
  const speaker = screened(singleLine(body.speaker, 'Speaker', { max: 80 }));
  const recordingFileId = identifier(body.recordingFileId, 'Recording');
  const transcript = screened(plainText(body.transcript, 'What the recording says', { max: 2000 }));
  const statement = screened(plainText(body.statement, 'The consent statement', { max: 1000 }));
  const scope = screened(singleLine(body.scope, 'What the consent covers', { max: 200 }));
  const until = body.until === null ? null : isoDate(body.until, 'Until');
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'kit.voiceConsent.record', tx => {
    const venture = tx.venture!;
    const today = todayOf(venture, tx.now);
    check(until === null || until >= today, 'INVALID_VENTURE_REQUEST', 'Until is in the past. Choose today or a later date, or no end.');
    const recording = tx.find('venture-upload', recordingFileId);
    check(recording && recording.format === 'audio', 'INVALID_VENTURE_REQUEST', 'Choose the audio recording of the consent, added to the order.');
    const version = Math.max(0, ...tx.list('venture-voice-consent').filter(item => speakerKey(item.speaker) === speakerKey(speaker)).map(item => item.version)) + 1;
    const record = tx.put<VoiceConsentRecord>({
      ...tx.base('venture-voice-consent'), speaker, recordingFileId, recordingDigest: recording.digest, transcript, statement, scope, until, version, revokedAt: null,
    });
    const back = version > 1 ? ` Version ${version - 1} is kept and no longer used.` : '';
    return { consent: itemOf(tx.state, record, today), line: `${speaker}'s consent is recorded, version ${version}.${back}` };
  });
}

/**
 * venture.voiceConsent.revoke { id } (approve, app only): withdraws the speaker's consent, every version, from now on.
 * Every file made with it is marked "consent withdrawn": it is never delivered or reused again. The reference
 * recordings' bytes are deleted; their digests, the transcript and the statement stay as evidence of what was agreed.
 */
export async function voiceConsentRevokeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VoiceConsentView> {
  requireAppChannel(ctx, 'venture.voiceConsent.revoke');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Consent');
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'kit.voiceConsent.revoke', tx => {
    const target = tx.find('venture-voice-consent', id);
    check(target, 'CONSENT_NOT_FOUND', 'That consent was not found.');
    check(target.revokedAt === null, 'INVALID_VENTURE_REQUEST', `${target.speaker}'s consent is already withdrawn.`);
    const versions = tx.list('venture-voice-consent').filter(item => speakerKey(item.speaker) === speakerKey(target.speaker));
    for (const version of versions) if (version.revokedAt === null) tx.replace<VoiceConsentRecord>({ ...version, revokedAt: tx.now });
    // DPDP: the reference recordings' sound is deleted; their digests stay on the consent, with its words, as evidence.
    for (const recordingId of new Set(versions.map(item => item.recordingFileId))) {
      const recording = tx.find('venture-upload', recordingId);
      if (recording && recording.contentBase64 !== '') tx.replace<UploadRecord>({ ...recording, contentBase64: '' });
    }
    const ids = new Set(versions.map(item => item.id));
    const made = tx.list('venture-asset').filter(asset => asset.consentId !== null && ids.has(asset.consentId) && asset.state !== 'consent-withdrawn');
    for (const asset of made) tx.replace({ ...asset, state: 'consent-withdrawn' });
    const today = todayOf(tx.venture!, tx.now);
    const marked = made.length ? ` ${made.length === 1 ? '1 file made with it is' : `${made.length} files made with it are`} marked consent withdrawn.` : '';
    return { consent: itemOf(tx.state, tx.find('venture-voice-consent', id)!, today), line: `${target.speaker}'s consent is withdrawn. Nothing uses their voice from now on.${marked}` };
  });
}

/** venture.voiceConsent.list {} (read): every consent, newest first, with where it stands today. */
export async function voiceConsentListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VoiceConsentsView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const today = todayOf(venture, deps.clock());
  const consents = listRecords(state, 'venture-voice-consent', venture.id).map(record => itemOf(state, record, today)).reverse();
  const current = consents.filter(item => item.state === 'current').length;
  return {
    consents,
    line: consents.length ? `${current} current ${current === 1 ? 'consent' : 'consents'}. A voice is used only with its speaker's current consent.` : 'No voice consents yet. A voice is used only with its speaker\'s consent.',
  };
}
