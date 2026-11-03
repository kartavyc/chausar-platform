/**
 * Apps (W6 6H1, D39; reference-ui/AppsA.dc.html and AppsB.dc.html): small tools the owner's AI built for this
 * business. "Make an app" sends the owner's words to their AI (venture.apps.make) and opens the new app with its
 * making chat and permission screen; each app card says what it reads and opens it; the last tile says what every app
 * can do, what asks first and what it never does. An app opens at #/apps?app=<id> (AppView.tsx).
 */
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { goTo, useRoute } from '../../shell/navigation';
import { Bento, Tile, TileHead } from '../../parts/Tile';
import { Chip } from '../../parts/Chip';
import { Composer } from '../../parts/Composer';
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

  async function make(text: string) {
    const done = await client.request('venture.apps.make', { ask: text });
    goTo('apps', undefined, { app: done.app.id });
  }

  return (
    <>
      <PageTitle title={t('apps.title')} line={t('apps.line')} />
      <Bento>
        <Tile as="section" span={12} labelledBy="apps-make" className={s.make}>
          <TileHead id="apps-make" title={t('apps.make.title')} />
          <Composer label={t('apps.make.label')} placeholder={t('apps.make.placeholder')} onSend={make} suggestions={data?.ideas ?? []} hint={t('apps.make.busy')} />
        </Tile>
        {list.error && <p className={s.problem} role="alert">{t('apps.failed', { message: list.error.message })}</p>}
        {data && data.apps.length === 0 && <p className={s.quiet}>{t('apps.empty')}</p>}
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
          <Tile as="section" span={12} labelledBy="apps-rules" className={s.rules}>
            <TileHead id="apps-rules" title={t('apps.rules.title')} />
            <dl className={s.rulesGrid}>
              <div><dt>{t('apps.rules.can')}</dt><dd>{t('apps.rules.canLine')}</dd></div>
              <div><dt>{t('apps.rules.asks')}</dt><dd>{t('apps.rules.asksLine')}</dd></div>
              <div><dt>{t('apps.rules.never')}</dt><dd>{data.never}</dd></div>
            </dl>
          </Tile>
        )}
      </Bento>
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
