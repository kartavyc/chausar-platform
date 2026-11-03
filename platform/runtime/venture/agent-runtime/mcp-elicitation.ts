/**
 * W6 6F1 (D30): an outside MCP server's question for the owner (elicitation). Only flat forms of plain fields reach the
 * owner. Questions that ask for passwords, keys, card or identity numbers are declined without asking, as the MCP
 * specification says servers must never ask for them in a form. Link requests are declined: Chausar does not open a
 * server's links. The answer goes only to the server that asked, never to the AI.
 */
import { check } from '../../portable.ts';

type Field = { type: 'string' | 'number' | 'integer' | 'boolean'; title?: string; description?: string; enum?: string[]; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; format?: string };
export type ElicitForm = { type: 'object'; properties: Record<string, Field>; required: string[] };
const SENSITIVE = /pass(word|code|phrase)?\b|\botp\b|\bpin\b|token|secret|api[\s_-]?key|private[\s_-]?key|card[\s_-]?(number|no)|\bcvv\b|\bcvc\b|aadhaar|\bpan\b|\bssn\b|social security|bank[\s_-]?account|ifsc|routing number|seed phrase|recovery code/i;
const KEYS = new Set(['type', 'title', 'description', 'enum', 'enumNames', 'minLength', 'maxLength', 'minimum', 'maximum', 'format', 'default']);
const FORMATS = new Set(['email', 'uri', 'date', 'date-time']);

/** The form the owner may see, or null when Chausar declines the question without asking. */
export function screenElicitation(params: Record<string, unknown>): { message: string; form: ElicitForm } | null {
  if (params.mode !== undefined && params.mode !== 'form') return null;
  const message = params.message, schema = params.requestedSchema as Record<string, unknown> | undefined;
  if (typeof message !== 'string' || message.length === 0 || message.length > 2000 || !schema || schema.type !== 'object') return null;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;
  const names = Object.keys(properties);
  if (names.length === 0 || names.length > 10 || SENSITIVE.test(message)) return null;
  const out: Record<string, Field> = {};
  for (const name of names) {
    const field = properties[name]!;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || !field || typeof field !== 'object' || Object.keys(field).some(key => !KEYS.has(key))) return null;
    if (!['string', 'number', 'integer', 'boolean'].includes(field.type as string)) return null;
    if (SENSITIVE.test(`${name} ${field.title ?? ''} ${field.description ?? ''}`)) return null;
    if (field.format !== undefined && !FORMATS.has(field.format as string)) return null;
    if (field.enum !== undefined && !(Array.isArray(field.enum) && field.enum.length > 0 && field.enum.length <= 50 && field.enum.every(item => typeof item === 'string' && item.length <= 200))) return null;
    out[name] = Object.fromEntries(Object.entries(field).filter(([key]) => key !== 'default' && key !== 'enumNames')) as Field;
  }
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string' && names.includes(key)) : [];
  return { message, form: { type: 'object', properties: out, required } };
}

/** The owner's answer, checked against the exact form. Refused with a plain reason when it does not fit. */
export function answerFits(form: ElicitForm, raw: unknown): Record<string, unknown> {
  const BAD = 'INVALID_VENTURE_REQUEST';
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), BAD, 'Answer the fields of this question.');
  const answer = raw as Record<string, unknown>;
  check(Object.keys(answer).every(key => Object.hasOwn(form.properties, key)), BAD, 'Answer only the fields this question asks.');
  check(form.required.every(key => answer[key] !== undefined && answer[key] !== ''), BAD, 'Fill in every required field.');
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answer)) {
    const field = form.properties[key]!;
    if (field.type === 'boolean') check(typeof value === 'boolean', BAD, `Choose yes or no for ${field.title ?? key}.`);
    else if (field.type === 'string') {
      check(typeof value === 'string' && value.length <= (field.maxLength ?? 2000) && value.length >= (field.minLength ?? 0) && !/[\u0000-\u001f\u007f]/.test(value), BAD, `Check ${field.title ?? key}.`);
      check(!field.enum || field.enum.includes(value as string), BAD, `Choose one of the offered answers for ${field.title ?? key}.`);
    } else {
      check(typeof value === 'number' && Number.isFinite(value) && (field.type === 'number' || Number.isInteger(value))
        && (field.minimum === undefined || value >= field.minimum) && (field.maximum === undefined || value <= field.maximum), BAD, `Check the number for ${field.title ?? key}.`);
    }
    out[key] = value;
  }
  return out;
}
