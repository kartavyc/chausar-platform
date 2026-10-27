// Chausar delivery harness: the monitored-data playbook's own tools (Monitored data service; Ink v2 wave 5, packages
// 5R5). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with
// the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type MonitoredDataToolName = Extract<ToolName, 'monitor.extract'>;

export const MONITORED_DATA_TOOLS: Readonly<Record<MonitoredDataToolName, Spec>> = Object.freeze({
  'monitor.extract': notBuiltTool('monitor.extract', 'read', 'Values from a watched page, only from the elements you picked.'), // 5R5
});
