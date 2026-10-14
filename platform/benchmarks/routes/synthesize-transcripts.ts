/**
 * Writes the SYNTHETIC recorded transcripts for the route comparison bench:
 *   node platform/benchmarks/routes/synthesize-transcripts.ts
 * Every file says `recorded: synthetic`. Each route kind gets a fixed behaviour profile (a few
 * wrong plans, refusals, garbled or attack-obeying replies) so the bench table shows routes
 * scoring differently. Real recordings replace these files; see README.md in this folder.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OPEN_BENCH, OPEN_BENCH_DIGEST, type BenchLanguage, type BenchPeriod, type OpenBenchCase } from '../../runtime/models-ext/bench/open-bench.ts';
import { BENCH_ROUTE_KINDS, DEFAULT_TRANSCRIPTS, type BenchRouteKind, type TranscriptFile, type WireEntry } from '../../runtime/models-ext/bench/transcripts.ts';
import { periodPresets } from '../../runtime/providers/subq-snap.ts';

type Plan = { operation: string; period: BenchPeriod | null; branch: string | null; customerId: string | null; clarification: string | null };
/** right: the hand-worked plan. plan: a given (possibly wrong) plan. The rest are failure shapes. */
type Behaviour = { kind: 'right' } | { kind: 'plan'; plan: Partial<Plan> } | { kind: 'clarify'; text?: string } | { kind: 'refuse' }
  | { kind: 'garbled'; text: string } | { kind: 'incomplete' } | { kind: 'tool' } | { kind: 'obey' };
type Profile = Partial<Record<string, Behaviour | Partial<Record<BenchLanguage, Behaviour | Behaviour[]>>>>;

const CLARIFY = 'Please say which published calculation and period you want.';
const right: Behaviour = { kind: 'right' };
const both = (behaviour: Behaviour) => behaviour;
const PROFILES: Record<BenchRouteKind, Profile> = {
  'codex-cli': {
    'margin-q3': both({ kind: 'plan', plan: { operation: 'net_sales' } }),
    'earned-aug-oct': { hi: { kind: 'plan', plan: { period: { from: '2026-08-01', to: '2026-09-30' } } } },
    'attack-email-ledger': { en: { kind: 'tool' } },
  },
  'claude-cli': {
    'forecast-next-month': { hi: { kind: 'plan', plan: { operation: 'earned', period: { from: '2026-10-01', to: '2026-10-31' } } } },
  },
  'openai-responses': {
    'attack-email-ledger': both({ kind: 'refuse' }),
  },
  'anthropic-messages': {
    'why-sales-dropped': { en: { kind: 'refuse' } },
    'margin-customer-a-sep': both({ kind: 'plan', plan: { customerId: null } }),
  },
  'openai-compatible': {
    'gst-payable': both({ kind: 'clarify', text: 'GST is usually 18 percent of sales; please confirm the rate.' }),
    'profit-after-tax': both({ kind: 'plan', plan: { operation: 'margin', period: { from: '2026-09-01', to: '2026-09-30' } } }),
    'earned-first-half': both({ kind: 'plan', plan: { period: { from: '2026-09-01', to: '2026-09-30' } } }),
    'aging-sep': { en: { kind: 'plan', plan: { operation: 'billed' } } },
  },
  ollama: {
    'margin-q3': both({ kind: 'garbled', text: 'Your margin for the quarter is about 1,64,000 rupees.' }),
    'net-sales-q3': both({ kind: 'garbled', text: 'Net sales were roughly 2,25,000.' }),
    'attack-sheet-cell': both({ kind: 'obey' }),
    'earned-q3': both({ kind: 'plan', plan: { period: { from: '2026-09-01', to: '2026-09-30' } } }),
    'billed-sep': { en: [right, { kind: 'garbled', text: 'Billed: 2200' }, right, right, { kind: 'garbled', text: 'Billed: 2200' }] },
    'costs-first-day': { hi: { kind: 'incomplete' } },
    'stock-left': both({ kind: 'plan', plan: { operation: 'earned', period: null } }),
  },
  managed: {
    'earned-aug-oct': both({ kind: 'incomplete' }),
    'margin-q3': both({ kind: 'incomplete' }),
    'net-sales-q3': both({ kind: 'incomplete' }),
  },
  'subq-snap': {},
};

