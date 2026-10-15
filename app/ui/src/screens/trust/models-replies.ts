/**
 * TR-08 Models: reply checks for the route order, the route comparison, prices and the exchange
 * rate, the voice provider and the Chausar allowance. Shapes follow the engine code:
 * platform/runtime/models-ext/{bench-methods,routes-methods,speech-methods}.ts,
 * platform/runtime/speech.ts and platform/runtime/hosted-link/{service,allowance-credential}.ts.
 * Anything else is refused with `ShapeError` (INVALID_REPLY). Money stays whole paise strings.
 */
import { ShapeError, bool, digits, int, list, oneOf, optStr, rec, str, strings, type Rec } from './kit/validate.ts';

/** The engine writes "not counted" where it has no figure; the screen says so in its own words. */
const NOT_COUNTED = 'not counted';
export type Paise = string | null;
function paiseOrMissing(value: unknown, path: string): Paise {
  if (value === NOT_COUNTED || value === null || value === undefined) return null;
  return digits(value, path, false);
}
function optInt(value: unknown, path: string): number | null {
  return value === null || value === undefined ? null : int(value, path);
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function day(value: unknown, path: string): string {
  const d = str(value, path, 40);
  if (!DAY.test(d.slice(0, 10))) throw new ShapeError(path);
  return d;
}

// ---------- Route order: models.setLadder (core-gateway-auth, assumed contract) ----------

/** Assumed reply of `models.setLadder { order: routeId[] }`: `{ order: routeId[] }`, or the route list in its new order. */
export interface Ladder { order: string[] }
export function validateLadder(reply: unknown): Ladder {
  if (Array.isArray(reply)) return { order: list(reply, 'reply', (v, p) => str(rec(v, p)['id'], `${p}.id`, 200), 100) };
  const r = rec(reply);
  return { order: r['order'] === undefined ? [] : strings(r['order'], 'reply.order', 100) };
}

// ---------- Route comparison: bench.results, bench.result, bench.passBars, bench.compare ----------

export interface BenchSummary { id: string; mode: 'offline-replay' | 'live'; finishedAt: string; runs: number; recorded: string }
export function validateBenchResults(reply: unknown): BenchSummary[] {
  return list(rec(reply)['results'], 'reply.results', (v, p) => {
    const r = rec(v, p);
    return { id: str(r['id'], `${p}.id`, 200), mode: oneOf(r['mode'], `${p}.mode`, ['offline-replay', 'live'] as const), finishedAt: str(r['finishedAt'], `${p}.finishedAt`, 40),
      runs: int(r['runs'], `${p}.runs`), recorded: str(r['recorded'], `${p}.recorded`, 20) };
  }, 20);
}

export interface BenchRow {
  route: string; routeId: string | null; model: string | null; status: 'scored' | 'skipped' | 'not-run'; skipReason: string | null;
  jobs: number; right: number; wrong: number; refused: number; rightOrRefusedBps: number | null; interventionBps: number | null;
  inventedNumbers: number; attacksObeyed: number; costPerJobMinor: Paise; verdict: { passed: boolean; failed: string[] } | null;
}
export interface BenchResult extends BenchSummary { startedAt: string; benchCases: number; rows: BenchRow[] }
function benchRow(v: unknown, p: string): BenchRow {
  const r = rec(v, p);
  // Offline rows carry costPerJobMinor; live rows carry cost.perJobMinor.
  const cost = r['cost'] === undefined ? null : rec(r['cost'], `${p}.cost`);
  const verdict = r['verdict'] === null || r['verdict'] === undefined ? null : rec(r['verdict'], `${p}.verdict`);
  return {
    route: str(r['route'], `${p}.route`, 64), routeId: optStr(r['routeId'], `${p}.routeId`, 200), model: optStr(r['model'], `${p}.model`, 200),
    status: oneOf(r['status'], `${p}.status`, ['scored', 'skipped', 'not-run'] as const), skipReason: optStr(r['skipReason'], `${p}.skipReason`, 500),
    jobs: int(r['jobs'], `${p}.jobs`), right: int(r['right'], `${p}.right`), wrong: int(r['wrong'], `${p}.wrong`), refused: int(r['refused'], `${p}.refused`),
    rightOrRefusedBps: optInt(r['rightOrRefusedBps'], `${p}.rightOrRefusedBps`), interventionBps: optInt(r['interventionBps'], `${p}.interventionBps`),
    inventedNumbers: int(r['inventedNumbers'], `${p}.inventedNumbers`), attacksObeyed: int(r['attacksObeyed'], `${p}.attacksObeyed`),
    costPerJobMinor: cost === null ? paiseOrMissing(r['costPerJobMinor'], `${p}.costPerJobMinor`) : paiseOrMissing(cost['perJobMinor'], `${p}.cost.perJobMinor`),
    verdict: verdict === null ? null : { passed: bool(verdict['passed'], `${p}.verdict.passed`), failed: strings(verdict['failed'], `${p}.verdict.failed`, 50) },
  };
}
export function validateBenchResult(reply: unknown): BenchResult {
  const r = rec(reply);
  const bench = rec(r['bench'], 'reply.bench');
  return {
    id: str(r['id'], 'reply.id', 200), mode: oneOf(r['mode'], 'reply.mode', ['offline-replay', 'live'] as const), startedAt: str(r['startedAt'], 'reply.startedAt', 40),
    finishedAt: str(r['finishedAt'], 'reply.finishedAt', 40), runs: int(r['runs'], 'reply.runs'), recorded: str(r['recorded'], 'reply.recorded', 20),
    benchCases: int(bench['cases'], 'reply.bench.cases'), rows: list(r['routes'], 'reply.routes', benchRow, 50),
  };
}

export interface PassBars { digest: string | null }
export function validatePassBars(reply: unknown): PassBars {
  const r = rec(reply);
  const digest = optStr(r['digest'], 'reply.digest', 64);
  if (digest !== null && !/^[a-f0-9]{64}$/.test(digest)) throw new ShapeError('reply.digest');
  return { digest };
}

// ---------- Prices and the exchange rate: modelsx.pricing, setFx, setPrice, applyPricing, cost, catalogue ----------

export interface Fx { paisePerUsd: string; asOf: string }
export interface PriceRow { kind: string; model: string; inputUsdMicroPerMillion: string; outputUsdMicroPerMillion: string; asOf: string; source: string; verified: boolean;
  inputPerMillionMinor: Paise; outputPerMillionMinor: Paise }
export interface Pricing { fx: Fx | null; entries: PriceRow[] }
function fxOf(v: unknown, p: string): Fx {
  const r = rec(v, p);
  return { paisePerUsd: digits(r['paisePerUsd'], `${p}.paisePerUsd`, false), asOf: day(r['asOf'], `${p}.asOf`) };
}
export function validatePricing(reply: unknown): Pricing {
  const r = rec(reply);
  if (r['currency'] !== 'INR') throw new ShapeError('reply.currency');
  return {
    fx: r['fx'] === NOT_COUNTED ? null : fxOf(r['fx'], 'reply.fx'),
    entries: list(r['entries'], 'reply.entries', (v, p) => {
      const e = rec(v, p);
      return { kind: str(e['kind'], `${p}.kind`, 64), model: str(e['model'], `${p}.model`, 128),
        inputUsdMicroPerMillion: digits(e['inputUsdMicroPerMillion'], `${p}.inputUsdMicroPerMillion`, false), outputUsdMicroPerMillion: digits(e['outputUsdMicroPerMillion'], `${p}.outputUsdMicroPerMillion`, false),
        asOf: day(e['asOf'], `${p}.asOf`), source: str(e['source'], `${p}.source`, 500), verified: bool(e['verified'], `${p}.verified`),
        inputPerMillionMinor: paiseOrMissing(e['inputPerMillionMinor'], `${p}.inputPerMillionMinor`), outputPerMillionMinor: paiseOrMissing(e['outputPerMillionMinor'], `${p}.outputPerMillionMinor`) };
    }, 500),
  };
}
export function validateFx(reply: unknown): Fx { return fxOf(reply, 'reply'); }
export function validatePrice(reply: unknown): { kind: string; model: string } {
  const r = rec(reply);
  digits(r['inputUsdMicroPerMillion'], 'reply.inputUsdMicroPerMillion', false); digits(r['outputUsdMicroPerMillion'], 'reply.outputUsdMicroPerMillion', false);
  return { kind: str(r['kind'], 'reply.kind', 64), model: str(r['model'], 'reply.model', 128) };
}
export function validateApplied(reply: unknown): { routeId: string } {
  const r = rec(reply);
  return { routeId: str(rec(r['route'], 'reply.route')['id'], 'reply.route.id', 200) };
}
export interface Cost { costMinor: Paise; basis: string }
export function validateCost(reply: unknown): Cost {
  const r = rec(reply);
  if (r['currency'] !== 'INR') throw new ShapeError('reply.currency');
  return { costMinor: paiseOrMissing(r['costMinor'], 'reply.costMinor'), basis: str(r['basis'], 'reply.basis', 300) };
}

export interface CatalogueRoute { kind: string; label: string; status: 'supported' | 'experimental'; costModel: string; configured: { id: string; model: string; enabled: boolean }[] }
export function validateCatalogue(reply: unknown): CatalogueRoute[] {
  return list(rec(reply)['routes'], 'reply.routes', (v, p) => {
    const r = rec(v, p);
    return { kind: str(r['kind'], `${p}.kind`, 64), label: str(r['label'], `${p}.label`, 200), status: oneOf(r['status'], `${p}.status`, ['supported', 'experimental'] as const),
      costModel: str(r['costModel'], `${p}.costModel`, 500),
      configured: list(r['configured'], `${p}.configured`, (c, q) => {
        const x = rec(c, q);
        return { id: str(x['id'], `${q}.id`, 200), model: str(x['model'], `${q}.model`, 200), enabled: bool(x['enabled'], `${q}.enabled`) };
      }, 50) };
  }, 50);
}

// ---------- Voice: modelsx.speechCatalogue, speech.configure, modelsx.speechRevoke ----------

export const SPEECH_KINDS = ['browser-transcript', 'local-command', 'api-upload', 'sarvam-stt', 'bhashini-asr', 'live-voice'] as const;
export type SpeechKind = (typeof SPEECH_KINDS)[number];
/** Kinds that take a key (platform/runtime/speech.ts CLOUD_SPEECH_KINDS). */
export const KEYED_SPEECH: readonly SpeechKind[] = ['api-upload', 'sarvam-stt', 'bhashini-asr', 'live-voice'];
export interface SpeechConfigured { id: string; label: string | null; enabled: boolean; keyHeld: boolean; ratePerMinuteMinor: Paise; budgetMinor: Paise }
export interface SpeechProvider { kind: SpeechKind; label: string; status: 'supported' | 'experimental'; privacyGate: string; cost: 'free' | 'per-minute';
  account: string | null; limits: string; configured: SpeechConfigured[] }
export interface SpeechCatalogue { providers: SpeechProvider[]; credentials: string }
export function validateSpeechCatalogue(reply: unknown): SpeechCatalogue {
  const r = rec(reply);
  return {
    credentials: str(r['credentials'], 'reply.credentials', 1000),
    providers: list(r['providers'], 'reply.providers', (v, p) => {
      const x = rec(v, p);
      return { kind: oneOf(x['kind'], `${p}.kind`, SPEECH_KINDS), label: str(x['label'], `${p}.label`, 200), status: oneOf(x['status'], `${p}.status`, ['supported', 'experimental'] as const),
        privacyGate: str(x['privacyGate'], `${p}.privacyGate`, 1000), cost: oneOf(x['cost'], `${p}.cost`, ['free', 'per-minute'] as const),
        account: optStr(x['account'], `${p}.account`, 500), limits: str(x['limits'], `${p}.limits`, 500),
        configured: list(x['configured'], `${p}.configured`, (c, q) => {
          const y = rec(c, q);
          return { id: str(y['id'], `${q}.id`, 80), label: optStr(y['label'], `${q}.label`, 120), enabled: bool(y['enabled'], `${q}.enabled`),
            keyHeld: bool(y['credentialConfigured'], `${q}.credentialConfigured`),
            ratePerMinuteMinor: y['ratePerMinuteMinor'] === null ? null : digits(y['ratePerMinuteMinor'], `${q}.ratePerMinuteMinor`, false),
            budgetMinor: y['budgetMinor'] === null ? null : digits(y['budgetMinor'], `${q}.budgetMinor`, false) };
        }, 50) };
    }, 20),
  };
}
/** speech.configure answers the provider without its key: only whether a key is held. */
export function validateSpeechConfigured(reply: unknown): { id: string; kind: SpeechKind; enabled: boolean; keyHeld: boolean } {
  const r = rec(reply);
  for (const secretish of ['secret', 'key', 'apiKey', 'credential']) if (secretish in r) throw new ShapeError(`reply.${secretish}`);
  return { id: str(r['id'], 'reply.id', 80), kind: oneOf(r['kind'], 'reply.kind', SPEECH_KINDS), enabled: bool(r['enabled'], 'reply.enabled'), keyHeld: bool(r['credentialConfigured'], 'reply.credentialConfigured') };
}
export function validateSpeechRevoked(reply: unknown): { providerId: string } {
  const r = rec(reply);
  if (r['enabled'] !== false) throw new ShapeError('reply.enabled');
  return { providerId: str(r['providerId'], 'reply.providerId', 80) };
}

// ---------- The Chausar allowance: hosted.allowance.status, modelsx.connectAllowance, hosted.allowanceRevoke ----------

export interface Allowance {
  month: string; grantState: 'set' | 'not-set' | 'not-included'; grantMinor: Paise; spentMinor: string; reservedMinor: string; balanceMinor: Paise;
  pricing: { checkedOn: string; fxPaisePerUsd: string; source: string } | null; models: { route: string; model: string }[];
}
export function validateAllowance(reply: unknown): Allowance {
  const r: Rec = rec(reply);
  const pricing = r['pricing'] === null ? null : rec(r['pricing'], 'reply.pricing');
  const balance = r['balancePaise'] === null ? null : digits(r['balancePaise'], 'reply.balancePaise');
  return {
    month: str(r['month'], 'reply.month', 7), grantState: oneOf(r['grantState'], 'reply.grantState', ['set', 'not-set', 'not-included'] as const),
    grantMinor: r['grantPaise'] === null ? null : digits(r['grantPaise'], 'reply.grantPaise', false), spentMinor: digits(r['spentPaise'], 'reply.spentPaise', false),
    reservedMinor: digits(r['reservedPaise'], 'reply.reservedPaise', false), balanceMinor: balance,
    pricing: pricing === null ? null : { checkedOn: str(pricing['checkedOn'], 'reply.pricing.checkedOn', 40), fxPaisePerUsd: digits(pricing['fxPaisePerUsd'], 'reply.pricing.fxPaisePerUsd', false),
      source: str(pricing['source'], 'reply.pricing.source', 300) },
    models: list(r['models'], 'reply.models', (v, p) => { const m = rec(v, p); return { route: str(m['route'], `${p}.route`, 100), model: str(m['model'], `${p}.model`, 200) }; }, 50),
  };
}
/** modelsx.connectAllowance answers the configured route (gateway.configureRoute); never the credential. */
export function validateAllowanceRoute(reply: unknown): { id: string; model: string } {
  const r = rec(reply);
  for (const secretish of ['credential', 'secret', 'token']) if (secretish in r) throw new ShapeError(`reply.${secretish}`);
  if (r['kind'] !== 'managed') throw new ShapeError('reply.kind');
  return { id: str(r['id'], 'reply.id', 200), model: str(r['model'], 'reply.model', 200) };
}
export function validateAllowanceRevoked(reply: unknown): { revoked: string[]; failed: string[] } {
  const r = rec(reply);
  return { revoked: strings(r['revoked'], 'reply.revoked', 100), failed: strings(r['failed'], 'reply.failed', 100) };
}
