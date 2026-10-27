/**
 * The fake engine's answers for monitors, mail import, local apps, the webhook handoff and speech providers (Ink v2
 * wave 5, package 5A6), in the engine's shapes, codes and words. Package 5-0 registered each method; until 5A6 lands
 * each answers NOT_BUILT_YET, as the engine does. 5A6 fills this file.
 */

import { EngineError } from './types';
import type { W4DeskHost } from './fake-w4';

const METHODS = new Set<string>([
  'venture.monitors.list',
  'venture.monitors.add',
  'venture.monitors.remove',
  'venture.mail.import',
  'venture.mail.threads',
  'venture.localApps.list',
  'venture.webhook.set',
  'venture.speechOut.providers',
]);
const NOT_BUILT = 'This part of Chausar is not built yet.';

export class FakeKitConnectDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return METHODS.has(method);
  }

  request(_method: string, _p: Record<string, unknown>): unknown {
    throw new EngineError('NOT_BUILT_YET', NOT_BUILT);
  }
}
