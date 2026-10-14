/**
 * A strict subset of JSON Schema for plugin tool arguments. Inspection refuses any keyword outside
 * the subset, so a tool never runs against a schema Chausar cannot fully enforce. Validation returns
 * a canonical copy of the arguments; every argument is data, bounded in size and depth.
 */
import { check } from '../contracts.ts';
import { canonical } from '../actions.ts';

export const ARGUMENT_LIMITS = { bytes: 16 * 1024, depth: 4, string: 4096, items: 256, properties: 64, pattern: 200 };
const TYPES = ['object', 'string', 'integer', 'number', 'boolean', 'array'] as const;
type SchemaType = typeof TYPES[number];
const ANNOTATIONS = new Set(['title', 'description', 'default', 'examples', '$schema', '$comment']);
const KEYWORDS: Record<SchemaType, string[]> = {
  object: ['type', 'properties', 'required', 'additionalProperties'],
  string: ['type', 'enum', 'minLength', 'maxLength', 'pattern'],
  integer: ['type', 'enum', 'minimum', 'maximum'],
  number: ['type', 'enum', 'minimum', 'maximum'],
  boolean: ['type', 'enum'],
  array: ['type', 'items', 'minItems', 'maxItems'],
};
const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Patterns are outside text compiled into a regular expression, so they are kept small and refused when they
 * could backtrack badly: no back-references, lookarounds, or quantified groups that themselves contain a quantifier.
 */
function safePattern(pattern: unknown): boolean {
  if (typeof pattern !== 'string' || pattern.length > ARGUMENT_LIMITS.pattern) return false;
  if (/\\[1-9k]|\(\?[=!<]/.test(pattern)) return false;
  if (/\([^()]*[*+}?][^()]*\)\s*[*+{]/.test(pattern) || /\([^()]*\|[^()]*\)\s*[*+{]/.test(pattern)) return false;
  try { new RegExp(pattern, 'u'); return true; } catch { return false; }
}

/** Every problem with a schema, as JSON-pointer-like paths. Empty means the schema is fully enforceable. */
export function schemaProblems(schema: unknown, path = '', depth = 0): string[] {
  if (!plain(schema)) return [path || '/'];
  if (depth > ARGUMENT_LIMITS.depth) return [`${path}/depth`];
  const type = schema.type as SchemaType;
  if (!TYPES.includes(type)) return [`${path}/type`];
  const problems: string[] = [];
  for (const key of Object.keys(schema)) if (!ANNOTATIONS.has(key) && !KEYWORDS[type].includes(key)) problems.push(`${path}/${key}`);
  if (Object.hasOwn(schema, 'enum') && !(Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 64 && schema.enum.every((item: unknown) => type === 'string' ? typeof item === 'string' && item.length <= ARGUMENT_LIMITS.string : type === 'boolean' ? typeof item === 'boolean' : typeof item === 'number' && Number.isFinite(item) && (type === 'number' || Number.isSafeInteger(item))))) problems.push(`${path}/enum`);
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (Object.hasOwn(schema, key) && !count(schema[key])) problems.push(`${path}/${key}`);
  for (const key of ['minimum', 'maximum']) if (Object.hasOwn(schema, key) && !(typeof schema[key] === 'number' && Number.isFinite(schema[key]))) problems.push(`${path}/${key}`);
  if (Object.hasOwn(schema, 'pattern') && !safePattern(schema.pattern)) problems.push(`${path}/pattern`);
  if (type === 'object') {
    const properties = schema.properties ?? {};
    if (!plain(properties) || Object.keys(properties).length > ARGUMENT_LIMITS.properties) problems.push(`${path}/properties`);
    else for (const [name, child] of Object.entries(properties)) { if (!NAME.test(name)) problems.push(`${path}/properties/${name.slice(0, 64)}`); else problems.push(...schemaProblems(child, `${path}/properties/${name}`, depth + 1)); }
    if (Object.hasOwn(schema, 'required') && !(Array.isArray(schema.required) && new Set(schema.required).size === schema.required.length && schema.required.every((name: unknown) => typeof name === 'string' && plain(properties) && Object.hasOwn(properties, name)))) problems.push(`${path}/required`);
    // Absent means false. Open objects are not enforceable, so only false is accepted.
    if (Object.hasOwn(schema, 'additionalProperties') && schema.additionalProperties !== false) problems.push(`${path}/additionalProperties`);
  }
  if (type === 'array') { if (!Object.hasOwn(schema, 'items')) problems.push(`${path}/items`); else problems.push(...schemaProblems(schema.items, `${path}/items`, depth + 1)); }
  return problems;
}

/**
 * The schema without its annotations (title, description, default, examples, $schema, $comment): those are outside
 * text, so a screen gets only the enforced keywords. Property names are format-checked; enum strings are data the
 * caller must match, so a screen shows them quoted.
 */
export function stripAnnotations(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripAnnotations);
  if (!plain(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATIONS.has(key)) continue;
    out[key] = key === 'properties' && plain(value) ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, stripAnnotations(child)])) : key === 'enum' ? value : stripAnnotations(value);
  }
  return out;
}

