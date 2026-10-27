// Chausar playbook kit: what an order for a kit offer asks at intake, and the checks on what it was sent (Ink v2 wave 5,
// package 5A1). A kit offer names its intake fields (the definition's intakeFields); the order keeps their values under
// intake.fields, by field id, checked by kind: text and lists as plain words, a choice from its options, yes or no, a
// real day, money as whole minor units in text, a file as an upload id, and consent only as a yes. A required field
// that is missing is refused with INTAKE_FIELD_REQUIRED naming its label, and so is consent that is not a yes. People
// seen or heard in the work each need their voice consent recorded and current (5A4 requirePeopleConsent,
// CONSENT_REQUIRED), or the order is refused at intake. The
// offer's rights, when it touches third-party media, are recorded as the flagships' are (delivery/rights.ts). Written
// for Chausar; nothing here is learned from an outside source.
import { check, ChausarError, type State } from '../../../contracts.ts';
import type { IsoDate, IsoTime, OfferIntakeAsk, OrderIntake, VentureRecord } from '../../contracts.ts';
import { requirePeopleConsent } from './voice-consent.ts';
import { RIGHTS_LABELS, recordRights, requireRights, type RightsBasis } from '../../delivery/rights.ts';
import type { IntakePerson, IntakeValue, KitIntakeField } from './define.ts';

/** A kit offer as the plan keeps it: its name, the rights it accepts and its intake fields. */
export type KitIntakeOffer = { key?: string; name: string; rights: readonly RightsBasis[]; intake: readonly KitIntakeField[] };

const MAX_TEXT = 2000;
const MAX_LIST = 50;
const MAX_ITEM = 200;
const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const UPLOAD_ID = /^[a-z]+_[A-Za-z0-9_-]{1,80}$/;

/** What an order for a kit offer asks: the rights it accepts and its fields; null when it asks nothing. */
export function kitIntakeAsk(offer: Pick<KitIntakeOffer, 'rights' | 'intake'>): OfferIntakeAsk | null {
  if (!offer.rights.length && !offer.intake.length) return null;
  return { rights: [...offer.rights], fields: [], kit: offer.intake.map(field => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) })) };
}

function realDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

const plainWords = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const words = value.trim().replace(/[ \t]+/g, ' ');
  return words.length > 0 && words.length <= max && !HIDDEN.test(words) ? words : null;
};

/** One field's value, checked by its kind; the label names it in every refusal. */
function fieldValue(field: KitIntakeField, value: unknown): IntakeValue {
  const bad = (why: string): never => { throw new ChausarError('INVALID_VENTURE_REQUEST', `${field.label}: ${why}`); };
  switch (field.kind) {
    case 'text': return plainWords(value, MAX_TEXT) ?? bad(`write it in plain words, at most ${MAX_TEXT} characters.`);
    case 'choice': return typeof value === 'string' && (field.options ?? []).includes(value) ? value : bad(`choose one of ${(field.options ?? []).join(', ')}.`);
    case 'yes-no': return typeof value === 'boolean' ? value : bad('say yes or no.');
    case 'consent':
      if (value !== true) throw new ChausarError('INTAKE_FIELD_REQUIRED', `${field.label}: the order needs a yes here before it can start.`);
      return true;
    case 'list': {
      if (!Array.isArray(value) || value.length > MAX_LIST) bad(`send a list of at most ${MAX_LIST} entries.`);
      const items = (value as unknown[]).map(item => plainWords(item, MAX_ITEM) ?? bad(`each entry is plain words of at most ${MAX_ITEM} characters.`));
      return [...new Set(items)];
    }
    case 'date': return typeof value === 'string' && realDay(value) ? value : bad('give a day like 2026-11-01.');
    case 'money': return typeof value === 'string' && /^\d{1,15}$/.test(value) ? value : bad('give the amount in whole paise, as digits.');
    case 'file': return typeof value === 'string' && UPLOAD_ID.test(value) ? value : bad('add the file to the order first, then name it.');
    case 'people': {
      if (!Array.isArray(value) || value.length > MAX_LIST) bad(`send each person, at most ${MAX_LIST}, with their name and consent.`);
      return (value as unknown[]).map((item): IntakePerson => {
        const person = item as Record<string, unknown> | null;
        const ok = person !== null && typeof person === 'object' && !Array.isArray(person) && Object.keys(person).sort().join(',') === 'consentId,name';
        const name = ok ? plainWords(person!.name, MAX_ITEM) : null;
        const consentId = ok ? person!.consentId : undefined;
        if (!name || !(consentId === null || (typeof consentId === 'string' && UPLOAD_ID.test(consentId)))) bad('give each person their name and the consent recorded for them, or null.');
        return { name: name!, consentId: consentId as string | null };
      });
    }
    // A rights field is the offer's rights, recorded at the top of the intake (rights), never a value here.
    case 'rights': return bad('record the rights with the order, not as a field.');
  }
}

