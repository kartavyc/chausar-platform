import type { EngineModule } from './types.ts';
import { MODULE_ID } from '../models-ext/part.ts';
import { routesPart } from '../models-ext/routes-methods.ts';
import { benchPart } from '../models-ext/bench-methods.ts';
import { speechPart } from '../models-ext/speech-methods.ts';
import { smallAppsPart } from '../smallapps/methods.ts';
import { pluginWrapPart } from '../smallapps/plugin-methods.ts';
import { modelsExtHostOptions } from '../models-ext/host-options.ts';

const parts = [routesPart, benchPart, speechPart, smallAppsPart, pluginWrapPart];

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const modelsExtModule: EngineModule = {
  id: MODULE_ID,
  methods: Object.assign({}, ...parts.map(part => part.methods)),
  hostOptions: modelsExtHostOptions,
  purge(state, reason) { return parts.reduce((total, part) => total + (part.purge?.(state, reason) ?? 0), 0); },
};
