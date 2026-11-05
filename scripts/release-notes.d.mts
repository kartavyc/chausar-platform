// Types for scripts/release-notes.mjs (D11): a release's notes.
export function releaseNotes(input: { version: string; commits: string[]; whatsNew: Record<string, unknown>; unsigned?: boolean }): string;
