import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens/tokens.css';
import './tokens/fonts.css';
import './tokens/motion.css';
import './tokens/base.css';
import { App } from './shell/App';
import { createEngineClient } from './engine/client';
import { pickLanguage, type Language } from './text';
import type { EngineClient } from './engine/types';

/** `?lang=hi` picks Hindi for a check or a screenshot; otherwise the computer's languages decide. */
function language(): Language {
  const asked = new URLSearchParams(window.location.search).get('lang');
  return asked === 'hi' || asked === 'en' ? asked : pickLanguage();
}

async function engine(): Promise<EngineClient> {
  // Only `npm run dev:ui` (vite --mode fake) uses the fake engine; any other build leaves it out entirely.
  if (import.meta.env.MODE === 'fake') {
    const { FakeEngine, createFakeClient } = await import('./engine/fake');
    return createFakeClient(new FakeEngine({ latencyMs: 120 }));
  }
  return createEngineClient();
}

async function start() {
  const lang = language();
  document.documentElement.lang = lang;
  const client = await engine();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App client={client} language={lang} />
    </StrictMode>,
  );
}

void start();
