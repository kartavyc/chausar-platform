import { readFileSync } from 'node:fs';
import { hash } from './contracts.ts';
import { starterPacks, type Dictionary, type Operation } from './ontology.ts';

export type CoreAliasPack = { schema: 'chausar.core-operation-aliases.v1'; revision: 1; scope: string;
  frames: Record<string, string[]>; operations: { id: string; type: Operation['type']; definitions: string[]; parameters: string[];
    terms: { language: 'en' | 'hi'; text: string; frames: string[] }[] }[] };
export type CoreAliasSelection = { kind: 'matched'; operationId: string; lexiconRevision: 1; dictionaryHash: string; definitionHash: string }
  | { kind: 'unknown' } | { kind: 'ambiguous'; operationIds: string[] };

const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim().replace(/[?!.।]+$/gu, '').trim();
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}
const equivalent = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function requirePack(condition: unknown): asserts condition { if (!condition) throw new Error('The bounded core alias pack is invalid.'); }
export function validateCoreAliasPack(value: unknown): asserts value is CoreAliasPack {
  const pack = value as CoreAliasPack;
  requirePack(pack && pack.schema === 'chausar.core-operation-aliases.v1' && pack.revision === 1 && typeof pack.scope === 'string');
  requirePack(pack.frames && typeof pack.frames === 'object' && !Array.isArray(pack.frames) && Object.keys(pack.frames).length <= 32);
  for (const [id, frames] of Object.entries(pack.frames)) {
    requirePack(/^(?:en|hi)-[a-z-]{1,60}$/.test(id) && Array.isArray(frames) && frames.length > 0 && frames.length <= 16);
    requirePack(frames.every(frame => typeof frame === 'string' && frame.length <= 160 && frame.split('{term}').length === 2 && !/[{}]/u.test(frame.replace('{term}', ''))));
  }
  requirePack(Array.isArray(pack.operations) && pack.operations.length > 0 && pack.operations.length <= 32);
  const ids = new Set<string>();
  for (const op of pack.operations) {
    requirePack(op && typeof op.id === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(op.id) && !ids.has(op.id)); ids.add(op.id);
    requirePack(['sum', 'margin', 'aging', 'change', 'scenario'].includes(op.type) && Array.isArray(op.definitions) && op.definitions.length > 0 && op.definitions.length <= 8
      && op.definitions.every(id => typeof id === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(id)) && new Set(op.definitions).size === op.definitions.length);
    requirePack(Array.isArray(op.parameters) && op.parameters.length <= 16 && new Set(op.parameters).size === op.parameters.length && op.parameters.every(parameter => typeof parameter === 'string' && /^[a-z][A-Za-z0-9]*$/.test(parameter)));
    requirePack(Array.isArray(op.terms) && op.terms.length > 0 && op.terms.length <= 32);
    for (const term of op.terms) requirePack(term && ['en', 'hi'].includes(term.language) && typeof term.text === 'string' && term.text.trim().length > 0 && term.text.length <= 80
      && !/[{}?!।]/u.test(term.text) && Array.isArray(term.frames) && term.frames.length > 0 && term.frames.length <= 16 && new Set(term.frames).size === term.frames.length
      && term.frames.every(id => typeof id === 'string' && id.startsWith(term.language + '-') && Object.hasOwn(pack.frames, id)));
  }
}
const parsed: unknown = JSON.parse(readFileSync(new URL('./core-operation-aliases.v1.json', import.meta.url), 'utf8'));
validateCoreAliasPack(parsed);
const loaded: CoreAliasPack = parsed;
export function coreAliasPack(): CoreAliasPack { return structuredClone(loaded); }

/** Exact discovery metadata only. Never extracts a keyword, date, filter, amount or instruction from a free question. */
export function resolveCoreOperationAlias(question: string, dictionary: Dictionary, trustedPack: CoreAliasPack = loaded): CoreAliasSelection {
  validateCoreAliasPack(trustedPack);
  const starter = starterPacks.find(pack => pack.pack === dictionary.pack);
  if (!starter || dictionary.currency !== starter.currency) return { kind: 'unknown' };
  const questionText = normalized(question), matches = new Map<string, { operation: Operation; definitions: Dictionary['definitions'] }>();
  for (const alias of trustedPack.operations) {
    const candidates = dictionary.operations.filter(operation => operation.id === alias.id);
    if (candidates.length !== 1) continue;
    const operation = candidates[0];
    if (operation.type !== alias.type || !equivalent(operation.definitions, alias.definitions) || !equivalent(operation.parameters, alias.parameters)) continue;
    if (alias.definitions.some(name => dictionary.definitions.filter(definition => definition.name === name).length !== 1)) continue;
    const definitions = alias.definitions.map(name => dictionary.definitions.find(definition => definition.name === name));
    const coreDefinitions = alias.definitions.map(name => starter.definitions.find(definition => definition.name === name));
    if (definitions.some(definition => !definition) || coreDefinitions.some(definition => !definition) || !equivalent(definitions, coreDefinitions)) continue;
    const recognized = alias.terms.some(term => term.frames.some(frameId => trustedPack.frames[frameId]
      .some(frame => normalized(frame.replace('{term}', term.text)) === questionText)));
    if (recognized) matches.set(operation.id, { operation, definitions: dictionary.definitions.filter(definition => operation.definitions.includes(definition.name)) });
  }
  if (matches.size === 0) return { kind: 'unknown' };
  if (matches.size !== 1) return { kind: 'ambiguous', operationIds: [...matches.keys()].sort() };
  const [operationId, match] = [...matches][0];
  return { kind: 'matched', operationId, lexiconRevision: trustedPack.revision, dictionaryHash: dictionary.hash, definitionHash: hash(match.definitions) };
}
