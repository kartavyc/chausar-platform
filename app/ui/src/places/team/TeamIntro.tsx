import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import sLocal from './TeamIntro.module.css';

/**
 * C5 task 1: introduce each agent once. The engine sends a code-written line for every agent this member has not met
 * (agents/intro.ts); Got it marks them met (a quiet write), and Team reads again so the lines leave.
 */
export function TeamIntro({ lines, onDone }: { lines: readonly { agentId: string; line: string }[]; onDone: () => void }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState(false);
  async function gotIt() {
    setBusy(true);
    try {
      await client.request('venture.team.introduced', { agentIds: lines.map((item) => item.agentId) });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={sLocal.intro} aria-label={t('team.intro.label')}>
      <ul className={sLocal.introLines}>
        {lines.map((item) => <li key={item.agentId}>{item.line}</li>)}
      </ul>
      <button type="button" className={sLocal.introDone} onClick={() => void gotIt()} disabled={busy}>{t('team.intro.gotIt')}</button>
    </section>
  );
}
