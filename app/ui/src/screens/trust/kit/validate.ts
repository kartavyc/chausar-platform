/**
 * Reply checks for the Reports, Tools and Trust screens. Every engine reply is untrusted
 * data: a screen reads it only through these helpers, which throw `ShapeError` on any
 * value that is not what the contract in docs/lanes/reports-tools-trust.md says.
 */
export class ShapeError extends Error {
  readonly code = 'INVALID_REPLY';
  constructor(readonly path: string) { super(`INVALID_REPLY:${path}`); }
}
export type Rec = Readonly<Record<string, unknown>>;
export function rec(value: unknown, path = 'reply'): Rec {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ShapeError(path);
  return value as Rec;
}
export function str(value: unknown, path: string, max = 20000): string {
  if (typeof value !== 'string' || value.length > max) throw new ShapeError(path);
  return value;
}
export function optStr(value: unknown, path: string, max = 20000): string | null {
  return value === null || value === undefined ? null : str(value, path, max);
}
export function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ShapeError(path);
  return value;
}
export function int(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) throw new ShapeError(path);
  return value as number;
}
export function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ShapeError(path);
  return value;
}
export function digits(value: unknown, path: string, signed = true): string {
  if (typeof value !== 'string' || value.length > 64 || !(signed ? /^-?\d+$/ : /^\d+$/).test(value)) throw new ShapeError(path);
  return value;
}
export function optDigits(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : digits(value, path);
}
export function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new ShapeError(path);
  return value as T;
}
export function list<T>(value: unknown, path: string, item: (v: unknown, path: string) => T, max = 5000): T[] {
  if (!Array.isArray(value) || value.length > max) throw new ShapeError(path);
  return value.map((v, i) => item(v, `${path}[${i}]`));
}
export function strings(value: unknown, path: string, max = 500): string[] {
  return list(value, path, (v, p) => str(v, p), max);
}
