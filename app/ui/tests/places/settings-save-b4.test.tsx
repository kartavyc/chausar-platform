import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createFakeClient, FakeEngine } from '../../src/engine/fake';
import { useSettingsSave } from '../../src/places/connections/useSettingsSave';

it('a slow settings save does not block a different client and failure releases this client', async () => {
  const client = createFakeClient(new FakeEngine({ latencyMs: 0 }));
  const first = renderHook(() => useSettingsSave(client));
  const same = renderHook(() => useSettingsSave(client));
  const other = renderHook(() => useSettingsSave(createFakeClient(new FakeEngine({ latencyMs: 0 }))));
  let reject!: (error: Error) => void;
  const gate = new Promise<void>((_, fail) => { reject = fail; });
  const second = vi.fn(async () => 'saved');
  const held = first.result.current(async () => gate);
  const failure = expect(held).rejects.toThrow('Refused');
  const queued = same.result.current(second);
  expect(await other.result.current(async () => 'other saved')).toBe('other saved');
  expect(second).not.toHaveBeenCalled();
  reject(new Error('Refused'));
  await failure;
  expect(await queued).toBe('saved');
});

it('a queued save from a closed page never starts in a later business', async () => {
  const client = createFakeClient(new FakeEngine({ latencyMs: 0 }));
  const first = renderHook(() => useSettingsSave(client));
  const second = renderHook(() => useSettingsSave(client));
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const held = first.result.current(async () => gate);
  const work = vi.fn(async () => 'should not write');
  const queued = second.result.current(work);
  const refused = expect(queued).rejects.toThrow('Open these settings again');
  second.unmount();
  await act(async () => { release(); });
  await held;
  await refused;
  expect(work).not.toHaveBeenCalled();
});


it('a queued save refuses a different business on the same mounted client', async () => {
  const engine = new FakeEngine({ latencyMs: 0 });
  const client = createFakeClient(engine);
  const first = renderHook(() => useSettingsSave(client));
  const second = renderHook(() => useSettingsSave(client));
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const held = first.result.current(async () => gate);
  const write = vi.fn(async () => 'should not write');
  const queued = second.result.current(write);
  const refused = expect(queued).rejects.toThrow(/business changed|Open these settings again/);
  await client.request('workspace.open', { folder: 'ledgerline' });
  release();
  await held;
  await refused;
  expect(write).not.toHaveBeenCalled();
});

it('changing the client without unmounting invalidates an already queued save', async () => {
  const client = createFakeClient(new FakeEngine({ latencyMs: 0 }));
  const first = renderHook(() => useSettingsSave(client));
  const second = renderHook(({ active }) => useSettingsSave(active), { initialProps: { active: client } });
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const held = first.result.current(async () => gate);
  const write = vi.fn(async () => 'should not write');
  const queued = second.result.current(write);
  const refused = expect(queued).rejects.toThrow(/Open these settings again/);
  second.rerender({ active: createFakeClient(new FakeEngine({ latencyMs: 0 })) });
  release();
  await held;
  await refused;
  expect(write).not.toHaveBeenCalled();
});
