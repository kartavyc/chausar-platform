// Chausar venture launcher, package P2 (models): the schema rule every model task must pass.
// A model may only return words and fixed choices. No number or integer type, no open objects,
// every property required, and only a small set of keywords both providers accept.
import { ChausarError } from '../../contracts.ts';
import type { Json } from '../contracts.ts';

const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description']);
const TYPES = new Set(['object', 'array', 'string', 'boolean', 'null']);
const MAX_DEPTH = 24;
const MAX_NODES = 2000;
const MAX_SCHEMA_CHARS = 65536;

function refuse(path: string, why: string): never {
  throw new ChausarError('INVALID_VENTURE_REQUEST', `The model schema is not allowed at ${path}: ${why}.`);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/**
 * Refuses (INVALID_VENTURE_REQUEST, a programming error) unless: the root is an object; every object node has
 * additionalProperties false and required equal to all of its property keys; no number or integer type appears;
 * every node has a type or an enum; arrays declare items; enums hold only text, true/false or null; and only the
 * keywords type, properties, required, additionalProperties, items, enum and description are used.
 */
export function assertSchemaSafe(schema: unknown): void {
  let nodes = 0;
  let text: string | undefined;
  try { text = JSON.stringify(schema); } catch { refuse('the root', 'it is not plain JSON'); }
  if (typeof text !== 'string' || text.length > MAX_SCHEMA_CHARS) refuse('the root', 'it is missing or too large');

  const walk = (node: unknown, path: string, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) refuse(path, 'it is too deep or too large');
    if (!plainObject(node)) refuse(path, 'each schema node must be an object');
    for (const key of Object.keys(node)) if (!KEYWORDS.has(key)) refuse(path, `the keyword ${key} is not supported`);
    if (!('type' in node) && !('enum' in node)) refuse(path, 'each node needs a type or an enum');

    let types: string[] = [];
    if ('type' in node) {
      const raw = node.type;
      types = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.map(item => String(item)) : [];
      if (!types.length || (Array.isArray(raw) && !raw.every(item => typeof item === 'string')) || new Set(types).size !== types.length) refuse(path, 'type must be a known type name');
      for (const type of types) {
        if (type === 'number' || type === 'integer') refuse(path, 'number types are not allowed; numbers come from Chausar');
        if (!TYPES.has(type)) refuse(path, `the type ${type} is not supported`);
      }
    }
    if ('enum' in node) {
      const values = node.enum;
      if (!Array.isArray(values) || !values.length) refuse(path, 'enum must list at least one value');
      for (const value of values) if (!(value === null || typeof value === 'string' || typeof value === 'boolean')) refuse(path, 'enum values must be text, true, false or null');
    }
    if ('description' in node && (typeof node.description !== 'string' || node.description.length > 1000)) refuse(path, 'description must be short text');

    const isObject = types.includes('object');
    const objectKeywords = 'properties' in node || 'required' in node || 'additionalProperties' in node;
    if (isObject || objectKeywords) {
      if (types.length !== 1 || !isObject) refuse(path, 'object keywords need type object and nothing else');
      if (node.additionalProperties !== false) refuse(path, 'objects must set additionalProperties to false');
      const properties = node.properties;
      if (!plainObject(properties)) refuse(path, 'objects must list their properties');
      const keys = Object.keys(properties);
      const required = node.required;
      if (!Array.isArray(required) || !required.every(item => typeof item === 'string') || new Set(required).size !== required.length
        || required.length !== keys.length || !keys.every(key => required.includes(key))) refuse(path, 'required must name every property exactly once');
      for (const key of keys) walk(properties[key], `${path}.${key}`, depth + 1);
    }
    const isArray = types.includes('array');
    if (isArray || 'items' in node) {
      if (types.length !== 1 || !isArray) refuse(path, 'items needs type array and nothing else');
      if (!('items' in node)) refuse(path, 'arrays must declare their items');
      walk(node.items, `${path}[]`, depth + 1);
    }
  };
  walk(schema, 'the root', 0);
  if (!plainObject(schema) || schema.type !== 'object') refuse('the root', 'the root must be an object');
}

/** A deep copy of a schema that passed assertSchemaSafe, holding only the allowed keywords. */
export function sanitizeSchema(schema: Json): Json {
  const copy = (node: any): any => {
    const result: Record<string, Json> = {};
    for (const key of Object.keys(node)) {
      if (!KEYWORDS.has(key)) continue;
      if (key === 'properties') result.properties = Object.fromEntries(Object.entries(node.properties).map(([name, child]) => [name, copy(child)]));
      else if (key === 'items') result.items = copy(node.items);
      else result[key] = structuredClone(node[key]);
    }
    return result;
  };
  return copy(schema);
}
