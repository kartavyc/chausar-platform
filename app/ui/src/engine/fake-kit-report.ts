/**
 * The fake engine's answers for client reports and their share links (Ink v2 wave 5, package 5A5), in the engine's
 * shapes, codes and words. Package 5-0 registered each method; until 5A5 lands each answers NOT_BUILT_YET, as the
 * engine does. 5A5 fills this file.
 */

import { EngineError } from './types';
import type { W4DeskHost } from './fake-w4';

const METHODS = new Set<string>([
  'venture.report.render',
  'venture.report.share',
  'venture.report.shareRotate',
  'venture.report.shareDisable',
]);
const NOT_BUILT = 'This part of Chausar is not built yet.';

export class FakeKitReportDesk {
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
