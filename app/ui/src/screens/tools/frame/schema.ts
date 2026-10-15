/**
 * The details an action card takes, as the small-apps engine describes them: the catalogue row's
 * payload schema, in the small subset `platform/runtime/smallapps/catalogue-adapter.ts` reads
 * (`parseSchema`) and checks (`checkPayload`). The host draws a form from it, turns what the
 * person typed into the exact payload, and checks that payload against the same rules before it
 * is sent. What a person types is their own data: it is never run and never read as an order.
 */
import { ShapeError, int, list, rec, str } from '../../trust/kit/validate.ts';

export type PayloadSchema =
  | { readonly type: 'string'; readonly minLength: number; readonly maxLength: number; readonly enum?: readonly string[]; readonly format?: 'paise' | 'date' }
  | { readonly type: 'integer'; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: 'boolean' }
  | { readonly type: 'array'; readonly items: PayloadSchema; readonly maxItems: number }
  | { readonly type: 'object'; readonly properties: Readonly<Record<string, PayloadSchema>>; readonly required: readonly string[] };

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const count = (value: unknown, path: string, max: number): number => {
  const n = int(value, path);
  if (n < 0 || n > max) throw new ShapeError(path);
  return n;
};

/** Check an engine-given schema into the subset; anything else is an invalid reply. */
export function payloadSchema(value: unknown, path: string, depth = 0): PayloadSchema {
  const s = rec(value, path);
  if (depth > 5) throw new ShapeError(path);
  const only = (...keys: string[]) => { if (!Object.keys(s).every((k) => ['type', 'description', 'title', ...keys].includes(k))) throw new ShapeError(path); };
  switch (s['type']) {
    case 'string': {
      only('minLength', 'maxLength', 'enum', 'format');
      const minLength = s['minLength'] === undefined ? 0 : count(s['minLength'], `${path}.minLength`, 4000);
      const maxLength = s['maxLength'] === undefined ? 4000 : count(s['maxLength'], `${path}.maxLength`, 4000);
      if (minLength > maxLength) throw new ShapeError(path);
      const out: { type: 'string'; minLength: number; maxLength: number; enum?: string[]; format?: 'paise' | 'date' } = { type: 'string', minLength, maxLength };
      if (s['enum'] !== undefined) {
        out.enum = list(s['enum'], `${path}.enum`, (v, p) => str(v, p, 200), 64);
        if (out.enum.length === 0) throw new ShapeError(`${path}.enum`);
      }
      if (s['format'] !== undefined) {
        if (s['format'] !== 'paise' && s['format'] !== 'date') throw new ShapeError(`${path}.format`);
        out.format = s['format'];
      }
      return out;
    }
    case 'integer': {
      only('minimum', 'maximum');
      return { type: 'integer', ...(s['minimum'] === undefined ? {} : { minimum: int(s['minimum'], `${path}.minimum`) }), ...(s['maximum'] === undefined ? {} : { maximum: int(s['maximum'], `${path}.maximum`) }) };
    }
    case 'boolean': only(); return { type: 'boolean' };
    case 'array': {
      only('items', 'maxItems');
      return { type: 'array', items: payloadSchema(s['items'], `${path}.items`, depth + 1), maxItems: s['maxItems'] === undefined ? 50 : count(s['maxItems'], `${path}.maxItems`, 200) };
    }
    case 'object': {
      only('properties', 'required', 'additionalProperties');
      if (s['additionalProperties'] !== undefined && s['additionalProperties'] !== false) throw new ShapeError(`${path}.additionalProperties`);
      const props = rec(s['properties'], `${path}.properties`), names = Object.keys(props);
      if (names.length > 64 || !names.every((n) => NAME.test(n))) throw new ShapeError(`${path}.properties`);
      const properties: Record<string, PayloadSchema> = {};
      for (const n of names) properties[n] = payloadSchema(props[n], `${path}.properties.${n}`, depth + 1);
      const required = list(s['required'] ?? [], `${path}.required`, (v, p) => str(v, p, 64), 64);
      if (!required.every((r) => Object.hasOwn(properties, r))) throw new ShapeError(`${path}.required`);
      return { type: 'object', properties, required: [...new Set(required)] };
    }
    default: throw new ShapeError(`${path}.type`);
  }
}

