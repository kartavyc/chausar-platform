// Types for scripts/release-smoke.mjs (D11): the release smoke.
export const FIRST_PAINT: string;
export const ENGINE_READY: string;
export function installRefusal(input?: { reg?: (args: string[]) => { status?: number | null; stdout?: string; error?: Error }; env?: Record<string, string | undefined>; allowInstall?: boolean }): string | null;
/** How the smoke asks the app to quit: a second launch with --quit on Windows, SIGTERM elsewhere. */
export function quitWay(platform?: string): 'launch' | 'signal';
