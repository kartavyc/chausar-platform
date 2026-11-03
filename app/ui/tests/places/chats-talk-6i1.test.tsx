// Wave 6 package 6I1 (D45): push-to-talk beside the chat box, and reading an answer aloud. The notice comes before the
// microphone first turns on; the words land in the box unsent, as if typed; a spoken "yes" sends and approves nothing;
// the hosted tier says it is not available. No real microphone or speech service is used.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { FAKE_TALK_WORDS } from '../../src/engine/fake-talk';
import { PushToTalk } from '../../src/places/chats/PushToTalk';
import { ReadAloud } from '../../src/places/chats/ReadAloud';
import { captionWav } from '../../../../platform/runtime/venture/playbooks/translation-studio/caption-audio';

const microphone = vi.hoisted(() => ({
  stop: vi.fn(async () => null as string | null),
  start: vi.fn(async () => ({ stop: microphone.stop })),
}));
vi.mock('../../src/places/chats/talk-microphone', () => ({ startTalkMicrophone: microphone.start }));

const NOW = '2026-11-01T10:00:00.000Z';

function mount(node: React.ReactElement, hosted = false) {
  const client = createFakeClient(new FakeEngine({ now: () => NOW, hosted }));
  const request = vi.spyOn(client, 'request');
  render(<TextProvider language="en"><EngineProvider client={client}>{node}</EngineProvider></TextProvider>);
  return { client, request };
}

describe('push-to-talk (6I1)', () => {
  it('the notice comes first; after agreeing, holding records once and the words land in the box unsent', async () => {
    microphone.stop.mockResolvedValue(captionWav(new Float32Array(16000).fill(0.1)));
    const heard = vi.fn();
    const { client, request } = mount(<PushToTalk onHeard={heard} />);
    await client.request('venture.transcription.set', { command: 'C:\\whisper\\whisper-cli.exe', model: 'C:\\whisper\\ggml-base.bin' });
    const hold = await screen.findByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(hold);
    const notice = await screen.findByRole('region', { name: 'Before the microphone turns on' });
    expect(notice.textContent).toMatch(/Saying yes never approves anything/);
    expect(microphone.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep my recordings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agree' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Before the microphone turns on' })).toBeNull());
    expect(request).toHaveBeenCalledWith('venture.talk.consent', expect.objectContaining({ keepAudio: true }));
    fireEvent.pointerDown(hold);
    await waitFor(() => expect(microphone.start).toHaveBeenCalledTimes(1));
    fireEvent.pointerUp(hold);
    await waitFor(() => expect(heard).toHaveBeenCalledWith(FAKE_TALK_WORDS));
    expect(request.mock.calls.map(([method]) => method)).not.toContain('venture.chief.thread.send');
    expect(request.mock.calls.filter(([method]) => String(method).includes('approve') || String(method).includes('decide'))).toEqual([]);
    expect(await screen.findByText('Check the words, then send. Saying yes never approves anything; you tap the card.')).toBeTruthy();
  });

  it('a release before the session opens is never lost: the microphone does not stay on', async () => {
    microphone.start.mockClear();
    const client = createFakeClient(new FakeEngine({ now: () => NOW }));
    await client.request('venture.transcription.set', { command: 'C:\\whisper\\whisper-cli.exe', model: 'C:\\whisper\\ggml-base.bin' });
    await client.request('venture.talk.consent', { digest: (await client.request('venture.talk.get', {})).consent.digest, keepAudio: false });
    const request = vi.spyOn(client, 'request');
    render(<TextProvider language="en"><EngineProvider client={client}><PushToTalk onHeard={() => undefined} /></EngineProvider></TextProvider>);
    const hold = await screen.findByRole('button', { name: 'Hold to talk' });
    await waitFor(() => expect(hold.getAttribute('disabled')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    fireEvent.pointerDown(hold);
    fireEvent.pointerUp(hold);
    fireEvent.keyDown(hold, { key: ' ' });
    await waitFor(() => expect(request.mock.calls.filter(([method]) => method === 'venture.talk.start').length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(request.mock.calls.filter(([method]) => method === 'venture.talk.start')).toHaveLength(1);
    expect(microphone.start).not.toHaveBeenCalled();
    expect(request.mock.calls.map(([method]) => method)).not.toContain('venture.talk.hear');
  });

  it('the hosted tier says push-to-talk is not available and never opens the microphone', async () => {
    microphone.start.mockClear();
    mount(<PushToTalk onHeard={() => undefined} />, true);
    const hold = await screen.findByRole('button', { name: 'Hold to talk' });
    await waitFor(() => expect(hold.getAttribute('aria-disabled')).toBe('true'));
    fireEvent.pointerDown(hold);
    expect(await screen.findByText('Push-to-talk works only in the desktop app.')).toBeTruthy();
    expect(microphone.start).not.toHaveBeenCalled();
  });

  it('read aloud says to read on screen without a speech key, from the engine\'s checked words', async () => {
    const client = createFakeClient(new FakeEngine({ now: () => NOW }));
    const sent = await client.request('venture.chief.thread.send', { text: 'What did I invoice this month?' });
    const chief = sent.added.find((message) => message.from === 'chief')!;
    render(<TextProvider language="en"><EngineProvider client={client}><ReadAloud threadId={sent.thread.id} messageId={chief.id} /></EngineProvider></TextProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Read aloud' }));
    expect(await screen.findByText(/Reading aloud needs your Google Cloud key/)).toBeTruthy();
  });
});
