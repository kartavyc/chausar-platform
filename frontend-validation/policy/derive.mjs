// Derive app/ui/ui-policy.json from the tokens (tokens.css, type.css, views/*.css) and the design's
// fixed limits (CHAUSAR-APP-DESIGN.md part 6 "Colours" and "Type", part 11 "Tests that check the design").
//   node frontend-validation/policy/derive.mjs          print the derived policy
//   node frontend-validation/policy/derive.mjs --write  write app/ui/ui-policy.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const policyPath = resolve(workspaceRoot, 'app/ui/ui-policy.json');
const SOURCES = {
  tokens: 'app/ui/src/tokens/tokens.css',
  type: 'app/ui/src/tokens/type.css',
  simple: 'app/ui/src/views/simple.css',
  books: 'app/ui/src/views/books.css',
};

/** The custom properties declared directly in the first block whose selector matches exactly. */
export function declarations(css, selector) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = clean.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block.`);
  const open = clean.indexOf('{', start);
  let depth = 0, end = open;
  for (; end < clean.length; end++) { if (clean[end] === '{') depth++; else if (clean[end] === '}' && --depth === 0) break; }
  const body = clean.slice(open + 1, end);
  const out = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[match[1]] = match[2].trim();
  return out;
}
/** Resolve `var(--x)` references against a token table, recursively. */
export function resolveVar(value, table, seen = new Set()) {
  return value.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/gi, (_, name) => {
    if (seen.has(name) || table[name] === undefined) throw new Error(`Unresolved ${name}.`);
    return resolveVar(table[name], table, new Set([...seen, name]));
  });
}
const px = value => { const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value); if (!match) throw new Error(`Not a px value: ${value}`); return Number(match[1]); };
const COLOUR_TOKENS = ['bg', 'fg', 'fg2', 'mute', 'line', 'line2', 'cha', 'amber', 'amber-t', 'red', 'dim'];

export function readTokens(root = workspaceRoot) {
  const read = name => readFileSync(resolve(root, SOURCES[name]), 'utf8');
  const tokensCss = read('tokens'), typeCss = read('type');
  const light = declarations(tokensCss, ':root');
  const dark = { ...light, ...declarations(tokensCss, ':root[data-theme="dark"]') };
  const type = declarations(typeCss, ':root');
  const views = { guided: {}, simple: declarations(read('simple'), ':root[data-view="simple"]'), books: declarations(read('books'), ':root[data-view="books"]') };
  const colours = theme => Object.fromEntries(COLOUR_TOKENS.map(name => [name, resolveVar(theme[`--${name}`], theme).toUpperCase()]));
  const sizes = {}, targets = {};
  for (const [view, overrides] of Object.entries(views)) {
    const table = { ...light, ...type, ...overrides };
    sizes[view] = Object.fromEntries(Object.keys(table).filter(name => name.startsWith('--fs-')).sort().map(name => [name, px(resolveVar(table[name], table))]));
    targets[view] = px(resolveVar(table['--target'], table));
  }
  // Frame sizes as drawn and in the medium window (design part 4, "Other window sizes").
  const medium = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const mediumAt = medium.indexOf('@media (min-width: 1024px) and (max-width: 1315px)');
  if (mediumAt < 0) throw new Error('No medium-window block in tokens.css.');
  const mediumTokens = declarations(medium.slice(medium.indexOf('{', mediumAt) + 1), ':root');
  const frame = {
    railPx: { asDrawn: px(light['--rail']), medium: px(mediumTokens['--rail']) },
    columnPx: { asDrawn: px(light['--col']), medium: px(mediumTokens['--col']) },
    sheetPx: px(light['--sheet']),
    topBarPx: px(light['--topbar']),
  };
  return { colours: { light: colours(light), dark: colours(dark) }, sizes, targets, frame };
}

/** The design's fixed rules (part 6, part 11 and WCAG 2.2 AA). Only token values above are derived. */
const WORD_LIMITS = { guided: 120, wide: 150, simple: 90, books: 170, sheet: 110 };
/** Every window width the checker walks (design part 4: as drawn, the medium window and the narrow layout down to 360). */
export const NARROW_WIDTHS = [1366, 1315, 1200, 1024, 1023, 800, 600, 480, 360];
const TEXT_TOKENS = ['fg', 'fg2', 'mute', 'amber-t', 'red'];
const MARK_TOKENS = ['fg', 'mute', 'cha', 'amber', 'dim'];

export function derivePolicy(root = workspaceRoot) {
  const tokens = readTokens(root);
  const views = Object.keys(tokens.sizes);
  const allowed = Object.fromEntries(views.map(view => [view, [...new Set(Object.values(tokens.sizes[view]))].sort((a, b) => a - b)]));
  const pairs = [];
  for (const theme of ['light', 'dark']) {
    for (const name of TEXT_TOKENS) pairs.push({ theme, foreground: name, background: 'bg', use: 'text', minimum: 4.5 });
    for (const name of MARK_TOKENS) pairs.push({ theme, foreground: name, background: 'bg', use: 'non-text mark', minimum: 3 });
  }
  return {
    $comment: 'Derived by frontend-validation/policy/derive.mjs. Do not edit by hand; app/ui/tests/frame-today-ui-policy.test.ts fails when this drifts from the tokens.',
    version: 1,
    generatedFrom: {
      files: Object.values(SOURCES),
      design: 'docs/specs/CHAUSAR-APP-DESIGN.md: part 6 (Colours, Type), part 4 (Tokens), part 11 (Words, Text, Never, Motion); WCAG 2.2 AA 1.4.3, 1.4.11, 2.5.8',
      note: 'The lane brief names reading sizes 13.5, 15 and 18: these are --fs-read in Books, Guided and Simple. Every other --fs-* token per view is an allowed size; nothing renders below the smallest token.',
      colours: tokens.colours,
      typeSizesPx: tokens.sizes,
      targetPx: tokens.targets,
      framePx: tokens.frame,
    },
    views, themes: ['light', 'dark'], languages: ['en', 'hi'],
    viewports: { full: { width: 1366, height: 768 }, medium: { width: 1024, height: 768 }, widths: NARROW_WIDTHS, height: 768 },
    rules: {
      textSize: {
        readingPx: Object.fromEntries(views.map(view => [view, tokens.sizes[view]['--fs-read']])),
        allowedPx: allowed,
        minimumPx: Object.fromEntries(views.map(view => [view, allowed[view][0]])),
        tolerancePx: 0.05,
        applies: 'Every element with its own visible text, in both languages. Hindi uses the same sizes.',
      },
      controlSize: {
        standard: 'WCAG 2.2 AA 2.5.8 Target Size (Minimum)',
        minimumPx: { width: 24, height: 24 },
        exceptions: ['inline: a link or control inside a sentence', 'spacing: a 24 px circle on the target centre touches no other target', 'hidden or disabled'],
        selector: 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=option]',
        designTargetPx: tokens.targets,
        designTargetSeverity: 'warning',
      },
      contrast: {
        standard: 'WCAG 2.2 AA 1.4.3 Contrast (Minimum) and 1.4.11 Non-text Contrast',
        textMinimum: 4.5, largeTextMinimum: 3, nonTextMinimum: 3,
        largeTextPx: 24, largeBoldTextPx: 18.66, boldWeight: 700,
        exempt: ['disabled controls', 'hairlines (line, line2): decoration, no control depends on them', 'invisible text'],
        pairs,
      },
      figures: {
        selector: '.fig, [data-figure], figure',
        contained: 'A figure is not clipped by its own box or a clipping ancestor and does not spill out of its parent box.',
        tolerancePx: 1,
      },
      words: {
        limits: WORD_LIMITS,
        count: 'Intl.Segmenter word-like segments of the rendered text, figures, labels and chart words included (design part 11 "Words").',
        atRest: 'main [data-region=page] plus the status line [data-region=status]; Guided uses the wide limit when the page column is wider than --col',
        sheet: 'the open sheet [data-region=sheet], counted on its own',
      },
      buttonLabels: { maximumCharacters: 22, selector: 'button.m-press', count: 'Unicode code points of the rendered, trimmed label' },
      punctuation: { forbidden: ['—', '!'], applies: 'all rendered text' },
      layout: {
        design: 'docs/specs/CHAUSAR-APP-DESIGN.md part 4, "Other window sizes": 1316 and wider as drawn; 1024 to 1315 rail 176, column 640, a sheet covers the list; under 1024 a bar across the top, the full width, a sheet fills the screen, lists one column, charts stack, a wide table scrolls sideways inside its own box; designed down to 360.',
        asDrawnFromPx: 1316,
        mediumFromPx: 1024,
        railPx: tokens.frame.railPx,
        columnPx: tokens.frame.columnPx,
        sheetPx: tokens.frame.sheetPx,
        topBarMaxPx: 120,
        tolerancePx: 1,
        rules: {
          'page-scroll-x': 'The window and the page never scroll sideways.',
          'overflow-viewport': 'No element reaches past the window, unless a box of its own scrolls or clips it inside the window.',
          'rail-layout': 'From 1024 the rail is a column at the left, 216 wide (176 from 1024 to 1315); under 1024 it is a bar across the top.',
          'sheet-layout': 'From 1316 the sheet sits beside the page; from 1024 to 1315 it covers the list; under 1024 it fills the window.',
          'charts-stack': 'Under 1024 no two charts sit side by side.',
          'table-scroll': 'A table wider than the page scrolls inside its own box.',
        },
      },
      remoteImages: { forbidden: true, applies: 'img/srcset/image/CSS background or mask URLs and every request that leaves 127.0.0.1' },
      motion: { repeatingAnimation: 'forbidden', reducedMotion: 'with prefers-reduced-motion: reduce, every transition and animation duration is 0' },
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = `${JSON.stringify(derivePolicy(), null, 2)}\n`;
  if (process.argv.includes('--write')) { writeFileSync(policyPath, text); console.log(`Wrote ${policyPath}`); }
  else process.stdout.write(text);
}
