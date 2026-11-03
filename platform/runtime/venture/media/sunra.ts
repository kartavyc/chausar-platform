/**
 * W6 6F9 (D38): images and video through Sunra's own MCP server (@sunra/mcp-server), behind the 6F1 client.
 *
 * - Each generation (submit or subscribe) gets exactly one owner card. The card carries the cost in rupees, worked out
 *   by code from Sunra's published price card for that endpoint and the owner's own rupee rate (Money > Spend), and a
 *   receipt: the venture-media-generation record, written before the card, holding the rule matched and the arithmetic.
 * - The rights record is built by code from the order: AI-made output for this client's order, to be labelled as AI-made,
 *   and any reference image or video only with the rights the owner recorded at intake.
 * - Never auto-confirm: any argument that asks Sunra or the tool to skip confirmation is refused, as are webhooks and
 *   batches. The key lives in protected storage and reaches the local program only as SUNRA_KEY; the key tool is refused.
 * - Status, result and model lookups are on Chausar's checked read-only list and need no card.
 */
import { ChausarError, check, money } from '../../contracts.ts';
import type { IsoDate, IsoTime } from '../contracts.ts';
import type { FootageRights } from '../delivery/rights.ts';
import { digest, findRecord, ventureAction } from '../records.ts';
import { argumentsDigest, npmPackageOf } from '../agent-runtime/mcp-policy.ts';
import { rupeesOf } from '../money/spend.ts';
import type { ExternalMcpServer } from '../agent-runtime/external-config.ts';
import type { McpCallAdapter, McpCallPlan } from '../agent-runtime/mcp-adapters.ts';

export const SUNRA_PACKAGE = '@sunra/mcp-server';
export const SUNRA_VERSION = '0.1.2';
/** Sunra's local MCP server, run by npx with the owner's key in SUNRA_KEY. The owner picks their npx path. */
export function sunraServerReference(npxPath: string): ExternalMcpServer {
  return { id: 'sunra', name: 'Sunra', transport: 'stdio', command: npxPath, args: ['-y', `${SUNRA_PACKAGE}@${SUNRA_VERSION}`], tokenEnv: 'SUNRA_KEY' };
}

/** Sunra's machine-readable price rules for one endpoint (api.sunra.ai/v1/pricing/model/{id}/endpoint/{endpoint}). */
export type SunraPriceCard = {
  id: string; model_endpoint: string; type: 'pre_defined' | 'post_calculated'; display?: string; tooltip?: string;
  /** For usage-settled endpoints: the most one request can cost. */
  freeze_amount?: string;
  prices: { unit_amount: string; matches?: Record<string, unknown> }[];
};
export type SunraQuote = { basis: 'fixed' | 'up-to'; usdMicros: string; paise: string; display: string; rule: string };

const usdMicros = (value: unknown): bigint => {
  check(typeof value === 'string' && /^\d{1,6}(\.\d{1,6})?$/.test(value), 'SUNRA_QUOTE_UNAVAILABLE', 'Sunra\'s price card has an amount Chausar cannot read. No card was made.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
};
/** One price rule's conditions against the request input: equal values, or $size / $size_lte / $size_gte / $lte / $gte / $in. */
function matches(conditions: Record<string, unknown> | undefined, input: Record<string, unknown>): boolean {
  if (!conditions) return true;
  return Object.entries(conditions).every(([field, condition]) => {
    const value = input[field];
    if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) return value === condition;
    return Object.entries(condition).every(([operator, expected]) => {
      const size = Array.isArray(value) ? value.length : value === undefined ? 0 : NaN;
      switch (operator) {
        case '$size': return size === expected;
        case '$size_lte': return typeof expected === 'number' && size <= expected;
        case '$size_gte': return typeof expected === 'number' && size >= expected;
        case '$lte': return typeof value === 'number' && typeof expected === 'number' && value <= expected;
        case '$gte': return typeof value === 'number' && typeof expected === 'number' && value >= expected;
        case '$in': return Array.isArray(expected) && expected.includes(value);
        default: throw new ChausarError('SUNRA_QUOTE_UNAVAILABLE', 'Sunra\'s price card uses a rule Chausar cannot check. No card was made.');
      }
    });
  });
}
const COUNT_FIELDS = ['num_images', 'number_of_images', 'num_outputs', 'num_videos', 'n', 'batch_size', 'count'];
/**
 * The rupee cost of one request: the first matching rule's US dollar amount (or, for a usage-settled endpoint, its
 * maximum reserve), times the owner's rate in ten-thousandths of a rupee, rounded to the nearest paisa once.
 */