/** One field of an action's form. */
export type FieldKind = 'text' | 'choice' | 'date' | 'rupees' | 'whole' | 'yesno';
export interface FormField {
  readonly name: string; readonly kind: FieldKind; readonly required: boolean;
  readonly options?: readonly string[]; readonly maxLength?: number;
}
/** The form for a schema: only a flat object of plain values can be filled in here; anything nested is null. */
export function formOf(schema: PayloadSchema): readonly FormField[] | null {
  if (schema.type !== 'object') return null;
  const fields: FormField[] = [];
  for (const [name, s] of Object.entries(schema.properties)) {
    const required = schema.required.includes(name);
    if (s.type === 'string') {
      if (s.enum) fields.push({ name, kind: 'choice', required, options: s.enum });
      else if (s.format === 'date') fields.push({ name, kind: 'date', required });
      else if (s.format === 'paise') fields.push({ name, kind: 'rupees', required });
      else fields.push({ name, kind: 'text', required, maxLength: s.maxLength });
    } else if (s.type === 'integer') fields.push({ name, kind: 'whole', required });
    else if (s.type === 'boolean') fields.push({ name, kind: 'yesno', required });
    else return null;
  }
  return fields;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: string) => DAY.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

/**
 * Rupees as a person types them ("1,250", "1250.5", "₹ 1,250.50") to whole paise as digits, by
 * moving the decimal point in the text. No floating point is ever used.
 */
export function rupeesToPaise(typed: string): string | null {
  const t = typed.replace(/[₹\s,]/g, '');
  const m = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(t);
  if (m === null) return null;
  const digits = `${m[1]}${(m[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  return digits;
}

/** True when `value` is exactly what `schema` takes (the engine's `checkPayload`, on this side too). */
export function payloadFits(schema: PayloadSchema, value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string' || value.length < schema.minLength || value.length > schema.maxLength || CONTROL.test(value.replace(/[\n\t]/g, ' '))) return false;
      if (schema.enum && !schema.enum.includes(value)) return false;
      if (schema.format === 'paise' && !/^(0|[1-9]\d{0,17})$/.test(value)) return false;
      if (schema.format === 'date' && !validDay(value)) return false;
      return true;
    case 'integer':
      return Number.isSafeInteger(value) && (schema.minimum === undefined || (value as number) >= schema.minimum) && (schema.maximum === undefined || (value as number) <= schema.maximum);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value) && value.length <= schema.maxItems && value.every((v) => payloadFits(schema.items, v, depth + 1));
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
      const input = value as Record<string, unknown>;
      return Object.keys(input).every((k) => Object.hasOwn(schema.properties, k)) && schema.required.every((k) => Object.hasOwn(input, k))
        && Object.entries(input).every(([k, v]) => payloadFits(schema.properties[k]!, v, depth + 1));
    }
  }
}

/** What the frame sent for a form: one plain value per field, nothing else. */
export type Typed = Readonly<Record<string, string | boolean>>;

/**
 * The exact payload from what was typed, or the name of the first field that does not fit.
 * An empty optional field is left out; a required one must be filled.
 */
export function payloadFrom(schema: PayloadSchema, form: readonly FormField[], typed: Typed): { ok: true; payload: Record<string, unknown> } | { ok: false; field: string } {
  if (schema.type !== 'object') return { ok: false, field: '' };
  if (!Object.keys(typed).every((k) => form.some((f) => f.name === k))) return { ok: false, field: '' };
  const payload: Record<string, unknown> = {};
  for (const f of form) {
    const raw = Object.hasOwn(typed, f.name) ? typed[f.name] : undefined;
    if (f.kind === 'yesno') {
      if (raw === undefined) { if (f.required) return { ok: false, field: f.name }; continue; }
      if (typeof raw !== 'boolean') return { ok: false, field: f.name };
      payload[f.name] = raw; continue;
    }
    if (raw !== undefined && typeof raw !== 'string') return { ok: false, field: f.name };
    const text = (raw ?? '').trim();
    if (text === '') { if (f.required) return { ok: false, field: f.name }; continue; }
    let value: unknown = text;
    if (f.kind === 'rupees') { value = rupeesToPaise(text); if (value === null) return { ok: false, field: f.name }; }
    if (f.kind === 'whole') { if (!/^-?\d{1,15}$/.test(text)) return { ok: false, field: f.name }; value = Number(text); }
    if (!payloadFits(schema.properties[f.name]!, value)) return { ok: false, field: f.name };
    payload[f.name] = value;
  }
  return payloadFits(schema, payload) ? { ok: true, payload } : { ok: false, field: '' };
}

