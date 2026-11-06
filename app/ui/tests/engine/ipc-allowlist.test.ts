import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { RENDERER_METHOD_NAMES } from '../../src/engine/methods.gen';

/**
 * Spec section 9: every engine method the UI can call is in the desktop's IPC allowlist, so nothing the app shows
 * fails on the desktop with "not allowed". The UI's methods are the keys of EngineMethods in src/engine/types.ts.
 */
const require = createRequire(import.meta.url);
const { METHODS } = require('../../../desktop/ipc-contract.cjs') as { METHODS: readonly string[] };

const called = RENDERER_METHOD_NAMES;
