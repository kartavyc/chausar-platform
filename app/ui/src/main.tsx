import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens/tokens.css';
import './tokens/fonts.css';
import './tokens/motion.css';
import './tokens/base.css';
import { App } from './shell/App';
import { createEngineClient } from './engine/client';
import { browserPush, startHostedPush } from './shell/push';
import { startCrashRelay } from './shell/crash-relay';
import { reportFirstPaint } from './shell/first-paint';
import { pickLanguage } from './text';
import type { EngineClient } from './engine/types';

async function engine(): Promise<EngineClient> {
  // Only `npm run dev:ui` (vite --mode fake) uses the fake engine; any other build leaves it out entirely.
  if (import.meta.env.MODE === 'fake') {
    const { FakeEngine, createFakeClient } = await import('./engine/fake');
    return createFakeClient(new FakeEngine({ latencyMs: 120 }));
  }
  return createEngineClient();
}

async function start() {
  const lang = pickLanguage();
  document.documentElement.lang = lang;
  const client = await engine();
  // The hosted app only (W4 4G4): the service worker for phone alerts, and this browser's subscription sent again so it
  // carries the session now signed in. It never asks the browser for permission; Business > Notifications does, on a press.
  void startHostedPush(client, browserPush());
  // W6 6J2: an uncaught error goes to the engine, which keeps it only while crash reports are on (Business > Reports).
  startCrashRelay(client);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App client={client} language={lang} />
    </StrictMode>,
  );
  // C5 task 26: the start-up timeline's last step on the desktop; nothing on the web.
  reportFirstPaint();
}

void start();
