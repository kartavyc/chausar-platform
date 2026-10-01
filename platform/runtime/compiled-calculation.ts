import { check, hash } from './contracts.ts';
import type { Definition, Operation } from './ontology.ts';

/** A closed arithmetic contract. It contains no expressions, SQL or executable callbacks. */
export type CompiledSingleSum = {
  contractVersion: 1; compilerVersion: 'chausar-single-sum/1'; type: 'single-definition-sum';
  operationId: string; definitionName: string; recordKind: string; moneyField: string;
  currency: string; sign: 1 | -1; nullPolicy: 'reject' | 'exclude';
  dictionaryVersion: number; definitionHash: string; digest: string;
};
export type CompiledCalculationBinding = { dictionaryHash: string; sum: CompiledSingleSum };
const keys: (keyof CompiledSingleSum)[] = ['contractVersion', 'compilerVersion', 'type', 'operationId',
  'definitionName', 'recordKind', 'moneyField', 'currency', 'sign', 'nullPolicy', 'dictionaryVersion', 'definitionHash', 'digest'];
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);

export function compileSingleSum(operation: Operation, definition: Definition, dictionaryVersion: number): CompiledSingleSum {
  check(operation?.type === 'sum' && identifier(operation.id) && Array.isArray(operation.definitions)
    && operation.definitions.length === 1 && operation.definitions[0] === definition?.name
    && (operation.id === definition.name || (operation.id === 'revenue' && definition.name === 'earned')),
  'COMPILED_SUM_INVALID', 'Compile one published definition or its declared revenue alias.');
  check(identifier(definition.name) && identifier(definition.kind) && typeof definition.field === 'string'
    && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(definition.field) && /^[A-Z]{3}$/.test(definition.currency)
    && (definition.sign === undefined || definition.sign === 1 || definition.sign === -1)
    && (definition.nulls === 'reject' || definition.nulls === 'exclude')
    && Number.isSafeInteger(dictionaryVersion) && dictionaryVersion > 0,
  'COMPILED_SUM_INVALID', 'A sum requires exact published money, kind, sign, missing-value and revision bindings.');
  const content = {
    contractVersion: 1 as const, compilerVersion: 'chausar-single-sum/1' as const, type: 'single-definition-sum' as const,
    operationId: operation.id, definitionName: definition.name, recordKind: definition.kind, moneyField: definition.field,
    currency: definition.currency, sign: definition.sign ?? 1, nullPolicy: definition.nulls,
    dictionaryVersion, definitionHash: hash(definition),
  };
  return { ...content, digest: hash(content) };
}

/** Reconstruct from the published binding; a digest alone never establishes a supported operation. */
export function assertCompiledSingleSum(artifact: unknown, operationId: string, definition: Definition, dictionaryVersion: number): asserts artifact is CompiledSingleSum {
  check(artifact !== null && typeof artifact === 'object' && Object.getPrototypeOf(artifact) === Object.prototype
    && Object.keys(artifact).length === keys.length && keys.every(key => Object.hasOwn(artifact, key)),
  'COMPILED_SUM_MISMATCH', 'A compiled sum must retain its complete closed compiler contract.');
  const expected = compileSingleSum({ id: operationId, label: definition.label, type: 'sum', definitions: [definition.name], parameters: [] }, definition, dictionaryVersion);
  check(keys.every(key => (artifact as Record<string, unknown>)[key] === expected[key]),
    'COMPILED_SUM_MISMATCH', 'The compiled sum differs from its published operation, definition or dictionary revision.');
}
