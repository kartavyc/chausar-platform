import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { derivePolicy, policyPath, readTokens } from '../../../frontend-validation/policy/derive.mjs';

interface Pair { theme: 'light' | 'dark'; foreground: string; background: string; use: string; minimum: number }
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

/** WCAG 2.x relative luminance of an sRGB hex colour. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  assert.ok(match, `Not a six-digit hex colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map(part => {
    const channel = parseInt(part!, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test('ui-policy.json is exactly what the tokens derive today', () => {
  assert.deepEqual(policy, derivePolicy(), 'Run: node frontend-validation/policy/derive.mjs --write');
});

test('the reading sizes are the lane brief\'s 13.5, 15 and 18, read from type.css and views/*.css', () => {
  assert.deepEqual(policy.rules.textSize.readingPx, { guided: 15, simple: 18, books: 13.5 });
  const tokens = readTokens();
  for (const view of ['guided', 'simple', 'books'] as const) {
    assert.equal(tokens.sizes[view]['--fs-read'], policy.rules.textSize.readingPx[view]);
    assert.ok(policy.rules.textSize.allowedPx[view].includes(policy.rules.textSize.readingPx[view]));
    assert.equal(policy.rules.textSize.minimumPx[view], Math.min(...Object.values(tokens.sizes[view]) as number[]));
  }
  assert.deepEqual(policy.rules.controlSize.minimumPx, { width: 24, height: 24 });
  assert.equal(policy.generatedFrom.targetPx.simple, 44);
});

test('every declared colour pair meets its WCAG 2.2 AA ratio in both themes', () => {
  const failures: string[] = [];
  for (const pair of policy.rules.contrast.pairs as Pair[]) {
    const colours = policy.generatedFrom.colours[pair.theme];
    const ratio = contrast(colours[pair.foreground], colours[pair.background]);
    if (ratio < pair.minimum) failures.push(`${pair.theme} ${pair.foreground} on ${pair.background}: ${ratio.toFixed(2)} < ${pair.minimum}`);
  }
  assert.deepEqual(failures, []);
  // The design's own measured figures (part 6), which it rounds: light green 3.4, dark text 16.8, light amber text 5.4.
  const near = (actual: number, stated: number) => assert.ok(Math.abs(actual - stated) <= 0.1, `${actual.toFixed(2)} is not the design's ${stated}`);
  near(contrast(policy.generatedFrom.colours.light.cha, policy.generatedFrom.colours.light.bg), 3.4);
  near(contrast(policy.generatedFrom.colours.dark.fg, policy.generatedFrom.colours.dark.bg), 16.8);
  near(contrast(policy.generatedFrom.colours.light['amber-t'], policy.generatedFrom.colours.light.bg), 5.4);
  // Green is never text in the light theme: it fails 4.5 and so is declared only as a mark.
  assert.ok(contrast(policy.generatedFrom.colours.light.cha, policy.generatedFrom.colours.light.bg) < 4.5);
  assert.ok(!(policy.rules.contrast.pairs as Pair[]).some(pair => pair.theme === 'light' && pair.foreground === 'cha' && pair.use === 'text'));
});

test('the word limits and text rules are the design\'s, as written in part 11', () => {
  const design = readFileSync(new URL('../../../docs/specs/CHAUSAR-APP-DESIGN.md', import.meta.url), 'utf8');
  const sentence = /Guided over (\d+), a wide page over (\d+), Simple over (\d+), Books over (\d+), a sheet over (\d+)/.exec(design);
  assert.ok(sentence, 'The design states the word limits.');
  assert.deepEqual(policy.rules.words.limits, { guided: Number(sentence[1]), wide: Number(sentence[2]), simple: Number(sentence[3]), books: Number(sentence[4]), sheet: Number(sentence[5]) });
  assert.equal(policy.rules.buttonLabels.maximumCharacters, 22);
  assert.deepEqual(policy.rules.punctuation.forbidden, ['—', '!']);
  assert.equal(policy.rules.motion.repeatingAnimation, 'forbidden');
});
