/**
 * Apps (W6 6H1, D39; reference-ui/AppsA.dc.html and AppsB.dc.html): small tools the owner's AI built for this
 * business. "Make an app" sends the owner's words to their AI (venture.apps.make) and opens the new app with its
 * making chat and permission screen; each app card says what it reads and opens it; the last tile says what every app
 * can do, what asks first and what it never does. An app opens at #/apps?app=<id> (AppView.tsx).
 */
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError } from '../../engine/types';
import { goTo, useRoute } from '../../shell/navigation';
import { Bento, Tile, TileHead } from '../../parts/Tile';
import { Chip } from '../../parts/Chip';
import { Composer } from '../../parts/Composer';
import { Fold } from '../../parts/Fold';
import { LoadingPlace, useArrived } from '../../parts/Skeleton';
import { PageTitle } from '../../parts/PageTitle';
import { AppView } from './AppView';
import s from './Apps.module.css';

const never = () => false;

export function Place() {
  const { query } = useRoute();
  return query.app ? <AppView id={query.app} /> : <AppsHome />;
}

function AppsHome() {
  const t = useT();
  const client = useEngine();
  const list = useResource('venture.apps.list', {}, { refreshOn: never });
  const data = list.data;
  const loading = !data && !list.error;
  const arrived = useArrived(loading);

  // One-shot C3 task 11: the Composer says "Writing your app" with its elapsed time while the make is on its way, and
  // the idea chips wait; nothing at rest.
  async function make(text: string) {
    const done = await client.request('venture.apps.make', { ask: text });
    goTo('apps', undefined, { app: done.app.id });
  }
  // B4 task 4: no AI yet is a known state, not an alarm: muted words, the fix in the line, the owner's words kept.
  const noAi = (failure: unknown) => (failure instanceof EngineError && failure.code === 'APP_NEEDS_AI'
    ? { words: failure.message, tone: 'expected' as const, fix: { label: t('apps.make.connect'), onSelect: () => goTo('connections') } }
    : null);

  return (
    <>
      <PageTitle title={t('apps.title')} line={t('apps.line')} />
      <section aria-labelledby="apps-make" className={s.make}>
          <TileHead id="apps-make" title={t('apps.make.title')} />
          <Composer label={t('apps.make.label')} placeholder={t('apps.make.placeholder')} onSend={make} focusSendOnSuggestion describeFailure={noAi} suggestions={data?.ideas ?? []} suggestionsLabel={t('apps.make.ideas')} waitLabel={t('apps.make.busy')} />
      </section>
      <LoadingPlace shape="cards" loading={loading} />
      <div data-arrived={arrived ? '' : undefined}><Bento>
        {list.error && <p className={s.problem} role="alert">{t('apps.failed', { message: list.error.message })}</p>}
        {data?.apps.map((app) => (
          <Tile key={app.id} as="article" span={4} labelledBy={`app-${app.id}`} pad="compact" className={s.card}>
            <p className={s.summary} data-content="">{app.summary}</p>
            <h3 id={`app-${app.id}`} className={s.cardName} data-content="">{app.name}</h3>
            <div className={s.chips}>{app.reads.map((read) => <Chip key={read} tone="line">{read}</Chip>)}</div>
            <div className={s.foot}>
              <span className={s.quiet}>{app.pinned ? t('apps.card.pinned') : app.allowed ? t('apps.card.version', { version: app.version }) : t('apps.card.waiting')}</span>
              <a className={s.open} href={`#/apps?app=${encodeURIComponent(app.id)}`} aria-label={t('apps.card.openNamed', { name: app.name })}>{t('apps.card.open')}</a>
            </div>
          </Tile>
        ))}
        {data && (
          <Fold summary={t('apps.rules.title')} className={s.rules}>
            <dl className={s.rulesGrid}>
              <div><dt>{t('apps.rules.can')}</dt><dd>{t('apps.rules.canLine')}</dd></div>
              <div><dt>{t('apps.rules.asks')}</dt><dd>{t('apps.rules.asksLine')}</dd></div>
              <div><dt>{t('apps.rules.never')}</dt><dd>{data.never}</dd></div>
            </dl>
          </Fold>
        )}
      </Bento></div>
    </>
  );
}

/**
 * Today's pinned apps (W6 6H1): each app the owner pinned, with a link that opens it. Nothing when none is pinned, so
 * Today at rest is unchanged. 6H3's layout library has no block for it yet; it sits after the other blocks.
 */
export function PinnedApps() {
  const t = useT();
  const list = useResource('venture.apps.list', {}, { refreshOn: never });
  const pinned = list.data?.apps.filter((app) => app.pinned) ?? [];
  if (!pinned.length) return null;
  return (
    <Tile as="section" labelledBy="today-pinned-apps" pad="compact" className={s.pinned}>
      <TileHead id="today-pinned-apps" title={t('apps.pinned.title')} />
      <ul className={s.pinnedList}>
        {pinned.map((app) => (
          <li key={app.id} className={s.pinnedItem}>
            <span className={s.grow} data-content="">{app.name}</span>
            <a className={s.open} href={`#/apps?app=${encodeURIComponent(app.id)}`} aria-label={t('apps.card.openNamed', { name: app.name })}>{t('apps.card.open')}</a>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
