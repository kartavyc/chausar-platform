// Chausar venture launcher: the build brief's fixed text and its deterministic lint (package P4).
// The lint blocks the builder buttons when a section or a required line is missing, a price does not match
// a receipt, or the text has an em dash, a house-style word or contact details. It never rewrites the brief.
import type { BriefLint, BriefLintRule, PriceReceiptRecord } from '../contracts.ts';
import { houseStyleFindings } from '../records.ts';

export const BRIEF_MAX_CHARS = 9000;
export const BRIEF_ID_PATTERN = /^chb_[a-z0-9]{8}$/;
export const FIRST_LINE_PATTERN = /^Build brief from Chausar\. Business type: [^.]+\. Brief id: chb_[a-z0-9]{8}\.$/;

/** The eleven section headings, in order. */
export const BRIEF_HEADINGS = Object.freeze([
  '## 1. What to build',
  '## 2. Who it is for',
  '## 3. Offer and prices (copy exactly)',
  '## 4. Pages',
  '## 5. Data rules',
  '## 6. Payments and money',
  '## 7. Look and feel',
  '## 8. Country notes',
  '## 9. Repo setup',
  '## 10. Done means',
  '## 11. Do not',
] as const);

/** One line in the brief. Every key is one lintapple's validatePolicy() accepts; controlContainers is not empty. */
export const UI_POLICY = '{"fonts":["system-ui"],"fontSizes":[15,16,18,20,24,32,40],"typeRules":[],"minControlSize":24,"controlSizeRules":[],"minControlGap":8,"minControlInset":8,"controlContainers":["[data-ui-container]"],"minLayoutGap":8,"bannedCopy":["seamless","game-changing","unlock your potential"],"viewports":[{"width":390,"height":844},{"width":1440,"height":900}],"colorSchemes":["light","dark"],"exceptions":[]}';

export const RLS_LINE = 'Turn on row level security for every table, with policies so a signed-in client reads and writes only their own rows.';
export const SIGN_IN_LINE = 'Nothing is readable without sign-in except the public pages.';
export const ANON_KEY_LINE = 'Only the public anon key may appear in front-end code, never a service role key.';
export const NO_TRACKING_LINE = 'Add no tracking scripts.';
export const LINTAPPLE_LINE = '- Run npm install --save-dev --save-exact lintapple@0.1.20 @playwright/test and commit the lockfile.';
export const UI_POLICY_LINE = `- Save this as ui-policy.json at the root: ${UI_POLICY}`;
export const WORKFLOW_LINE = '- Add .github/workflows/ui-lint.yml named UI lint. Run it on push and pull_request only, never pull_request_target. Set permissions: contents: read. Use no secrets. Pin every third-party action to a full commit SHA.';
export const WORKFLOW_STEPS_LINE = '- In that workflow run npm ci, build the app, start it, wait for its address, then run npx playwright test.';

