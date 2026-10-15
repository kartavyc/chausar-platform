/**
 * Listening and speaking on this computer for the ask line (SH-05).
 *
 * - `browser-transcript`: the browser's own speech recognition turns the hold into words as they
 *   are heard; only the words leave this port.
 * - `record-audio`: the microphone records one hold; the bytes are handed once to `voice.stop`
 *   and the port forgets them. Nothing is written anywhere.
 * - Speaking uses the browser's speech synthesis, so no audio leaves this computer.
 *
 * A computer without these capabilities gets `null` ports, and the ask line says "not built yet".
 */
import type { VoiceCapturePort, VoiceSpeakerPort, VoiceTake } from './voice-controller.ts';

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Bytes to base64 without keeping a copy beyond the call. */
async function base64Of(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return url.slice(url.indexOf(',') + 1);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** A dropped voice note, read once into what `voice.dropNote` takes. The file itself is not kept. */
export async function readVoiceNote(file: File): Promise<{ audioBase64: string; mimeType: string; durationMs: number } | null> {
  if (!/^audio\/[a-z0-9.+-]{1,40}$/i.test(file.type) || file.size === 0 || file.size > 16 * 1024 * 1024) return null;
  const durationMs = await new Promise<number>(resolve => {
    if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') { resolve(0); return; }
    const url = URL.createObjectURL(file), audio = new Audio();
    const done = (ms: number) => { URL.revokeObjectURL(url); audio.removeAttribute('src'); resolve(ms); };
    const timer = setTimeout(() => done(0), 1500);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { clearTimeout(timer); done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0); };
    audio.onerror = () => { clearTimeout(timer); done(0); };
    audio.src = url;
  });
  return { audioBase64: await base64Of(file), mimeType: file.type, durationMs };
}

export function browserVoiceCapture(): VoiceCapturePort | null {
  const Rec = recognitionClass();
  const canRecord = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';
  if (Rec === null && !canRecord) return null;
  let active: { end(): Promise<VoiceTake | null>; cancel(): void } | null = null;
  return {
    begin(capture, language, onWords) {
      active?.cancel(); active = null;
      const startedAt = Date.now();
      if (capture === 'browser-transcript') {
        if (Rec === null) return false;
        const rec = new Rec();
        let words = '', ended: (() => void) | null = null, finished = false;
        rec.lang = language === 'hi' ? 'hi-IN' : 'en-IN'; rec.continuous = true; rec.interimResults = true;
        rec.onresult = event => {
          words = Array.from(event.results, r => r[0]?.transcript ?? '').join(' ').replace(/\s+/g, ' ').trim();
          onWords(words);
        };
        rec.onerror = () => { finished = true; ended?.(); };
        rec.onend = () => { finished = true; ended?.(); };
        try { rec.start(); } catch { return false; }
        active = {
          end: () => new Promise(resolve => {
            ended = () => resolve({ transcript: words, durationMs: Date.now() - startedAt });
            if (finished) ended(); else try { rec.stop(); } catch { ended(); }
          }),
          cancel: () => { try { rec.abort(); } catch { /* already ended */ } },
        };
        return true;
      }
      if (!canRecord) return false;
      const chunks: Blob[] = [];
      let recorder: MediaRecorder | null = null, stream: MediaStream | null = null, cancelled = false;
      const opening = navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
        stream = s;
        if (cancelled) { s.getTracks().forEach(track => track.stop()); return; }
        recorder = new MediaRecorder(s);
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.start();
      }, () => undefined);
      const release = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; };
      active = {
        end: async () => {
          await opening;
          const r = recorder;
          if (r === null) { release(); return null; }
          await new Promise<void>(resolve => { r.onstop = () => resolve(); try { r.stop(); } catch { resolve(); } });
          release();
          const blob = new Blob(chunks.splice(0), { type: r.mimeType || 'audio/webm' });
          return blob.size === 0 ? null : { audioBase64: await base64Of(blob), mimeType: blob.type, durationMs: Date.now() - startedAt };
        },
        cancel: () => { cancelled = true; try { (recorder as MediaRecorder | null)?.stop(); } catch { /* idle */ } chunks.splice(0); release(); },
      };
      return true;
    },
    async end() { const a = active; active = null; return a === null ? null : a.end(); },
    cancel() { active?.cancel(); active = null; },
  };
}

export function browserVoiceSpeaker(): VoiceSpeakerPort | null {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  if (synth === null || typeof SpeechSynthesisUtterance === 'undefined') return null;
  return {
    speak(texts, language, onEnd) {
      synth.cancel();
      const parts = texts.filter(t => t.trim().length > 0);
      if (parts.length === 0) return false;
      parts.forEach((text, i) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
        if (i === parts.length - 1) { u.onend = onEnd; u.onerror = onEnd; }
        synth.speak(u);
      });
      return true;
    },
    stop() { synth.cancel(); },
  };
}
