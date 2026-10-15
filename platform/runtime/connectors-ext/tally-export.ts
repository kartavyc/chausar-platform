import { createHash } from 'node:crypto';
import { authorize, audit, check, ChausarError, newId, now, type Context } from '../contracts.ts';
import type { BoundedHttp } from '../connectors.ts';
import type { ModuleHost } from '../modules/types.ts';
import { runApiRead } from '../adapters/read-kit.ts';
import { checkPeriod } from '../adapters/google/common.ts';
import { tallyCompaniesSpec, tallyLedgersSpec, tallyRegisterEndpoint, tallyRegisterRequestBody, tallyRegisterSpec, tallyRegisterTotalRequestBody, type TallyRegister } from '../adapters/accounting/tally-registers.ts';
import { recipe as registeredRecipe, runRegistered } from './recipes/index.ts';
import { connection, options, outcomeSummary, recordEnvelope, scoped, shape, trusted, view } from './service.ts';
import { cxState, LIMITS, peekCx, prune, type Connection, type TallyExport } from './state.ts';

/**
 * Tally on another computer (BK-03). Chausar writes a PowerShell script holding the same read-only
 * export requests it would send to Tally on this computer; the person runs it beside Tally and brings
 * back the answer file, which is replayed through the same register reader and recipe. Outside text
 * (company and ledger names) only ever travels inside base64 request bodies, never as script code.
 */
const REQUEST = 'CONNECTOR_REQUEST_INVALID';
const ANSWER_FORMAT = 'chausar-tally-answers';
const ANSWER_LIMIT = 24 * 1024 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DIGEST = /^[0-9a-f]{64}$/;
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const digest = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');
const REGISTER_WORDS = { sales: { en: 'Sales Register', hi: 'सेल्स रजिस्टर', group: 'Sales Accounts' }, purchase: { en: 'Purchase Register', hi: 'परचेज़ रजिस्टर', group: 'Purchase Accounts' } } as const;

function tallyConnection(host: ModuleHost, id: unknown): Connection {
  const item = connection(host.store, id);
  check(item.group === 'tally', 'TALLY_CONNECTION_REQUIRED', 'Choose a Tally connection.');
  check(item.status === 'active', 'CONNECTION_PAUSED', 'This connection is paused.');
  return item;
}
/** The connection's exact Tally company: the interface setting when present, else the connection's company. */
const companyOf = (item: Connection) => item.settings.company ?? item.company;

/** The requests a register read sends, in order: the vouchers, then the group movement. */
function registerRequests(register: TallyRegister, company: string, period: { from: string; to: string }): string[] {
  return [tallyRegisterRequestBody(register, company, period), tallyRegisterTotalRequestBody(register, company, period)];
}

