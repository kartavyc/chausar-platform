// Wave 6 (6E7 / D49, D21): the securities guard. Chausar never places, suggests or automates trades, never gives buy,
// sell or hold advice, tips, target prices, copy trading or promised returns, and never connects to a broker with order
// rights. The guard holds on every AI path: model words, agent chat answers, About-you offers, and owner-added MCP
// servers (saving, listing and calling). No setting or attestation unlocks it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { securitiesAdviceIn, brokerOrderTool, brokerTradingHost, SECURITIES_GUARD_LINE } from '../runtime/venture/policy/securities-guard.ts';
import { isHardStop } from '../runtime/venture/policy/hard-stops.ts';
import { modelWords } from '../runtime/venture/records.ts';
import { validateAnswer } from '../runtime/venture/agents/answer.ts';
import { validateExternalServers } from '../runtime/venture/agent-runtime/external-config.ts';
import { createExternalMcpTools } from '../runtime/venture/agent-runtime/external-mcp.ts';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';

const code = (expected: string, words?: RegExp) => (error: any) => { assert.equal(error?.code, expected, error?.message); if (words) assert.match(error.message, words); return true; };

const ADVICE = [
  'Buy RELIANCE now and hold it for two weeks.',
  'Sell NIFTY CE before expiry.',
  'You should buy this stock before results.',
  'We recommend you sell your shares today.',
  'Our target price for the stock is higher.',
  'Keep a stop loss below the last low.',
  'Guaranteed returns every month for members.',
  'Double your money in the market with us.',
  'Join our copy trading group.',
  'Mirror my trades in your account.',
  'Daily intraday tips on WhatsApp.',
  'This multibagger will fly.',
  'Rating: BUY with a strong view.',
  'Time to accumulate banking stocks.',
  'Join our trading calls channel.',
];
const PLAIN = [
  'Buy now and get a free first consultation.',
  'Your target audience is new parents in Pune.',
  'Shares you hold for more than twelve months are long term under the rule.',
  'You sold shares in March and bought them in January.',
  'Hold the line while we check your file.',
  'We return phone calls within a day.',
  'Copy the text into your own mail app.',
  'Tax tips for freelancers, checked with your CA.',
  'The realised loss on this trade comes from the receipt.',
  'Sell more tiffin plans to offices nearby.',
];

test('securitiesAdviceIn finds advice, tips, target prices, copy trading and promised returns', () => {
  for (const text of ADVICE) assert.ok(securitiesAdviceIn(text), text);
});

test('securitiesAdviceIn leaves ordinary business words and journal facts alone', () => {
  for (const text of PLAIN) assert.equal(securitiesAdviceIn(text), null, text);
});

test('the guard rests on the securities hard stop, which no attestation unlocks', () => {
  assert.ok(isHardStop('securities-advice'));
  assert.match(SECURITIES_GUARD_LINE, /never/i);
});

test('modelWords refuses advice on every model path that uses it', () => {
  assert.throws(() => modelWords('Buy RELIANCE now and hold it for two weeks.', 'draft text'), code('MODEL_OUTPUT_REJECTED', /trade|advice|stock/i));
  assert.throws(() => modelWords('Guaranteed returns every month for members.', 'reply'), code('MODEL_OUTPUT_REJECTED'));
  assert.equal(modelWords('Buy now and get a free first consultation.', 'line'), 'Buy now and get a free first consultation.');
});

test('an agent chat answer with advice is refused, so the template answer is used instead', () => {
  const part = (text: string) => ({ kind: 'text', text, receiptId: '', key: '' });
  assert.throws(() => validateAnswer({ parts: [part('Your journal is ready.'), part('You should buy this stock before results.')] }), code('MODEL_OUTPUT_REJECTED'));
  assert.equal(validateAnswer({ parts: [part('Your journal is ready.')] }).parts.length, 1);
});

test('brokerOrderTool spots tools that place, change or cancel orders', () => {
  assert.ok(brokerOrderTool({ name: 'place_order', description: 'Place an order on Kite.' }));
  assert.ok(brokerOrderTool({ name: 'modify_gtt_order', description: '' }));
  assert.ok(brokerOrderTool({ name: 'cancel_order' }));
  assert.ok(brokerOrderTool({ name: 'exit_position' }));
  assert.ok(brokerOrderTool({ name: 'submit', description: 'Submit a buy or sell order for a stock.' }));
  assert.ok(brokerOrderTool({ name: 'trade', inputSchema: { type: 'object', properties: { tradingsymbol: {}, transaction_type: { enum: ['BUY', 'SELL'] }, quantity: {} } } }));
  assert.ok(!brokerOrderTool({ name: 'get_holdings', description: 'Read holdings.' }));
  assert.ok(!brokerOrderTool({ name: 'create_invoice', description: 'Create a draft invoice for an order of goods.' }));
});