export function quoteSunra(card: SunraPriceCard, input: Record<string, unknown>, rate: { perUsd: string; setOn: IsoDate }): SunraQuote {
  for (const field of COUNT_FIELDS) check(input[field] === undefined || input[field] === 1, 'SUNRA_ONE_PER_APPROVAL', 'Ask for one image or video per approval, so each one has its own card and cost.');
  check(card && Array.isArray(card.prices) && card.prices.length > 0 && card.prices.length <= 200, 'SUNRA_QUOTE_UNAVAILABLE', 'Sunra did not give a price for this endpoint. No card was made.');
  check(/^[1-9]\d{0,9}$/.test(rate.perUsd), 'RUPEE_RATE_REQUIRED', 'Set your rupee rate in Money, Spend first, so the card can show the cost in rupees.');
  let micros: bigint, rule: string, basis: SunraQuote['basis'];
  if (card.type === 'post_calculated') {
    micros = usdMicros(card.freeze_amount); basis = 'up-to';
    rule = `Usage-settled endpoint: the most one request can cost is $${card.freeze_amount} (Sunra's reserve).`;
  } else {
    check(card.type === 'pre_defined', 'SUNRA_QUOTE_UNAVAILABLE', 'Sunra\'s price card has a type Chausar cannot check. No card was made.');
    const index = card.prices.findIndex(price => matches(price.matches, input));
    check(index >= 0, 'SUNRA_QUOTE_UNAVAILABLE', 'No Sunra price rule fits this request. No card was made.');
    micros = usdMicros(card.prices[index]!.unit_amount); basis = 'fixed';
    rule = `Price rule ${index + 1} of ${card.prices.length}: $${card.prices[index]!.unit_amount} per request.`;
  }
  const paise = (micros * BigInt(rate.perUsd) + 50_000_000n) / 100_000_000n;
  return { basis, usdMicros: String(micros), paise: String(paise), display: money(paise, 'INR'), rule };
}

/** Sunra's public price rules for one endpoint. No key, nothing paid. A failure means no card. */
export async function fetchSunraPriceCard(endpointId: string, fetcher: typeof fetch = fetch): Promise<SunraPriceCard> {
  const parts = endpointId.split('/');
  check(parts.length === 3 && parts.every(part => /^[A-Za-z0-9._-]{1,100}$/.test(part)), 'SUNRA_QUOTE_UNAVAILABLE', 'Use a Sunra endpoint like owner/model/endpoint.');
  const get = async (path: string) => {
    const response = await fetcher(`https://api.sunra.ai${path}`, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } }).catch(() => null);
    check(response?.ok, 'SUNRA_QUOTE_UNAVAILABLE', 'Sunra\'s price list could not be read. No card was made.');
    return response.json() as Promise<any>;
  };
  const models = await get('/v1/models?limit=1000');
  const model = Array.isArray(models?.data) ? models.data.find((row: any) => row?.alias === `${parts[0]}/${parts[1]}`) : null;
  check(model && typeof model.id === 'string' && /^[A-Za-z0-9_]+$/.test(model.id), 'SUNRA_QUOTE_UNAVAILABLE', 'Sunra does not list this model. No card was made.');
  return await get(`/v1/pricing/model/${model.id}/endpoint/${encodeURIComponent(parts[2]!)}`) as SunraPriceCard;
}

export type GenerationRights = {
  aiGenerated: true; disclose: string; provider: 'Sunra'; model: string;
  orderId: string; clientId: string; use: string;
  references: { url: string; basis: FootageRights['basis']; holder: string }[];
};
export type MediaGenerationBody = {
  provider: 'sunra'; runId: string; jobId: string; orderId: string; clientId: string; endpointId: string; inputDigest: string;
  quote: SunraQuote & { perUsd: string; rateSetOn: IsoDate; priceCardId: string };
  rights: GenerationRights;
  status: 'quoted' | 'approved' | 'submitted' | 'failed' | 'declined';
  requestId: string | null; settledAt: IsoTime | null;
};

const AUTO_CONFIRM = /^(auto[-_]?(confirm|approve|accept|pay)|skip[-_]?(confirm|confirmation|approval|review)|no[-_]?confirm|confirm(ed)?|yes|force|assume[-_]?yes|dangerously.*)$/i;
function confirmKeys(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => confirmKeys(item, depth + 1));
  return Object.entries(value).some(([key, child]) => AUTO_CONFIRM.test(key) || confirmKeys(child, depth + 1));
}
function references(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  if (typeof value === 'string' && /^(https?:\/\/|data:)/i.test(value)) out.push(value.slice(0, 500));
  else if (Array.isArray(value)) value.forEach(item => references(item, out, depth + 1));
  else if (value && typeof value === 'object') Object.values(value).forEach(child => references(child, out, depth + 1));
  return out;
}

