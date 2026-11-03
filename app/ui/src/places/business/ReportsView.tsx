import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { FeedbackView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { FeedbackQuestionCard } from '../../parts/FeedbackQuestion';
import { TileSection, messageOf } from './shared';
import s from './Business.module.css';
import r from './Reports.module.css';

/**
 * Business > Reports (#/business/reports), wave 6 package 6J2 (D47). Off by default. The engine's privacy notice comes
 * first; the owner picks usage reports, crash reports or both and turns them on by the notice's digest. Once on, the
 * page shows exactly what Send report would send, as the engine wrote it (quoted content), and Send report goes by
 * that preview's digest. Delete my reports asks twice. Every line here is the engine's; nothing is worked out here.
 */
export function ReportsView() {
  const t = useT();
  const client = useEngine();
  const resource = useResource('venture.feedback.get', {});
  const [view, setView] = useState<FeedbackView | null>(null);
  const [usage, setUsage] = useState(false);
  const [crashes, setCrashes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (resource.data) setView(resource.data); }, [resource.data]);
  const data = view ?? resource.data ?? null;
  // The boxes follow what the engine has in force each time it changes; ticking them changes nothing until a button.
  const inForce = data ? `${data.consent.given && data.consent.usage}:${data.consent.given && data.consent.crashes}` : '';
  useEffect(() => {
    if (!inForce) return;
    const [nextUsage, nextCrashes] = inForce.split(':');
    setUsage(nextUsage === 'true');
    setCrashes(nextCrashes === 'true');
  }, [inForce]);

  async function run(call: () => Promise<FeedbackView>) {
    setBusy(true);
    setProblem(null);
    try { setView(await call()); } catch (error) { setProblem(t('feedback.failed', { message: messageOf(error) })); } finally { setBusy(false); }
  }

  if (!data) {
    return (
      <div className={s.page}>
        {resource.error ? <p className={s.problem} role="alert">{t('feedback.failed', { message: resource.error.message })}</p> : <p className={s.note}>{t('feedback.loading')}</p>}
      </div>
    );
  }
  const given = data.consent.given;
  const preview = data.preview;
  return (
    <div className={s.page}>
      <p className={s.lead} role="status">{data.line}</p>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <TileSection title={t('feedback.notice')}>
        <p className={s.line}>{data.notice.text}</p>
        <p className={s.note}>{data.setUp.line}</p>
      </TileSection>
      <TileSection title={t('feedback.choose')}>
        <label className={r.choice}>
          <input type="checkbox" checked={usage} disabled={busy} onChange={(event) => setUsage(event.target.checked)} />
          <span>{t('feedback.usage')} <span className={r.hint}>{t('feedback.usageHint')}</span></span>
        </label>
        <label className={r.choice}>
          <input type="checkbox" checked={crashes} disabled={busy} onChange={(event) => setCrashes(event.target.checked)} />
          <span>{t('feedback.crashes')} <span className={r.hint}>{t('feedback.crashesHint')}</span></span>
        </label>
        <div className={s.buttons}>
          <Button
            variant={given ? 'secondary' : 'primary'}
            disabled={busy || (!usage && !crashes)}
            onClick={() => void run(() => client.request('venture.feedback.consent', { digest: data.notice.digest, usage, crashes }))}
          >
            {t(given ? 'feedback.save' : 'feedback.turnOn')}
          </Button>
          {given && <Button variant="quiet" disabled={busy} onClick={() => void run(() => client.request('venture.feedback.consent', { withdraw: true }))}>{t('feedback.turnOff')}</Button>}
        </div>
      </TileSection>
      {data.question && <FeedbackQuestionCard question={data.question} onView={setView} />}
      {preview && (
        <TileSection title={t('feedback.preview')}>
          {preview.posthog && (
            <>
              <p className={s.note}>{t('feedback.to', { service: 'PostHog', to: preview.posthog.to })}</p>
              <pre className={r.json} data-content="">{JSON.stringify(preview.posthog.events, null, 2)}</pre>
            </>
          )}
          {preview.sentry && (
            <>
              <p className={s.note}>{t('feedback.to', { service: 'Sentry', to: preview.sentry.to })}</p>
              <pre className={r.json} data-content="">{JSON.stringify(preview.sentry.events, null, 2)}</pre>
            </>
          )}
          <p className={s.note}>{t('feedback.keys')}</p>
          {data.lastSend && <p className={s.note}>{data.lastSend.line}</p>}
          <div className={s.buttons}>
            <Button variant="primary" disabled={busy} onClick={() => void run(() => client.request('venture.feedback.send', { digest: preview.digest }))}>{t('feedback.send')}</Button>
          </div>
        </TileSection>
      )}
      <TileSection title={t('feedback.delete')}>
        {data.reportId && <p className={s.note}>{t('feedback.id', { id: data.reportId })}</p>}
        {data.deletion && <p className={s.line}>{data.deletion.line}</p>}
        {asking ? (
          <>
            <p className={s.line}>{t('feedback.deleteAsk')}</p>
            <div className={s.buttons}>
              <Button variant="quiet" disabled={busy} onClick={() => setAsking(false)}>{t('feedback.keep')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => { setAsking(false); void run(() => client.request('venture.feedback.delete', {})); }}>{t('feedback.deleteSure')}</Button>
            </div>
          </>
        ) : (
          <div className={s.buttons}>
            <Button disabled={busy} onClick={() => setAsking(true)}>{t('feedback.delete')}</Button>
          </div>
        )}
      </TileSection>
    </div>
  );
}
