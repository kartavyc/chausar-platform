/**
 * Shared pieces of the three forms of Today: the system rows the screen adds, the at-rest
 * cut of attention rows, the in-place expansion with Review, and the open-row state.
 */

import { useRef, useState } from 'react';
import type { Address, RowItem, View } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { Button } from '../../parts/Button';
import { TODAY_ATTENTION_MAX, TODAY_REVIEW_MAX, type TodayData, type TodayIntents } from './TodayData.ts';

export interface TodayScreenProps {
  data: TodayData;
  intents: TodayIntents;
  view: View;
  sheetId?: string | undefined;
  onNavigate: (a: Address) => void;
}

const SETUP_ROW = 'system:setup';
const UPDATE_ROW = 'system:update';

/** The rows the screen adds for setup and updates. Their words are UI text. A row offers
 *  its action only when the engine offered it and the adapter supplied the callback; with
 *  either one missing the row still says what is true and shows no button. */
export function useSystemRows(data: TodayData, intents: TodayIntents): ReadonlyArray<RowItem> {
  const t = useT();
  const rows: RowItem[] = [];
  if (data.setup) {
    const offered = data.setup.can?.includes('continue') === true && intents.onResumeSetup !== undefined;
    rows.push({ id: SETUP_ROW, mark: 'wait', what: t('TD-01.setup', { step: data.setup.step, of: data.setup.of }), can: offered ? ['open'] : [] });
  }
  if (data.update) {
    const offered = data.update.can?.includes('update') === true && intents.onUpdate !== undefined;
    rows.push({ id: UPDATE_ROW, mark: 'wait', what: t('TD-01.update'), can: offered ? ['open'] : [] });
  }
  return rows;
}

/** Review and worth-a-look rows cut to the at-rest limits: four, and five together. */
export function attentionRows(data: TodayData, system: ReadonlyArray<RowItem>) {
  const review = [...system, ...data.review.rows].slice(0, TODAY_REVIEW_MAX);
  const worth = (data.worthALook ?? []).slice(0, Math.max(0, TODAY_ATTENTION_MAX - review.length));
  return { review, worth };
}

/** Whether a row opens in place: it has a line of detail to show or an action to offer. */
export function opensInPlace(row: RowItem): boolean {
  return (row.detail !== undefined && row.detail.length > 0) || (row.can !== undefined && row.can.length > 0);
}

/** The in-place expansion of a row: one line of detail and Review (or Prepare, or Open).
 *  A button appears only when the engine offered the action in `can` and its callback
 *  was supplied. There is never an enabled button with nothing behind it. */
export function RowExpansion({ row, intents, origin }: { row: RowItem; intents: TodayIntents; origin: HTMLElement | null }) {
  const t = useT();
  const can = row.can ?? [];
  const onResumeSetup = intents.onResumeSetup;
  const onUpdate = intents.onUpdate;
  const onPrepare = intents.onPrepare;
  const onOpenRow = intents.onOpenRow;

  if (row.id === SETUP_ROW) {
    return (
      <>
        <span />
        {can.includes('open') && onResumeSetup && (
          <Button variant="filled" onClick={() => onResumeSetup()}>
            {t('BTN.continue')}
          </Button>
        )}
      </>
    );
  }
  if (row.id === UPDATE_ROW) {
    return (
      <>
        <span />
        {can.includes('open') && onUpdate && (
          <Button variant="filled" onClick={() => onUpdate()}>
            {t('BTN.update')}
          </Button>
        )}
      </>
    );
  }
  return (
    <>
      <span>{row.detail}</span>
      {can.includes('review') ? (
        <Button variant="filled" onClick={() => intents.onReview(row.id, origin)}>
          {t('BTN.review')}
        </Button>
      ) : can.includes('prepare') && onPrepare ? (
        <Button variant="quiet" onClick={() => onPrepare(row.id)}>
          {t('BTN.prepare')}
        </Button>
      ) : can.includes('open') && onOpenRow ? (
        <Button variant="quiet" onClick={() => onOpenRow(row.id, origin)}>
          {t('BTN.open')}
        </Button>
      ) : null}
    </>
  );
}

/** Which row is open in place, and where each row's control is for focus return. */
export function useInPlaceRows() {
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const origins = useRef(new Map<string, HTMLElement>());
  const registerOrigin = (id: string, el: HTMLButtonElement | null) => {
    if (el) origins.current.set(id, el);
    else origins.current.delete(id);
  };
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? undefined : id));
  const originOf = (id: string) => origins.current.get(id) ?? null;
  return { openId, toggle, registerOrigin, originOf };
}
