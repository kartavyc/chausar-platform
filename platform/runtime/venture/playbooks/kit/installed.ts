// Chausar playbook kit: the kit definitions the engine reads now (Ink v2 wave 5, package 5A1). The landed ones are
// playbooks/definitions.ts PLAYBOOK_DEFINITIONS (each business package fills its own stub); tests may install a
// fixture definition beside them, which registers it too (registry.ts), so a whole business can run on it. The landed
// definitions are loaded on the first call, never at import: a definition calls definePlaybook when it loads, and
// definePlaybook reads the shared playbook and harness code, so a definition must load only once every shared module
// is set up, whichever module the process imported first. Every shared playbook function reads kitDefinitions() when
// it is called, never at load. Written for Chausar; nothing here is learned from an outside source.
import { createRequire } from 'node:module';
import { setTestRegistrations } from '../registry.ts';
import type { PlaybookDefinition } from './define.ts';
import { forgetHi, keepHi, type HiFile } from './words.ts';

let installed: readonly PlaybookDefinition[] = Object.freeze([]);
let landed: readonly PlaybookDefinition[] | null = null;

/** playbooks/definitions.ts PLAYBOOK_DEFINITIONS, loaded once, on first use (see the header). */
function landedDefinitions(): readonly PlaybookDefinition[] {
  landed ??= (createRequire(import.meta.url)('../definitions.ts') as { PLAYBOOK_DEFINITIONS: readonly PlaybookDefinition[] }).PLAYBOOK_DEFINITIONS;
  return landed;
}

/** Every kit definition: the landed ones in package order, then any a test installed. */
export function kitDefinitions(): readonly PlaybookDefinition[] {
  const definitions = landedDefinitions();
  return installed.length ? [...definitions, ...installed] : definitions;
}

/** The kit definition with this playbook id, or null (a flagship, a plain business, or a stub still null). */
export function kitDefinition(id: string | null | undefined, definitions: readonly PlaybookDefinition[] = kitDefinitions()): PlaybookDefinition | null {
  return id ? definitions.find(definition => definition.registration.id === id) ?? null : null;
}

/**
 * Tests only: installs definitions (already passed through definePlaybook) beside the landed ones, registers them so
 * an idea can pick them, and keeps their Hindi. Returns the undo, which puts everything back.
 */
export function installTestPlaybooks(definitions: readonly { definition: PlaybookDefinition; hi: HiFile }[]): () => void {
  const before = installed;
  installed = Object.freeze([...before, ...definitions.map(item => item.definition)]);
  for (const item of definitions) keepHi(item.definition.registration.id, item.hi);
  setTestRegistrations(installed.map(definition => definition.registration));
  return () => {
    installed = before;
    for (const item of definitions) forgetHi(item.definition.registration.id);
    setTestRegistrations(before.map(definition => definition.registration));
  };
}
