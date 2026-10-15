/**
 * The jobs-ext Work sub-places through the place-module seam: work/procedures and
 * work/job-controls. Any other address is not this module's.
 */
import type { Address } from '../../app/presentation.ts';
import type { PlaceModule, PlaceRenderProps } from '../../places/types.ts';
import { ProceduresPage } from './Procedures.tsx';
import { JobControlsPage } from './JobControls.tsx';

export const JOBSX_SUBS = ['procedures', 'job-controls'] as const;

export function handlesJobsx(address: Address): boolean {
  return address.place === 'work' && (address.sub === 'procedures' || address.sub === 'job-controls');
}

function JobsxPlace(props: PlaceRenderProps) {
  return props.address.sub === 'procedures' ? <ProceduresPage props={props} /> : <JobControlsPage props={props} />;
}

/** The jobs-ext place module. */
export const jobsxPlace: PlaceModule = {
  id: 'jobs-ext',
  handles: handlesJobsx,
  render: props => <JobsxPlace key={props.address.sub ?? ''} {...props} />,
};
