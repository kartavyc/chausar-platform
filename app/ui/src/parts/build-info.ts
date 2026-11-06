/**
 * One-shot C4 task 41: this build's version and when it was built, as constants the build writes in (vite.config.ts and
 * vitest.config.ts define them). They name this copy of the app and nothing else, so reading them asks the engine nothing.
 */
declare const __CHAUSAR_VERSION__: string;
declare const __CHAUSAR_BUILT_AT__: string;

export const APP_VERSION: string = __CHAUSAR_VERSION__;
export const BUILT_AT: string = __CHAUSAR_BUILT_AT__;
