/**
 * W6 6G5 (D44): the model receipt the fake engine puts on a run, worded as platform/runtime/venture/money/model-receipt.ts
 * words it: tool, model, tier, tokens and cost joined with a middle dot. A native job reads its own progress (its cost
 * when a key priced it, else the owner's plan); the sample runs carry sample receipts (a key run still running, a run on
 * the owner's plan, a finished key run with the sum receipt of its charge). A routine run that asked the AI says it ran
 * on the owner's plan.
 */
import type { ModelReceiptView, RunDetail } from './types';

const SEPARATOR = ' · ';
const finish = (parts: Omit<ModelReceiptView, 'line'>): ModelReceiptView => ({ ...parts, line: [parts.tool, parts.model, parts.tier, parts.usage, parts.cost].join(SEPARATOR) });

const SAMPLE: Readonly<Record<string, Omit<ModelReceiptView, 'line'>>> = {
  '31': { tool: 'Claude Sonnet 5.5, your key', model: 'claude-sonnet-5-5', tier: 'Main model', usage: '18,240 tokens in, 2,310 out', cost: 'Not known yet', state: 'unknown', agent: 'Editor' },
  '30': { tool: 'Claude Code', model: 'claude-sonnet-5-5', tier: 'Quick model', usage: 'Tokens not reported', cost: 'On your plan', state: 'plan', agent: 'Researcher' },
  '29': { tool: 'Claude Sonnet 5.5, your key', model: 'claude-sonnet-5-5', tier: 'Main model', usage: '6,020 tokens in, 880 out', cost: 'Not known yet', state: 'unknown', agent: 'Producer' },
  '28': { tool: 'Claude Sonnet 5.5, your key', model: 'claude-sonnet-5-5', tier: 'Main model', usage: 'Tokens not reported', cost: 'Not known yet', state: 'unknown', agent: 'Editor' },
  '27': { tool: 'Codex', model: 'gpt-6-astra', tier: 'Main model', usage: '9,800 tokens in, 1,120 out', cost: 'On your plan', state: 'plan', agent: 'Bookkeeper' },
  '26': { tool: 'Claude Sonnet 5.5, your key', model: 'claude-sonnet-5-5', tier: 'Main model', usage: '4,410 tokens in, 620 out', cost: 'USD 0.0412', state: 'priced', receiptId: 'R-0454', agent: 'Researcher' },
};

/** A run's model receipt: a native job's from its progress, a sample run's from the sample, else no AI. */
export function fakeRunReceipt(run: RunDetail): ModelReceiptView {
  const progress = run.agentProgress;
  if (progress) {
    const base = { model: progress.model ?? 'not reported', tier: 'Main model', usage: 'Tokens not reported', agent: run.agent };
    if (!progress.cost) return finish({ ...base, tool: 'Your AI tool', cost: 'On your plan', state: 'plan' });
    return progress.cost.state === 'priced'
      ? finish({ ...base, tool: 'Your AI key', cost: progress.cost.display, state: 'priced', ...(progress.cost.receiptId ? { receiptId: progress.cost.receiptId } : {}) })
      : finish({ ...base, tool: 'Your AI key', cost: 'Not known yet', state: 'unknown' });
  }
  const sample = SAMPLE[run.runId];
  if (sample) return finish(sample);
  return finish({ tool: 'Built-in templates', model: 'not reported', tier: 'No AI', usage: 'Tokens not reported', cost: 'No cost', state: 'none' });
}

/** A routine run that was delivered: its chat answer, on the owner's plan in the sample. */
export function fakeRoutineReceipt(agent: string | null): ModelReceiptView {
  return finish({ tool: 'Claude Code', model: 'claude-sonnet-5-5', tier: 'Main model', usage: 'Tokens not reported', cost: 'On your plan', state: 'plan', ...(agent ? { agent } : {}) });
}