/** Windows PowerShell 5.1 script. Every value spliced here is Chausar's own (ids, digests, base64, a validated loopback URL). */
function powershell(input: { exportId: string; register: TallyRegister; period: { from: string; to: string }; fileName: string; answerFileName: string; endpoint: string; bodies: string[] }): string {
  for (const value of [input.exportId, input.fileName, input.answerFileName]) check(/^[A-Za-z0-9_.-]+$/.test(value), 'TALLY_EXPORT_INVALID', 'The export could not be written.');
  check(/^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d{4,5}\/$/.test(input.endpoint), 'ENDPOINT_REFUSED', 'Tally must use an explicit loopback HTTP port with no path or credentials.');
  const words = REGISTER_WORDS[input.register];
  const requests = input.bodies.map(body => `  @{ digest = '${digest(body)}'; body = '${Buffer.from(body, 'utf8').toString('base64')}' }`).join(",\n");
  return [
    `# Chausar: Tally ${words.en} export, ${input.period.from} to ${input.period.to}.`,
    '#',
    '# What this script does, in plain words:',
    `# - It asks TallyPrime on this computer, at ${input.endpoint}, for ${input.bodies.length} read-only exports:`,
    `#   the ${words.en} for the period and the ${words.group} total for the same period.`,
    '#   These are the same export requests Chausar sends when Tally runs on the Chausar computer.',
    `# - It writes one answer file next to this script: ${input.answerFileName}`,
    '# - It changes nothing in Tally and sends nothing anywhere else.',
    '# - The requests below are stored in base64 so they are sent to Tally exactly as Chausar made them.',
    '#',
    '# Before running: open TallyPrime with the company you chose in Chausar, and turn on its XML server',
    '# on port 9000 (F1 Help > Settings > Connectivity, "TallyPrime acts as": Both or Server).',
    `# Run it with: powershell -ExecutionPolicy Bypass -File ${input.fileName}`,
    '# Then bring the answer file back to Chausar: Books, Tally on another computer.',
    '',
    "$ErrorActionPreference = 'Stop'",
    'Set-StrictMode -Version 2',
    `$endpoint = '${input.endpoint}'`,
    `$exportId = '${input.exportId}'`,
    `$answerFile = '${input.answerFileName}'`,
    '$requests = @(',
    requests,
    ')',
    '$answers = @()',
    'foreach ($request in $requests) {',
    '  [byte[]] $bytes = [Convert]::FromBase64String($request.body)',
    '  try {',
    "    $response = Invoke-WebRequest -Uri $endpoint -Method Post -Body $bytes -ContentType 'text/xml; charset=utf-8' -UseBasicParsing -TimeoutSec 300",
    '  } catch {',
    "    Write-Host 'Tally did not answer on its XML port. Open TallyPrime with the company, turn on the XML server on port 9000, and run this again.'",
    '    exit 1',
    '  }',
    '  $answer = [Convert]::ToBase64String($response.RawContentStream.ToArray())',
    `  $answers += ('{"requestDigest":"' + $request.digest + '","bodyBase64":"' + $answer + '"}')`,
    '}',
    `$json = '{"format":"${ANSWER_FORMAT}","version":1,"exportId":"' + $exportId + '","responses":[' + ($answers -join ',') + ']}'`,
    '$path = Join-Path $PSScriptRoot $answerFile',
    '[System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))',
    "Write-Host ('Done. Bring this file back to Chausar: ' + $path)",
    '',
  ].join('\r\n');
}

