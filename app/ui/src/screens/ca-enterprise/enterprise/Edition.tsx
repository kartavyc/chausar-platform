/**
 * Trust, Edition: the owner turns the company version (the enterprise shell) on or off for this
 * workspace with `enterprise.setup`. The frame is read once per sign-in, so the page says the
 * app opens in the other version the next time it is signed in to or reloaded; nothing moves now.
 */
import { useState } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { validateShellFacts, type ShellFacts } from '../host-wiring.ts';
import { Frame, Note, Outcome, useWhere } from './Frame';
import { useRead, useSend } from './kit.ts';
import { ReplyError, validateSetup, type ShellKindValue } from './validate.ts';
import s from './Enterprise.module.css';

function checkedShell(reply: unknown): ShellFacts {
  const facts = validateShellFacts(reply);
  if (facts === null) throw new ReplyError();
  return facts;
}

export function EditionScreen({ p }: { p: PlaceRenderProps }) {
  const t = useT();
  const where = useWhere();
  const { state } = useRead(p, 'caent.shell', checkedShell);
  const { sent, send } = useSend(p.rpc, validateSetup);
  const [now, setNow] = useState<ShellKindValue | null>(null);
  const owner = !p.viewer && p.member.role === 'owner';
  const turn = async (on: boolean) => { const done = await send('enterprise.setup', { on }); if (done !== null && p.live(p.address)) setNow(done.kind); };
  return (
    <Frame where={where('trust', 'edition')} title={t('SH-01.sub.trust.edition')} loaded={state}>
      {(facts) => {
        const kind = now ?? facts.kind;
        return (
          <>
            <Note>{t('ENX-edition.intro')}</Note>
            <p className={s.text} data-kind={kind}>{t(`ENX-edition.is.${kind}`)}</p>
            {now !== null && <p className={s.status} role="status">{t(now === 'enterprise' ? 'ENX-edition.reopenOn' : 'ENX-edition.reopenOff')}</p>}
            {kind === 'ca-firm' ? null : owner ? (
              <span>
                <Button onClick={() => void turn(kind !== 'enterprise')} disabled={sent.kind === 'sending'}>
                  {t(kind === 'enterprise' ? 'ENX-edition.turnOff' : 'ENX-edition.turnOn')}
                </Button>
              </span>
            ) : <Note>{t('ENX-edition.ownerOnly')}</Note>}
            <Outcome sent={sent} done={() => null} />
          </>
        );
      }}
    </Frame>
  );
}