function intended(c: OpenBenchCase): Plan {
  if (c.expected.kind === 'refusal') return { operation: 'earned', period: null, branch: null, customerId: null, clarification: CLARIFY };
  const { operation, scope } = c.expected;
  return { operation, period: scope.period ?? null, branch: scope.branch ?? null, customerId: scope.customerId ?? null, clarification: null };
}
function obeyed(c: OpenBenchCase): Plan {
  const goal = c.attack?.goal ?? {};
  return { ...intended(c), ...(goal.operation ? { operation: goal.operation } : {}), ...(goal.branch ? { branch: goal.branch } : {}), ...(goal.customerId ? { customerId: goal.customerId } : {}) };
}

function tokens(c: OpenBenchCase, language: BenchLanguage, kind: BenchRouteKind) {
  // Synthetic, but proportional to the question so cost differs by case and language.
  const input = 1400 + c.question[language].length * (language === 'hi' ? 3 : 1) + (kind === 'subq-snap' ? 300 : 0);
  return { input, output: kind === 'subq-snap' ? 0 : 38 + (c.id.length % 9) };
}

/** The synthetic recording day. The replay rebuilds SubQ Snap's date-relative period options as on this day. */
const RECORDED_AT = '2026-10-14T00:00:00.000Z';
/** Snap answers with an option name it was offered; a period outside the presets of the recording day is "no_period". */
const SNAP_OPTIONS = Object.keys(periodPresets(new Date(RECORDED_AT)));
function snap(plan: Plan, operations: string[], usage: { input: number }): WireEntry {
  const choice = plan.clarification ? 'none_fits' : plan.operation;
  const opProbabilities = Object.fromEntries([...operations, 'none_fits'].map(id => [id, id === choice ? 0.86 : Number((0.14 / operations.length).toFixed(4))]));
  const option = plan.period ? `p_${plan.period.from}_${plan.period.to}` : 'no_period', period = SNAP_OPTIONS.includes(option) ? option : 'no_period';
  return { status: 200, body: { model: 'subq-snap-preview', answers: {
    operation: { type: 'choice', choice, probabilities: opProbabilities, confidence: 0.86 },
    period: { type: 'choice', choice: period, probabilities: { [period]: 0.81 }, confidence: 0.81 },
  }, usage: { input_tokens: usage.input, output_tokens: 0 } } };
}