function guide(input: { register: TallyRegister; period: { from: string; to: string }; fileName: string; answerFileName: string; expiresAt: string }) {
  const words = REGISTER_WORDS[input.register], until = input.expiresAt.slice(0, 10), run = `powershell -ExecutionPolicy Bypass -File ${input.fileName}`;
  const en = [
    'Chausar: read Tally on another computer',
    '',
    'Use this when Tally runs on a different computer from Chausar.',
    '',
    `1. Copy the script ${input.fileName} to the computer where Tally runs.`,
    '2. On that computer, open TallyPrime and open the company you chose in Chausar.',
    '3. Turn on Tally\'s XML server: press F1 (Help) > Settings > Connectivity. Set "TallyPrime acts as" to Both or Server, and the port to 9000. Save.',
    '4. Open Windows PowerShell in the folder that holds the script, and run:',
    `   ${run}`,
    `5. When it says Done, a new file sits beside the script: ${input.answerFileName}`,
    '6. Bring that file back to the Chausar computer, for example on a pen drive or a shared folder, and import it in Books, Tally on another computer.',
    '',
    `What the script does: it asks Tally for the ${words.en} and the ${words.group} total from ${input.period.from} to ${input.period.to}. These are the same read-only requests Chausar sends when Tally is on its own computer. It changes nothing in Tally and sends nothing anywhere else: it talks only to Tally on that computer (127.0.0.1, port 9000) and writes one file beside itself.`,
    '',
    `The answer file can be imported until ${until}. After that, make a new script in Chausar.`,
  ].join('\n');
  const hi = [
    'Chausar: दूसरे कंप्यूटर पर चल रहे Tally से हिसाब लाना',
    '',
    'जब Tally उस कंप्यूटर पर नहीं है जिस पर Chausar चल रहा है, तब यह तरीका अपनाएँ।',
    '',
    `1. स्क्रिप्ट ${input.fileName} को उस कंप्यूटर पर कॉपी करें जिस पर Tally चलता है।`,
    '2. उस कंप्यूटर पर TallyPrime खोलें और वही कंपनी खोलें जो आपने Chausar में चुनी है।',
    '3. Tally का XML सर्वर चालू करें: F1 (Help) > Settings > Connectivity में जाएँ। "TallyPrime acts as" को Both या Server पर रखें और पोर्ट 9000 रखें। फिर सेव करें।',
    '4. जिस फ़ोल्डर में स्क्रिप्ट रखी है, वहीं Windows PowerShell खोलें और यह चलाएँ:',
    `   ${run}`,
    `5. "Done" दिखने पर स्क्रिप्ट के पास एक नई फ़ाइल बन जाएगी: ${input.answerFileName}`,
    '6. यह फ़ाइल पेन ड्राइव या शेयर्ड फ़ोल्डर से Chausar वाले कंप्यूटर पर लाएँ और Books में "Tally on another computer" से इम्पोर्ट करें।',
    '',
    `स्क्रिप्ट क्या करती है: यह Tally से ${input.period.from} से ${input.period.to} तक का ${words.hi} और ${words.group} का कुल माँगती है। ये वही केवल पढ़ने वाली माँगें हैं जो Chausar तब भेजता है जब Tally उसी कंप्यूटर पर हो। यह Tally में कुछ नहीं बदलती और कहीं और कुछ नहीं भेजती: यह सिर्फ़ उसी कंप्यूटर पर चल रहे Tally (127.0.0.1, पोर्ट 9000) से बात करती है और अपने पास एक फ़ाइल लिखती है।`,
    '',
    `उत्तर फ़ाइल ${until} तक इम्पोर्ट की जा सकती है। उसके बाद Chausar में नई स्क्रिप्ट बनाएँ।`,
  ].join('\n');
  return { en, hi };
}

/** Strict answer file: exact keys, our format and version, one answer per request digest. */
function answerFile(value: unknown): { exportId: string; responses: { requestDigest: string; bodyBase64: string }[] } {
  const invalid = () => new ChausarError('TALLY_EXPORT_INVALID', 'This is not an answer file written by the Chausar Tally script.');
  if (typeof value !== 'string' || value.length === 0 || value.length > ANSWER_LIMIT) throw invalid();
  let parsed: any;
  try { parsed = JSON.parse(value.replace(/^﻿/, '')); } catch { throw invalid(); }
  const keys = (item: unknown, names: string[]) => plain(item) && Object.keys(item).length === names.length && names.every(name => Object.hasOwn(item, name));
  if (!keys(parsed, ['format', 'version', 'exportId', 'responses']) || parsed.format !== ANSWER_FORMAT || parsed.version !== 1
    || typeof parsed.exportId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(parsed.exportId) || !Array.isArray(parsed.responses) || parsed.responses.length === 0 || parsed.responses.length > 10) throw invalid();
  for (const item of parsed.responses) if (!keys(item, ['requestDigest', 'bodyBase64']) || typeof item.requestDigest !== 'string' || !DIGEST.test(item.requestDigest) || typeof item.bodyBase64 !== 'string' || !BASE64.test(item.bodyBase64)) throw invalid();
  if (new Set(parsed.responses.map((item: any) => item.requestDigest)).size !== parsed.responses.length) throw invalid();
  return { exportId: parsed.exportId, responses: parsed.responses };
}
/** Tally answers in UTF-16LE (with its byte order mark) or UTF-8. UTF-16 is turned into text here; UTF-8 bytes go to the read kit's own strict check. */
function responseBody(bytes: Buffer): string | Buffer {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xfe) return bytes;
  let text: string;
  try { text = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(2)); } catch { throw new ChausarError('TALLY_EXPORT_INVALID', 'This is not an answer file written by the Chausar Tally script.'); }
  return text.replace(/^<\?xml(\s+version=(?:"1\.0"|'1\.0'))\s+encoding=(?:"UTF-16(?:LE)?"|'UTF-16(?:LE)?')/i, '<?xml$1 encoding="UTF-8"');
}

