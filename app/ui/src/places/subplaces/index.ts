/** Every lane's added sub-places, by lane, in rail order after the authored ones. This list is fixed. */
import type { LaneSubPlace } from './types.ts';
import { subPlaces as frameToday } from './frame-today.ts';
import { subPlaces as ask } from './ask.ts';
import { subPlaces as workBooks } from './work-books.ts';
import { subPlaces as reportsToolsTrust } from './reports-tools-trust.ts';
import { subPlaces as connectorsExt } from './connectors-ext.ts';
import { subPlaces as writeback } from './writeback.ts';
import { subPlaces as jobsExt } from './jobs-ext.ts';
import { subPlaces as learningExt } from './learning-ext.ts';
import { subPlaces as hostedLink } from './hosted-link.ts';
import { subPlaces as release } from './release.ts';
import { subPlaces as modelsExt } from './models-ext.ts';
import { subPlaces as driving } from './driving.ts';
import { subPlaces as caEnterprise } from './ca-enterprise.ts';

export const laneSubPlaces: Readonly<Record<string, readonly LaneSubPlace[]>> = {
  'frame-today': frameToday,
  'ask': ask,
  'work-books': workBooks,
  'reports-tools-trust': reportsToolsTrust,
  'connectors-ext': connectorsExt,
  'writeback': writeback,
  'jobs-ext': jobsExt,
  'learning-ext': learningExt,
  'hosted-link': hostedLink,
  'release': release,
  'models-ext': modelsExt,
  'driving': driving,
  'ca-enterprise': caEnterprise,
};

export type { LaneSubPlace } from './types.ts';
