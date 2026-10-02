import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Engine } from '../../runtime/engine.ts';
import { runEngineWorker } from '../../runtime/worker.ts';

// Trusted test host only: an actual Engine and production worker loop receive a
// deterministic synthetic provider. No network or semantic qualification.
const directory = resolve(process.env.CHAUSAR_VAULT_DIRECTORY!);
const engine = new Engine({ directory, storage: 'experimental-file', demo: true,
  version: '0.1.0-preview.1', gateway: { http: async request => {
    const payload = JSON.parse(request.body);
    const input = JSON.parse(payload.input ?? payload.messages.find((item: any) => item.role === 'user').content);
    if (input.questionDisclosure !== 'verbatim') throw new Error('Synthetic fixture requires reviewed verbatim conversation input.');
    const business = { tool: 'business.describe', args: {
      claimIds: input.evidence.business.capabilities.map((item: any) => item.claimId),
      unknownCategories: input.evidence.business.unknownCategories } };
    const calculation = (operation: string, period: { from: string; to: string } | null = null) => ({
      tool: 'calculator.calculate', args: { operation, period, branch: null, customerId: null } });
    let plan: unknown;
    switch (input.question) {
      case 'Help me understand what this company actually does.':
      case 'Can you explain the business in plain language?':
      case 'What is this business about for the Acme account?':
        plan = { kind: 'execute', calls: [business], clarification: null }; break;
      case 'Explain this business and tell me what was billed in September.':
        plan = { kind: 'execute', calls: [business, calculation('billed', { from: '2026-09-01', to: '2026-09-30' })], clarification: null }; break;
      case 'Which view of the business should we look at?':
        plan = { kind: 'clarification', calls: [], clarification: 'Which business aspect would you like described?' }; break;
      case 'Describe this business and age its invoices.':
        plan = { kind: 'execute', calls: [business, calculation('aging')], clarification: null }; break;
      case 'Compare billed change without reviewed periods.':
        plan = { kind: 'execute', calls: [calculation('change')], clarification: null }; break;
      case 'Model a price scenario without reviewed assumptions.':
        plan = { kind: 'execute', calls: [calculation('scenario')], clarification: null }; break;
      case 'Return an invalid synthetic plan.':
        plan = { kind: 'execute', calls: [{ tool: 'unregistered.fixture', args: {} }], clarification: null }; break;
      default: throw new Error('The synthetic provider has no authored fixture for this exact question.');
    }
    await appendFile(join(directory, 'synthetic-provider-calls.jsonl'), JSON.stringify({
      fixture: 'synthetic-planner-not-semantic-qualified', endpoint: request.endpoint,
      payload: request.body, input, plan }) + '\n');
    return { status: 200, endpoint: request.endpoint, requestId: 'synthetic-dispatch', body: JSON.stringify(
      payload.messages ? { message: { content: JSON.stringify(plan) }, prompt_eval_count: 1, eval_count: 1 }
        : { status: 'completed', output_text: JSON.stringify(plan), usage: { input_tokens: 1, output_tokens: 1 } }) };
  } } });
runEngineWorker(engine);