export async function tallyExporter(ctx: Context, payload: Record<string, any>, host: ModuleHost, internal: { endpoint?: string } = {}) {
  trusted(ctx);
  shape(payload, ['connectionId', 'register', 'period', 'ledgers', 'baseCurrency'], ['connectionId', 'register', 'period', 'ledgers', 'baseCurrency']);
  const item = tallyConnection(host, payload.connectionId); scoped(host, ctx, item);
  check(payload.register === 'sales' || payload.register === 'purchase', REQUEST, 'Choose the sales or the purchase register.');
  const register: TallyRegister = payload.register;
  check(plain(payload.period) && Object.keys(payload.period).length === 2, 'PERIOD_INVALID', 'A period is two calendar dates, the first not after the second.');
  const period = checkPeriod({ from: payload.period.from, to: payload.period.to }, true)!;
  const config = tallyRegisterSpec(register).validate({ company: companyOf(item), baseCurrency: payload.baseCurrency, ledgers: Array.isArray(payload.ledgers) ? [...payload.ledgers] : payload.ledgers });
  const endpoint = tallyRegisterEndpoint(internal.endpoint);
  const bodies = registerRequests(register, config.company, period);
  const exportId = newId('tallyexport'), createdAt = now(), expiresAt = new Date(Date.parse(createdAt) + LIMITS.tallyExportTtlMs).toISOString();
  const stem = `chausar-tally-${register}-${period.from}-to-${period.to}`, fileName = `${stem}.ps1`, answerFileName = `${stem}-answers.json`, guideFileName = 'chausar-tally-guide.txt';
  const script = powershell({ exportId, register, period, fileName, answerFileName, endpoint, bodies });
  const record: TallyExport = { exportId, connectionId: item.id, sourceId: item.sourceId, register, period, company: config.company, ledgers: [...config.ledgers], baseCurrency: config.baseCurrency,
    requestDigests: bodies.map(digest), createdAt, expiresAt, createdBy: ctx.memberId };
  await host.store.update(state => {
    authorize(view(host.store, state), ctx, 'prepare');
    const cx = cxState(state); prune(cx, Date.now());
    cx.tallyExports = [...(cx.tallyExports ?? []), record];
    if (cx.tallyExports.length > LIMITS.tallyExports) cx.tallyExports.splice(0, cx.tallyExports.length - LIMITS.tallyExports);
    audit(state, 'connectorsx.tally-export', { exportId, connectionId: item.id, register });
  });
  return { exportId, fileName, script, guideFileName, guide: guide({ register, period, fileName, answerFileName, expiresAt }), expiresAt };
}

