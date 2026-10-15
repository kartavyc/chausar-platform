import type { LaneSubPlace } from './types.ts';

/** Sub-places the reports-tools-trust lane adds to the rail. Only the owning lane edits this file.
 *  Each one needs its name under SH-01.sub.<place>.<id> in app/ui/src/text/lanes/reports-tools-trust.ts. */
export const subPlaces: readonly LaneSubPlace[] = [
  // TR-08 models
  { place: 'trust', id: 'models-compare' },
  { place: 'trust', id: 'models-prices' },
  { place: 'trust', id: 'models-voice' },
  { place: 'trust', id: 'models-allowance' },
  // end TR-08 models
  // TR-07/12/14 vault-hosted-keys
  { place: 'trust', id: 'keys' },
  { place: 'trust', id: 'devices' },
  { place: 'trust', id: 'hosted' },
  // end TR-07/12/14 vault-hosted-keys
];
