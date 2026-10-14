/**
 * The Work place (WK-01..WK-16) through the place-module seam. Sub-places: approvals (the
 * default), jobs, actions, cando, after-restore. A sheet is the address's `sheet`, an
 * engine id encoded so it fits an address (contract.ts, sheetOf).
 */
import type { PlaceModule, PlaceRenderProps } from '../../places/types.ts';
import { Page } from './kit/Page';
import { SUBS, useHost, workWords, type WorkProps, type WorkSub } from './shared.tsx';
import { ApprovalsPage } from './Approvals.tsx';
import { ActionsPage } from './Actions.tsx';
import { CanDoPage } from './CanDo.tsx';
import { JobsPage } from './Jobs.tsx';
import { AfterRestorePage } from './AfterRestore.tsx';
import { DrivingPage } from './Driving.tsx';
import { BillPhotoBody } from '../books/BillPhoto.tsx';
import { kitWords } from './kit/words.ts';

const isSub = (value: string): value is WorkSub => (SUBS as readonly string[]).includes(value);

function WorkPlace(props: PlaceRenderProps) {
  const raw = props.address.sub ?? 'approvals';
  const sub: WorkSub = isSub(raw) ? raw : 'approvals';
  const w = workWords(props.language);
  const host = useHost(props, raw);
  if (!isSub(raw)) {
    return <Page place="work" sub={raw} subs={SUBS} title={w['approvals.title']} language={props.language} navigate={props.navigate} state={{ kind: 'not-built' }} />;
  }
  const p: WorkProps = { ...props, w, host, sub };
  switch (sub) {
    case 'approvals': return <ApprovalsPage p={p} />;
    case 'jobs': return <JobsPage p={p} />;
    case 'actions': return <ActionsPage p={p} />;
    case 'cando': return <CanDoPage p={p} />;
    case 'after-restore': return <AfterRestorePage p={p} />;
    case 'driving': return <DrivingPage p={p} />;
    // WK-13: the same reading and form as BK-18, reached from Work.
    case 'bill': return <Page place="work" sub="bill" subs={SUBS} title={kitWords(props.language)['sub.bill']} language={props.language} navigate={props.navigate}><BillPhotoBody props={props} /></Page>;
  }
}

/** The work place module. */
export const workPlace: PlaceModule = {
  id: 'work',
  handles: address => address.place === 'work',
  render: props => <WorkPlace key={props.address.sub ?? 'approvals'} {...props} />,
};