export async function tallyImportExport(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  shape(payload, ['connectionId', 'text'], ['connectionId', 'text']);
  const item = tallyConnection(host, payload.connectionId); scoped(host, ctx, item);
  const file = answerFile(payload.text);
  const stored = (peekCx(host.store.read()).tallyExports ?? []).find(entry => entry.exportId === file.exportId && entry.connectionId === item.id && Date.parse(entry.expiresAt) > Date.now());
  check(stored, 'TALLY_EXPORT_UNKNOWN', 'Chausar made no such export for this connection, or it expired. Make a new script.');
  check(file.responses.every(answer => stored!.requestDigests.includes(answer.requestDigest)), 'TALLY_EXPORT_MISMATCH', 'This file answers other requests than the ones Chausar made.');
  const answers = new Map(file.responses.map(answer => [answer.requestDigest, responseBody(Buffer.from(answer.bodyBase64, 'base64'))]));
  let mismatch = false;
  // Answers a request only when Chausar made it and the file holds its answer; nothing reaches the network.
  const replay: BoundedHttp = async request => {
    const key = digest(request.body ?? ''), body = request.method === 'POST' && stored!.requestDigests.includes(key) ? answers.get(key) : undefined;
    if (body === undefined) { mismatch = true; throw new ChausarError('TALLY_EXPORT_MISMATCH', 'This file answers other requests than the ones Chausar made.'); }
    return { status: 200, url: request.url, body, headers: { 'content-type': 'text/xml' } };
  };
  const recipeId = `tally.${stored!.register}-register`, recipe = registeredRecipe(recipeId), period = { ...stored!.period };
  let result: Awaited<ReturnType<typeof runApiRead>>;
  try { result = await runApiRead(tallyRegisterSpec(stored!.register), { config: { company: stored!.company, baseCurrency: stored!.baseCurrency, ledgers: [...stored!.ledgers] }, sourceId: item.sourceId, period, http: replay }); }
  catch (error) {
    if (mismatch) throw new ChausarError('TALLY_EXPORT_MISMATCH', 'This file answers other requests than the ones Chausar made.');
    const code = error instanceof ChausarError ? error.code : 'SOURCE_READ_FAILED';
    await recordEnvelope(host, ctx, { outcome: null, failure: { code }, connection: item, target: item, recipe, road: 'file', requestedPeriod: period });
    throw error instanceof ChausarError ? error : new ChausarError('SOURCE_READ_FAILED', 'The read failed. Nothing was retried.');
  }
  const declared = result.declared ?? null;
  const meta: Record<string, string> = declared ? { ...(declared.rowCount != null ? { declaredRowCount: String(declared.rowCount) } : {}), ...(declared.amount != null ? { declaredAmount: declared.amount, declaredAmountUnit: declared.amountUnit ?? 'major' } : {}), declaredReference: declared.reference ?? 'tally-declared' } : {};
  const outcome = runRegistered(recipeId, { records: result.records, meta });
  return outcomeSummary(await recordEnvelope(host, ctx, { outcome, connection: item, target: item, recipe, road: 'file', requestedPeriod: period, read: { pages: result.pages, requests: result.requests, bytes: result.bytes } }));
}

/** Setup reads against Tally on this computer: they answer "Which company?" and "Which ledgers?". */
function interfaceConnection(host: ModuleHost, ctx: Context, id: unknown): Connection {
  trusted(ctx);
  const item = connection(host.store, id);
  check(item.group === 'tally' && item.road === 'interface', 'READ_NOT_AVAILABLE', 'Only a Tally connection on this computer can list its companies and ledgers.');
  scoped(host, ctx, item);
  return item;
}
const endpointOf = (item: Connection) => item.settings.endpoint ? { endpoint: item.settings.endpoint } : {};
const tallyDay = (value: string) => /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;

export async function tallyCompanies(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  shape(payload, ['connectionId'], ['connectionId']);
  const item = interfaceConnection(host, ctx, payload.connectionId);
  const result = await runApiRead(tallyCompaniesSpec, { config: endpointOf(item), sourceId: item.sourceId, http: options(host).http });
  return { companies: result.records.map(record => ({ name: String(record.name), booksFrom: tallyDay(String(record.booksFrom ?? '')) })) };
}
export async function tallyLedgers(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  shape(payload, ['connectionId'], ['connectionId']);
  const item = interfaceConnection(host, ctx, payload.connectionId);
  const result = await runApiRead(tallyLedgersSpec, { config: { ...endpointOf(item), company: companyOf(item) }, sourceId: item.sourceId, http: options(host).http });
  return { ledgers: result.records.map(record => ({ name: String(record.name), parent: record.parent ? String(record.parent) : null })) };
}
