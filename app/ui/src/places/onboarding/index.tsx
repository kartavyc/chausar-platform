import { useContext } from 'react';
import { StartedContext } from './started';
import { Start } from './Start';

/** "New business" from the business menu: the same one-sentence start, inside the app. */
export function Place() {
  const started = useContext(StartedContext);
  return <Start variant="place" onStarted={started} />;
}