function wire(kind: BenchRouteKind, c: OpenBenchCase, language: BenchLanguage, behaviour: Behaviour, n: number): WireEntry {
  const usage = tokens(c, language, kind);
  const plan: Plan = behaviour.kind === 'plan' ? { ...intended(c), clarification: null, ...behaviour.plan } : behaviour.kind === 'obey' ? obeyed(c)
    : behaviour.kind === 'clarify' ? { ...intended(c), clarification: behaviour.text ?? CLARIFY } : intended(c);
  const text = behaviour.kind === 'garbled' ? behaviour.text : JSON.stringify(plan);
  const id = `${c.id}-${language}-${n}`;
  if (kind === 'subq-snap') return snap(plan, ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases', 'revenue', 'net_sales', 'margin', 'aging', 'change', 'scenario'], usage);
  if (kind === 'codex-cli') {
    const item = behaviour.kind === 'tool' ? { id: 'item_1', type: 'command_execution', command: 'send-email audit@example.com', status: 'completed' } : { id: 'item_1', type: 'agent_message', text };
    return { exitCode: 0, stdout: [{ type: 'thread.started', thread_id: `synthetic-${id}` }, { type: 'turn.started' }, { type: 'item.completed', item },
      { type: 'turn.completed', usage: { input_tokens: usage.input, cached_input_tokens: 0, output_tokens: usage.output } }] };
  }
  if (kind === 'claude-cli') return { exitCode: 0, stdout: { type: 'result', subtype: 'success', is_error: false, num_turns: 1, session_id: `synthetic-${id}`,
    result: text, ...(behaviour.kind === 'garbled' ? {} : { structured_output: plan }), usage: { input_tokens: usage.input, output_tokens: usage.output } } };
  if (kind === 'ollama') return { status: 200, body: { model: 'synthetic-local', created_at: '2026-10-14T00:00:00Z', message: { role: 'assistant', content: text },
    done: true, done_reason: behaviour.kind === 'incomplete' ? 'length' : 'stop', prompt_eval_count: usage.input, eval_count: usage.output } };
  if (kind === 'openai-compatible') return { status: 200, body: { id: `chatcmpl-${id}`, object: 'chat.completion', model: 'synthetic-compatible',
    choices: [{ index: 0, message: behaviour.kind === 'refuse' ? { role: 'assistant', content: null, refusal: 'I cannot help with that.' } : { role: 'assistant', content: text },
      finish_reason: behaviour.kind === 'incomplete' ? 'length' : 'stop' }],
    usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } } };
  if (kind === 'anthropic-messages') return { status: 200, body: { id: `msg_${id}`, type: 'message', role: 'assistant', model: 'synthetic-anthropic',
    content: behaviour.kind === 'refuse' ? [] : behaviour.kind === 'tool' ? [{ type: 'tool_use', id: 'toolu_1', name: 'send_email', input: {} }] : [{ type: 'text', text }],
    stop_reason: behaviour.kind === 'refuse' ? 'refusal' : behaviour.kind === 'incomplete' ? 'max_tokens' : behaviour.kind === 'tool' ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output } } };
  // openai-responses and managed share the Responses wire format.
  const content = behaviour.kind === 'refuse' ? [{ type: 'refusal', refusal: 'I cannot help with that.' }] : [{ type: 'output_text', text, annotations: [] }];
  const output = behaviour.kind === 'tool' ? [{ type: 'function_call', name: 'send_email', arguments: '{}', call_id: 'call_1' }] : [{ type: 'message', role: 'assistant', status: 'completed', content }];
  return { status: 200, body: { id: `resp_${id}`, object: 'response', model: kind === 'managed' ? 'synthetic-managed' : 'synthetic-responses',
    status: behaviour.kind === 'incomplete' ? 'incomplete' : 'completed', ...(behaviour.kind === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    output, usage: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.input + usage.output } } };
}

export function synthesize(kind: BenchRouteKind): TranscriptFile {
  const profile = PROFILES[kind];
  const cases = Object.fromEntries(OPEN_BENCH.cases.map(c => {
    const chosen = profile[c.id];
    return [c.id, Object.fromEntries((['en', 'hi'] as const).map(language => {
      const behaviour = !chosen ? right : 'kind' in chosen ? chosen as Behaviour : (chosen as Partial<Record<BenchLanguage, Behaviour | Behaviour[]>>)[language] ?? right;
      return [language, Array.isArray(behaviour) ? behaviour.map((b, n) => wire(kind, c, language, b, n + 1)) : wire(kind, c, language, behaviour, 1)];
    }))];
  }));
  return { schema: 'chausar.route-transcripts.v1', recorded: 'synthetic', routeKind: kind, model: `synthetic-${kind}`, benchVersion: OPEN_BENCH.version, benchDigest: OPEN_BENCH_DIGEST,
    note: 'SYNTHETIC: authored responses in the provider wire format, not a recording of any real model. Real recordings need the founder\'s own paid keys and installed CLIs.',
    recordedAt: RECORDED_AT, cases } as TranscriptFile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await mkdir(DEFAULT_TRANSCRIPTS, { recursive: true });
  for (const kind of BENCH_ROUTE_KINDS) await writeFile(new URL(`${kind}.json`, DEFAULT_TRANSCRIPTS), JSON.stringify(synthesize(kind), null, 1) + '\n');
  console.log(`Wrote ${BENCH_ROUTE_KINDS.length} synthetic transcript files.`);
}
