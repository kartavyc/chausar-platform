/**
 * Trust, Holds (enterprise part 3, "Retention ... and legal holds"). The list of holds, and a
 * "Place a hold" control. The engine refuses every hold (ENTERPRISE_HOLDS_NOT_ENFORCED) until
 * retention enforcement exists, and the screen says so plainly instead of pretending a hold
 * was placed.
 */
import { useState } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { Frame, Group, Note, Outcome, useWhere } from './Frame';
import { canChange, useRead, useSend } from './kit.ts';
import { validateHolds } from './validate.ts';
import s from './Enterprise.module.css';

const noReply = (reply: unknown): unknown => reply;

export function HoldsScreen({ p }: { p: PlaceRenderProps }) {
  const t = useT();
  const where = useWhere();
  const { state } = useRead(p, 'enterprise.holds.list', validateHolds);
  const edit = canChange(p);
  const [what, setWhat] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, noReply);
  const place = async () => {
    const typed = what.trim();
    if (typed.length === 0 || typed.length > 200) { setProblem(t('ENX-holds.needWhat')); return; }
    setProblem(undefined);
    await send('enterprise.holds.place', { what: typed });
  };
  return (
    <Frame where={where('trust', 'holds')} title={t('SH-01.sub.trust.holds')} loaded={state} forbiddenKey="ENX-holds.forbidden">
      {({ holds, enforced }) => (
        <>
          {!enforced && <Note>{t('ENX-holds.notEnforced')}</Note>}
          {holds.length === 0 ? <Note>{t('ENX-holds.none')}</Note> : (
            <ul className={s.list}>
              {holds.map((h) => <li key={h.id} className={s.item} data-hold={h.id}>{h.what ?? <span className={s.mono}>{h.id}</span>}</li>)}
            </ul>
          )}
          {edit ? (
            <Group title={t('ENX-holds.place')}>
              <form className={s.form} onSubmit={(e) => { e.preventDefault(); void place(); }}>
                <Field label={t('ENX-holds.what')} value={what} onChange={(e) => setWhat(e.currentTarget.value)} problem={problem} autoComplete="off" />
                <Button submit disabled={sent.kind === 'sending'}>{t('ENX-holds.place')}</Button>
              </form>
              <Outcome sent={sent} done={() => t('ENX-holds.placed')} />
            </Group>
          ) : <Note>{t('ENX-readOnly')}</Note>}
        </>
      )}
    </Frame>
  );
}
