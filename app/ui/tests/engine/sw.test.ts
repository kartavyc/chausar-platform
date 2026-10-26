// The service worker's words (public/sw.js, 4G3's; Hindi by 4G4): a count only, in the browser's language. The engine's
// own tests (platform/tests/venture-webpush.test.ts) hold the English, the tag, the tap and the storage rules.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

function worker(languages?: string[]) {
  const source = readFileSync(join(import.meta.dirname, '../../public/sw.js'), 'utf8');
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: { body: string } }[] = [];
  const self = {
    addEventListener: (name: string, listener: (event: unknown) => void) => { listeners.set(name, listener); },
    registration: { scope: 'https://app.example.com/app/', showNotification: async (title: string, options: { body: string }) => { shown.push({ title, options }); } },
    clients: { matchAll: async () => [], openWindow: async () => null, claim: async () => {} },
    skipWaiting: async () => {},
    ...(languages ? { navigator: { languages, language: languages[0] } } : {}),
  };
  vm.runInNewContext(source, { self, URL, console: { error() {} } });
  const push = async (data: unknown) => {
    const waits: Promise<unknown>[] = [];
    listeners.get('push')!({ data, waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    await Promise.all(waits);
  };
  return { shown, push };
}
const count = (n: number) => ({ json: () => ({ count: n }) });

describe('the service worker says only the count, in the browser\'s language', () => {
  it('in Hindi when the browser prefers Hindi', async () => {
    const sw = worker(['hi-IN', 'en-IN']);
    await sw.push(count(3));
    await sw.push(count(1));
    await sw.push(null);
    expect(sw.shown.map((n) => n.title)).toEqual(['Chausar', 'Chausar', 'Chausar']);
    expect(sw.shown.map((n) => n.options.body)).toEqual(['3 चीज़ों में आपकी ज़रूरत है', '1 चीज़ में आपकी ज़रूरत है', 'Chausar में किसी चीज़ में आपकी ज़रूरत है।']);
  });

  it('in English otherwise, and with no language known', async () => {
    for (const sw of [worker(['en-IN']), worker()]) {
      await sw.push(count(3));
      expect(sw.shown[0]!.options.body).toBe('3 need you');
    }
  });
});
