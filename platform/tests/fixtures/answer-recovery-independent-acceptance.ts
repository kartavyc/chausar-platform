import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { Engine } from '../../runtime/engine.ts';
import { createLocalServer } from '../../runtime/server.ts';
import { harness } from './conversation-acceptance-renderer.ts';

// Actual pre-repair Engine encrypted authority and public originals. No authored
// State, deleted cutoff, live provider, native SQL, installed GUI or user vault.
export const legacy = JSON.parse(await readFile(new URL('./answer-recovery-independent-legacy.json', import.meta.url), 'utf8'));
export const INITIAL = legacy.knownOn as string;
export const CORRECTED = '2026-10-10T12:00:00.000Z';
export const CURRENT = '2026-10-11T12:00:00.000Z';
export const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };
export const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
export const scope = (overrides: Record<string, unknown> = {}) => ({ asOf: CURRENT, period: { ...SEPTEMBER }, comparePeriod: null, onDate: null, ...overrides });
export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(CURRENT) });
  // Match the Vault's canonical physical path even when Windows TEMP uses an alias.
  const base = await realpath(resolve(tmpdir())), directory = await mkdtemp(join(base, 'chausar-independent-recovery-'));
  const authorityPath = join(directory, 'main', 'authority.encrypted.json');
  await mkdir(join(directory, 'main'));
  const originalAuthority = Buffer.from(legacy.authorityBase64, 'base64');
  assert.equal(sha256(originalAuthority), legacy.originalAuthoritySha256);
  await writeFile(authorityPath, originalAuthority, { flag: 'wx' });
  const options = { directory, demo: true, storage: 'experimental-file' as const };
  let engine = new Engine(options), app = createLocalServer(engine), host = await app.listen(), bearer = host.token;
  const raw = async (method: string, payload: unknown = {}, authorization = bearer) => {
    const response = await fetch(`${host.origin}/api/rpc`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authorization}` },
      body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  };
  const http = async (method: string, payload: Record<string, unknown>) => {
    const value = await raw(method, payload);
    if (value.status !== 200) throw Object.assign(new Error(value.body.error.message), { code: value.body.error.code });
    return value.body.result;
  };
  t.after(async () => {
    await app.close(); const child = relative(base, resolve(directory));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith('chausar-independent-recovery-'));
    await rm(directory, { recursive: true, force: true });
  });
  await http('workspace.open', { passphrase: legacy.passphrase });
  const h = await harness({ mount: true, dispatch: http });
  const request = (method: string, payload: Record<string, unknown> = {}): Promise<any> => h.exposed.request(method, payload);
  const advance = (milliseconds = 1000) => t.mock.timers.setTime(Date.now() + milliseconds);
  let lastExportedTime = 0;
  const snapshot = async () => {
    // Genuine public owner-confirmed snapshot; no artifact/private State read.
    lastExportedTime = Math.max(Date.now(), lastExportedTime) + 1;
    t.mock.timers.setTime(lastExportedTime);
    const exported = await request('workspace.export', { confirmed: true, plaintext: true });
    assert.equal(exported.encrypted, false);
    return JSON.parse(await readFile(exported.path, 'utf8'));
  };
  const originals = (state: any) => Object.fromEntries(Object.entries(legacy.originals).map(([name, value]) => {
    const original = value as any;
    return [name, { answer: state.answers.find((answer: any) => answer.id === original.answer.id),
      receipt: state.receipts.find((receipt: any) => receipt.id === original.receipt.id) }];
  }));
  const before = await snapshot(); assert.deepEqual(originals(before), legacy.originals);
  const history = async () => {
    const answers = await request('trials.savedQuestions');
    return Object.fromEntries(Object.entries(legacy.originals).map(([name, value]) => [name, (value as any).answer.id])
      .map(([name, id]) => [name, answers.find((answer: any) => answer.id === id)])) as Record<string, any>;
  };
  const evidence = async () => {
    const answers = await request('trials.savedQuestions');
    return { ontology: await request('ontology.get'), facts: await request('memory.list'), sources: await request('sources.list'),
      answers, receipts: await Promise.all(answers.map((answer: any) => request('receipts.get', { id: answer.receiptId }))) };
  };
  const review = (name = 'billed') => request('answers.recovery.review', { answerId: legacy.originals[name].answer.id });
  const declaration = (reviewed: any, timeScope = scope()) => ({ answerId: reviewed.source.originalAnswerId,
    source: reviewed.source, reviewedEvidencePin: reviewed.reviewedEvidencePin, timeScope, confirmedNewCalculation: true });
  const prepare = async (name = 'billed', timeScope = scope()) => request('answers.recovery.prepare', declaration(await review(name), timeScope));
  const executePayload = (issued: any) => ({ newRequestId: issued.newRequestId, preparationDigest: issued.preparationDigest });
  const refusal = async (method: string, payload: Record<string, unknown>, codes: string[]) => {
    let code: string | undefined;
    await assert.rejects(request(method, payload), (error: any) => {
      code = error.code; return typeof error.message === 'string' && codes.includes(error.code);
    });
    return code;
  };
  const restart = async () => {
    await request('workspace.lock'); await app.close();
    engine = new Engine(options); app = createLocalServer(engine); host = await app.listen(); bearer = host.token;
    await request('workspace.open', { passphrase: legacy.passphrase });
  };
  const correct = async () => {
    t.mock.timers.setTime(Date.parse(CORRECTED));
    const facts = (await request('memory.list')).facts;
    const original = facts.find((fact: any) => fact.sourceId === legacy.sourceId && fact.entityId === 'A1');
    assert.ok(original); return request('memory.correct', { id: original.id, fields: { amountMinor: '40000', taxMinor: '4000' } });
  };
  const publishTax = async () => {
    t.mock.timers.setTime(Date.parse(CURRENT));
    const dictionary = (await request('ontology.get')).current;
    const draft = Object.fromEntries(['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'].map(key => [key, structuredClone(dictionary[key])]));
    const definition = draft.definitions.find((value: any) => value.name === 'billed');
    definition.field = 'taxMinor'; definition.meaning = 'Independent current dictionary: count explicitly reported invoice tax.';
    return request('ontology.publish', { draft });
  };
  return { h, directory, authorityPath, request, raw, snapshot, originals, history, evidence, review, declaration,
    prepare, executePayload, refusal, restart, correct, publishTax, advance,
    setBearer: (token: string) => { bearer = token; }, get engine() { return engine; } };
}
