/**
 * The dev server's parts page (app/ui/parts.html), for the screenshot walk (scripts/ui-shots/walk.mjs) and the
 * founder's side-by-side look at the direction D boards. It lives outside src/, so its sample props never enter the
 * app's source, and `build:ui` never builds it (it builds index.html only).
 *
 *   parts.html?app=empty#/today         the whole app on the fake engine with nothing waiting on Today
 *   parts.html?app=departments#/team    the whole app, with the department views W4 4A1 sends added to the fake's
 *                                       team (as tests/places/team-v2.test.tsx does), so Team draws its departments
 *   parts.html?show=goal|team-dept|network|chats|money
 *                                       the parts W4 feeds (goal card, next step, gallery, paths, board, chat, charts),
 *                                       drawn with test-style props and marked "Sample props" on the page
 *
 * `?lang=hi` draws it in Hindi, as on the app's own page.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/tokens/tokens.css';
import '../src/tokens/fonts.css';
import '../src/tokens/motion.css';
import '../src/tokens/base.css';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient } from '../src/engine/fake';
import type { EngineClient } from '../src/engine/types';
import { withDepartments } from './departments';
import { Specimens } from './Specimens';

const params = new URLSearchParams(window.location.search);
const language = params.get('lang') === 'hi' ? 'hi' : 'en';
document.documentElement.lang = language;

function client(start: string): EngineClient {
  const base = createFakeClient(new FakeEngine({ latencyMs: 120, ...(start === 'empty' ? { queue: [] } : {}) }));
  return start === 'departments' ? withDepartments(base) : base;
}

const root = createRoot(document.getElementById('root')!);
const start = params.get('app');
if (!import.meta.env.DEV) {
  root.render(<p>The parts page runs on the dev server only.</p>);
} else if (start) {
  root.render(<StrictMode><App client={client(start)} language={language} /></StrictMode>);
} else {
  root.render(<StrictMode><Specimens show={params.get('show') ?? 'goal'} language={language} client={client('')} /></StrictMode>);
}
