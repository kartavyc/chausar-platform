import { useId } from 'react';
import { useT } from '../../text';
import { FilterChips, type FilterOption } from '../../parts/FilterChips';
import { WAY_SORTS, type WayFilter, type WaySort } from './ways';
import s from './GalleryFilters.module.css';

/**
 * The gallery's toolbar (D-Start's `.toolbar`, W4 4J21): one row of chips, All with every way, each category with the
 * engine's count, then past a thin line "Up to 5 h a week" with its count (it reads each way's maxHours); and Sort, Best
 * fit, Fewest hours or Name. One chip is on at a time. Every count is the engine's.
 */
export function GalleryFilters({ total, categories, upTo, chip, onChip, sort, onSort }: {
  total: number;
  categories: readonly WayFilter[];
  upTo?: WayFilter | undefined;
  chip: string;
  onChip: (id: string) => void;
  sort: WaySort;
  onSort: (sort: WaySort) => void;
}) {
  const t = useT();
  const sortId = useId();
  const options: FilterOption[] = [
    { id: 'all', label: t('onboarding.ways.all'), count: total },
    // A chip that would show 0 ways is not drawn: there is nothing to pick behind it.
    ...categories.filter((item) => item.count > 0).map((item) => ({ id: item.id, label: item.label, count: item.count })),
    ...(upTo && upTo.count > 0 ? [{ id: upTo.id, label: upTo.label, count: upTo.count, icon: 'clock' as const, separatorBefore: true }] : []),
  ];
  return (
    <div className={s.toolbar} data-gallery-filters="">
      <FilterChips label={t('onboarding.ways.show')} options={options} value={chip} onChange={onChip} />
      <span className={s.sort}>
        <label htmlFor={sortId}>{t('onboarding.ways.sort')}</label>
        <select id={sortId} className={s.select} value={sort} onChange={(event) => onSort(event.target.value as WaySort)}>
          {WAY_SORTS.map((id) => <option key={id} value={id}>{t(`onboarding.ways.sort.${id}`)}</option>)}
        </select>
      </span>
    </div>
  );
}
