/**
 * W6 6F2 (D31): playbook packs in the engine. Load a pack folder, validate it (pack-format.ts), show it, add it after
 * the owner approves its exact digest inside the app, remove it. Pack calculators run in an isolated worker with no
 * imports, no file or network access and a deadline; their answers become code receipts in the job that asked.
 * A pack's MCP server references are shown only: adding one is the normal owner-approved server setting.
 */
import { formatCount } from '../../owner-format.ts';
import { spawn } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChausarError, check, money, type Context, type State } from '../../contracts.ts';
import type { DeliveryRunRecord, VentureDeps, WorkReceiptRecord } from '../contracts.ts';
import { digest, exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { recordDecision } from '../journal/decisions.ts';
import { removeRecords } from '../network/people.ts';
import { PACK_FORMAT, packOperation, packView, validatePack, type PackCalculator, type PackDoc, type PackView } from './pack-format.ts';
import type { JobCalculation } from '../agent-runtime/job-tools.ts';

export type PackRecordBody = { packId: string; doc: PackDoc; digest: string; addedBy: string };
const BAD = 'INVALID_VENTURE_REQUEST';

function packsOf(state: State, ventureId: string) {
  return listRecords(state, 'venture-pack', ventureId).filter(row => digest(row.doc) === row.digest);
}

/** venture.packs.list {} (read): the business's packs, without calculator code bytes. */
export async function listPacks(deps: VentureDeps, ctx: Context, raw: unknown): Promise<{ packs: PackView[] }> {
  exactPayload(raw, []);
  const { state, venture } = readVenture(deps, ctx);
  return { packs: packsOf(state, venture.id).map(row => packView(row.doc, row.digest)).sort((a, b) => a.id.localeCompare(b.id)) };
}

/**
 * venture.packs.add { pack, digest? } (approve). Without a digest it validates and answers the exact preview. With the
 * preview's digest, inside the app, it adds the pack. A changed pack is refused with PREVIEW_CHANGED.
 */
export async function addPack(deps: VentureDeps, ctx: Context, raw: unknown): Promise<{ added: boolean; digest: string; pack: PackView }> {
  const body = exactPayload(raw, ['pack', 'digest'], ['pack']);
  const valid = validatePack(body.pack);
  if (body.digest === undefined) { readVenture(deps, ctx); return { added: false, digest: valid.digest, pack: valid.view }; }
  requireAppChannel(ctx, 'venture.packs.add');
  check(typeof body.digest === 'string', BAD, 'Approve the exact pack you previewed.');
  check(body.digest === valid.digest, 'PREVIEW_CHANGED', 'This pack changed since you previewed it. Review it again.');
  return ventureAction(deps, ctx, 'approve', 'packs.add', tx => {
    const current = packsOf(tx.state, tx.venture!.id);
    check(!current.some(row => row.packId === valid.doc.id), 'PACK_EXISTS', 'A pack with this id is already added. Remove it first to add another version.');
    const taken = new Set(current.flatMap(row => row.doc.calculators.map(calc => packOperation(row.packId, calc.id))));
    check(valid.doc.calculators.every(calc => !taken.has(packOperation(valid.doc.id, calc.id))), 'PACK_EXISTS', 'A calculator name in this pack clashes with one already added.');
    tx.put({ ...tx.base('venture-pack'), packId: valid.doc.id, doc: valid.doc, digest: valid.digest, addedBy: tx.ctx.memberId });
    recordDecision(tx, { subject: `pack:${valid.doc.id}:${valid.digest}`, action: 'approve', ruleId: null, reason: 'Added this exact pack. Its server references are not added.', rowId: null });
    tx.emit('queue.changed', {});
    return { added: true, digest: valid.digest, pack: valid.view };
  });
}

/** venture.packs.remove { packId } (approve, inside the app). Receipts its calculators made are kept. */
export async function removePack(deps: VentureDeps, ctx: Context, raw: unknown): Promise<{ removed: boolean }> {
  requireAppChannel(ctx, 'venture.packs.remove');
  const body = exactPayload(raw, ['packId'], ['packId']);
  check(typeof body.packId === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(body.packId), BAD, 'Choose an added pack.');
  return ventureAction(deps, ctx, 'approve', 'packs.remove', tx => {
    const found = tx.list('venture-pack').find(row => row.packId === body.packId);
    check(found, 'PACK_NOT_FOUND', 'This pack is not added.');
    removeRecords(tx, row => row.id === found.id);
    recordDecision(tx, { subject: `pack:${found.packId}:${found.digest}`, action: 'approve', ruleId: null, reason: 'Removed this pack.', rowId: null });
    tx.emit('queue.changed', {});
    return { removed: true };
  });
}

/**
 * Read a pack folder: pack.json, skills/<id>.md (title from the first heading) and calculators/<id>.wasm for each
 * calculator pack.json names. Any other file or folder, and any link, is refused before anything is read as code.
 */
export async function loadPackFolder(dir: string): Promise<unknown> {
  const top = await readdir(dir, { withFileTypes: true });
  for (const entry of top) {
    const inside = join(dir, entry.name);
    check(!(await lstat(inside)).isSymbolicLink(), 'PACK_PATH_REFUSED', 'Packs cannot contain links to other places.');
    if (entry.isFile() && entry.name === 'pack.json') continue;
    if (entry.isDirectory() && (entry.name === 'skills' || entry.name === 'calculators')) {
      for (const child of await readdir(inside, { withFileTypes: true })) {
        check(!(await lstat(join(inside, child.name))).isSymbolicLink(), 'PACK_PATH_REFUSED', 'Packs cannot contain links to other places.');
        const allowed = child.isFile() && (entry.name === 'skills' ? /^[a-z][a-z0-9-]{0,39}\.md$/ : /^[a-z][a-z0-9-]{0,39}\.wasm$/).test(child.name);
        check(allowed, 'PACK_CODE_REFUSED', `Packs hold only skills, server references and calculators. Remove ${entry.name}/${child.name.slice(0, 60)}.`);
      }
      continue;
    }
    throw new ChausarError('PACK_CODE_REFUSED', `Packs hold only pack.json, skills and calculators. Remove ${entry.name.slice(0, 60)}.`);
  }
  const meta = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8')) as Record<string, unknown>;
  check(meta && typeof meta === 'object' && !Array.isArray(meta), 'PACK_INVALID', 'pack.json must describe the pack.');
  const skillFiles = top.some(entry => entry.name === 'skills') ? (await readdir(join(dir, 'skills'))).sort() : [];
  const skills = await Promise.all(skillFiles.map(async file => {
    const markdown = await readFile(join(dir, 'skills', file), 'utf8');
    const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? file.replace(/\.md$/, '');
    return { id: file.replace(/\.md$/, ''), title, markdown };
  }));
  const specs = Array.isArray(meta.calculators) ? meta.calculators as Record<string, unknown>[] : [];
  const calculators = await Promise.all(specs.map(async spec => {
    check(spec && typeof spec.id === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(spec.id), 'PACK_INVALID', 'Give each calculator a short id in lower case.');
    const bytes = await readFile(join(dir, 'calculators', `${spec.id}.wasm`)).catch(() => { throw new ChausarError('PACK_INVALID', `calculators/${spec.id}.wasm is missing.`); });
    return { ...spec, wasmBase64: bytes.toString('base64') };
  }));
  return { format: PACK_FORMAT, ...meta, skills, mcpServers: Array.isArray(meta.mcpServers) ? meta.mcpServers : [], calculators };
}

/** Run one calculator in an isolated child: Node's permission model, no file access but its own worker, a deadline. */
export async function runPackCalculator(calc: PackCalculator, inputs: Record<string, unknown>): Promise<string> {
  check(inputs && typeof inputs === 'object' && Object.keys(inputs).length === calc.inputs.length && calc.inputs.every(input => typeof inputs[input.name] === 'string' && /^-?(0|[1-9][0-9]{0,18})$/.test(inputs[input.name] as string)
    && BigInt(inputs[input.name] as string) <= 9223372036854775807n && BigInt(inputs[input.name] as string) >= -9223372036854775808n), BAD, 'Give every input as a whole number in text, like "125000". Money is in paise.');
  const args = calc.inputs.map(input => inputs[input.name] as string);
  const worker = fileURLToPath(new URL('./pack-worker.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${worker}`, '--max-old-space-size=32', worker], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } });
    let output = '', done = false;
    const fail = () => new ChausarError('PACK_CALCULATOR_FAILED', `The ${calc.name} calculator did not give an answer. Check its inputs; no figure was made.`);
    const finish = (error: Error | null, value?: string) => { if (done) return; done = true; clearTimeout(timer); if (error) { child.kill(); reject(error); } else resolve(value!); };
    const timer = setTimeout(() => finish(fail()), calc.timeoutMs + 1000);
    child.on('error', () => finish(fail()));
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 200) finish(fail()); });
    child.stderr.on('data', () => undefined);
    child.on('close', code => {
      if (done) return;
      try { const parsed = JSON.parse(output); check(code === 0 && typeof parsed.result === 'string' && /^-?\d{1,19}$/.test(parsed.result), 'PACK_CALCULATOR_FAILED', 'x'); finish(null, parsed.result); }
      catch { finish(fail()); }
    });
    child.stdin.on('error', () => finish(fail()));
    child.stdin.end(JSON.stringify({ moduleBase64: calc.wasmBase64, args, maxMemoryPages: calc.maxMemoryPages }));
  });
}