/** Lines that must appear word for word: four in section 5, four in section 7. */
export const REQUIRED_BRIEF_LINES: readonly string[] = Object.freeze([
  RLS_LINE, SIGN_IN_LINE, ANON_KEY_LINE, NO_TRACKING_LINE,
  LINTAPPLE_LINE, UI_POLICY_LINE, WORKFLOW_LINE, WORKFLOW_STEPS_LINE,
]);
const REQUIRED_LINE_SECTION: readonly number[] = Object.freeze([5, 5, 5, 5, 7, 7, 7, 7]);
const REQUIRED_LINE_NAME: readonly string[] = Object.freeze([
  'the row level security line', 'the sign-in line', 'the anon key line', 'the no tracking line',
  'the lintapple install line', 'the ui-policy.json line', 'the UI lint workflow line', 'the workflow steps line',
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d\s-]{8,}\d/;
const PRICE_TOKEN = /[A-Z]{3} [\d,]+(?:\.\d+)?/g;

type Finding = BriefLint['findings'][number];

/** Lines (0-based) between a heading and the next "## " line. Null when the heading is absent. */
function sectionRange(lines: readonly string[], heading: string): { start: number; end: number; headingLine: number } | null {
  const index = lines.indexOf(heading);
  if (index < 0) return null;
  let end = index + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  return { start: index + 1, end, headingLine: index };
}

/**
 * Deterministic lint, one finding per problem with a 1-based line number (null when the problem has no line).
 * priceReceipts are the receipts whose figures the brief may quote; briefId is the id the brief must carry.
 * clientArea false is a composed plan with no client-area page: it has no private area, so the row level security and
 * sign-in lines are left out of its brief on purpose and are not required. Every other rule is unchanged.
 */
export function lintBrief(markdown: string, priceReceipts: readonly PriceReceiptRecord[], briefId: string, options: { clientArea?: boolean } = {}): BriefLint {
  const clientArea = options.clientArea !== false;
  const findings: Finding[] = [];
  const add = (rule: BriefLintRule, line: number | null, message: string) => { findings.push({ rule, line, message }); };
  const text = String(markdown).replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  // first-line
  if (!FIRST_LINE_PATTERN.test(lines[0] ?? '')) add('first-line', 1, 'Line one must say "Build brief from Chausar", the business type and the brief id.');

  // brief-id
  const idOk = typeof briefId === 'string' && BRIEF_ID_PATTERN.test(briefId);
  if (!idOk) add('brief-id', null, 'The brief id must be chb_ followed by eight lower-case letters or digits.');
  else {
    if (!(lines[0] ?? '').endsWith(`Brief id: ${briefId}.`)) add('brief-id', 1, 'Line one must carry this brief\'s id.');
    const repo = sectionRange(lines, BRIEF_HEADINGS[8]);
    const repoLines = repo ? lines.slice(repo.start, repo.end) : [];
    if (!repoLines.includes(`chausar-brief-id: ${briefId}`)) add('brief-id', repo ? repo.headingLine + 1 : null, 'Section 9 must carry the line chausar-brief-id with this brief\'s id.');
    if (!repoLines.some(line => line.includes(`<meta name="chausar-brief" content="${briefId}">`))) add('brief-id', repo ? repo.headingLine + 1 : null, 'Section 9 must carry the chausar-brief meta tag with this brief\'s id.');
  }

  // required-section: all eleven, once each, in order, and no other "## " heading
  const known = new Set<string>(BRIEF_HEADINGS);
  lines.forEach((line, index) => {
    if (line.startsWith('## ') && !known.has(line)) add('required-section', index + 1, 'This heading is not one of the eleven brief sections.');
  });
  let lastFirst = -1;
  let orderBroken = false;
  for (const heading of BRIEF_HEADINGS) {
    const at: number[] = [];
    lines.forEach((line, index) => { if (line === heading) at.push(index); });
    if (at.length === 0) { add('required-section', null, `The section "${heading.slice(3)}" is missing.`); continue; }
    if (at.length > 1) add('required-section', at[1] + 1, `The section "${heading.slice(3)}" appears more than once.`);
    if (!orderBroken && at[0] < lastFirst) {
      orderBroken = true;
      add('required-section', at[0] + 1, `The section "${heading.slice(3)}" is out of order.`);
    }
    lastFirst = Math.max(lastFirst, at[0]);
  }

  // required-text
  REQUIRED_BRIEF_LINES.forEach((required, i) => {
    if (!clientArea && (required === RLS_LINE || required === SIGN_IN_LINE)) return;
    const section = REQUIRED_LINE_SECTION[i];
    const range = sectionRange(lines, BRIEF_HEADINGS[section - 1]);
    const present = range ? lines.slice(range.start, range.end).includes(required) : false;
    if (!present) add('required-text', range ? range.headingLine + 1 : null, `Section ${section} must keep ${REQUIRED_LINE_NAME[i]} word for word.`);
  });

  // too-long
  if (text.length > BRIEF_MAX_CHARS) add('too-long', null, `The brief has ${text.length} characters. Keep it at ${BRIEF_MAX_CHARS} or fewer.`);

  // em-dash, banned-word, contact-detail
  lines.forEach((line, index) => {
    for (const finding of houseStyleFindings(line)) {
      add(finding.rule, index + 1, finding.rule === 'em-dash'
        ? 'Use a comma or a full stop instead of a long dash.'
        : `Use a plainer word than "${finding.match}".`);
    }
    if (EMAIL.test(line)) add('contact-detail', index + 1, 'Remove the email address. The brief never carries contact details.');
    if (PHONE.test(line)) add('contact-detail', index + 1, 'Remove the phone number. The brief never carries contact details.');
  });

  // price-mismatch: every currency amount in section 3 must be a receipt figure
  const displays = new Set<string>();
  for (const receipt of priceReceipts) for (const figure of receipt.figures ?? []) displays.add(figure.display);
  const prices = sectionRange(lines, BRIEF_HEADINGS[2]);
  if (prices) {
    for (let index = prices.start; index < prices.end; index++) {
      for (const match of lines[index].matchAll(PRICE_TOKEN)) {
        const token = match[0].replace(/,+$/, '').slice(0, 60);
        if (!displays.has(token)) add('price-mismatch', index + 1, `"${token}" does not match a price receipt. Prices come only from Chausar's calculator.`);
      }
    }
  }

  return { ok: findings.length === 0, findings };
}
