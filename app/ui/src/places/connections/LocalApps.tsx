/**
 * Connections, "Apps on this computer" (Ink v2 wave 5, 5A6; the engine's build/local-apps.ts, catalogue K13): apps
 * the owner installed themselves (BaoCut, Kimo, FilmCraft), driven only through their public command line. Each shows
 * its honest label from the engine: writes when it is on this computer, planned with the manual path ("Install it
 * yourself; Chausar never installs it.") when not. What an app asked of the owner (its remedy) is the app's own words,
 * shown in [data-content]. Nothing here runs anything: an app runs only as the exact command the owner approves.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import s from './Mailbox.module.css';
import k from './KitConnect.module.css';

export function LocalApps() {
  const t = useT();
  const apps = useResource('venture.localApps.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  return (
    <div role="region" aria-label={t('kit-connect.apps.title')} className={s.card} data-local-apps="">
      <p className={s.quiet}>{t('kit-connect.apps.line')}</p>
      {apps.data && <p className={s.said}>{apps.data.line}</p>}
      {apps.data && (
        <ul className={k.list}>
          {apps.data.apps.map((app) => (
            <li key={app.id} className={k.item} data-local-app={app.id}>
              <div className={k.itemHead}>
                <span className={k.name}>{app.name}</span>
                <ConnectorLabel label={app.label === 'write' ? 'write' : 'planned'} />
              </div>
              <p className={k.small}>{app.manualPath ?? app.note}</p>
              {app.needs && (
                <p className={k.small} data-needs="">
                  {t('kit-connect.apps.needs')} <span className={k.content} data-content="">{app.needs.remedy}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
