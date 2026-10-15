import type { PlaceId } from '../../app/presentation.ts';

/** A sub-place a lane adds to the rail. Its name is the text key SH-01.sub.<place>.<id>. */
export interface LaneSubPlace {
  readonly place: PlaceId;
  readonly id: string;
  /** The shells that list it. Absent means the desktop shell only. */
  readonly shells?: ReadonlyArray<'desktop' | 'enterprise' | 'ca-firm'>;
}
