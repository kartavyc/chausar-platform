/** Every engine module. Each lane owns exactly one file below; this list is fixed. */
import type { EngineModule } from './types.ts';
import { frameTodayModule } from './lane-frame-today.ts';
import { askModule } from './lane-ask.ts';
import { workBooksModule } from './lane-work-books.ts';
import { reportsToolsTrustModule } from './lane-reports-tools-trust.ts';
import { connectorsExtModule } from './lane-connectors-ext.ts';
import { writebackModule } from './lane-writeback.ts';
import { jobsExtModule } from './lane-jobs-ext.ts';
import { learningExtModule } from './lane-learning-ext.ts';
import { hostedLinkModule } from './lane-hosted-link.ts';
import { releaseModule } from './lane-release.ts';
import { modelsExtModule } from './lane-models-ext.ts';

export const modules: readonly EngineModule[] = [ frameTodayModule, askModule, workBooksModule, reportsToolsTrustModule, connectorsExtModule, writebackModule, jobsExtModule, learningExtModule, hostedLinkModule, releaseModule, modelsExtModule, ];
