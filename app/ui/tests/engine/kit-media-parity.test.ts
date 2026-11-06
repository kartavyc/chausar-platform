// Chausar's own consent lifecycle, tested through the fake desk's public replies. No outside source code.
import { expect, it } from 'vitest';
import { FakeKitMediaDesk } from '../../src/engine/fake-kit-media';
import type { W4DeskHost } from '../../src/engine/fake-w4';
import type { AssetsView, VoiceConsentView } from '../../src/engine/types';

function fixture() {
  let now = '2026-10-27T10:00:00.000Z';
  const host = {
    current: () => 'business', now: () => now, rows: () => [], setRows: () => {}, emit: () => {}, digest: () => 'digest',
    ask: (method: string) => method === 'venture.client.list' ? [{ id: 'client', name: 'Owner' }]
      : method === 'venture.order.list' ? [{ id: 'order', clientId: 'client', at: now }, { id: 'other', clientId: 'client', at: '2026-10-01' }]
      : method === 'venture.files.list' ? [{ id: 'recording', format: 'audio' }] : { voices: [] },
  } as unknown as W4DeskHost;
  const desk = new FakeKitMediaDesk(host);
  const terms = { speaker: 'Asha', recordingFileId: 'recording', transcript: 'I agree.', statement: 'I agree to narration.', scope: 'Narration', until: '2026-10-27' };
  const recorded = desk.request('venture.voiceConsent.record', terms) as VoiceConsentView;
  // Seed an existing file made with this consent, as a persisted engine record would be restored.
  const state = desk as unknown as { books: Record<string, { assets: { consentId: string | null }[]; consents: unknown[] }> };
  state.books.business!.assets[0]!.consentId = recorded.consent.id;
  return { desk, terms, state, recorded, tomorrow: () => { now = '2026-10-28T10:00:00.000Z'; } };
}

it('fake assets read live consent expiry and missing records on list and reuse', () => {
  const f = fixture();
  f.tomorrow();
  const view = f.desk.request('venture.assets.list', {}) as AssetsView;
  const file = view.assets.find(asset => asset.name === 'thumbnail.png')!;
  expect(file.blocked?.code).toBe('CONSENT_REQUIRED');
  expect(() => f.desk.request('venture.assets.reuse', { id: file.id, orderId: 'other' })).toThrowError(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
  f.state.books.business!.consents = [];
  const missing = f.desk.request('venture.assets.list', {}) as AssetsView;
  expect(missing.assets.find(asset => asset.id === file.id)?.blocked?.code).toBe('CONSENT_WITHDRAWN');
});

it('fake consent renewal needs a fresh recording after withdrawal', () => {
  const f = fixture();
  f.desk.request('venture.voiceConsent.revoke', { id: f.recorded.consent.id });
  expect(() => f.desk.request('venture.voiceConsent.record', f.terms)).toThrowError(expect.objectContaining({ code: 'INVALID_VENTURE_REQUEST' }));
});
