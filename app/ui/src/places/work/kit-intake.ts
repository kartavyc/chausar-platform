// Chausar kit order intake (5M): original form state at the engine's schema boundary. No outside source.
import type { EngineMethods, OfferIntakeLite } from '../../engine/types';
import { ruleEntries } from './intake';
import { readBase64 } from './files';
export type KitPerson = { name: string; consentId: string | null };
export type KitAnswer = string | boolean | KitPerson[] | File;
export type KitAnswers = Record<string, KitAnswer>;
type Params = NonNullable<EngineMethods['venture.order.create']['params']['intake']>;
/** Only the chosen offer's questions can enter a new order. Money stays rupee text until the engine parses it. */
export function kitIntakeParams(ask: OfferIntakeLite | null, answers: KitAnswers): Params {
  const fields: NonNullable<Params['fields']> = {};
  const moneyRupees: Record<string, string> = {};
  for (const field of ask?.kit ?? []) {
    const value = answers[field.id];
    if (field.kind === 'rights' || value === undefined || value === '') continue;
    if (field.kind === 'money') { if (typeof value === 'string' && value.trim()) moneyRupees[field.id] = value.trim(); continue; }
    if (field.kind === 'list') { if (typeof value === 'string' && value.trim()) fields[field.id] = [...new Set(ruleEntries(value))]; continue; }
    if (field.kind === 'people') { if (Array.isArray(value) && value.length) fields[field.id] = value.map(person => ({ name: person.name.trim(), consentId: person.consentId })); continue; }
    if (typeof value === 'boolean') fields[field.id] = value;
    else if (typeof value === 'string' && value.trim()) fields[field.id] = value.trim();
  }
  return { fields, ...(Object.keys(moneyRupees).length ? { moneyRupees } : {}) };
}
/** Required yes/no answers distinguish no from unanswered; required consent always needs an affirmative answer. */
export function kitIntakeReady(ask: OfferIntakeLite | null, answers: KitAnswers): boolean {
  const files = (ask?.kit ?? []).flatMap(field => field.kind === 'file' && isKitFile(answers[field.id]) ? [answers[field.id] as File] : []);
  if (files.reduce((sum, file) => sum + file.size, 0) > 1_300_000 || files.some(file => kitFileProblem(file))) return false;
  return (ask?.kit ?? []).every(field => {
    if (!field.required || field.kind === 'rights') return true;
    const value = answers[field.id];
    if (field.kind === 'file' && isKitFile(value)) return true;
    if (field.kind === 'consent') return value === true;
    if (field.kind === 'yes-no') return typeof value === 'boolean';
    if (field.kind === 'people') return Array.isArray(value) && value.length > 0 && value.every(person => person.name.trim() && person.consentId);
    if (typeof value !== 'string' || !value.trim()) return false;
    if (field.kind === 'choice') return field.options?.includes(value) ?? false;
    if (field.kind === 'list') return ruleEntries(value).length > 0;
    return true;
  });
}

/** Client intake files use the same format and size boundaries as the engine, including cleanable photos and recordings. */
export const KIT_FILE_ACCEPT = '.txt,.md,.markdown,.docx,.csv,.xlsx,.pdf,.srt,.vtt,.jpg,.jpeg,.png,.webp,.wav,.mp3,.m4a,.ogg';
export function isKitFile(value: unknown): value is File { return typeof File !== 'undefined' && value instanceof File; }
/** A displayable problem code, without inspecting private file bytes in the UI. */
export function kitFileProblem(file: File): 'type' | 'size' | null {
 const ext = file.name.toLowerCase().split('.').pop() ?? '';
 if (!file.name.includes('.') || !KIT_FILE_ACCEPT.split(',').includes('.' + ext)) return 'type';
 return file.size > 0 && file.size <= 1_300_000 ? null : 'size';
}
/** Send bytes only for this offer's selected file questions; the engine creates their references atomically. */
export async function kitIntakeFiles(ask: OfferIntakeLite | null, answers: KitAnswers): Promise<Record<string, { name: string; contentBase64: string }>> {
 const entries = await Promise.all((ask?.kit ?? []).filter(field => field.kind === 'file' && isKitFile(answers[field.id])).map(async field => {
  const file = answers[field.id] as File;
  return [field.id, { name: file.name, contentBase64: await readBase64(file) }] as const;
 }));
 return Object.fromEntries(entries);
}
