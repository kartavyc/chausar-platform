import { access, appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../../runtime/engine.ts';
import { runEngineWorker } from '../../runtime/worker.ts';

// Only provider transport is synthetic. The default production codec, Engine,
// persistence and worker protocol are exercised unchanged. No sockets or GUI.
const directory = resolve(process.env.CHAUSAR_VAULT_DIRECTORY!);
function authoredAnswer(summary: any) {
  const useful = summary.evidence.filter((item: any) => item.kind !== 'caution');
  const paragraphs: any[] = [];
  for (let offset = 0; offset < useful.length; offset += 4) {
    const chunk = useful.slice(offset, offset + 4), parts: any[] = [];
    parts.push({ kind: 'text', text: offset ? 'The retained evidence states: ' : 'The reviewed records support this answer: ' });
    for (const [index, item] of chunk.entries()) {
      if (index) parts.push({ kind: 'text', text: '; ' });
      parts.push({ kind: 'slot', ref: item.ref });
    }
    parts.push({ kind: 'text', text: '.' });
    paragraphs.push({ parts, evidenceRefs: chunk.map((item: any) => item.ref) });
  }
  if (!paragraphs.length) paragraphs.push({ parts: [{ kind: 'text',
    text: 'The requested result is unavailable. The retained limitation explains what remains unresolved.' }],
    evidenceRefs: [summary.evidence.find((item: any) => item.kind === 'caution').ref] });
  return { schemaVersion: 1, paragraphs,
    cautionRefs: summary.evidence.filter((item: any) => item.kind === 'caution').map((item: any) => item.ref) };
}
function changedAnswer(summary: any, variant?: string) {
  const output = authoredAnswer(summary);
  if (!variant || variant === 'valid') return output;
  if (variant === 'foreign-ref') output.paragraphs[0].evidenceRefs.push('foreign-evidence');
  else if (variant === 'extra-citation') Object.assign(output.paragraphs[0], { citationRefs: ['foreign-citation'] });
  else if (variant === 'omit-caution') output.cautionRefs = [];
  else if (variant === 'numeric-prose') output.paragraphs[0].parts.unshift({ kind: 'text', text: 'Billed revenue was 999999 INR. ' });
  else if (variant === 'wrong-currency') output.paragraphs[0].parts.unshift({ kind: 'text', text: 'The billed result is denominated in CAD. ' });
  else if (variant === 'empty-paragraphs') output.paragraphs = [];
  else if (variant === 'omit-required-slot') {
    const figure = summary.evidence.find((item: any) => item.kind === 'figure');
    if (!figure) throw new Error('Authored omit-required-slot needs a figure.');
    for (const paragraph of output.paragraphs) paragraph.parts = paragraph.parts.filter((part: any) => part.ref !== figure.ref);
  } else throw new Error('Unknown authored synthesis variant.');
  return output;
}
const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
  version: '0.1.0-preview.1', gateway: { http: async request => {
    const envelope = JSON.parse(request.body);
    const content = JSON.parse(envelope.input ?? envelope.messages.find((item: any) => item.role === 'user').content);
    const input = content.summary ?? content;
    const stage = Array.isArray(input.results) && Array.isArray(input.evidence) ? 'synthesis' : 'planner';
    const scenarios = JSON.parse(await readFile(join(directory, 'synthesis-scenarios.json'), 'utf8'));
    const scenario = scenarios[input.question];
    if (!scenario) throw new Error('No authored scenario for this exact retained question.');
    const controls = scenario[stage] ?? {};
    let value: any;
    if (stage === 'synthesis') value = controls.wire ?? changedAnswer(input, controls.variant);
    else if (controls.wire) value = controls.wire;
    else if (controls.kind === 'clarification') value = { kind: 'clarification', calls: [], clarification: 'Which period should I use?' };
    else value = { kind: 'execute', clarification: null, calls: (scenario.calls ?? ['billed']).map((tool: string) => {
      if (tool === 'business.describe') {
        const claims = input.evidence.business.capabilities.filter((item: any) => scenario.business !== 'owner' || item.origin === 'owner-told');
        return { tool, args: { claimIds: claims.map((item: any) => item.claimId), unknownCategories: input.evidence.business.unknownCategories } };
      }
      return { tool: 'calculator.calculate', args: { operation: tool,
        period: { from: '2026-09-01', to: '2026-09-30' }, branch: null, customerId: null } };
    }) };
    await appendFile(join(directory, 'synthesis-provider-calls.jsonl'), JSON.stringify({
      synthetic: true, stage, endpoint: request.endpoint, payload: request.body, input, output: value,
    }) + '\n');
    if (controls.gate) {
      const deadline = Date.now() + 15000;
      while (true) {
        try { await access(join(directory, 'synthesis-release-' + stage)); break; }
        catch { if (Date.now() > deadline) throw new Error('Authored provider gate expired.'); await delay(10); }
      }
    }
    if (controls.transportFailure) throw new Error('Authored synthetic transport failure.');
    const response = envelope.messages ? (request.endpoint.includes('127.0.0.1')
      ? { done: controls.done ?? true, done_reason: controls.finishReason ?? 'stop', message: { content: JSON.stringify(value) }, prompt_eval_count: 1, eval_count: 1 }
      : { choices: [{ finish_reason: controls.finishReason ?? 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
      : { status: controls.status ?? 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
        usage: { input_tokens: 1, output_tokens: 1 }, ...(controls.providerError ? { error: { message: 'Authored synthetic provider refusal.' } } : {}) };
    return { status: controls.httpStatus ?? 200, endpoint: request.endpoint, body: controls.rawBody ?? JSON.stringify(response) };
  } } });
runEngineWorker(engine);
