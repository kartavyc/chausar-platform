import { METHODS as area0 } from './workspace-methods.ts';
import { METHODS as area1 } from './custody-methods.ts';
import { METHODS as area2 } from './draft-desk-methods.ts';
import { METHODS as area3 } from './updates-methods.ts';
import { METHODS as area4 } from './app-methods.ts';
import { METHODS as area5 } from './venture-methods.ts';
import { METHODS as area6 } from './legacy-methods.ts';
import type { Handler } from './admission.ts';
export const ENGINE_HANDLERS: Readonly<Record<string, Handler>> = Object.freeze(Object.assign(Object.create(null), area0, area1, area2, area3, area4, area5, area6));
