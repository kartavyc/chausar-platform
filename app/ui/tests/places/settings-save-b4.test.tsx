import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createFakeClient, FakeEngine } from '../../src/engine/fake';
import { useSettingsSave } from '../../src/places/connections/useSettingsSave';

it('a slow settings save does not block a different client and failure releases this client', async () => {
  const client = createFakeClient(new FakeEngine({ latencyMs: 0 }));
  const first = renderHook(() => useSettingsSave(client, 'venture_lumen'));
  const same = renderHook(() => useSettingsSave(client, 'venture_lumen'));
  const other = renderHook(() => useSettingsSave(createFakeClient(new FakeEngine({ latencyMs: 0 })), 'venture_lumen'));
  let reject!: (error: Error) => void;
  const gate = new Promise<void>((_, fail) => { reject = fail; });
  const second = vi.fn(async () => 'saved');
  let entered = false;
  const held = first.result.current(async () => { entered = true; return gate; });
  await waitFor(() => expect(entered).toBe(true));
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
  const first = renderHook(() => useSettingsSave(client, 'venture_lumen'));
  const second = renderHook(() => useSettingsSave(client, 'venture_lumen'));
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  let entered = false;
  const held = first.result.current(async () => { entered = true; return gate; });
  await waitFor(() => expect(entered).toBe(true));
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
  const first = renderHook(() => useSettingsSave(client, 'venture_lumen'));
  const second = renderHook(() => useSettingsSave(client, 'venture_lumen'));
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  let entered = false;
  const held = first.result.current(async () => { entered = true; return gate; });
  await waitFor(() => expect(entered).toBe(true));
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
  const first = renderHook(() => useSettingsSave(client, 'venture_lumen'));
  const second = renderHook(({ active }) => useSettingsSave(active, 'venture_lumen'), { initialProps: { active: client } });
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  let entered = false;
  const held = first.result.current(async () => { entered = true; return gate; });
  await waitFor(() => expect(entered).toBe(true));
  const write = vi.fn(async () => 'should not write');
  const queued = second.result.current(write);
  const refused = expect(queued).rejects.toThrow(/Open these settings again/);
  second.rerender({ active: createFakeClient(new FakeEngine({ latencyMs: 0 })) });
  release();
  await held;
  await refused;
  expect(write).not.toHaveBeenCalled();
});


it('rechecks the business after a deferred read, immediately before the write', async () => {
  const client = createFakeClient(new FakeEngine({ latencyMs: 0 }));
  const hook = renderHook(() => useSettingsSave(client, 'venture_lumen'));
  let release!: () => void;
  const read = new Promise<void>(done => { release = done; });
  let entered = false;
  const write = vi.fn();
  const save = hook.result.current(async stillOpen => {
    entered = true;
    await read;
    await stillOpen();
    write();
  });
  const refused = expect(save).rejects.toThrow('business changed');
  await waitFor(() => expect(entered).toBe(true));
  await client.request('workspace.open', { folder: 'ledgerline' });
  release();
  await refused;
  expect(write).not.toHaveBeenCalled();
});
