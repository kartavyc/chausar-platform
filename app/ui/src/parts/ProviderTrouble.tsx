import { useT } from '../text';
import { useOwnerZone } from '../shell/clock';
import type { ProviderTroubleLite } from '../engine/types';
import { momentOf } from './custody';

/**
 * A2: the AI provider's own status page when it says the provider has problems ("Claude is having problems right now,
 * not you."), in the engine's words, with the page it was read from and when.
 */
export function ProviderTrouble({ trouble, className }: { trouble: ProviderTroubleLite; className?: string }) {
  const t = useT();
  const zone = useOwnerZone();
  return <p className={className} role="status" data-provider-status="">{trouble.line} {t('ai.statusFrom', { source: trouble.source, time: momentOf(trouble.readAt, zone) })}</p>;
}
