// Chausar delivery harness: the app-testing playbook's own tools (App testing and demo videos; Ink v2 wave 5, packages
// 5R3). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with
// the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type AppTestingToolName = Extract<ToolName, 'apptest.logcat' | 'demo.plan'>;

export const APP_TESTING_TOOLS: Readonly<Record<AppTestingToolName, Spec>> = Object.freeze({
  'apptest.logcat': notBuiltTool('apptest.logcat', 'read', 'The test app\'s logs from the emulator on this computer.'), // 5R3
  'demo.plan': notBuiltTool('demo.plan', 'compute', 'The demo video planned scene by scene.'), // 5R3
});