/** True when the tool takes any argument at all; such tools receive their arguments as bytes in linear memory. */
export const takesArguments = (schema: Record<string, any>) => plain(schema.properties) && Object.keys(schema.properties).length > 0;

// The path is kept for the reader of this code only; messages never carry argument or schema text.
function invalid(condition: unknown, _path: string): asserts condition { check(condition, 'PLUGIN_ARGUMENTS_INVALID', 'The arguments do not match the tool’s declared schema.'); }

function validateValue(schema: Record<string, any>, value: unknown, path: string, depth: number): unknown {
  invalid(depth <= ARGUMENT_LIMITS.depth, path);
  if (Object.hasOwn(schema, 'enum')) invalid(schema.enum.some((item: unknown) => item === value), path);
  switch (schema.type as SchemaType) {
    case 'string':
      invalid(typeof value === 'string' && value.length <= ARGUMENT_LIMITS.string && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), path);
      invalid((schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength), path);
      invalid(schema.pattern === undefined || new RegExp(schema.pattern, 'u').test(value), path);
      return value;
    case 'integer': case 'number':
      invalid(typeof value === 'number' && Number.isFinite(value) && (schema.type === 'number' || Number.isSafeInteger(value)), path);
      invalid((schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum), path);
      return value;
    case 'boolean': invalid(typeof value === 'boolean', path); return value;
    case 'array':
      invalid(Array.isArray(value) && value.length <= ARGUMENT_LIMITS.items && (schema.minItems === undefined || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems), path);
      return value.map((item, index) => validateValue(schema.items, item, `${path}/${index}`, depth + 1));
    case 'object': {
      invalid(plain(value), path);
      const properties: Record<string, any> = schema.properties ?? {};
      for (const key of Object.keys(value)) invalid(Object.hasOwn(properties, key), `${path}/${key.slice(0, 64)}`);
      for (const key of schema.required ?? []) invalid(Object.hasOwn(value, key), `${path}/${key}`);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(properties).sort()) if (Object.hasOwn(value, key)) out[key] = validateValue(properties[key], value[key], `${path}/${key}`, depth + 1);
      return out;
    }
  }
  invalid(false, path);
}

/** Validate caller arguments against an already-inspected schema. Returns a canonical, plain copy. */
export function validateArguments(schema: Record<string, any>, args: unknown): Record<string, unknown> {
  check(schemaProblems(schema).length === 0, 'PLUGIN_SCHEMA_UNSUPPORTED', 'This tool declares a schema Chausar cannot fully enforce, so it does not run.');
  let size = 0; try { size = Buffer.byteLength(canonical(args ?? {})); } catch { invalid(false, ''); }
  check(size <= ARGUMENT_LIMITS.bytes, 'PLUGIN_ARGUMENTS_TOO_LARGE', 'Tool arguments are limited to 16 KiB.');
  return validateValue(schema, args ?? {}, '', 0) as Record<string, unknown>;
}
