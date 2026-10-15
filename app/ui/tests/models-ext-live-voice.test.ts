import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_CONNECT_ENDPOINT, startLiveVoice } from '../src/screens/voice/live-client.ts';
import type { LiveDataChannel, LivePeer, LiveStream, LiveVoiceEnd, LiveVoiceGrant } from '../src/screens/voice/live-client.ts';

// Fakes only: no network, no microphone, no real clock.
const start = Date.parse('2031-02-03T04:05:06.000Z');
const grant = (capMs = 120000): LiveVoiceGrant => ({ clientSecret: 'ek_test_secret_1234', expiresAt: new Date(start + 60000).toISOString(), connectEndpoint: LIVE_CONNECT_ENDPOINT, model: 'gpt-4o-transcribe', capMs, endsAt: new Date(start + capMs).toISOString() });

function fakes() {
  const log: string[] = []; let listener: ((event: { data: unknown }) => void) | null = null;
  const track = { stop: () => log.push('track.stop') };
  const stream: LiveStream = { getTracks: () => [track] };
  const channel: LiveDataChannel = { addEventListener: (_type, l) => { listener = l; }, close: () => log.push('channel.close') };
  const peer: LivePeer = {
    addTrack: () => log.push('addTrack'), createDataChannel: label => { log.push(`channel:${label}`); return channel; },
    createOffer: async () => ({ sdp: 'v=0 offer' }), setLocalDescription: async () => { log.push('local'); },
    setRemoteDescription: async d => { log.push(`remote:${d.type}:${d.sdp}`); }, close: () => log.push('peer.close'),
  };
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const posts: { url: string; init: any }[] = [];
  return {
    log, timers, posts, emit: (data: unknown) => listener?.({ data }),
    options: {
      now: () => start, createPeer: () => peer, getUserMedia: async () => stream,
      setTimer: (run: () => void, ms: number) => { const t = { run, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; },
      post: async (url: string, init: any) => { posts.push({ url, init }); return { ok: true, status: 201, text: async () => 'v=0 answer' }; },
    },
  };
}

test('live client: documented WebRTC handshake, input transcripts only, hangs up itself at endsAt', async () => {
  const f = fakes(); const heard: [string, boolean][] = []; const ends: LiveVoiceEnd[] = [];
  const call = startLiveVoice({ live: grant(), onTranscript: (t, final) => heard.push([t, final]), onEnd: e => ends.push(e), ...f.options });
  assert.equal(await call.connected, true);
  assert.equal(f.timers.length, 1); assert.equal(f.timers[0]!.ms, 120000);
  assert.deepEqual(f.posts.map(p => [p.url, p.init.method, p.init.body, p.init.headers.Authorization, p.init.headers['Content-Type'], p.init.redirect]),
    [[LIVE_CONNECT_ENDPOINT, 'POST', 'v=0 offer', 'Bearer ek_test_secret_1234', 'application/sdp', 'error']]);
  assert.deepEqual(f.log, ['addTrack', 'channel:oai-events', 'local', 'remote:answer:v=0 answer']);
  f.emit(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'do lakh ' }));
  f.emit(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'MODEL WORDS 999' }));
  f.emit('not json'); f.emit(42);
  f.emit(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'do lakh ka payment nahi aaya' }));
  assert.deepEqual(heard, [['do lakh ', false], ['do lakh ka payment nahi aaya', true]]);
  // The cap timer fires: the client hangs up by itself, once, and hands the transcript to the host.
  f.timers[0]!.run(); f.timers[0]!.run(); call.stop();
  assert.deepEqual(ends, [{ reason: 'cap', transcript: 'do lakh ka payment nahi aaya' }]);
  assert.deepEqual(f.log.slice(-3), ['track.stop', 'channel.close', 'peer.close']);
  f.emit(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'late' })); assert.equal(heard.length, 2);
});

test('live client: stop hangs up and cancels the cap timer; a past endsAt never connects', async () => {
  const f = fakes(); const ends: LiveVoiceEnd[] = [];
  const call = startLiveVoice({ live: grant(), onTranscript: () => undefined, onEnd: e => ends.push(e), ...f.options });
  await call.connected; call.stop();
  assert.deepEqual(ends, [{ reason: 'stopped', transcript: '' }]); assert.equal(f.timers[0]!.cancelled, true);

  const late = fakes(); const lateEnds: LiveVoiceEnd[] = [];
  const expired = startLiveVoice({ live: grant(1000), onTranscript: () => undefined, onEnd: e => lateEnds.push(e), ...late.options, now: () => start + 1000 });
  assert.equal(await expired.connected, false); assert.deepEqual(lateEnds, [{ reason: 'cap', transcript: '' }]); assert.equal(late.posts.length, 0); assert.equal(late.log.length, 0);
});

test('live client: the cap during connecting stops the call before any offer is sent; bad grants and failed connects end once', async () => {
  const f = fakes(); const ends: LiveVoiceEnd[] = [];
  let release!: (s: LiveStream) => void;
  const call = startLiveVoice({ live: grant(), onTranscript: () => undefined, onEnd: e => ends.push(e), ...f.options, getUserMedia: () => new Promise<LiveStream>(r => { release = r; }) });
  f.timers[0]!.run(); release({ getTracks: () => [{ stop: () => f.log.push('late.stop') }] });
  assert.equal(await call.connected, false); assert.deepEqual(ends.map(e => e.reason), ['cap']); assert.equal(f.posts.length, 0); assert.deepEqual(f.log, ['late.stop']);

  for (const live of [{ ...grant(), connectEndpoint: 'https://evil.example/v1/realtime/calls' }, { ...grant(), clientSecret: 'x' }]) {
    const g = fakes(); const out: LiveVoiceEnd[] = [];
    assert.equal(await startLiveVoice({ live, onTranscript: () => undefined, onEnd: e => out.push(e), ...g.options }).connected, false);
    assert.deepEqual(out, [{ reason: 'failed', transcript: '', code: 'LIVE_VOICE_INVALID_GRANT' }]); assert.equal(g.posts.length, 0);
  }
  const h = fakes(); const out: LiveVoiceEnd[] = [];
  const failing = startLiveVoice({ live: grant(), onTranscript: () => undefined, onEnd: e => out.push(e), ...h.options, post: async () => ({ ok: false, status: 401, text: async () => '' }) });
  assert.equal(await failing.connected, false); assert.deepEqual(out, [{ reason: 'failed', transcript: '', code: 'LIVE_VOICE_CONNECT_FAILED' }]);
  assert.equal(h.timers[0]!.cancelled, true); assert.ok(h.log.includes('peer.close'));
});