/** Pack calculators every job of this business can call, by their job names. */
export function packCalculations(state: State, ventureId: string): JobCalculation[] {
  return packsOf(state, ventureId).flatMap(row => row.doc.calculators.map(calc => ({
    name: packOperation(row.packId, calc.id),
    description: `${calc.name}, from the ${row.doc.name} pack: ${calc.about} Inputs: ${calc.inputs.map(input => `${input.name} (${input.label}, ${input.unit === 'money' ? 'minor units such as paise' : input.unit === 'bps' ? 'basis points' : 'a count'})`).join(', ')}. Whole numbers as text.`,
    inputSchema: { type: 'object', additionalProperties: false, required: calc.inputs.map(input => input.name),
      properties: Object.fromEntries(calc.inputs.map(input => [input.name, { type: 'string', pattern: '^-?(0|[1-9][0-9]{0,18})$', description: input.label }])) },
  })));
}
/** Skills of the business's packs, for the AI tool to read as owner-installed guidance. */
export function packSkills(state: State, ventureId: string): { id: string; title: string; markdown: string; source: 'owner-added pack' }[] {
  return packsOf(state, ventureId).flatMap(row => row.doc.skills.map(skill => ({ id: `${row.packId}/${skill.id}`, title: skill.title, markdown: skill.markdown, source: 'owner-added pack' as const })));
}
export const isPackOperation = (operation: string) => operation.startsWith('pack_');

