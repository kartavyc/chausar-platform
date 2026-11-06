// D2 task 10: the fake-engine and text-key tests run in the 'logic' project (node, threads, no isolation). A file there
// that draws a page or parses HTML needs the DOM, so it must be on NEEDS_DOM in vitest.config.ts, and every name on
// that list must still be such a file.
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const config = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
const list = (name: string) => [...(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`).exec(config)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1]!);
const USES_DOM = /@testing-library|DOMParser|\bwindow\.\w|\bdocument\.(?:querySelector|getElementById|body|createElement)/;

describe('the logic project', () => {
  it('holds no test that needs the DOM, and NEEDS_DOM names exactly those that do', () => {
    const logic = list('LOGIC'), needsDom = list('NEEDS_DOM');
    expect(logic).toEqual(['tests/engine/**/*.test.{ts,tsx}', 'tests/text*.test.{ts,tsx}']);
    const files = logic.flatMap(pattern => globSync(pattern, { cwd: root })).map(file => file.replaceAll('\\', '/')).sort();
    expect(files.length).toBeGreaterThan(100);
    const needing = files.filter(file => USES_DOM.test(readFileSync(join(root, file), 'utf8')));
    expect([...needsDom].sort()).toEqual(needing);
  });
});
