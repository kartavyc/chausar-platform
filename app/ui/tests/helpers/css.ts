/**
 * Reading a part's CSS module in a test. jsdom computes no styles from CSS modules, so a test that must check a
 * look (a token on a ground, a rule inside a media query) reads the module's own text. Prefer a behaviour test;
 * use these only for what the DOM cannot show.
 *
 *   cssOf(file)                    the module's text without comments
 *   rule(file, selector, media?)   the declarations of the rule whose selector list holds `selector` exactly, at the
 *                                  top level, or inside `@media <media>` when `media` is given
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const parts = join(import.meta.dirname, '../../src/parts');

/** A CSS module under src/parts (`Tile.module.css`, `charts/Charts.module.css`) without comments. */
export function cssOf(file: string): string {
  return readFileSync(join(parts, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The top-level blocks of a stylesheet: each prelude (a selector list or an at-rule) with its body. */
function blocks(css: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  let prelude = '';
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') {
      if (depth === 0) {
        prelude = css.slice(preludeStart, i).trim();
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        out.push({ prelude, body: css.slice(bodyStart, i) });
        preludeStart = i + 1;
      }
    }
  }
  return out;
}

/** The declarations of the rule whose selector list holds `selector` exactly, top level or inside `@media <media>`. */
export function rule(file: string, selector: string, media?: string): string {
  let scope = blocks(cssOf(file));
  if (media !== undefined) {
    const block = scope.find((b) => b.prelude.replace(/\s+/g, ' ') === `@media ${media}`);
    if (!block) throw new Error(`no @media ${media} in ${file}`);
    scope = blocks(block.body);
  }
  const found = scope.find((b) => !b.prelude.startsWith('@') && b.prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes(selector));
  if (!found) throw new Error(`no rule "${selector}"${media ? ` in @media ${media}` : ''} in ${file}`);
  return found.body;
}
