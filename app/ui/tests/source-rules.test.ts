import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = join(import.meta.dirname, '../src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const code = files(src).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => ({ f: f.slice(src.length + 1), text: readFileSync(f, 'utf8') }));

describe('rules the UI keeps (spec section 6)', () => {
  it('text nodes only: no innerHTML and no dangerouslySetInnerHTML', () => {
    for (const { f, text } of code) expect(text, f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|outerHTML|insertAdjacentHTML/);
  });
  it('no inline styles at runtime: no style props or style attributes', () => {
    for (const { f, text } of code.filter((c) => c.f.endsWith('.tsx'))) expect(text, f).not.toMatch(/\sstyle=\{|setAttribute\(['"]style/);
  });
  it('nothing kept in browser storage, so no secret can be', () => {
    for (const { f, text } of code) expect(text, f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  });
  it('no money arithmetic: no BigInt, parseFloat or toFixed on figures in the UI', () => {
    for (const { f, text } of code.filter((c) => !c.f.startsWith('engine/fake'))) expect(text, f).not.toMatch(/BigInt\(|parseFloat\(|toFixed\(|Intl\.NumberFormat/);
  });
  it('no em dashes in code or copy', () => {
    for (const { f, text } of code) expect(text.includes('—'), f).toBe(false);
  });
  it('colours come from tokens: no hex colours outside tokens.css', () => {
    for (const { f, text } of code.filter((c) => c.f.endsWith('.css') && !c.f.endsWith('tokens.css'))) expect(text, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
