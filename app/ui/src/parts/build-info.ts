/**
 * One-shot C4 task 41: this build's version and when it was built, as constants the build writes in (vite.config.ts and
 * vitest.config.ts define them). They name this copy of the app and nothing else, so reading them asks the engine nothing.
 */
export const APP_VERSION: string = import.meta.env.VITE_CHAUSAR_VERSION;
export const BUILT_AT: string = import.meta.env.VITE_CHAUSAR_BUILT_AT;
