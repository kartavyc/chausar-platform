import { createContext } from 'react';

/**
 * What a place calls once a new business exists (or one was opened); the app provides it. It lives alone in this file
 * so a hot reload of the boot or the start screens never makes a second context the provider and readers disagree on.
 */
export const StartedContext = createContext<() => void>(() => {});
