// Chausar fake kit intake (5M). Browser-only mirror of kit/intake.ts, preserving its field-exact refusals.
import { EngineError, type OfferIntakeLite, type OrderLite, type VoiceConsentsView } from './types';
type Fields = NonNullable<NonNullable<OrderLite['intake']>['fields']>;
const invalid = (line: string): never => { throw new EngineError('INVALID_VENTURE_REQUEST', line); };
const required = (line: string): never => { throw new EngineError('INTAKE_FIELD_REQUIRED', line); };
const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const ID = /^[a-z]+_[A-Za-z0-9_-]{1,80}$/;
const nameKey = (name: string) => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
function object(value: unknown, line: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(line);
  return value as Record<string, unknown>;
}
function words(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[ \t]+/g, ' ');
  return clean.length > 0 && clean.length <= max && !HIDDEN.test(clean) ? clean : null;
}
/** Validate and normalize only the selected kit offer's answers, before any order is kept. */
export function fakeKitIntake(raw: unknown, ask: OfferIntakeLite, consents: () => VoiceConsentsView, meta: { by: string; at: string; today: string }): NonNullable<OrderLite['intake']> | null {
  const body = raw === undefined ? {} : object(raw, 'Send the intake as named fields.');
  const extra = Object.keys(body).find(key => !['rights', 'fields', 'moneyRupees'].includes(key));
  if (extra) invalid(`The intake has no field called ${extra}.`);
  const values = { ...object(body.fields ?? {}, 'Send the intake fields as named fields.') };
  if (body.moneyRupees !== undefined) {
    for (const [id, rawAmount] of Object.entries(object(body.moneyRupees, 'Send rupee amounts as named fields.'))) {
      if (!ask.kit?.some(field => field.id === id && field.kind === 'money') || Object.hasOwn(values, id)) invalid('Name each money field once, in rupees or paise.');
      if (typeof rawAmount !== 'string' || rawAmount.length > 30) throw new EngineError('INVALID_AMOUNT', 'Give the rupee amount as exact decimal text.');
      const amount = (rawAmount as string).trim().replace(/[, ]/g, '');
      if (!/^-?\d+(?:\.\d+)?$/.test(amount)) throw new EngineError('INVALID_AMOUNT', 'Use exact decimal text without exponents.');
      const negative = amount.startsWith('-');
      const [whole = '0', rawFraction = ''] = amount.replace(/^-/, '').split('.');
      const fraction = rawFraction.replace(/0+$/, '');
      if (fraction.length > 2) throw new EngineError('INVALID_AMOUNT', 'The amount contains a fractional minor unit for its currency.');
      const minor = String((negative ? -1n : 1n) * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')));
      if (!/^\d{1,15}$/.test(minor)) throw new EngineError('INVALID_AMOUNT', 'Give a non-negative amount of at most fifteen paise digits.');
      values[id] = minor;
    }
  }
  const unknown = Object.keys(values).find(key => !ask.kit?.some(field => field.id === key && field.kind !== 'rights'));
  if (unknown) invalid(`The intake has no field called ${unknown}.`);
  if (!ask.rights.length && body.rights !== undefined && body.rights !== null) invalid("This offer touches no one else's media, so it records no rights.");
  let rights: NonNullable<OrderLite['intake']>['rights'] = null;
  if (ask.rights.length) {
    const value = body.rights;
    const refuse = (line: string): never => { throw new EngineError('RIGHTS_REQUIRED', line); };
    if (!value || typeof value !== 'object' || Array.isArray(value)) refuse('Record the rights to the footage before clipping.');
    const source = value as Record<string, unknown>;
    if (!ask.rights.includes(source.basis as typeof ask.rights[number])) refuse('Choose own footage, a licence, or a creator clip programme.');
    const line = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\r\n\t\u0000-\u001F\u007F]/.test(value.trim()) ? value.trim() : null;
    const holder = line(source.holder, 160), reference = line(source.reference, 300);
    if (!holder) refuse('Say who owns the footage.');
    if (source.basis !== 'own-footage' && !reference) refuse('Add the licence or clip programme reference.');
    const expiresOn = source.expiresOn ?? null;
    if (expiresOn !== null && (typeof expiresOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || !Number.isFinite(Date.parse(expiresOn)) || new Date(expiresOn).toISOString().slice(0, 10) !== expiresOn)) refuse('Give the end date like 2026-12-31, or leave it empty.');
    if (typeof expiresOn === 'string' && expiresOn < meta.today) refuse('The rights to this footage ended on ' + expiresOn + '.');
    rights = { basis: source.basis as typeof ask.rights[number], holder: holder!, reference, scope: line(source.scope, 300), expiresOn: expiresOn as string | null, recordedAt: meta.at, recordedBy: meta.by };
  }
  const fields: Fields = {};
  for (const field of ask.kit ?? []) {
    if (field.kind === 'rights') continue;
    const value = values[field.id];
    if (value === undefined || value === null || value === '') { if (field.required) required(`${field.label} is needed for this order.`); continue; }
    const bad = (line: string): never => invalid(`${field.label}: ${line}`);
    switch (field.kind) {
      case 'text': fields[field.id] = words(value, 2000) ?? bad('write it in plain words, at most 2000 characters.'); break;
      case 'choice': fields[field.id] = typeof value === 'string' && field.options?.includes(value) ? value : bad(`choose one of ${(field.options ?? []).join(', ')}.`); break;
      case 'yes-no': fields[field.id] = typeof value === 'boolean' ? value : bad('say yes or no.'); break;
      case 'consent': if (value !== true) required(`${field.label}: the order needs a yes here before it can start.`); fields[field.id] = true; break;
      case 'date': {
        const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
        fields[field.id] = day && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value ? value as string : bad('give a day like 2026-11-01.'); break;
      }
      case 'money': fields[field.id] = typeof value === 'string' && /^\d{1,15}$/.test(value) ? value : bad('give the amount in whole paise, as digits.'); break;
      case 'file': fields[field.id] = typeof value === 'string' && ID.test(value) ? value : bad('add the file to the order first, then name it.'); break;
      case 'list': {
        if (!Array.isArray(value) || value.length > 50) bad('send a list of at most 50 entries.');
        const items=(value as unknown[]).map(item => words(item, 200) ?? bad('each entry is plain words of at most 200 characters.'));
        if(field.options && items.some(item=>!field.options!.includes(item)))bad('choose only entries from the offered list.');
        fields[field.id]=[...new Set(items)]; break;
      }
      case 'people': {
        if (!Array.isArray(value) || value.length > 50) bad('send each person, at most 50, with their name and consent.');
        const people = (value as unknown[]).map(item => {
          const person = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
          const name = person && Object.keys(person).sort().join(',') === 'consentId,name' ? words(person.name, 200) : null;
          if (!name || !(person!.consentId === null || typeof person!.consentId === 'string' && ID.test(person!.consentId))) bad('give each person their name and the consent recorded for them, or null.');
          return { name: name!, consentId: person!.consentId as string | null };
        });
        const current = people.length ? consents().consents : [];
        for (const person of people) if (!current.some(consent => consent.id === person.consentId && consent.state === 'current' && nameKey(consent.speaker) === nameKey(person.name))) throw new EngineError('CONSENT_REQUIRED', `${person.name} appears in this work. Record their consent before the order starts.`);
        fields[field.id] = people; break;
      }
    }
  }
  if (!ask.rights.length && raw === undefined && !Object.keys(fields).length) return null;
  return { rights, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, fields };
}