/**
 * Checks a kit order's intake: only rights (when the offer takes them) and fields at the top; only the offer's own
 * fields inside, each checked by its kind; every required field present (INTAKE_FIELD_REQUIRED naming its label).
 * Returns what to keep on the order, or null when the offer asks nothing and was sent nothing.
 */
export function kitOrderIntake(raw: unknown, offer: KitIntakeOffer, meta: { by: string; at: IsoTime; today: IsoDate; state?: State; venture?: VentureRecord }): OrderIntake | null {
  check(raw === undefined || (raw !== null && typeof raw === 'object' && !Array.isArray(raw)), 'INVALID_VENTURE_REQUEST', 'Send the intake as named fields.');
  const body = (raw ?? {}) as Record<string, unknown>;
  const extra = Object.keys(body).filter(key => key !== 'rights' && key !== 'fields');
  check(extra.length === 0, 'INVALID_VENTURE_REQUEST', `The intake has no field called ${extra[0]}.`);
  const sent = body.fields ?? {};
  check(sent !== null && typeof sent === 'object' && !Array.isArray(sent), 'INVALID_VENTURE_REQUEST', 'Send the intake fields as named fields.');
  const values = sent as Record<string, unknown>;
  const unknown = Object.keys(values).filter(key => !offer.intake.some(field => field.id === key && field.kind !== 'rights'));
  check(unknown.length === 0, 'INVALID_VENTURE_REQUEST', `The intake has no field called ${unknown[0]}.`);
  const cuts = offer.rights.length > 0;
  let rights = null;
  if (cuts) {
    rights = recordRights(body.rights, { by: meta.by, at: meta.at });
    const wanted = offer.rights.map(basis => RIGHTS_LABELS[basis].toLowerCase()).join(' or ');
    check(offer.rights.includes(rights.basis), 'RIGHTS_REQUIRED', `${offer.name} needs ${wanted}, recorded at intake.`);
    requireRights({ id: 'intake', clipping: true }, { rights }, meta.today);
  } else {
    check(body.rights === undefined || body.rights === null, 'INVALID_VENTURE_REQUEST', 'This offer touches no one else\'s media, so it records no rights.');
  }
  const fields: Record<string, IntakeValue> = {};
  for (const field of offer.intake) {
    if (field.kind === 'rights') continue;
    const value = values[field.id];
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new ChausarError('INTAKE_FIELD_REQUIRED', `${field.label} is needed for this order.`);
      continue;
    }
    fields[field.id] = fieldValue(field, value);
    // 5A4: everyone seen or heard in the work has a current consent recorded for them, their own.
    if (field.kind === 'people') {
      const people = fields[field.id] as IntakePerson[];
      if (people.length && (!meta.state || !meta.venture)) throw new ChausarError('CONSENT_REQUIRED', `${people[0].name} appears in this work. Record their consent before the order starts.`);
      if (people.length) requirePeopleConsent(meta.state!, meta.venture!, people, meta.today);
    }
  }
  if (!cuts && raw === undefined && !Object.keys(fields).length) return null;
  return { rights, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, fields };
}
