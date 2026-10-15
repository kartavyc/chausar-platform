/**
 * Books, Learning: the learning-ext lane's place. Four sections over the `learningx.*` methods:
 * dictionary edits, the first dictionary, the answer key, and model asks. The module draws
 * exactly the address Books/learning; the sub-place is registered in places/subplaces/learning-ext.ts.
 */
import { useState, type ReactNode } from 'react';
import type { PlaceModule } from '../../places/types.ts';
import { PageHeader } from '../../app/PageHeader';
import { Edits } from './Edits.tsx';
import { FirstDictionary } from './FirstDictionary.tsx';
import { AnswerKey } from './AnswerKey.tsx';
import { ModelAsks } from './ModelAsks.tsx';
import { Button, styles as s, useLx, type LearningProps } from './shared.tsx';
import { handlesLearning } from './address.ts';

export const SECTIONS = ['edits', 'first', 'key', 'model'] as const;
type Section = typeof SECTIONS[number];
const SCREENS: Readonly<Record<Section, (props: LearningProps) => ReactNode>> = { edits: Edits, first: FirstDictionary, key: AnswerKey, model: ModelAsks };

function Learning(props: LearningProps) {
  const lx = useLx();
  const [section, setSection] = useState<Section>('edits');
  const Screen = SCREENS[section];
  return (
    <div className={[s.page, s[props.view]].join(' ')} data-view={props.view} data-place="books" data-sub="learning">
      <PageHeader where={lx('where')} title={lx('title')} />
      <nav aria-label={lx('sections')}>
        <ul className={s.tabs}>
          {SECTIONS.map(id => (
            <li key={id}><Button variant="link" aria-pressed={section === id} onClick={() => setSection(id)}>{lx(`section.${id}`)}</Button></li>
          ))}
        </ul>
      </nav>
      {props.viewer && <p className={s.note}>{lx('readOnly')}</p>}
      <Screen key={section} {...props} />
    </div>
  );
}

export const learningPlace: PlaceModule = {
  id: 'learning-ext.books.learning',
  handles: handlesLearning,
  render: props => <Learning key={props.language} {...props} />,
};
