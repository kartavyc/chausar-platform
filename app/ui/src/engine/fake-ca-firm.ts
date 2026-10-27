/**
 * The fake engine's desk for AI-native CA firm (Ink v2 wave 5, packages 5C1, 5C2), in the engine's shapes, codes and
 * words (platform/runtime/venture/playbooks/ca-firm/desk.ts). Package 5-0 left it empty, so venture.desk.* for this
 * playbook answers NOT_BUILT_YET, as the engine does; the package fills its record kinds here.
 */

import { EngineError } from './types';
import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';

const NOT_BUILT = 'This part of Chausar is not built yet.';
const notBuilt = (): never => { throw new EngineError('NOT_BUILT_YET', NOT_BUILT); };

/** The CA firm's desk, and its wave 5 methods (5C1, 5C2), each answering NOT_BUILT_YET until its package lands. */
export function fakeCaFirmDesk(_host: W4DeskHost): FakePlaybookDesk {
  return {
    playbook: 'ca-firm',
    kinds: {},
    methods: {
      'venture.ca.confirmCitations': notBuilt, // 5C1
      'venture.ca.signoff.get': notBuilt, // 5C1
      'venture.ca.differential.add': notBuilt, // 5C2
      'venture.ca.dataPack.export': notBuilt, // 5C2
    },
  };
}
