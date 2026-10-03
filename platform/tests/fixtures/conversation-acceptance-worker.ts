import { access, appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../../runtime/engine.ts';
import { runEngineWorker } from '../../runtime/worker.ts';
import { installSyntheticProductionStorage } from './synthetic-production-engine.ts';

// Authored provider contract fixtures, never model predictions. The production
// worker loop and Engine execute unchanged with authored snapshot/SQL ports.
// No socket, installed credential or GUI use; no native storage qualification.
const directory = resolve(process.env.CHAUSAR_VAULT_DIRECTORY!);
const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['acceptance']),
  version: '0.1.0-preview.1', gateway: { http: async request => {
    const envelope = JSON.parse(request.body), input = JSON.parse(envelope.input ?? envelope.messages.find((item: any) => item.role === 'user').content);
    const scenarios = JSON.parse(await readFile(join(directory, 'acceptance-scenarios.json'), 'utf8'));
    const scenario = scenarios[input.question];
    if (!scenario) throw new Error('No authored scenario for this exact question.');
    const business = { tool: 'business.describe', args: {
      claimIds: input.evidence.business.capabilities.map((item: any) => item.claimId),
      unknownCategories: input.evidence.business.unknownCategories,
    } };
    const calculation = (operation: string) => ({ tool: 'calculator.calculate', args: {
      operation, period: { from: '2026-09-01', to: '2026-09-30' }, branch: null, customerId: null,
    } });
    const plan = scenario.wire ?? (scenario.kind === 'clarification'
      ? { kind: 'clarification', calls: [], clarification: 'Which period and business aspect should I use?' }
      : { kind: 'execute', clarification: null, calls: scenario.calls.map((tool: string) =>
        tool === 'business.describe' ? business : calculation(tool)) });
    await appendFile(join(directory, 'acceptance-provider-calls.jsonl'), JSON.stringify({
      synthetic: true, endpoint: request.endpoint, payload: request.body, input, plan,
    }) + '\n');
    if (scenario.gate) {
      const deadline = Date.now() + 10000;
      while (true) {
        try { await access(join(directory, 'acceptance-release')); break; }
        catch { if (Date.now() > deadline) throw new Error('Fixture gate deadline exceeded.'); await delay(10); }
      }
    }
    if (scenario.transportFailure) throw new Error('Authored synthetic transport failure.');
    const response = envelope.messages ? (request.endpoint.includes('127.0.0.1')
      ? { done: scenario.done ?? true, done_reason: scenario.finishReason ?? 'stop', message: { content: JSON.stringify(plan) }, prompt_eval_count: 1, eval_count: 1 }
      : { choices: [{ finish_reason: scenario.finishReason ?? 'stop', message: { content: JSON.stringify(plan) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) : {
      status: scenario.status ?? 'completed', output_text: JSON.stringify(plan),
      usage: { input_tokens: 1, output_tokens: 1 }, ...(scenario.providerError ? { error: { message: 'Authored synthetic refusal.' } } : {}),
    };
    return { status: scenario.httpStatus ?? 200, endpoint: request.endpoint, body: scenario.rawBody ?? JSON.stringify(response) };
  } } });
runEngineWorker(engine);
