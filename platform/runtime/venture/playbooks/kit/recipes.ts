// Chausar playbook kit: workflow recipes as data (Ink v2 wave 5, package 5A3; catalogue P6). A recipe tells the owner
// and the team when to use it, each step with why it is done, how to read what comes out, and the common mistakes. A
// mistake marked judge becomes a yes or no rule for the judge, each with its own floor (a required yes: a known mistake
// is never allowed by a share of votes). Business > Plan and playbook shows the recipes (venture.rules.list). Code only.
//
// Idea taken, code written here: marketplaces-mcp-ru ozon_mcp/workflows.yaml (workflows as data with when to use,
// steps, interpretation and common mistakes), read for the idea only.
import { check } from '../../../contracts.ts';
import type { RecipeView } from '../../contracts.ts';
import type { KitJudgeRule, KitRecipe } from './define.ts';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const filled = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * Refuses (RECIPE_INVALID, naming the recipe and the part) a playbook with no recipe, or a recipe without a short
 * lowercase id (or one listed twice), a name, when to use it, steps each with what to do and why, how to read the
 * result, or at least one common mistake. Returns the recipes as given.
 */
export function validateRecipes(recipes: readonly KitRecipe[]): readonly KitRecipe[] {
  check(recipes.length > 0, 'RECIPE_INVALID', 'A playbook needs at least one recipe.');
  const seen = new Set<string>();
  for (const recipe of recipes) {
    const refuse = (ok: unknown, what: string): void => check(ok, 'RECIPE_INVALID', `The recipe ${recipe.id} ${what}.`);
    refuse(typeof recipe.id === 'string' && ID.test(recipe.id), 'needs a short lowercase id');
    refuse(!seen.has(recipe.id), 'is listed twice');
    seen.add(recipe.id);
    refuse(filled(recipe.name), 'needs a name');
    refuse(filled(recipe.whenToUse), 'needs when to use it');
    refuse(Array.isArray(recipe.steps) && recipe.steps.length > 0, 'needs its steps');
    recipe.steps.forEach((step, index) => refuse(filled(step?.do) && filled(step?.why), `step ${index + 1} needs what to do and why`));
    refuse(filled(recipe.howToRead), 'needs how to read the result');
    refuse(Array.isArray(recipe.mistakes) && recipe.mistakes.length > 0 && recipe.mistakes.every(item => filled(item?.text)), 'needs its common mistakes');
  }
  return recipes;
}

/** "Blaming an update." as "blaming an update", to sit inside a sentence. A name ("WhatsApp") keeps its capital. */
function inner(text: string): string {
  const trimmed = text.trim().replace(/[.!?]+$/, '');
  const [first] = trimmed.split(/\s/, 1);
  return /^[A-Z][a-z]+$/.test(first) ? `${first[0].toLowerCase()}${trimmed.slice(1)}` : trimmed;
}

/**
 * The judge rules the recipes' judge mistakes make, in recipe and mistake order: id "<recipe>-mistake-<n>" (n counts
 * every mistake of the recipe), the question asked, the rule a no must quote, and a required-yes floor of its own.
 */
export function recipeJudgeRules(recipes: readonly KitRecipe[]): KitJudgeRule[] {
  return recipes.flatMap(recipe => recipe.mistakes.flatMap((mistake, index) => (mistake.judge
    ? [{
      id: `${recipe.id}-mistake-${index + 1}`,
      question: `Does the draft avoid this mistake: ${inner(mistake.text)}?`,
      text: `${recipe.name}: avoid ${inner(mistake.text)}.`,
      floor: { kind: 'required-yes' as const },
    }]
    : [])));
}

/** The recipes as Plan and playbook shows them: every word as written, the mistakes as plain lines. */
export function recipeViews(recipes: readonly KitRecipe[]): RecipeView[] {
  return recipes.map(recipe => ({
    id: recipe.id, name: recipe.name, whenToUse: recipe.whenToUse, steps: recipe.steps.map(step => ({ do: step.do, why: step.why })),
    howToRead: recipe.howToRead, mistakes: recipe.mistakes.map(item => item.text),
  }));
}
