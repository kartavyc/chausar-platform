import { useT } from '../text';
import { EmptyState } from '../parts/EmptyState';
import { PageTitle } from '../parts/PageTitle';
import type { PlaceId } from '../shell/routes';

/** A placeholder so the shell runs before a place is built. Phase 2 replaces each place's index.tsx. */
export function PlaceStub({ place }: { place: PlaceId }) {
  const t = useT();
  return (
    <>
      <PageTitle title={t(`place.${place}`)} />
      <EmptyState title={t('stub.line')} />
    </>
  );
}
