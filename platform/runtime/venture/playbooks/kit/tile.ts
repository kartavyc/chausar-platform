// Chausar playbook kit: a kit playbook's Start tile as the gallery's way data (Ink v2 wave 5, package 5A1; spec 5.8
// "the start tile"). The definition's startTile (category, the line, what the owner does and the hours a week, the team
// and its line, what clients usually pay and per what) maps onto wave 4's WayData (playbooks/ways.ts), so
// venture.playbooks.list shows it like a flagship's: hours and pay a model estimate with their basis, the team's AI
// agents only, with every display word in English. What it needs names only the
// playbook's connectors that work today (write, read or handoff), never a planned one. Written for Chausar; nothing
// here is learned from an outside source.
import type { PlaybookDefinition } from './define.ts';
import type { WayData } from '../ways.ts';
import { pickPlaybook } from '../registry.ts';

const capitalised = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);
const listed = (items: readonly string[], and: string) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)}` : items[0] ?? '');

/** The words that start a business on this playbook: its label when that picks it, else its first phrase, then the line. */
function starterHead(definition: PlaybookDefinition): string {
  const { label, picks } = definition.registration;
  return pickPlaybook(label, [definition.registration])?.id === definition.registration.id ? label : capitalised(picks[0]);
}

/** A kit definition's tile as the gallery's way data. */
export function kitWay(definition: PlaybookDefinition): WayData {
  const id = definition.registration.id;
  const tile = definition.startTile;
  const working = definition.connectors.filter(connector => !connector.label.startsWith('planned'));
  const head = starterHead(definition);
  return {
    playbook: id,
    category: tile.category,
    hours: { min: tile.youDo.hoursMin, max: tile.youDo.hoursMax },
    pay: { minRupees: tile.pay.minRupees, maxRupees: tile.pay.maxRupees },
    en: {
      label: definition.registration.label, line: tile.line, youDo: tile.youDo.line, teamLine: tile.team.line, per: tile.pay.per,
      starter: `${head}: ${tile.line}`,
      needs: working.length ? `Works with ${listed(working.map(connector => connector.name), 'and')}.` : 'Nothing past your own AI and your files.',
    },


    uses: working.map(connector => connector.id),
    team: [...tile.team.roleIds],
  };
}
