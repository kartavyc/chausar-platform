/**
 * The top of a page: a small grey line that says where you are ("Work · Approvals") or,
 * on Today, the date; then the title, set large, with a count beside it when the page is
 * a list. `aside` holds something at the right: a lens, "See all", "Add a source".
 */

import type { ReactNode } from 'react';
import type { Count } from './presentation.ts';
import s from './PageHeader.module.css';

export interface PageHeaderProps {
  where: string;
  title: string;
  titleId?: string | undefined;
  /** Shown as given. A count that is not known arrives as its missing word, never as 0. */
  count?: Count | undefined;
  aside?: ReactNode;
  /** Something above the title at the right, such as the enterprise lens. */
  top?: ReactNode;
}

export function PageHeader({ where, title, titleId, count, aside, top }: PageHeaderProps) {
  return (
    <header className={s.header}>
      <div className={s.whereLine}>
        <p className={s.where}>{where}</p>
        {top}
      </div>
      <div className={s.titleLine}>
        <h1 id={titleId} className={s.title}>
          {title}
          {count && <span className={[s.count, 'fig'].join(' ')}>{count.display}</span>}
        </h1>
        {aside && <div className={s.aside}>{aside}</div>}
      </div>
    </header>
  );
}
