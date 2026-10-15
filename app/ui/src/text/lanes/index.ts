/** Every lane's added words. This list is fixed; each lane owns one file. */
import { words as frameToday } from './frame-today.ts';
import { words as ask } from './ask.ts';
import { words as workBooks } from './work-books.ts';
import { words as reportsToolsTrust } from './reports-tools-trust.ts';
import { words as connectorsExt } from './connectors-ext.ts';
import { words as writeback } from './writeback.ts';
import { words as jobsExt } from './jobs-ext.ts';
import { words as learningExt } from './learning-ext.ts';
import { words as hostedLink } from './hosted-link.ts';
import { words as release } from './release.ts';
import { words as modelsExt } from './models-ext.ts';
import { words as driving } from './driving.ts';
import { words as caEnterprise } from './ca-enterprise.ts';

export const laneWords: Readonly<Record<string, { readonly en: Readonly<Record<string, string>>; readonly hi: Readonly<Record<string, string>> }>> = {
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
