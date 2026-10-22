import { createContext } from 'react';

/**
 * What a place calls once a new business exists (or one was opened); the app provides it. It lives alone in this file
 * so a hot reload of the boot or the start screens never makes a second context the provider and readers disagree on.
 */
export const StartedContext = createContext<() => void>(() => {});

/**
 * After the open business was closed, locked or deleted: what Welcome back does next. `autoOpen: false` keeps the one
 * business left from opening by itself (after a delete); `ask` opens Welcome back on that business's passphrase or
 * its recovery code; `problem` says, in plain words, why the next business did not open.
 */
export interface Leaving { autoOpen?: boolean; ask?: { folder: string; with: 'passphrase' | 'recovery-code' }; problem?: string }

/** What a place calls once the business it showed is no longer open; the app goes back to Welcome back. */
export const LeftContext = createContext<(after?: Leaving) => void>(() => {});
