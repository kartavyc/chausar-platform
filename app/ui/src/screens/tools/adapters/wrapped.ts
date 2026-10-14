/**
 * Adapter for the models-ext lane's wrapped tools (`plugins.wrapped`, `plugins.reapprove`),
 * which may not exist yet. Both descriptions are outside text: shown as data, never obeyed.
 */
import { bool, list, rec, str } from '../../trust/kit/validate.ts';
import { id } from '../validate.ts';

export const WRAPPED = { list: 'plugins.wrapped', reapprove: 'plugins.reapprove' } as const;

export interface WrappedTool { readonly id: string; readonly name: string; readonly ours: string; readonly theirs: string; readonly changed: boolean }
export function wrapped(value: unknown): readonly WrappedTool[] {
  return list(rec(value)['tools'], 'reply.tools', (v, p) => {
    const t = rec(v, p);
    return { id: id(t['id'], `${p}.id`), name: str(t['name'], `${p}.name`, 200), ours: str(t['ours'], `${p}.ours`, 4000), theirs: str(t['theirs'], `${p}.theirs`, 4000), changed: bool(t['changed'], `${p}.changed`) };
  }, 200);
}
