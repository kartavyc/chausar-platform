import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { MiniAppView } from '../../engine/types';
import { Bento, Tile, TileHead } from '../../parts/Tile';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Composer } from '../../parts/Composer';
import { Icon } from '../../parts/Icon';
import { goTo } from '../../shell/navigation';
import { MiniAppFrame } from './MiniAppFrame';
import s from './Apps.module.css';
import { LoadingPlace } from '../../parts/Skeleton';

const never = () => false;

type Undo = { kind: 'version'; version: number } | { kind: 'pin'; pinned: boolean };

/** Saves the exported single file where the owner picks (the browser's own download; the desktop shows its save dialog). */
function saveFile(fileName: string, document: string): void {
  const url = URL.createObjectURL(new Blob([document], { type: 'text/html' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * One app, opened (W6 6H1, D39; reference-ui/AppsB.dc.html): the making chat with Chausar (the owner's words and
 * Chausar's code-written replies), the app running in its locked box, Pin to Today and Export, and a box to ask for a
 * change, which makes a new version. Beside it, the permission screen when the version on screen needs something not
 * allowed yet (Allow sends the digest of exactly what it lists); otherwise what the app may do with Turn off, its
 * versions with Use and Undo, and Delete. Before Allow the app does not run. C4 task 29: an app with no data of its own
 * offers Preview with sample data: it runs afresh on made-up rows under a banner, every write refused, until Back to your data.
 */
export function AppView({ id }: { id: string }) {
  const t = useT();
  const client = useEngine();
  const chatId = useId(), sideId = useId(), allowId = useId();
  const loaded = useResource('venture.apps.get', { app: id }, { refreshOn: never });
  const [fresh, setFresh] = useState<MiniAppView | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [sample, setSample] = useState(false);
  const app = fresh && fresh.id === id ? fresh : loaded.data?.app;

  async function run(work: () => Promise<{ app: MiniAppView; line: string; next?: Undo }>) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await work();
      setFresh(done.app);
      setLine(done.line);
      setUndo(done.next ?? null);
      setMoved(false);
    } catch (error) {
      setProblem(t('apps.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  if (!app) return loaded.error ? <p className={s.quiet} role="alert">{t('apps.failed', { message: loaded.error.message })}</p> : <LoadingPlace shape="cards" />;

  // A permission to ask for again ends the preview with the app it ran.
  const showingSample = sample && !app.ask;

  const pin = () => void run(async () => {
    const done = await client.request('venture.apps.pin', { app: app.id, pinned: !app.pinned });
    return { ...done, next: { kind: 'pin' as const, pinned: done.undo.pinned } };
  });
  const back = () => {
    if (!undo) return;
    if (undo.kind === 'pin') void run(() => client.request('venture.apps.pin', { app: app.id, pinned: undo.pinned }));
    else void run(() => client.request('venture.apps.restore', { app: app.id, version: undo.version }));
  };
  const use = (version: number) => void run(async () => {
    const done = await client.request('venture.apps.restore', { app: app.id, version });
    return { ...done, next: { kind: 'version' as const, version: done.undo.version } };
  });
  async function exportApp() {
    setProblem(null);
    try {
      const file = await client.request('venture.apps.export', { app: app!.id });
      saveFile(file.fileName, file.document);
      setLine(t('apps.view.exported', { file: file.fileName }));
      setUndo(null);
    } catch (error) {
      setProblem(t('apps.failed', { message: messageOf(error) }));
    }
  }
  async function change(text: string) {
    const done = await client.request('venture.apps.make', { ask: text, app: app!.id });
    setFresh(done.app);
    setLine(null);
    setUndo(null);
    setMoved(false);
  }
  async function remove() {
    setBusy(true);
    try {
      await client.request('venture.apps.remove', { app: app!.id });
      goTo('apps');
    } catch (error) {
      setProblem(t('apps.failed', { message: messageOf(error) }));
      setBusy(false);
    }
  }

  return (
    <Bento className={s.view}>
      <Tile as="section" span={7} labelledBy={chatId} className={s.chat}>
        <a className={s.back} href="#/apps">{t('apps.view.back')}</a>
        <TileHead id={chatId} title={t('apps.view.chat')} />
        <ol className={s.thread}>
          {app.messages.map((message, index) => (
            <li key={`${message.at}-${index}`} className={s.bubble} data-from={message.from}><span data-content="">{message.text}</span></li>
          ))}
        </ol>
        <section className={s.box} aria-label={t('apps.view.running', { name: app.name })}>
          <div className={s.bar}>
            <Icon name="layout-grid" size={14} />
            <span className={s.barName} data-content="">{t('apps.view.bar', { name: app.name, version: app.version })}</span>
            <Chip tone="line">{t('apps.view.box')}</Chip>
          </div>
          {moved
            ? <p className={s.locked} role="status">{t('apps.view.moved')}</p>
            : app.ask
              ? <p className={s.locked}>{t('apps.view.locked')}</p>
              : (
                <>
                  {showingSample && <p className={s.sampleBanner} role="status">{t('apps.preview.banner')}</p>}
                  <MiniAppFrame key={`${app.id}:${app.version}:${showingSample ? 'sample' : 'yours'}`} app={app} title={t('apps.view.frame', { name: app.name })} onMoved={() => setMoved(true)} sample={showingSample} />
                </>
              )}
        </section>
        <div className={s.actions}>
          {/* B4: an app waiting on Allow can't run, so it can't be pinned or exported yet. One line says why, for both. */}
          <Button onClick={pin} disabled={busy || (Boolean(app.ask) && !app.pinned)} aria-describedby={app.ask && !app.pinned ? allowId : undefined}>{app.pinned ? t('apps.view.unpin') : t('apps.view.pin')}</Button>
          <Button onClick={() => void exportApp()} disabled={busy || Boolean(app.ask)} aria-describedby={app.ask ? allowId : undefined}>{t('apps.view.export')}</Button>
          {showingSample
            ? <Button variant="quiet" onClick={() => setSample(false)}>{t('apps.preview.back')}</Button>
            : app.empty && !app.ask && !moved && <Button variant="quiet" onClick={() => setSample(true)}>{t('apps.preview.go')}</Button>}
        </div>
        {app.ask && <p id={allowId} className={s.quiet}>{t('apps.view.allowFirst')}</p>}
        {line && (
          <p className={s.said} role="status">
            <span>{line}</span>
            {undo && <Button size="sm" variant="quiet" onClick={back} disabled={busy}>{t('apps.view.undo')}</Button>}
          </p>
        )}
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        <Composer label={t('apps.view.change')} placeholder={t('apps.view.changePlaceholder')} onSend={change} className={s.composer} />
      </Tile>
      <Tile as="section" span={5} labelledBy={sideId} className={s.side}>
        {app.ask ? (
          <>
            <p className={s.eyebrow}>{app.ask.first ? t('apps.allow.first') : t('apps.allow.more')}</p>
            <h2 id={sideId} className={s.allowTitle}>{t('apps.allow.title', { name: app.name })}</h2>
            <ul className={s.perms}>
              {app.permissions.map((item) => (
                <li key={item.id} className={s.perm}>
                  <span><b>{item.verb}</b> {item.line}</span>
                  {!app.ask!.first && app.ask!.added.includes(item.id) && <Chip tone="line">{t('apps.allow.new')}</Chip>}
                </li>
              ))}
            </ul>
            <div className={s.never}>
              <p className={s.neverTitle}>{t('apps.allow.never')}</p>
              <p className={s.neverLine}>{app.never}</p>
            </div>
            <div className={s.allowRow}>
              <Button variant="primary" size="lg" disabled={busy} onClick={() => void run(() => client.request('venture.apps.grant', { app: app.id, digest: app.ask!.digest }))}>{t('apps.allow.yes')}</Button>
              <Button size="lg" onClick={() => goTo('apps')}>{t('apps.allow.notNow')}</Button>
            </div>
            <p className={s.quiet}>{t('apps.allow.later')}</p>
          </>
        ) : (
          <>
            <h2 id={sideId} className={s.sideTitle}>{t('apps.access.title')}</h2>
            <ul className={s.perms}>
              {app.permissions.map((item) => <li key={item.id} className={s.perm}><span><b>{item.verb}</b> {item.line}</span></li>)}
            </ul>
            {app.permissions.length > 0 && <Button size="sm" onClick={() => void run(() => client.request('venture.apps.revoke', { app: app.id }))} disabled={busy}>{t('apps.access.off')}</Button>}
            <h3 className={s.sideTitle}>{t('apps.versions.title')}</h3>
            <ul className={s.versions}>
              {[...app.versions].reverse().map((item) => (
                <li key={item.version} className={s.version}>
                  <span className={s.grow}><span className={s.versionName}>{t('apps.versions.item', { version: item.version })}</span>{' · '}<span data-content="">{item.summary}</span></span>
                  {item.current
                    ? <span className={s.quiet}>{t('apps.versions.current')}</span>
                    : <Button size="sm" variant="quiet" onClick={() => use(item.version)} disabled={busy}>{t('apps.versions.use', { version: item.version })}</Button>}
                </li>
              ))}
            </ul>
            {removing ? (
              <div className={s.removeAsk} role="group" aria-label={t('apps.remove')}>
                <p>{t('apps.remove.ask', { name: app.name })}</p>
                <div className={s.allowRow}>
                  <Button size="sm" tone="danger" onClick={() => void remove()} disabled={busy}>{t('apps.remove.yes')}</Button>
                  <Button size="sm" variant="quiet" onClick={() => setRemoving(false)}>{t('apps.remove.no')}</Button>
                </div>
              </div>
            ) : <Button size="sm" tone="danger" onClick={() => setRemoving(true)}>{t('apps.remove')}</Button>}
          </>
        )}
      </Tile>
    </Bento>
  );
}
