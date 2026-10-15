/**
 * Paid live voice in the renderer (SH-05, experimental): the WebRTC call to OpenAI Realtime that `voice.start {live}`
 * approved. The engine hands over a one-minute ephemeral secret and the session's `endsAt`; this client
 *  - opens the microphone, makes an SDP offer and POSTs it to `connectEndpoint` with `Authorization: Bearer <secret>`
 *    and `Content-Type: application/sdp`, then applies the answer SDP from the reply body;
 *  - reads the `oai-events` data channel and surfaces only the person's own words
 *    (`conversation.item.input_audio_transcription.delta` / `.completed`); the session is transcription-only;
 *  - hangs up by itself at `endsAt` (and on `stop()`), then calls `onEnd` so the host calls `voice.stop`.
 * Handshake as documented at https://developers.openai.com/api/docs/guides/realtime-webrtc and the server events at
 * https://developers.openai.com/api/reference/resources/realtime/server-events (read 2026-10-15).
 * Nothing is recorded or stored here; audio goes from the microphone to the provider only while the call is up.
 */

export const LIVE_CONNECT_ENDPOINT = 'https://api.openai.com/v1/realtime/calls';
const DELTA = 'conversation.item.input_audio_transcription.delta';
const COMPLETED = 'conversation.item.input_audio_transcription.completed';
const MAX_TRANSCRIPT = 10000;

/** The `live` part of the `voice.start` reply after the owner's approval. */
export interface LiveVoiceGrant {
  readonly clientSecret: string;
  readonly expiresAt: string;
  readonly connectEndpoint: string;
  readonly model: string;
  readonly capMs: number;
  readonly endsAt: string;
}
export type LiveVoiceEnd = { readonly reason: 'stopped' | 'cap' | 'failed'; readonly transcript: string; readonly code?: string };

/** The few WebRTC surfaces used here, so tests can pass fakes. */
export interface LiveTrack { stop(): void }
export interface LiveStream { getTracks(): readonly LiveTrack[] }
export interface LiveDataChannel { addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void; close(): void }
export interface LivePeer {
  addTrack(track: LiveTrack, stream: LiveStream): unknown;
  createDataChannel(label: string): LiveDataChannel;
  createOffer(): Promise<{ sdp?: string | undefined }>;
  setLocalDescription(description: { sdp?: string | undefined }): Promise<void>;
  setRemoteDescription(description: { type: 'answer'; sdp: string }): Promise<void>;
  close(): void;
}
type Post = (url: string, init: { method: 'POST'; body: string; headers: Record<string, string>; redirect: 'error' }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface StartLiveVoiceOptions {
  readonly live: LiveVoiceGrant;
  /** The words heard so far, in order; `final` marks a finished turn. */
  readonly onTranscript: (text: string, final: boolean) => void;
  /** Called once, after the call is down: the host then calls `voice.stop` with the transcript. */
  readonly onEnd: (end: LiveVoiceEnd) => void;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => () => void;
  readonly createPeer?: () => LivePeer;
  readonly getUserMedia?: (constraints: { audio: true }) => Promise<LiveStream>;
  readonly post?: Post;
}
export interface LiveVoiceCall { stop(): void; readonly connected: Promise<boolean> }

const defaultTimer = (run: () => void, ms: number) => { const id = setTimeout(run, ms); return () => clearTimeout(id); };

export function startLiveVoice(options: StartLiveVoiceOptions): LiveVoiceCall {
  const { live, onTranscript, onEnd } = options;
  const now = options.now ?? Date.now;
  const endsAt = Date.parse(live.endsAt);
  const finished: string[] = []; let partial = ''; let ended = false;
  let peer: LivePeer | null = null; let channel: LiveDataChannel | null = null; let stream: LiveStream | null = null;
  const transcript = () => [...finished, partial].filter(Boolean).join(' ').slice(0, MAX_TRANSCRIPT);

  let cancelTimer: () => void = () => undefined;
  const hangUp = (reason: LiveVoiceEnd['reason'], code?: string) => {
    if (ended) return; ended = true; cancelTimer();
    for (const track of stream?.getTracks() ?? []) track.stop();
    try { channel?.close(); } catch { /* already closed */ }
    try { peer?.close(); } catch { /* already closed */ }
    onEnd(code === undefined ? { reason, transcript: transcript() } : { reason, transcript: transcript(), code });
  };

  const valid = live.connectEndpoint === LIVE_CONNECT_ENDPOINT && /^[A-Za-z0-9_.-]{8,1024}$/.test(live.clientSecret) && Number.isFinite(endsAt);
  if (!valid) { hangUp('failed', 'LIVE_VOICE_INVALID_GRANT'); return { stop: () => undefined, connected: Promise.resolve(false) }; }
  const remaining = endsAt - now();
  if (remaining <= 0) { hangUp('cap'); return { stop: () => undefined, connected: Promise.resolve(false) }; }
  cancelTimer = (options.setTimer ?? defaultTimer)(() => hangUp('cap'), remaining);

  const read = (event: { data: unknown }) => {
    if (ended || typeof event.data !== 'string' || event.data.length > 65536) return;
    let message: unknown; try { message = JSON.parse(event.data); } catch { return; }
    if (typeof message !== 'object' || message === null) return;
    const { type, delta, transcript: text } = message as { type?: unknown; delta?: unknown; transcript?: unknown };
    if (type === DELTA && typeof delta === 'string') { partial = (partial + delta).slice(0, MAX_TRANSCRIPT); onTranscript(transcript(), false); }
    else if (type === COMPLETED && typeof text === 'string') { finished.push(text.trim()); partial = ''; onTranscript(transcript(), true); }
  };

  const connected = (async () => {
    try {
      const media = options.getUserMedia ?? ((constraints: { audio: true }) => navigator.mediaDevices.getUserMedia(constraints) as Promise<LiveStream>);
      stream = await media({ audio: true });
      if (ended) { for (const track of stream.getTracks()) track.stop(); return false; }
      peer = options.createPeer ? options.createPeer() : new RTCPeerConnection() as unknown as LivePeer;
      const track = stream.getTracks()[0]; if (!track) { hangUp('failed', 'MICROPHONE_UNAVAILABLE'); return false; }
      peer.addTrack(track, stream);
      channel = peer.createDataChannel('oai-events'); channel.addEventListener('message', read);
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      if (ended || typeof offer.sdp !== 'string') { if (!ended) hangUp('failed', 'LIVE_VOICE_OFFER_FAILED'); return false; }
      const post: Post = options.post ?? ((url, init) => fetch(url, init));
      const reply = await post(live.connectEndpoint, { method: 'POST', body: offer.sdp, redirect: 'error',
        headers: { Authorization: `Bearer ${live.clientSecret}`, 'Content-Type': 'application/sdp' } });
      if (ended) return false;
      if (!reply.ok) { hangUp('failed', 'LIVE_VOICE_CONNECT_FAILED'); return false; }
      const sdp = await reply.text(); if (ended) return false;
      await peer.setRemoteDescription({ type: 'answer', sdp });
      return !ended;
    } catch {
      hangUp('failed', 'LIVE_VOICE_CONNECT_FAILED'); return false;
    }
  })();
  return { stop: () => hangUp('stopped'), connected };
}
