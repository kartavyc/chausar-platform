/**
 * The status line: three facts in small type. Each is a link: sources freshness opens
 * Books, Sources; the model fact opens Trust, Models; what left this computer opens
 * Trust, Network. When something unusual is true the third fact gives way to it.
 * Simple shows two plain sentences. Books adds the keys that work here.
 * Facts are announced politely when they change.
 */

import type { Address, StatusLineData, View } from './presentation.ts';
import { useT } from './text';
import { formatAddress } from './routes.ts';
import s from './StatusLine.module.css';

export interface StatusLineProps {
  status: StatusLineData;
  view: View;
  onNavigate: (a: Address) => void;
  /** Simple view: two plain sentences instead of three facts. */
  simpleSentences?: readonly [string, string] | undefined;
}

export function StatusLine({ status, view, onNavigate, simpleSentences }: StatusLineProps) {
  const t = useT();

  if (view === 'simple' && simpleSentences) {
    return (
      <p className={[s.line, s.simple].join(' ')} role="status" aria-label={t('SH-01.region.status')} data-region="status">
        <span>{simpleSentences[0]}</span>
        <span>{simpleSentences[1]}</span>
      </p>
    );
  }

  const facts = [status.sources, status.model, status.third];
  return (
    <p className={[s.line, 'fig'].join(' ')} role="status" aria-label={t('SH-01.region.status')} data-region="status">
      {facts.map((f, i) =>
        f.address ? (
          <a
            key={i}
            className={s.fact}
            href={formatAddress(f.address)}
            onClick={(e) => {
              e.preventDefault();
              if (f.address) onNavigate(f.address);
            }}
          >
            {f.text}
          </a>
        ) : (
          <span key={i} className={s.fact}>
            {f.text}
          </span>
        ),
      )}
      {view === 'books' && <span className={s.fact}>{t('SH-01.status.keys')}</span>}
    </p>
  );
}
