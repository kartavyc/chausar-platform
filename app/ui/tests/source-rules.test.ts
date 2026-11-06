import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const src = join(import.meta.dirname, '../src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
/** Paths relative to src with forward slashes on every system, so the exemptions below match on Windows too. */
const code = files(src).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => ({ f: relative(src, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

describe('rules the UI keeps (spec section 6)', () => {
  it('paths are relative with forward slashes, so the fake engine exemption applies on every system', () => {
    expect(code.some(({ f }) => f === 'engine/fake.ts')).toBe(true);
    for (const { f } of code) expect(f.includes(String.fromCharCode(92)), f).toBe(false);
  });
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
  it('dates and times go through parts/when.ts: no own date formats, 24-hour clocks, UTC pins or raw ISO days (one-shot B2)', () => {
    // parts/when.ts writes every day and time in the owner's zone; onboarding/flow.ts guesses the country from the
    // computer's zone, which is not a date shown to anyone. The fake engine answers as the engine does.
    const exempt = (f: string) => f.startsWith('engine/fake') || f === 'places/onboarding/flow.ts';
    const found: string[] = [];
    for (const { f, text } of code.filter((c) => /\.tsx?$/.test(c.f) && !exempt(c.f))) {
      if (/Intl\.DateTimeFormat/.test(text)) found.push(`${f}: Intl.DateTimeFormat`);
      if (/hourCycle/.test(text)) found.push(`${f}: hourCycle`);
      if (/timeZone:\s*'UTC'/.test(text)) found.push(`${f}: timeZone 'UTC'`);
      if (/toLocaleString\(/.test(text)) found.push(`${f}: toLocaleString`);
      if (/\.slice\(0,\s?10\)/.test(text)) found.push(`${f}: a raw ISO day`);
      // B2 fix round 1: a day or hour read off a Date is the computer's zone; useLocalToday, useDayKey and the
      // when.ts hooks read the business's zone.
      if (/\.get(?:FullYear|Month|Date|Hours|Day|Minutes)\(/.test(text)) found.push(`${f}: the computer's own day or hour`);
    }
    expect(found).toEqual([]);
  });
  it('the fake engine writes amounts as the engine does: the exact form only in the listed places (B2 fix round 1)', () => {
    // Each place, how many exact calls or exact amounts it writes, and why; the engine's own list is
    // platform/tests/owner-format-sources-b2.test.ts. A hand-made formatter (its own digit grouping) is never allowed.
    const EXACT: Record<string, [count: number, why: string]> = {
      'engine/fake-money.ts': [1, 'the words sent with a shared invoice leave the app, as money/invoice-pdf.ts writes them'],
      'engine/fake-work.ts': [1, 'the client room keeps the exact price, as playbooks/kit/client-room-state.ts does'],
      'engine/fake-model-receipt.ts': [1, "a model call's receipt keeps four decimals, as money/model-receipt.ts does"],
    };
    const EXACT_AMOUNT = /\bformat(?:Minor|Micros)\(|['`"][^'`"\n]*\b[A-Z]{3} -?\d{1,3}(?:,\d{3})*\.\d{2,4}\b/g;
    const found: string[] = [];
    for (const { f, text } of code.filter((c) => c.f.startsWith('engine/fake'))) {
      const count = (text.match(EXACT_AMOUNT) ?? []).length;
      if (count !== (EXACT[f]?.[0] ?? 0)) found.push(`${f}: ${count} exact, listed ${EXACT[f]?.[0] ?? 0}`);
      if (text.includes(String.raw`(?=(\d{3})+(?!\d))`)) found.push(`${f}: its own digit grouping`);
    }
    expect(found).toEqual([]);
  });
  it('DM Mono is for codes only: figures, counts and times are in the body font (B2 fix round 1)', () => {
    // A `mono` class sits on the same line as data-code (an id, a number such as an invoice number, a link, a file
    // name, a key); a CSS rule in DM Mono is one of the listed code styles.
    const CODE_RULES: Record<string, string> = {
      'tokens/base.css .mono': 'the code class itself', 'places/business/Business.module.css .mono': 'a code in the business pages',
      'places/business/Business.module.css .diff': 'a file diff', 'places/business/Reports.module.css .json': 'raw JSON',
      'places/business/RulesSection.module.css .address span': 'an email address', 'places/connections/KitConnect.module.css .code': 'a pairing code',
      'places/money/Money.module.css .pre': 'preformatted text', 'places/onboarding/FirstRun.module.css .code': 'a code',
      'places/onboarding/Onboarding.module.css .code': 'a code', 'places/work/desks/YoutubeDesk.module.css .summary': 'a script as written',
      'places/work/desks/YoutubeDesk.module.css .preview': 'a script as written', 'parts/QuestionCard.module.css .number': 'a question code',
    };
    const found: string[] = [];
    for (const { f, text } of code.filter((c) => c.f.endsWith('.tsx'))) {
      text.split('\n').forEach((line, index) => {
        if (/className=[^\n]*\bmono\b/.test(line) && !/data-code/.test(line)) found.push(`${f}:${index + 1}`);
      });
    }
    for (const { f, text } of code.filter((c) => c.f.endsWith('.css') && !c.f.endsWith('fonts.css') && !c.f.endsWith('tokens.css'))) {
      for (const rule of uncomment(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/font-family:\s*var\(--font-mono\)/.test(rule[2]!)) continue;
        const selector = rule[1]!.trim();
        if (!Object.hasOwn(CODE_RULES, `${f} ${selector}`)) found.push(`${f} ${selector}`);
      }
    }
    expect(found).toEqual([]);
  });
  it('no em dashes in code or copy', () => {
    for (const { f, text } of code) expect(text.includes('—'), f).toBe(false);
  });
  it('colours come from tokens: no hex colours outside tokens.css', () => {
    for (const { f, text } of code.filter((c) => c.f.endsWith('.css') && !c.f.endsWith('tokens.css'))) expect(text, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

/* Ink v2 rules (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md, "The rules that hold"), package 3A1. */

const app = join(src, '..');
const TEXT_FILE = /\.(tsx?|css|json|svg|html|js|mjs|cjs|webmanifest|md|txt)$/;
const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Every text file under src, the en and hi catalogues included. */
const everything = files(src).filter((f) => TEXT_FILE.test(f)).map((f) => ({ f: relative(src, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));
/** Every stylesheet under src but tokens.css, the one file that holds literal values. */
const sheets = everything.filter(({ f }) => f.endsWith('.css') && f !== 'tokens/tokens.css').map((c) => ({ ...c, css: uncomment(c.text) }));
/** Code that renders, where a colour could hide in an SVG attribute or a string. */
const scripts = everything.filter(({ f }) => /\.tsx?$/.test(f));
/** Files outside src that may hold colour literals, each checked by its own test: icon.svg against the founder's logo
 * (shell/rail.test.tsx, one-shot A7), the manifest and index.html against the tokens (shell/phone.test.tsx, w3 plan). */
const LITERAL_FILES = ['public/icon.svg', 'public/manifest.webmanifest', 'index.html'];
/** Every custom property tokens.css defines. */
const TOKEN_NAMES = new Set([...uncomment(readFileSync(join(src, 'tokens/tokens.css'), 'utf8')).matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]!));
/** The one token a container sets to its own ground (w3 plan, "How the D boards become code"). */
const CONTAINER_SET = ['--ring-ground'];

type Declaration = [property: string, value: string];
/** The innermost rules of a stylesheet, each with its declarations in order (property names lower case, custom ones as written). */
function rules(css: string): { selector: string; decls: Declaration[] }[] {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    decls: m[2]!.split(';').filter((d) => d.includes(':')).map((d): Declaration => {
      const property = d.slice(0, d.indexOf(':')).trim();
      return [property.startsWith('--') ? property : property.toLowerCase(), d.slice(d.indexOf(':') + 1).trim()];
    }),
  }));
}
/** Each declaration, inside a rule, whose property matches. */
const declarations = (css: string, property: RegExp): Declaration[] => rules(css).flatMap(({ decls }) => decls.filter(([p]) => property.test(p)));

const UNITS = 'px|em|rem|ex|rex|ch|rch|cap|rcap|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|svi|svb|svmin|svmax|lvw|lvh|lvi|lvb|lvmin|lvmax|dvw|dvh|dvi|dvb|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pt|pc|%';
const RAW_LENGTH = new RegExp(`(?<![\\w.-])-?(?:\\d+\\.?\\d*|\\.\\d+)(?:${UNITS})(?![\\w%])`, 'gi');
const RAW_TIME = /(?<![\w.-])(?:\d+\.?\d*|\.\d+)m?s(?!\w)/i;
/** Lengths written as numbers (6px, 2REM, 50%), not as tokens; zero does not count. */
function rawLengths(value: string): string[] {
  return (value.replace(/var\(--[\w-]+\)/g, '').match(RAW_LENGTH) ?? []).filter((n) => Number(n.replace(/[a-z%]+$/i, '')) !== 0);
}

/** CSS colour functions; color( only with a colour space, so a function named color( in code is not one. */
const COLOUR_FUNCTION = /(?<![\w$.-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|light-dark|device-cmyk)\(|(?<![\w$.-])color\((?=\s*(?:from|srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)\b)/gi;
/** The CSS named colours (CSS Color 4). transparent, currentColor and inherit are allowed; so are system colours, which forced-colors mode needs. */
const NAMED_COLOURS = new Set(
  ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate ' +
    'coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen ' +
    'darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray ' +
    'lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise ' +
    'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon ' +
    'sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise ' +
    'violet wheat white whitesmoke yellow yellowgreen').split(' '),
);
/** A colour written in code: a string that is a hex colour, a hex colour inside a string, or a literal SVG paint. */
const QUOTED_HEX = /(['"`])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\1/gi;
const EMBEDDED_HEX = /(?<=[\s(,:])(?<!url\()#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/gi;
const SVG_PAINT = /\b(?:fill|stroke|stopColor|floodColor|lightingColor)=\{?(['"`])([^'"`]*)\1/g;

// W6 6C2 (DECISIONS D16a): About you turns A into B on Send, one motion of --t-settle.
// One-shot C3: motion.css animates the view-transition pseudo elements of a place change; Swap fades a word in place.
const ANIMATED = ['Sheet.module.css', 'ApprovalRow.module.css', 'Today.module.css', 'SwipeCard.module.css', 'AboutYou.module.css', 'motion.css', 'Swap.module.css'];
const SPACING = /^(?:(?:padding|margin)(?:-[a-z]+)*|(?:row-|column-|grid-|grid-row-|grid-column-)?gap)$/;

/** Each check takes one stylesheet (comments removed), or code for codeColours, and returns what breaks the rule. */
const check = {
  colours: (css: string) => [
    ...(css.match(COLOUR_FUNCTION) ?? []),
    ...rules(css).flatMap(({ decls }) =>
      decls.flatMap(([, value]) => value.replace(/url\([^)]*\)|'[^']*'|"[^"]*"/g, '').match(/(?<![\w-])[a-z]+(?![\w-])/gi) ?? []).filter((word) => NAMED_COLOURS.has(word.toLowerCase())),
    ),
  ],
  codeColours: (text: string) => [
    ...(text.match(QUOTED_HEX) ?? []),
    ...(text.match(EMBEDDED_HEX) ?? []).filter((hex) => !/^#\d{3,4}$/.test(hex)),
    ...(text.match(COLOUR_FUNCTION) ?? []),
    ...[...text.matchAll(SVG_PAINT)].map((m) => m[2]!).filter((paint) => !/^(?:none|currentColor|transparent|inherit|url\(#[\w-]+\)|var\(--[\w-]+\))$/.test(paint)),
  ],
  customProperties: (css: string) =>
    declarations(css, /^--/).map(([property]) => property).filter((p) => !CONTAINER_SET.includes(p) && (TOKEN_NAMES.has(p) || /^--(?:text|fig|t)-/.test(p))),
  motion: (css: string, file: string) => {
    const found = /infinite/i.test(css) ? ['infinite: nothing loops'] : [];
    for (const [property, value] of declarations(css, /^(?:animation|transition)(?:-[a-z-]+)?$/)) {
      const at = `${property}: ${value}`;
      const parts = value.split(/,(?![^(]*\))/).map((p) => p.trim());
      if (RAW_TIME.test(value)) found.push(`${at} has a raw time`);
      if ([...value.matchAll(/var\((--[\w-]+)/g)].some(([, name]) => !name!.startsWith('--t-') && name !== '--ease' && name !== '--ease-exit')) found.push(`${at} uses a variable other than --t-*, --ease or --ease-exit`);
      if (property.startsWith('animation') && !ANIMATED.includes(file.split('/').pop()!)) found.push(`${at} outside ${ANIMATED.join(', ')}`);
      if ((property === 'animation' || property === 'transition') && value !== 'none' && parts.some((p) => !/var\(--t-[\w-]+\)/.test(p))) found.push(`${at} needs a var(--t-...) duration`);
      // One-shot C3: a stagger's delay may be calc(var(--t-stagger) * n), for the first five places alone.
      if (/-(?:duration|delay)$/.test(property) && parts.some((p) => !/^var\(--t-[\w-]+\)$/.test(p) && !(property.endsWith('delay') && /^calc\(var\(--t-stagger\) \* [1-4]\)$/.test(p)))) found.push(`${at}: durations and delays are var(--t-...)`);
      if (property === 'animation-iteration-count' && value !== '1') found.push(`${at} repeats`);
      if (property === 'animation' && parts.some((p) => p.replace(/\([^()]*\)/g, '()').split(/\s+/).some((t) => /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(t) && Number(t) !== 1))) found.push(`${at} repeats`);
    }
    return found;
  },
  fontSize: (css: string) => [
    ...declarations(css, /^font-size$/).filter(([, value]) => !/^(?:var\(--(?:text|fig)-[\w-]+\)|inherit)$/.test(value)).map(([, value]) => `font-size: ${value}`),
    ...declarations(css, /^font$/).filter(([, value]) => rawLengths(value).length > 0).map(([, value]) => `font: ${value}`),
  ],
  rawSpacing: (css: string) => declarations(css, SPACING).flatMap(([, value]) => rawLengths(value)),
  grounds: (css: string) =>
    rules(css).flatMap(({ selector, decls }) => {
      const grounds = decls.filter(([p]) => p === 'background' || p === 'background-color').map(([, v]) => v);
      const colour = decls.filter(([p]) => p === 'color').pop()?.[1] ?? '';
      const only = (allowed: string[]) =>
        grounds.every((g) => /^(?:transparent|none|inherit)$/i.test(g) || (/^(?:\s*var\(--[\w-]+\)\s*)+$/.test(g) && [...g.matchAll(/var\((--[\w-]+)\)/g)].every(([, n]) => allowed.includes(n!))));
      return [
        /var\(--dim\)/.test(colour) && !only(['--bg', '--surface']) ? `${selector}: --dim on ${grounds.join(', ')}` : '',
        /var\(--wait\)/.test(colour) && !only(['--bg', '--surface', '--wait-soft']) ? `${selector}: --wait on ${grounds.join(', ')}` : '',
      ].filter(Boolean);
    }),
};

/**
 * Literals the two global stylesheets must hold, one by one: the screen-reader-only box (base.css), the high-contrast
 * line (base.css) and the reduced-motion times (motion.css). Everything else in them keeps every rule.
 */
const LITERALS: Record<string, Partial<Record<keyof typeof check, string[]>>> = {
  'tokens/base.css': { rawSpacing: ['-1px'], customProperties: ['--line'] },
  // The five time tokens twice: once under reduced motion, once under [data-motion='off'] (one-shot C3).
  'tokens/motion.css': { customProperties: ['--t-press', '--t-sheet', '--t-settle', '--t-exit', '--t-stagger', '--t-press', '--t-sheet', '--t-settle', '--t-exit', '--t-stagger'] },
};
type Sheet = (typeof sheets)[number];
/** What breaks a rule in one stylesheet, less the literals listed above for it. */
function broken(rule: Exclude<keyof typeof check, 'codeColours'>, { f, css }: Sheet): string[] {
  const allowed = [...(LITERALS[f]?.[rule] ?? [])];
  return (rule === 'motion' ? check.motion(css, f) : check[rule](css)).filter((item) => {
    const at = allowed.indexOf(item);
    if (at < 0) return true;
    allowed.splice(at, 1);
    return false;
  });
}

describe('Ink v2 rules the UI keeps (w3 plan)', () => {
  it('the CSS checks catch what they should, on samples', () => {
    expect(check.colours('.a { box-shadow: 0 1px rgba(0, 0, 0, 0.1); color: hsl(0 0% 0%) }')).toHaveLength(2);
    expect(check.colours('.a { box-shadow: var(--shadow-tile) }')).toHaveLength(0);
    expect(check.motion('.a { transition: color 120ms ease }', 'parts/Row.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { transition: color var(--t-press) var(--ease), border-color 200ms }', 'parts/Row.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { transition: color var(--t-press) cubic-bezier(0.2, 0.7, 0.2, 1), opacity var(--t-press) var(--ease) }', 'parts/Row.module.css')).toHaveLength(0);
    expect(check.motion('.a { transition: none }', 'parts/Row.module.css')).toHaveLength(0);
    expect(check.motion('.a { animation: ink-settle var(--t-settle) var(--ease) 1 }', 'parts/Row.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { animation: ink-settle var(--t-settle) var(--ease) 1 }', 'parts/Sheet.module.css')).toHaveLength(0);
    expect(check.motion('.a { animation: ink-settle var(--t-settle) var(--ease) infinite }', 'parts/Sheet.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { animation-iteration-count: 2 }', 'parts/Sheet.module.css')).not.toHaveLength(0);
    expect(check.fontSize('.a { font-size: 13px }')).not.toHaveLength(0);
    expect(check.fontSize('.a { font: 500 13px/1.4 var(--font) }')).not.toHaveLength(0);
    expect(check.fontSize('.a { font-size: calc(var(--text-read) * 0.9) }')).not.toHaveLength(0);
    expect(check.fontSize('.a { font-size: var(--text-read) } .b { font-size: var(--fig-goal) } .c { font-size: inherit; font: inherit }')).toHaveLength(0);
    expect(check.rawSpacing('.a { padding: 6px var(--sp-2); margin: 0 auto; gap: calc(var(--sp-4) * -1); margin-top: calc(1em + 10px); row-gap: 0px }')).toEqual(['6px', '1em', '10px']);
    expect(check.rawSpacing('.a { scroll-padding: 8px } .gap:hover { color: var(--fg) }')).toHaveLength(0);
    expect(check.grounds('.a { background: var(--wash); color: var(--dim) }')).not.toHaveLength(0);
    expect(check.grounds('.a { background-color: var(--prod-tint); color: var(--wait) }')).not.toHaveLength(0);
    expect(check.grounds('.a { background: var(--prod-tint); color: var(--wait-strong) } .b { background: var(--surface); color: var(--dim) }')).toHaveLength(0);
  });

  it('the CSS checks close the loopholes the review found, on samples', () => {
    // 1. Custom properties may not stand in for a token or invent a size or time; longhand times are tokens too.
    expect(check.customProperties('.a { --text-tiny: 10px }')).toEqual(['--text-tiny']);
    expect(check.customProperties('.a { --text-label: 9px; --fig-big: 80px; --t-slow: 2s; --accent: var(--fail) }')).toEqual(['--text-label', '--fig-big', '--t-slow', '--accent']);
    expect(check.customProperties('.a { --ring-ground: var(--inner); --av: var(--av-40); --snap-from: var(--sp-6) }')).toEqual([]);
    expect(check.motion('.a { transition-duration: var(--slow) }', 'parts/Row.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { transition-delay: 2S }', 'parts/Row.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { transition: opacity var(--t-press) var(--slow) }', 'parts/Row.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { transition-duration: var(--t-press), var(--t-sheet); transition-delay: var(--t-press) }', 'parts/Row.module.css')).toEqual([]);
    // 2. Loops in any spelling.
    expect(check.motion('.a { animation: ink-settle var(--t-settle) var(--ease) 3 }', 'parts/Sheet.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { animation: ink-settle var(--t-settle) var(--ease) INFINITE }', 'parts/Sheet.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { --n: infinite } .b { animation: ink-settle var(--t-settle) var(--ease) var(--n) }', 'parts/Sheet.module.css')).not.toHaveLength(0);
    expect(check.motion('.a { animation: ink-snap var(--t-settle) var(--ease) 1 both }', 'parts/SwipeCard.module.css')).toEqual([]);
    // 3. Every way to write a colour, in stylesheets and in code.
    for (const bad of ['color: white', 'border: 1px solid Black', 'background: oklch(0.7 0.1 150)', 'background: lab(50 40 30)', 'color: hwb(150 20% 30%)', 'color: color(display-p3 0 1 0)', 'color: color-mix(in srgb, var(--accent) 50%, var(--surface))', 'color: light-dark(var(--fg), var(--bg))', '--x: Red']) {
      expect(check.colours(`.a { ${bad} }`), bad).not.toHaveLength(0);
    }
    expect(check.colours('.a { color: transparent; fill: currentColor; stroke: inherit; font-family: \'Tan Sans\' } .red:not(.white) { color: var(--fg) } @media (forced-colors: active) { .b { outline-color: CanvasText } }')).toEqual([]);
    for (const bad of ['<rect fill="#16181b" />', '<path stroke={\'#fff\'} />', 'const shadow = \'0 0 0 2px #2fb67c\';', 'const accent = \'rgb(47 182 124)\';', '<circle fill="white" />', '<stop stopColor="Tomato" />', 'const c = `oklch(0.7 0.1 150)`;']) {
      expect(check.codeColours(bad), bad).not.toHaveLength(0);
    }
    expect(check.codeColours('<path fill="none" stroke="currentColor" /> <a href="#/today">Today</a> <rect fill="url(#stripe)" /> const x = colour(\'a\'); Invoice #1042 and #12')).toEqual([]);
    // 5. Allowlists, not blocklists: --dim only on --bg or --surface, --wait only on --bg, --surface or --wait-soft.
    for (const ground of ['hover', 'line-soft', 'accent-soft', 'wait-soft', 'fail-soft', 'prod-tint', 'inner']) {
      expect(check.grounds(`.a { background: var(--${ground}); color: var(--dim) }`), ground).not.toHaveLength(0);
    }
    for (const ground of ['accent-soft', 'fail-soft', 'hover', 'sales-tint']) {
      expect(check.grounds(`.a { background-color: var(--${ground}); color: var(--wait) }`), ground).not.toHaveLength(0);
    }
    expect(check.grounds('.a { background: var(--bg); color: var(--dim) } .b { background: var(--wait-soft); color: var(--wait) } .c { color: var(--dim) } .d { background: transparent; color: var(--wait) }')).toEqual([]);
    // 6. Raw lengths in any unit and any case.
    expect(check.rawSpacing('.a { padding: 2REM 3dvh 1cqw 4Q; margin: 1in 2mm 3cm 4pc; gap: 1rlh; margin-top: 0PX }')).toEqual(['2REM', '3dvh', '1cqw', '4Q', '1in', '2mm', '3cm', '4pc', '1rlh']);
  });

  it('colours are tokens in every stylesheet: no colour function and no named colour (shadows and scrims are tokens)', () => {
    expect(sheets.some(({ f }) => f === 'tokens/base.css')).toBe(true);
    for (const sheet of sheets) expect(broken('colours', sheet), sheet.f).toEqual([]);
  });

  it(`colours are tokens in code too: no hex, colour function or literal SVG paint in .ts, .tsx or public files but ${LITERAL_FILES.join(', ')}`, () => {
    for (const { f, text } of scripts) expect(check.codeColours(text), f).toEqual([]);
    for (const path of files(join(app, 'public')).filter((p) => TEXT_FILE.test(p))) {
      const name = relative(app, path).split(sep).join('/');
      if (!LITERAL_FILES.includes(name)) expect(check.codeColours(readFileSync(path, 'utf8')), name).toEqual([]);
    }
  });

  it('custom properties in stylesheets never stand in for a token: no name tokens.css defines (but --ring-ground) and no new --text-*, --fig-* or --t-*', () => {
    for (const sheet of sheets) expect(broken('customProperties', sheet), sheet.f).toEqual([]);
  });

  // One-shot A7: the founder's logo (public/icon.svg, held to the logo file by rail.test.tsx) has its own green, the
  // old neon. That one file keeps it; the app's accent stays Jade and the neon stays out of everything else.
  it('the accent is a token: 2fb67c appears in src only in tokens.css, and the old neon green nowhere but the logo', () => {
    const neon = new RegExp(['46', 'f0', '9b'].join(''), 'i');
    for (const { f, text } of everything) {
      if (f !== 'tokens/tokens.css') expect(text, f).not.toMatch(/2fb67c/i);
      expect(text, f).not.toMatch(neon);
    }
    const logo = join(app, 'public', 'icon.svg');
    for (const path of [...files(join(app, 'public')).filter((p) => TEXT_FILE.test(p) && p !== logo), join(app, 'index.html')]) expect(readFileSync(path, 'utf8'), path).not.toMatch(neon);
    expect(readFileSync(logo, 'utf8')).toMatch(neon);
  });

  it('no emoji in src or the text catalogues', () => {
    expect(everything.some(({ f }) => f.startsWith('text/hi/'))).toBe(false);
    for (const { f, text } of everything) expect(text.match(/\p{Extended_Pictographic}/u)?.[0], f).toBeUndefined();
  });

  it(`motion runs once on the time tokens, and only ${ANIMATED.join(', ')} animate`, () => {
    for (const sheet of sheets) expect(broken('motion', sheet), sheet.f).toEqual([]);
  });

  it('every time token is 0 ms under reduced motion and when the owner turns animations off (one-shot C3)', () => {
    const motion = uncomment(readFileSync(join(src, 'tokens/motion.css'), 'utf8'));
    const times = [...TOKEN_NAMES].filter((name) => name.startsWith('--t-'));
    expect(times).toEqual(expect.arrayContaining(['--t-press', '--t-sheet', '--t-settle', '--t-exit', '--t-stagger']));
    const reduced = motion.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1];
    const off = motion.match(/:root\[data-motion='off'\]\s*\{([^}]*)\}/)?.[1];
    expect(reduced, 'the reduced-motion block').toBeDefined();
    expect(off, "the [data-motion='off'] block").toBeDefined();
    for (const name of times) {
      expect(reduced, name).toMatch(new RegExp(`${name}:\\s*0ms`));
      expect(off, name).toMatch(new RegExp(`${name}:\\s*0ms`));
    }
    // The exit ease is a motion token beside --ease (C3 task 1).
    expect(check.motion('.a { transition: opacity var(--t-exit) var(--ease-exit) }', 'parts/Row.module.css')).toEqual([]);
  });

  it('type sizes in stylesheets are tokens: font-size is a --text-* or --fig-* variable', () => {
    for (const sheet of sheets) expect(broken('fontSize', sheet), sheet.f).toEqual([]);
  });

  it('spacing in stylesheets is on tokens: each file holds exactly the raw padding, margin and gap values tests/baselines/spacing.json says, and that only goes down', () => {
    const { counts } = JSON.parse(readFileSync(join(import.meta.dirname, 'baselines/spacing.json'), 'utf8')) as { counts: Record<string, number> };
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0), 'the wave 3 start counted 54').toBeLessThanOrEqual(54);
    for (const f of Object.keys(counts)) expect(sheets.some((s) => s.f === f), `${f} is gone: remove it from the baseline`).toBe(true);
    for (const sheet of sheets) {
      const raw = broken('rawSpacing', sheet);
      const allowed = counts[sheet.f] ?? 0;
      const advice = raw.length > allowed ? `the baseline allows ${allowed}: use --sp-*, --gap-*, --pad-* or calc() of them` : `lower the baseline to ${raw.length}`;
      expect(raw.length, `${sheet.f} has ${raw.length} raw spacing values (${raw.join(' ')}); ${advice}`).toBe(allowed);
    }
  });

  it('--dim sits only on --bg or --surface, and plain --wait only on --bg, --surface or --wait-soft', () => {
    for (const sheet of sheets) expect(broken('grounds', sheet), sheet.f).toEqual([]);
  });
});

/*
 * w3 3H2: Hindi runs longer than English, so chips wrap rather than spill, and nothing cuts a figure (spec section 8:
 * "Cards and chips wrap to two lines; no truncation of figures").
 */

/** The words of a class name: `qcKind` is qc and kind, `rank-name` is rank and name. */
const segments = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_-]+/).filter(Boolean);
/** Each item of a selector list as [the classes of its subject compound, whether it is scoped to Hindi]. */
function subjects(selector: string): { classes: string[]; hindi: boolean }[] {
  return selector.split(/,(?![^(]*\))/).map((item) => {
    const hindi = /:lang\(\s*hi\s*\)/.test(item);
    const compounds = item.replace(/:[\w-]+\([^)]*\)/g, '').trim().split(/\s*[>+~]\s*|\s+/);
    return { classes: [...(compounds.pop() ?? '').matchAll(/\.([\w-]+)/g)].map((m) => m[1]!), hindi };
  });
}
const declared = (decls: Declaration[], property: RegExp, value: RegExp) => decls.some(([p, v]) => property.test(p) && value.test(v));

const PROSE = /^(?:title|line|role|now|sub|name)$/;
const FIGURE = /^(?:fig|figure|amt|amount|value|count|price|total|num)$/;
/** Rules that cut text (an ellipsis or a line clamp) must name a prose part, never a figure. */
function truncatedFigures(css: string): string[] {
  return rules(css)
    .filter(({ decls }) => declared(decls, /^text-overflow$/, /ellipsis/) || declared(decls, /^(?:-webkit-)?line-clamp$/, /^(?!none$)/))
    .flatMap(({ selector }) =>
      subjects(selector)
        .filter(({ classes }) => !classes.some((cls) => segments(cls).some((word) => PROSE.test(word))) || classes.some((cls) => segments(cls).some((word) => FIGURE.test(word))))
        .map(() => `${selector} cuts text but is not a prose part (title, line, role, now, sub, name), or names a figure`),
    );
}

describe('figures stay whole', () => {
  it('text-overflow and line-clamp only cut prose, never a figure', () => {
    expect(truncatedFigures('.title { text-overflow: ellipsis } .compact .postLine { line-clamp: 2 } .rankName { -webkit-line-clamp: 3 }')).toEqual([]);
    expect(truncatedFigures('.amount { text-overflow: ellipsis } .cardHead { -webkit-line-clamp: 2 } .subCount { text-overflow: ellipsis } .title { line-clamp: none }')).toHaveLength(3);
    for (const sheet of sheets) expect(truncatedFigures(sheet.css), sheet.f).toEqual([]);
  });
});
