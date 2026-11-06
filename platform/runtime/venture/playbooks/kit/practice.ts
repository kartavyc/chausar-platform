// Chausar playbook kit: a kit playbook's three practice clients, as rehearsal cases (Ink v2 wave 5, package 5A1). Each
// definition names a clean, a messy and a pushy client with their request and files; a kit business rehearses on them
// (delivery/scenarios.ts scenariosFor with the playbook), through the kit's checks and, with an AI judge on, the
// playbook's own rules (2C1's path, delivery/simulate.ts). The files are Chausar's own made-up files, never a client's,
// so rehearsals stay free of client data: CSV tables, or SRT and VTT transcripts. Written for Chausar; nothing here is
// learned from an outside source.
import type { ScenarioKind, UploadFormat } from '../../contracts.ts';
import type { KitPracticeClient, PlaybookDefinition } from './define.ts';
import { kitDefinitions } from './installed.ts';

/** The rehearsal kind of each practice client: the pushy client is the engine's pushback case. */
export const PRACTICE_KIND: Readonly<Record<KitPracticeClient['kind'], ScenarioKind>> = Object.freeze({ clean: 'clean', messy: 'messy', pushy: 'pushback' });

/** A practice file's format by its name, or null for a kind of file the tools can't read. */
export function practiceFormat(name: string): UploadFormat | null {
  if (/\.csv$/i.test(name)) return 'csv';
  if (/\.(srt|vtt)$/i.test(name)) return 'transcript';
  return null;
}

/** The rehearsal case id of one practice client: '<playbook>-clean', '<playbook>-messy', '<playbook>-pushback'. */
export const practiceScenarioId = (playbook: string, kind: KitPracticeClient['kind']): string => `${playbook}-${PRACTICE_KIND[kind]}`;

/** The practice client a case id names, with its definition, or null for any other case. */
export function kitPracticeClient(scenarioId: string, definitions: readonly PlaybookDefinition[] = kitDefinitions()): { definition: PlaybookDefinition; client: KitPracticeClient } | null {
  for (const definition of definitions) {
    const client = definition.practice.find(item => practiceScenarioId(definition.registration.id, item.kind) === scenarioId);
    if (client) return { definition, client };
  }
  return null;
}
