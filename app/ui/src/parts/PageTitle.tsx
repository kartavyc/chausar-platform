import { createContext, useContext, type ReactNode } from 'react';
import { useT } from '../text';
import s from './PageTitle.module.css';

/**
 * The shell's own tools for every page header (D's `.tools`: W4 4G4's bell), drawn after the place's own tools. The
 * shell gives them only beside the rail; on a phone they sit in the top bar instead.
 */
export const ShellToolsContext = createContext<ReactNode>(null);

export interface PageTitleProps {
  title: string;
  /** A small line above the title (Today's date). */
  eyebrow?: string | undefined;
  /** The one line under the title. */
  line?: ReactNode;
  /** The count inside `line` to set in bold (D's `.sub b`), found as text where it first stands as a whole number.
   *  A line that does not hold it is drawn plain. */
  count?: string | undefined;
  /** Page tools on the right of the header (D's `.tools`). */
  tools?: ReactNode;
}

/**
 * `line` with the first `count` in it wrapped in `<b>`, where it stands as a whole number: no digit right before or
 * after it, and no digit across a comma or point (so "2" is not the 2 in "12", "1" not the 1 in "1,200", "12" not the
 * 12 in "12.5"; a full stop after it is fine). Only text is matched and split; nothing is parsed or worked out.
 */
function withCount(line: ReactNode, count: string | undefined): ReactNode {
  if (typeof line !== 'string' || !count) return line;
  const escaped = count.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?<!\\d)(?<!\\d[,.])${escaped}(?!\\d)(?![,.]\\d)`).exec(line);
  if (!found) return line;
  const at = found.index;
  return <>{line.slice(0, at)}<b>{count}</b>{line.slice(at + count.length)}</>;
}

/** Longer than this wraps on a small window, so the line gives its height back there (B4 task 5). */
const LONG_LINE = 48;

/**
 * A place's header (D's `header.phead`): the eyebrow, the title (28/600), its line, and the page tools beside them. The
 * line's slot is always there with one line's height, so sub-pages with and without a line keep one header (B4 task 5).
 */
export function PageTitle({ title, eyebrow, line, count, tools }: PageTitleProps) {
  const t = useT();
  const shellTools = useContext(ShellToolsContext);
  return (
    <header className={s.header}>
      <div className={s.text}>
        {eyebrow && <p className={s.eyebrow}>{eyebrow}</p>}
        <h1 className={s.title}>{title}</h1>
        <p className={s.line} data-line-slot="" data-long={typeof line === 'string' && line.length > LONG_LINE ? '' : undefined}>{withCount(line, count)}</p>
      </div>
      {(tools || shellTools) && <div className={s.tools} role="group" aria-label={t('shell.pageTools')}>{tools}{shellTools}</div>}
    </header>
  );
}