type AdapterOptions = { priceCard?: (endpointId: string) => Promise<SunraPriceCard>; matches?: (server: ExternalMcpServer) => boolean };
export function sunraAdapter(options: AdapterOptions = {}): McpCallAdapter {
  const priceCard = options.priceCard ?? (endpointId => fetchSunraPriceCard(endpointId));
  return {
    id: 'sunra',
    matches: options.matches ?? (server => npmPackageOf(server) === SUNRA_PACKAGE),
    async plan({ deps, ctx, capability, tool, input }): Promise<McpCallPlan | undefined> {
      check(tool.name !== 'set-sunra-key', 'SUNRA_KEY_TOOL_REFUSED', 'Chausar keeps your Sunra key in protected storage. The AI never handles it.');
      check(!confirmKeys(input), 'SUNRA_AUTO_CONFIRM_REFUSED', 'Chausar never lets Sunra skip a confirmation. Every generation waits for your tap.');
      check(input.webhookUrl === undefined, 'SUNRA_WEBHOOK_REFUSED', 'Sunra results are read back in the app. Chausar does not send them to a web address.');
      if (tool.name !== 'submit' && tool.name !== 'subscribe') return undefined;
      const endpointId = input.endpointId;
      check(typeof endpointId === 'string' && /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/.test(endpointId), 'INVALID_VENTURE_REQUEST', 'Use a Sunra endpoint like owner/model/endpoint.');
      const request = input.input === undefined ? {} : input.input;
      check(request !== null && typeof request === 'object' && !Array.isArray(request), 'INVALID_VENTURE_REQUEST', 'Send the generation settings as one object.');
      const settings = request as Record<string, unknown>, scope = capability.scope;
      const state = deps.store.read(), venture = findRecord(state, 'venture-record', scope.ventureId);
      check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
      const rupees = rupeesOf(state, venture);
      check(rupees, 'RUPEE_RATE_REQUIRED', 'Set your rupee rate in Money, Spend first, so the card can show the cost in rupees.');
      for (const field of COUNT_FIELDS) check(settings[field] === undefined || settings[field] === 1, 'SUNRA_ONE_PER_APPROVAL', 'Ask for one image or video per approval, so each one has its own card and cost.');
      const order = findRecord(state, 'venture-order', scope.orderId);
      check(order && order.clientId === scope.clientId, 'JOB_SCOPE_CHANGED', 'The job no longer matches this order.');
      const urls = [...new Set(references(settings))], recorded = order.intake?.rights ?? null;
      check(urls.length === 0 || recorded, 'RIGHTS_REQUIRED', 'Record the rights to the client\'s images or footage at intake before using them as a reference.');
      const card = await priceCard(endpointId);
      const quote = quoteSunra(card, settings, rupees.rate);
      const rights: GenerationRights = { aiGenerated: true, disclose: 'Label it as AI-made wherever it is shown.', provider: 'Sunra', model: endpointId,
        orderId: order.id, clientId: order.clientId, use: 'For this client\'s order only.',
        references: urls.map(url => ({ url, basis: recorded!.basis, holder: recorded!.holder })) };
      const inputDigest = argumentsDigest(input);
      const record = await ventureAction(deps, ctx, 'prepare', 'media.sunra.quote', tx => {
        capability.assert();
        check(tx.find('venture-delivery-run', scope.runId)?.agentJob?.scope.jobId === scope.jobId, 'JOB_CLOSED', 'This AI job is no longer running.');
        const body: MediaGenerationBody = { provider: 'sunra', runId: scope.runId, jobId: scope.jobId, orderId: order.id, clientId: order.clientId, endpointId, inputDigest,
          quote: { ...quote, perUsd: rupees.rate.perUsd, rateSetOn: rupees.rate.setOn, priceCardId: String(card.id).slice(0, 100) }, rights, status: 'quoted', requestId: null, settledAt: null };
        return tx.put({ ...tx.base('venture-media-generation'), ...body });
      });
      const settle = (patch: Partial<Pick<MediaGenerationBody, 'status' | 'requestId' | 'settledAt'>>) => ventureAction(deps, ctx, 'prepare', 'media.sunra.settle', tx => {
        const row = tx.find('venture-media-generation', record.id); if (row) tx.replace({ ...row, ...patch });
      });
      const usd = `$${(BigInt(quote.usdMicros) / 1_000_000n).toString()}.${String(BigInt(quote.usdMicros) % 1_000_000n).padStart(6, '0').replace(/0{1,4}$/, '')}`;
      return {
        description: `Make one ${/video/i.test(endpointId) ? 'video' : 'image'} with Sunra for ${quote.basis === 'up-to' ? 'up to ' : ''}${quote.display}. Approve only this exact request.`,
        card: { cost: { display: quote.display, paise: quote.paise, currency: 'INR', basis: quote.basis, usd, rule: quote.rule, receiptId: record.id }, rights, generation: { endpointId, inputDigest, oneApproval: true } },
        approved: async () => { await settle({ status: 'approved' }); },
        declined: async () => { await settle({ status: 'declined', settledAt: deps.clock().toISOString() }); },
        settled: async outcome => {
          let requestId: string | null = null;
          if (outcome.ok) {
            const text = (outcome.result as { content?: { type?: string; text?: string }[]; isError?: boolean })?.content?.find(part => part.type === 'text')?.text;
            try { const parsed = JSON.parse(text ?? ''); if (parsed?.success === true && typeof parsed.requestId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(parsed.requestId)) requestId = parsed.requestId; } catch { requestId = null; }
          }
          await settle({ status: requestId ? 'submitted' : 'failed', requestId, settledAt: deps.clock().toISOString() });
        },
      };
    },
  };
}
/** The receipt's own digest, for tests and the receipt sheet. */
export const generationDigest = (body: MediaGenerationBody) => digest(body);
