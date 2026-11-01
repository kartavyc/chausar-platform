// Chausar venture launcher, core (wave 6, 6C2): the families bound to the engine's own idea classifier. families.ts stays
// free of engine imports so the app's fake engine can read the same data; the engine calls these.
import { familyIdeaWith, keywordFamilyWith, type FamilyId } from './families.ts';
import { classifyIdea } from './service-types.ts';

/** The no-AI guess of the owner's family, with the plan's own classifier as the last fallback. */
export function keywordFamily(text: string): FamilyId | null {
  return keywordFamilyWith(text, classifyIdea);
}

/** The idea sentence the plan starts from for this family (families.ts familyIdeaWith). */
export function familyIdea(id: FamilyId, ownerWords: string): string {
  return familyIdeaWith(id, ownerWords, classifyIdea);
}
