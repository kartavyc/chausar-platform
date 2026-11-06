import { expect, it } from 'vitest';
import { createScriptedClient } from '../../src/engine/scripted';
import type { RpcRecording } from '../../../../platform/shared/rpc-recording';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const epoch = '2026-11-06T12:00:00.000Z';
const recording = (): RpcRecording => ({
  format: 'chausar-rpc-recording/1', scenario: 'scripted-client-unit', epoch, placeholders: {},
  frames: [
    { kind: 'request', id: 1, method: 'venture.countries', payload: {} },
    { kind: 'event', event: { type: 'queue.changed', businessId: 'sample', seq: 1, at: epoch } },
    { kind: 'answer', id: 1, result: [{ code: 'IN', name: 'India' }] },
    { kind: 'request', id: 2, method: 'app.preferences.get', payload: {} },
    { kind: 'answer', id: 2, result: { motion: 'off', language: 'en' } },
  ],
});

it('keeps request order and replays events before the corresponding answer', async () => {
  const client = createScriptedClient(recording());
  const seen: string[] = [];
  const stop = client.subscribe(event => seen.push(event.type));
  const countries = await client.request('venture.countries', {});
  seen.push('answered');
  expect(seen).toEqual(['queue.changed', 'answered']);
  expect(countries).toEqual([{ code: 'IN', name: 'India' }]);
  expect(await client.request('app.preferences.get', {})).toEqual({ motion: 'off', language: 'en' });
  expect(() => client.assertComplete()).not.toThrow();
  stop();
});

it('fails an unexpected request with expected and received payloads and never consumes the expected frame', async () => {
  const client = createScriptedClient(recording());
  await expect(client.request('venture.countries', { wrong: true } as never)).rejects.toThrow(/Expected venture.countries \{\}[\s\S]*Received venture.countries \{"wrong":true\}/);
  expect(() => client.assertComplete()).toThrow(/Unexpected scripted requests/);
  expect(await client.request('venture.countries', {})).toHaveLength(1);
});

it('hydrates valid identifiers and dates and requires the same identity on a later action', async () => {
  const source: RpcRecording = {
    format: 'chausar-rpc-recording/1', scenario: 'identity', epoch,
    placeholders: { '<id-1>': { kind: 'id', prefix: 'client_' }, '<time-1>': { kind: 'time', offsetMs: 0 }, '<digest-1>': { kind: 'digest' } },
    frames: [
      { kind: 'request', id: 1, method: 'venture.clients.list', payload: {} },
      { kind: 'answer', id: 1, result: { clients: [{ id: '<id-1>', createdAt: '<time-1>', disclosureDigest: '<digest-1>' }] } },
      { kind: 'request', id: 2, method: 'venture.client.aiConsent.agree', payload: { clientId: '<id-1>', disclosureDigest: '<digest-1>' } },
      { kind: 'answer', id: 2, result: { allowed: true } },
    ],
  };
  const client = createScriptedClient(source);
  const reply = await client.request('venture.clients.list', {}) as unknown as { clients: { id: string; createdAt: string; disclosureDigest: string }[] };
  const first = reply.clients[0]!;
  expect(new Date(first.createdAt).toISOString()).toBe(epoch);
  expect(first.id).toMatch(/^client_[a-f0-9-]{36}$/);
  expect(first.disclosureDigest).toMatch(/^[a-f0-9]{64}$/);
  await expect(client.request('venture.client.aiConsent.agree', { clientId: 'wrong', disclosureDigest: first.disclosureDigest } as never)).rejects.toThrow(/Received/);
  await client.request('venture.client.aiConsent.agree', { clientId: first.id, disclosureDigest: first.disclosureDigest } as never);
  expect(() => client.assertComplete()).toThrow(/Unexpected scripted requests/);
});

it('keeps concurrent requests and their recorded completion order', async () => {
  const source = recording();
  source.frames = [source.frames[0]!, source.frames[3]!, source.frames[4]!, source.frames[1]!, source.frames[2]!];
  const client = createScriptedClient(source);
  const order: string[] = [];
  const first = client.request('venture.countries', {}).then(() => order.push('countries'));
  const second = client.request('app.preferences.get', {}).then(() => order.push('preferences'));
  await Promise.all([first, second]);
  expect(order).toEqual(['preferences', 'countries']);
  client.assertComplete();
});

it('neither the scripted client nor its recording protocol has an app caller', () => {
  const root = join(import.meta.dirname, '../../src');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const file = join(dir, name); return statSync(file).isDirectory() ? walk(file) : [file]; });
  const callers = walk(root).filter(file => /\.tsx?$/.test(file) && !file.endsWith('scripted.ts')).filter(file => /(?:from\s*|import\s*\()\s*['"][^'"]*(?:\/scripted|\/rpc-recording)(?:\.ts)?['"]/.test(readFileSync(file, 'utf8')));
  expect(callers.map(file => relative(root, file))).toEqual([]);
});
