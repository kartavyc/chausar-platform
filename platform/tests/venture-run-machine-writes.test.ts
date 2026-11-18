// Only the run machine writes a delivery run's lifecycle fields (venture/delivery/run-machine.ts). This reads the
// engine's source and fails when another file sets a run's status, verdict, stop, pending step, pending question or
// lifecycle stamp, or keeps its own list of run statuses under a new name. A reader uses the machine's sets instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUN_STATUSES } from '../runtime/venture/delivery/run-machine.ts';

const ROOT = fileURLToPath(new URL('../runtime/venture/', import.meta.url));
const MACHINE = 'delivery/run-machine.ts';
/** contracts.ts declares the types; it writes nothing. */
const TYPES_ONLY = new Set(['contracts.ts']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(`${dir}${entry.name}/`) : entry.name.endsWith('.ts') ? [`${dir}${entry.name}`] : []);
}
const sources = files(ROOT).map(path => ({ name: path.slice(ROOT.length), text: readFileSync(path, 'utf8') }))
  .filter(file => file.name !== MACHINE && !TYPES_ONLY.has(file.name));

/** Words only a delivery run's status ever took, today's and the older builds'. */
const RUN_ONLY = ['working', 'finishing', 'needs-answer', 'ready-for-review', 'waiting-for-you', 'brief-waiting'];
/** A spread of a run with a status, a verdict or a stop set beside it: the shape every old write site had. */
const RUN_NAMES = 'run|current|latest|rest|older|stored|restored|live|next|source|copy|cleaned|traced';
const RULES: { what: string; pattern: RegExp; only?: (text: string) => boolean }[] = [
  { what: 'sets a run-only status word', pattern: new RegExp(`status\\s*:\\s*'(${RUN_ONLY.join('|')})'`) },
  { what: 'sets a status beside a spread of a run', only: text => text.includes("'venture-delivery-run'"),
    pattern: new RegExp(`\\{\\s*\\.\\.\\.(${RUN_NAMES})(?![.\\w])[^{}\\n]*,\\s*status\\s*:\\s*(?:'(${RUN_STATUSES.join('|')})'|verdict\\b|[a-z]+\\.status\\b)`) },
  { what: 'sets a run verdict', only: text => text.includes("'venture-delivery-run'"), pattern: /\bverdict\s*:\s*(null|\{\s*choice|from\.verdict)/ },
  { what: 'sets the stop, the reject memory or the lifecycle stamp', pattern: /\bstopped\s*:\s*\{\s*reason\b|\b(rejectedFrom|lifecycle)\s*:\s*(\{|null|2\b|RUN_LIFECYCLE)/ },
  { what: 'sets or clears a pending step or question on a job', pattern: /\b(pendingApproval|pendingFacts)\s*:\s*(undefined|\{\s*request|\{\s*digest)|delete\s+\w+\.(pendingApproval|pendingFacts)\b/ },
  { what: 'keeps its own list of run statuses', pattern: new RegExp(`\\[\\s*'(${[...RUN_STATUSES, 'waiting-for-you', 'brief-waiting'].join('|')})'\\s*,\\s*'(${[...RUN_STATUSES, 'waiting-for-you', 'brief-waiting'].join('|')})'`) },
];
/**
 * The few places that match a rule and are not a write of a run: each with why. A new entry needs the same proof.
 */
const ALLOWED: { file: string; has: string; why: string }[] = [
  { file: 'views/queue-actions.ts', has: "regulatedSignoff(state, venture, { ...run, status: 'edited', editedText: text })", why: 'a what-if copy for the sign-off check before an edit is stored; never stored itself' },
];

test('no file but the run machine writes a delivery run\'s lifecycle fields or lists its statuses', () => {
  const found: string[] = [];
  for (const file of sources) {
    const lines = file.text.split('\n');
    for (const rule of RULES) {
      if (rule.only && !rule.only(file.text)) continue;
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || !rule.pattern.test(line)) return;
        if (ALLOWED.some(item => item.file === file.name && line.includes(item.has))) return;
        found.push(`${file.name}:${index + 1} ${rule.what}: ${line.trim().slice(0, 140)}`);
      });
    }
  }
  assert.deepEqual(found, [], `Move these onto venture/delivery/run-machine.ts:\n${found.join('\n')}`);
});

test('the rules catch the shapes the old write sites had', () => {
  const samples = [
    "tx.replace({ ...run, status: 'waiting-for-you', verdict: null });",
    "tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,verdict:null});",
    "tx.replace({ ...current, status: 'stopped', callId: null, preview: null, agentJob: job, interrupted: record });",
    "...run, status: verdict, practice, verdict: { choice: verdict, reason, at: tx.now },",
    "const next = { ...run, rejectedFrom: null };",
    "if (job) delete job.pendingApproval;",
    "const ACTIVE = ['waiting-for-you', 'ready-for-review', 'brief-waiting', 'needs-answer'];",
    "const POSTABLE = ['accepted', 'edited'];",
  ];
  for (const sample of samples) assert.ok(RULES.some(rule => rule.pattern.test(sample)), sample);
});
