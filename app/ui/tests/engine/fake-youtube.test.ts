// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import { describe, expect, it } from 'vitest';
import { fakeYoutubeDesk } from '../../src/engine/fake-youtube';
import type { W4DeskHost } from '../../src/engine/fake-w4';
const source = { label: 'words.json', durationMs: 10000, words: [{ id: 'w1', text: 'Coffee', startMs: 0, endMs: 3000 }] };
function setup(rights: unknown = { basis: 'own-footage', holder: 'Asha' }) {
  let business = 'b1';
  const files = [{ id: 'upload_source', at: '2026-10-27', name: 'source.srt', format: 'transcript', bytes: 12, scope: { kind: 'order', orderId: 'o1' } }];
  const host = { current: () => business, now: () => '2026-10-27T10:00:00Z', hosted: () => false, uploadFingerprint: (id: string) => id === 'upload_new' ? 'changed-bytes' : 'source-bytes', digest: (value: unknown) => JSON.stringify(value), emit: () => {}, ask: (method: string) => method === 'venture.files.list' ? files : method === 'venture.assets.list' ? { assets: [] } : [{ id: 'o1', status: 'open', intake: { rights } }] } as unknown as W4DeskHost;
  const kinds = fakeYoutubeDesk(host).kinds;
  const act = (id: string, action: string, payload: unknown, digest?: string) => kinds.edit!.act!({ playbook: 'youtube', kind: 'edit', id, action, payload, ...(digest ? { digest } : {}) }) as { id: string; result: any };
  return { kinds, act, files, switchBusiness: (id: string) => { business = id; } };
}
describe('YouTube fake parity', () => {
  it('refuses stale source captions and cross-order source bindings', () => {
    const { act, files } = setup();
    const made = act('new', 'create', { orderId: 'o1', source, sourceRef: { kind: 'transcript', orderId: 'o1' } });
    files.unshift({ ...files[0]!, id: 'upload_new', bytes: 15 });
    expect(() => act(made.id, 'captions', { profile: 'web' }, made.result.digest)).toThrowError(expect.objectContaining({ code: 'DERIVED_STALE' }));
    expect(() => act('new', 'create', { orderId: 'o1', source, sourceRef: { kind: 'transcript', orderId: 'other' } })).toThrowError(expect.objectContaining({ code: 'WORD_SOURCE_REQUIRED' }));
  });
  it('binds a large request to confirmation, refuses stale digests and undoes once', () => {
    const { act } = setup(); const created = act('new', 'create', { orderId: 'o1', source, sourceRef: { kind: 'transcript', orderId: 'o1' } });
    const pending = act(created.id, 'apply', { request: 'Cut the opening', ops: [{ kind: 'cut', from: 'w1', to: 'w1' }] }, created.result.digest);
    expect(pending.result.document.cuts).toHaveLength(0);
    expect(() => act(created.id, 'confirm', {}, created.result.digest)).toThrowError(expect.objectContaining({ code: 'EDIT_STALE' }));
    const done = act(created.id, 'confirm', {}, pending.result.digest);
    expect(done.result.last.summary).toBe('Cut 1 passage, 3 s shorter.');
    const undone = act(created.id, 'undo', {}, done.result.digest);
    expect(undone.result.document.cuts).toHaveLength(0);
    expect(() => act(created.id, 'undo', {}, undone.result.digest)).toThrowError(expect.objectContaining({ code: 'EDIT_NOTHING_TO_UNDO' }));
  });
  it('rejects incomplete licence rights and accepts the actual creator programme basis', () => {
    expect(() => setup({ basis: 'licence', holder: 'Asha' }).act('new', 'create', { orderId: 'o1', source, sourceRef: { kind: 'transcript', orderId: 'o1' } })).toThrowError(expect.objectContaining({ code: 'RIGHTS_REQUIRED' }));
    expect(() => setup({ basis: 'creator-clip-programme', holder: 'Asha', reference: 'Written programme' }).act('new', 'create', { orderId: 'o1', source, sourceRef: { kind: 'transcript', orderId: 'o1' } })).not.toThrow();
  });
  it('keeps business records apart and uses the same exact-field refusals', () => {
    const { act, switchBusiness, kinds } = setup(); const created = act('new', 'create', { orderId: 'o1', source, sourceRef: { kind: 'transcript', orderId: 'o1' } });
    expect(() => act(created.id, 'undo', { extra: true }, created.result.digest)).toThrowError(expect.objectContaining({ code: 'INVALID_VENTURE_REQUEST', message: 'Send the required fields and nothing else.' }));
    switchBusiness('b2'); expect((kinds.edit!.list!({ playbook: 'youtube', kind: 'edit' }) as { rows: unknown[] }).rows).toEqual([]);
    expect(() => act(created.id, 'undo', {}, created.result.digest)).toThrowError(expect.objectContaining({ code: 'EDIT_NOT_FOUND' }));
  });
});
