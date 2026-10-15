// Chausar venture launcher, package P2 (models): the replay transport for tests and the offline demo.
// It answers from a synthetic recording (hand-written, never captured from a live account) and refuses any
// fixture with another label. It never touches the network or starts a process.
import { ChausarError, check } from '../../contracts.ts';
import { MODEL_PURPOSES } from '../contracts.ts';
import type { ModelHttpRequest, ModelHttpResponse, ModelProcessRequest, ModelProcessResponse, ModelReplayFixture, ModelRouteKind, ModelTransport } from '../contracts.ts';
import { isPlainRecord } from './types.ts';

const KINDS: readonly ModelRouteKind[] = ['anthropic-messages', 'openai-responses', 'claude-cli', 'codex-cli'];

function assertFixture(fixture: unknown): asserts fixture is ModelReplayFixture {
  check(isPlainRecord(fixture) && fixture.label === 'synthetic recording', 'INVALID_VENTURE_REQUEST', 'Replay files must be labelled synthetic recording.');
  check(Array.isArray(fixture.responses), 'INVALID_VENTURE_REQUEST', 'The replay file has no responses list.');
  for (const response of fixture.responses as unknown[]) {
    check(isPlainRecord(response)
      && (MODEL_PURPOSES as readonly unknown[]).includes(response.purpose)
      && (KINDS as readonly unknown[]).includes(response.kind)
      && typeof response.model === 'string'
      && Number.isInteger(response.status)
      && 'body' in response
      && Array.isArray(response.mustInclude) && response.mustInclude.every(item => typeof item === 'string'),
    'INVALID_VENTURE_REQUEST', 'A replay response is missing its purpose, kind, model, status, body or mustInclude list.');
  }
}

function kindOfUrl(url: string): ModelRouteKind | null {
  let host = '';
  try { host = new URL(url).hostname; } catch { return null; }
  if (host === 'api.anthropic.com') return 'anthropic-messages';
  if (host === 'api.openai.com') return 'openai-responses';
  return null;
}

function kindOfCommand(command: string): ModelRouteKind | null {
  if (command === 'claude') return 'claude-cli';
  if (/(?:^|[\\/])codex(?:\.exe)?$/i.test(command)) return 'codex-cli';
  return null;
}

function modelOfBody(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return isPlainRecord(parsed) && typeof parsed.model === 'string' ? parsed.model : '';
  } catch { return ''; }
}

function bodyText(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body);
}

export function createReplayTransport(fixture: ModelReplayFixture): ModelTransport {
  assertFixture(fixture);
  const responses = structuredClone(fixture.responses);
  const used = new Set<number>();

  const pick = (purpose: string, kind: ModelRouteKind | null, model: string, text: string) => {
    const candidates = responses
      .map((response, index) => ({ response, index }))
      .filter(({ response }) => response.purpose === purpose && response.kind === kind && response.model === model
        && response.mustInclude.every(fragment => text.includes(fragment)));
    if (!candidates.length) throw new ChausarError('FIXTURE_MISSING', `Record this fixture: ${purpose} for ${model || 'an unknown model'}.`);
    const chosen = candidates.find(({ index }) => !used.has(index)) ?? candidates[candidates.length - 1];
    used.add(chosen.index);
    return chosen.response;
  };

  return {
    replay: true,
    async http(request: ModelHttpRequest): Promise<ModelHttpResponse> {
      const response = pick(request.purpose, kindOfUrl(request.url), modelOfBody(request.body), request.body);
      return { status: response.status, body: bodyText(response.body) };
    },
    async process(request: ModelProcessRequest): Promise<ModelProcessResponse> {
      if (request.purpose === 'version-check') return { exitCode: 0, stdout: 'synthetic recording' };
      const modelIndex = request.args.indexOf('--model');
      const model = modelIndex >= 0 ? request.args[modelIndex + 1] ?? '' : '';
      const response = pick(request.purpose, kindOfCommand(request.command), model, request.stdin);
      return { exitCode: response.status === 200 ? 0 : 1, stdout: bodyText(response.body) };
    },
  };
}
