// Types for scripts/near.mjs (D11): the tests near a change.
export function importsOf(text: string): string[];
export function nearTests(input: { changed: string[]; files: string[]; read: (file: string) => string }): { engine: string[]; ui: string[] };
