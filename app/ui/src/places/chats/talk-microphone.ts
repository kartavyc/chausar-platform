// W6 6I1 (D45): the push-to-talk recorder. The operating system microphone opens only after the engine started a talk
// session (the desktop shell's permission handler checks it); mono 16 kHz PCM is gathered while the button is held, up
// to twenty seconds, and handed back once as a canonical WAV for the engine. Nothing is sent to a speech website from
// here, nothing is stored in the browser, and the tracks stop the moment the button is let go.
import { captionWav } from '../../../../../platform/runtime/venture/playbooks/translation-studio/caption-audio';
import { TALK_SECONDS } from '../../../../../platform/runtime/venture/agents/talk-core';

export type TalkMicrophone = { stop: () => Promise<string | null> };

/** Opens the microphone for one recording; stop() closes it and gives the WAV, or null when nothing was gathered. */
export async function startTalkMicrophone(): Promise<TalkMicrophone> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true }, video: false });
  const samples = new Float32Array(16000 * TALK_SECONDS);
  let used = 0;
  let stopped = false;
  let context: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  const close = async () => {
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    node?.disconnect();
    await context?.close().catch(() => undefined);
  };
  try {
    context = new AudioContext({ sampleRate: 16000 });
    if (context.sampleRate !== 16000) throw new Error('This device did not give the sample rate push-to-talk needs.');
    await context.audioWorklet.addModule(new URL('caption-worklet.js', document.baseURI).href);
    node = new AudioWorkletNode(context, 'chausar-caption-pcm');
    context.createMediaStreamSource(stream).connect(node);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (stopped || !(event.data instanceof Float32Array) || event.data.length > 2048) return;
      for (const sample of event.data) {
        // Twenty seconds gathered: the microphone itself turns off, even while the button is still held.
        if (used === samples.length) { stream.getTracks().forEach((track) => track.stop()); return; }
        samples[used++] = Number.isFinite(sample) ? sample : 0;
      }
    };
    await context.resume();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    async stop() {
      if (stopped) return null;
      await close();
      const wav = used > 0 ? captionWav(samples.slice(0, used)) : null;
      samples.fill(0);
      return wav;
    },
  };
}
