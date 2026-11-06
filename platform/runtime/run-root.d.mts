export const CHECKOUT_PACKAGE: 'chausar-desktop';
export function checkoutOf(path: string): string | null;
export class DataInsideRepoError extends Error { code: 'DATA_INSIDE_REPO'; }
export type RunEnv = Readonly<Record<string, string | undefined>>;
export function refuseInsideRepo(path: string, options?: { env?: RunEnv; variable?: string; fallback?: string }): string;
export function localDay(date: Date): string;
export function defaultRunRoot(name: string, options?: { now?: () => Date; temp?: string }): string;
export function runRoot(name: string, options?: { env?: RunEnv; now?: () => Date; temp?: string }): string;
export function outputFile(requested: string | undefined | null, options: { name: string; file: string; env?: RunEnv; now?: () => Date; temp?: string }): string;
