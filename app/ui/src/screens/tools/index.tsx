import type { Address } from '../../app/presentation.ts';
import type { PlaceModule, PlaceRenderProps } from '../../places/types.ts';
import { Screen } from '../trust/kit/Screen';
import { AssistantsPlace } from './Assistants';
import { PhonePlace } from './Phone';
import { PluginsPlace } from './Plugins';
import { SmallAppsPlace } from './SmallApps';
import { toolsWords } from './shared';

export { ToolRequestSheet } from './ToolRequestSheet';

/** The sub-place an address draws; a bare Tools address draws the first, Small apps. */
function sub(address: Address): string | null {
  return address.place === 'tools' ? address.sub ?? 'smallapps' : null;
}

/** Enterprise planning is not built in this lane yet. */
function PlanningPlace({ language }: PlaceRenderProps) {
  const w = toolsWords(language);
  return <Screen where={w.where} title={w['title.planning']} loaded={{ kind: 'not-built' }}>{() => null}</Screen>;
}

function place(id: string, render: (props: PlaceRenderProps) => ReturnType<PlaceModule['render']>): PlaceModule {
  return { id: `tools.${id}`, handles: (address) => sub(address) === id, render };
}

/** Tools: every sub-place drawn by this lane. */
export const toolsPlaces: readonly PlaceModule[] = [
  place('smallapps', (props) => <SmallAppsPlace {...props} />),
  place('plugins', (props) => <PluginsPlace {...props} />),
  place('assistants', (props) => <AssistantsPlace {...props} />),
  place('phone', (props) => <PhonePlace {...props} />),
  place('planning', (props) => <PlanningPlace {...props} />),
];