function display(minor: string, unit: PackCalculator['output']['unit'], currency: string, country: string | null | undefined): { display: string; unit: 'money' | 'count' | 'percent' } {
  const value = BigInt(minor);
  if (unit === 'money') return { display: money(value, currency), unit: 'money' };
  if (unit === 'bps') { const sign = value < 0n ? '-' : '', abs = value < 0n ? -value : value; return { display: `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}%`, unit: 'percent' }; }
  return { display: formatCount(value, country ?? 'IN'), unit: 'count' };
}

/**
 * One pack calculation inside a job: run sandboxed outside the transaction, then recheck the job and the pack and
 * store a work receipt. Only the answer is a citable figure; the inputs are recorded as given.
 */
export async function calculatePack(deps: VentureDeps, ctx: Context, run: DeliveryRunRecord, currency: string, operation: string, args: Record<string, unknown>,
  guard: (state: State) => unknown): Promise<{ result: unknown; receipts: WorkReceiptRecord[] }> {
  const found = packsOf(deps.store.read(), run.ventureId).flatMap(row => row.doc.calculators.map(calc => ({ row, calc }))).find(item => packOperation(item.row.packId, item.calc.id) === operation);
  check(found, 'UNKNOWN_CALCULATION', 'This pack calculator is not added to this business.');
  const { row, calc } = found;
  const minor = await runPackCalculator(calc, args);
  return ventureAction(deps, ctx, 'prepare', 'agent.job.packCalculate', tx => {
    guard(tx.state);
    check(tx.list('venture-pack').some(item => item.id === row.id && item.digest === row.digest), 'PACK_NOT_FOUND', 'This pack changed or was removed. Calculate again.');
    const shown = display(minor, calc.output.unit, currency, tx.venture?.country?.code);
    const given = calc.inputs.map(input => `${input.label} ${args[input.name]}`).join(', ');
    const body = { operation: 'pack.calc' as const, runRef: { kind: 'delivery' as const, runId: run.id }, currency,
      inputs: { tables: [{ id: `pack:${row.packId}:${calc.id}`, name: `${row.doc.name}: ${calc.name}`, digest: calc.moduleDigest }],
        columns: { pack: row.packId, version: row.doc.version, calculator: calc.id, ...Object.fromEntries(calc.inputs.map(input => [`input.${input.name}`, String(args[input.name])])) }, rowIds: [] },
      steps: [], figures: [{ key: 'result', label: calc.output.label, minor, display: shown.display, currency, unit: shown.unit }], reconciliation: null, allowedNumbers: [shown.display],
      explanation: `Worked by code: the ${calc.name} calculator from the ${row.doc.name} pack, version ${row.doc.version}, module ${calc.moduleDigest.slice(0, 12)}. Inputs as given: ${given}. Answer: ${shown.display}.` };
    const receipt = tx.put<WorkReceiptRecord>({ ...tx.base('venture-work-receipt'), ...body, digest: digest(body) });
    return { result: { ok: true, result: { figure: shown.display } }, receipts: [receipt] };
  });
}
