// Types for scripts/release-smoke.mjs (D11): the release smoke.
export const FIRST_PAINT: string;
export function installRefusal(input?: { reg?: (args: string[]) => { status?: number | null; stdout?: string; error?: Error }; env?: Record<string, string | undefined>; allowInstall?: boolean }): string | null;
