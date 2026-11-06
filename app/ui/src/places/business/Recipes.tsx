/**
 * Business > Plan and playbook: a kit playbook's recipes and its measurement-boundaries table (Ink v2 wave 5, package
 * 5A3; catalogue P6), from venture.rules.list beside the dated rules (RulesSection). Each recipe shows its name and when
 * to use it; its steps with why, how to read the result and the common mistakes are one fold away. The table says,
 * for each kind of evidence, what it can say and what it cannot; on a phone each row reads as a short block with its
 * own labels. Every word is the engine's or this screen's; a flagship playbook has neither, and then nothing is drawn.
 *
 * Ideas taken, code written here: marketplaces-mcp-ru ozon_mcp/workflows.yaml (recipes as data) and beyondseo
 * references/measurement-boundaries.md, read for the idea only.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { RecipeView } from '../../engine/types';
import { Icon } from '../../parts/Icon';
import { TileSection } from './shared';
import r from './Recipes.module.css';

export function Recipes() {
  const t = useT();
  const view = useResource('venture.rules.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const data = view.data;
  if (!data || (!data.recipes.length && !data.boundaries.length)) return null;
  return (
    <>
      {data.recipes.length > 0 && (
        <TileSection title={t('kit-rules.recipes.heading')}>
          <ul className={r.recipes}>
            {data.recipes.map((recipe) => <li key={recipe.id}><Recipe recipe={recipe} /></li>)}
          </ul>
        </TileSection>
      )}
      {data.boundaries.length > 0 && (
        <TileSection title={t('kit-rules.bounds.heading')}>
          <table className={r.table}>
            <caption className={r.caption}>{t('kit-rules.bounds.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('kit-rules.bounds.evidence')}</th>
                <th scope="col">{t('kit-rules.bounds.can')}</th>
                <th scope="col">{t('kit-rules.bounds.cannot')}</th>
              </tr>
            </thead>
            <tbody>
              {data.boundaries.map((row) => (
                <tr key={row.evidence} data-boundary="">
                  <th scope="row">{row.evidence}</th>
                  <td><span className={r.cellLabel} aria-hidden="true">{t('kit-rules.bounds.can')}</span>{row.canSay}</td>
                  <td><span className={r.cellLabel} aria-hidden="true">{t('kit-rules.bounds.cannot')}</span>{row.cannotSay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TileSection>
      )}
    </>
  );
}

function Recipe({ recipe }: { recipe: RecipeView }) {
  const t = useT();
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className={r.recipe} data-recipe={recipe.id}>
      <h3 id={titleId} className={r.name}>{recipe.name}</h3>
      <p className={r.when}>{t('kit-rules.recipes.when', { when: recipe.whenToUse })}</p>
      <details className={r.fold}>
        <summary>{t('kit-rules.recipes.open')}<Icon name="chevron-down" size={16} /></summary>
        <div className={r.body}>
          <h4 className={r.sub}>{t('kit-rules.recipes.steps')}</h4>
          <ol className={r.steps}>
            {recipe.steps.map((step) => (
              <li key={step.do}>
                <span className={r.do}>{step.do}</span>
                <span className={r.why}>{t('kit-rules.recipes.why', { why: step.why })}</span>
              </li>
            ))}
          </ol>
          <h4 className={r.sub}>{t('kit-rules.recipes.read')}</h4>
          <p className={r.read}>{recipe.howToRead}</p>
          <h4 className={r.sub}>{t('kit-rules.recipes.mistakes')}</h4>
          <ul className={r.mistakes}>
            {recipe.mistakes.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </details>
    </article>
  );
}
