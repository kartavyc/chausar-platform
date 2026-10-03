/**
 * Enterprise additions, from props only.
 * Lens: a row of words at the top of Today; the chosen one is underlined. It changes
 * which objectives and changes are shown, not what is true.
 * Whose: Mine, My team, Everyone at the top right of a list.
 */

import type { Lens, Whose } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Choice } from '../parts/Choice';

const LENSES: ReadonlyArray<Lens> = ['whole-group', 'finance', 'sales', 'operations'];
const WHOSE: ReadonlyArray<Whose> = ['mine', 'team', 'everyone'];

export function LensRow({ value, onChange, className }: { value: Lens; onChange: (lens: Lens) => void; className?: string | undefined }) {
  const t = useT();
  return (
    <Choice<Lens>
      label={t('EN.lens')}
      labelHidden
      options={LENSES.map((l) => ({ value: l, label: t(`EN.lens.${l}`) }))}
      value={value}
      onChange={onChange}
      className={className}
    />
  );
}

export function WhoseRow({ value, onChange, className }: { value: Whose; onChange: (w: Whose) => void; className?: string | undefined }) {
  const t = useT();
  return (
    <Choice<Whose>
      label={t('EN.whose')}
      labelHidden
      options={WHOSE.map((w) => ({ value: w, label: t(`EN.whose.${w}`) }))}
      value={value}
      onChange={onChange}
      className={className}
    />
  );
}