test('saving an external server that points at a broker trading API is a hard stop', () => {
  assert.ok(brokerTradingHost('https://api.kite.trade/mcp'));
  assert.ok(brokerTradingHost('https://mcp.kite.trade/mcp'));
  assert.ok(brokerTradingHost('https://api.upstox.com/v2'));
  assert.ok(brokerTradingHost('https://api.dhan.co'));
  assert.ok(!brokerTradingHost('https://example.com/mcp'));
  assert.throws(() => validateExternalServers([{ id: 'kite', name: 'Kite', transport: 'http', url: 'https://mcp.kite.trade/mcp' }]), code('HARD_STOP', /broker/i));
  assert.equal(validateExternalServers([{ id: 'docs', name: 'Docs', transport: 'http', url: 'https://example.com/mcp' }]).length, 1);
});

class Store implements StateStore {
  state: State = initialState('Fixture', true);
  read() { return structuredClone(this.state); }
  async update<T>(fn: (state: State) => T | Promise<T>): Promise<T> { const draft = structuredClone(this.state); const result = await fn(draft); this.state = draft; return result; }
}

test('an owner-added MCP server that offers order tools is refused before listing or calling, even with approval', async () => {
  const store = new Store();
  const server = { id: 'broker', name: 'Broker tools', transport: 'http' as const, url: 'https://broker.example.com/mcp' };
  const settings = await import('../runtime/venture/agent-runtime/settings.ts');
  store.state.conversations.push({ kind: 'venture-record', id: 'v1', aiSettings: { ...settings.defaultAiSettings(), mcpServers: [server] } } as any);
  const ctx: Context = { memberId: 'owner', epoch: 1, role: 'owner' };
  let called = 0;
  const capability = { scope: { ventureId: 'v1', jobId: 'job', runId: 'run' }, assert() {} } as any;
  const tools = createExternalMcpTools({ store } as any, ctx, capability, {
    signal: new AbortController().signal, guard() {}, approve: async () => true,
    connect: async () => ({ list: async () => [{ name: 'get_holdings', inputSchema: { type: 'object' } }, { name: 'place_order', description: 'Place an order.', inputSchema: { type: 'object' } }], call: async () => { called += 1; return {}; }, close: async () => {} }),
  } as any);
  const list = tools.tools.find(tool => tool.name === 'external_tools')!;
  const call = tools.tools.find(tool => tool.name === 'external_call')!;
  await assert.rejects(() => list.call({ serverId: 'broker', query: '' }, ctx) as Promise<unknown>, code('HARD_STOP', /broker|order/i));
  await assert.rejects(() => call.call({ serverId: 'broker', tool: 'get_holdings', fingerprint: 'x', arguments: {} }, ctx) as Promise<unknown>, code('HARD_STOP'));
  assert.equal(called, 0);
});

test('modal words without a security stay ordinary business words', () => {
  for (const text of ['You should hold the meeting on Monday.', 'We must sell more plans this month.', 'Time to exit the old office lease.']) assert.equal(securitiesAdviceIn(text), null, text);
});

test('a local bridge whose arguments point at a broker trading API is refused too', () => {
  assert.throws(() => validateExternalServers([{ id: 'kite', name: 'Kite', transport: 'stdio', command: 'C:/tools/npx.cmd', args: ['mcp-remote', 'https://mcp.kite.trade/mcp'] }]), code('HARD_STOP'));
});

test('About-you offers that sell tips or copy trading are refused', async () => {
  const { aboutTask } = await import('../runtime/venture/core/about.ts');
  const { FAMILY_IDS } = await import('../runtime/venture/core/families.ts');
  const task = aboutTask({ text: 'I trade options from Pune.', file: null });
  const answer = (name: string, line: string) => ({ familyId: FAMILY_IDS[0], offers: [{ name, line }], countryCode: null, evidence: null });
  assert.throws(() => task.validate(answer('Daily intraday tips', 'Tips on WhatsApp for members.')), code('MODEL_OUTPUT_REJECTED', /never/i));
  assert.throws(() => task.validate(answer('Trading group', 'Join our copy trading group.')), code('MODEL_OUTPUT_REJECTED'));
  assert.equal(task.validate(answer('Trading journal', 'Your trades and charges for your CA.')).offers.length, 1);
});
