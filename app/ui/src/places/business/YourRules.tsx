import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { LockedRuleLite, RuleLocksLite, VentureRunEvent } from '../../engine/types';
import { onDesktop, safeUrl } from '../connections/external';
import { TileSection } from './shared';
import s from './Business.module.css';
import r from './RulesSection.module.css';
import { LoadingPlace } from '../../parts/Skeleton';

/**
 * Business > Your rules (#/business/rules), wave 6 package 6C5 (D20, D21). One screen per locked rule (a lawyer or CA
 * would confirm it, nobody has): the rule in plain words, what it does not cover, its sources, and one tick, "I am
 * responsible for this in my business". Ticking calls venture.rules.attest with the digest of the words shown; the
 * engine records the date. Unticking withdraws. Then the hard stops, one line each, with no tick: nothing unlocks them.
 * Every line is the engine's. The CA firm's sign-off by the CA of record stays on Your CA.
 */
const onChange = (event: VentureRunEvent) => event.type === 'queue.changed';

export function YourRules() {
  const t = useT();
  const locks = useResource('venture.rules.locks', {}, { refreshOn: onChange });
  const [view, setView] = useState<RuleLocksLite | null>(null);
  useEffect(() => { if (locks.data) setView(locks.data); }, [locks.data]);
  const data = view ?? locks.data ?? null;
  return (
    <div className={s.page}>
      {locks.error && !data && <p className={s.problem} role="alert">{t('business.failed', { message: locks.error.message })}</p>}
      {!data && !locks.error && <LoadingPlace shape="settings" />}
      {data && (
        <>
          <p className={s.lead}>{data.line}</p>
          {data.rules.map((rule) => <RuleScreen key={rule.id} rule={rule} words={data.words} onView={setView} />)}
          <TileSection title={t('business.yourRules.never')}>
            <ul className={s.plain}>
              {data.hardStops.map((stop) => <li key={stop.id} data-hard-stop={stop.id}>{stop.line}</li>)}
            </ul>
          </TileSection>
        </>
      )}
    </div>
  );
}

function RuleScreen({ rule, words, onView }: { rule: LockedRuleLite; words: string; onView: (view: RuleLocksLite) => void }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      onView(await client.request('venture.rules.attest', next ? { ruleId: rule.id, attest: true, digest: rule.digest } : { ruleId: rule.id, attest: false }));
    } catch (error) {
      setProblem(t('business.yourRules.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TileSection title={rule.topic}>
      <div data-locked-rule={rule.id}>
        <p className={s.line}>{rule.rule}</p>
        <p className={s.note}>{rule.limitations}</p>
        {rule.sources.length > 0 && (
          <ul className={s.plain}>
            {rule.sources.map((source) => <li key={source.url}><SourceLink title={source.title} url={source.url} /></li>)}
          </ul>
        )}
        <label className={s.line}>
          <input type="checkbox" checked={rule.attestedOn !== null} disabled={busy || !rule.attestable} onChange={(event) => void toggle(event.target.checked)} />{' '}
          {words}
        </label>
        <p className={s.note} role="status">{rule.line}</p>
        {problem && <p className={s.problem} role="alert">{problem}</p>}
      </div>
    </TileSection>
  );
}

/** A source page: a link that opens apart from Chausar on the web; on the desktop its title and address as text. */
function SourceLink({ title, url }: { title: string; url: string }) {
  const safe = safeUrl(url);
  if (!safe) return <span>{title}</span>;
  if (onDesktop()) return <span className={r.address}>{title} <span>{safe}</span></span>;
  return <a className={r.source} href={safe} target="_blank" rel="noopener noreferrer">{title}</a>;
}
