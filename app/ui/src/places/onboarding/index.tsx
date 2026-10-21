import { useContext } from 'react';
import { StartedContext } from './boot';
import { Start } from './Start';

/** "New business" from the business menu: the same one-sentence start, inside the app. */
export function Place() {
  const started = useContext(StartedContext);
  return <Start variant="place" onStarted={started} />;
}

export { FirstRun } from './FirstRun';
export { StartedContext, useFirstRun } from './boot';
