import { AsyncLocalStorage } from 'node:async_hooks';
import { check, hash } from './contracts.ts';
import type { State, StateStore } from './contracts.ts';
import { createLessonEvidenceAuthority } from './lesson-evidence.ts';
import { LessonService } from './lessons.ts';
import type {
  LessonEvaluationAuthority, LessonEvidenceResolver, LessonState, LessonStore, LessonTargetAuthority,
} from './lesson-contracts.ts';

/** Trusted installed ports, never an RPC payload or a persisted authority. */
export type EngineLessonOptions = {
  evidenceResolver: LessonEvidenceResolver;
  targets: LessonTargetAuthority;
  evaluations?: LessonEvaluationAuthority;
};

type WriterFrame = { state: State; active: boolean };

function lessonState(state: State): LessonState {
  const saved = state.lessonState;
  if (saved === undefined) return { workspaceId: state.workspace.id, episodes: [], lessons: [] };
  check(saved !== null && typeof saved === 'object' && Object.getPrototypeOf(saved) === Object.prototype &&
    Object.keys(saved).length === 3 && Object.keys(saved).every(key => ['workspaceId', 'episodes', 'lessons'].includes(key)) &&
    Array.isArray(saved.episodes) && Array.isArray(saved.lessons),
  'INVALID_LESSON_STATE', 'The saved lesson namespace must contain its workspace, episodes and lessons.');
  check(saved.workspaceId === state.workspace.id, 'LESSON_WORKSPACE_CHANGED', 'Saved lessons belong to their exact workspace.');
  return structuredClone(saved);
}

/** The comparison basis omits only independent private derived storage.
 * Authentic evidence resolvers still receive the full state and real revision. */
function businessAuthorityRevision(state: State): string {
  const { lessonState: ignoredLessons, scenarioRecords: ignoredScenarios, ...business } = state;
  return hash({ ...business, revision: 0 });
}

/**
 * Persist the isolated lifecycle through the existing serialized, encrypted
 * StateStore transaction. Lesson callbacks receive no business State or write
 * capability, and retained callback/result aliases cannot change stored data.
 * Callback throws roll back through that store. External target/evaluation
 * revocation during asynchronous storage publication is refused by the existing
 * postcommit release; it does not undo an already committed protocol record.
 */
export function createEngineLessonService(store: StateStore, options: EngineLessonOptions): LessonService {
  check(typeof options?.evidenceResolver === 'function' && options.targets &&
    typeof options.targets.authorityRevision === 'function' && typeof options.targets.resolve === 'function' &&
    typeof options.targets.validateChange === 'function',
  'LESSON_AUTHORITY_REQUIRED', 'Install current evidence and personal-target authorities before using lessons.');
  const { evidenceResolver, targets, evaluations } = options;
  check(evaluations === undefined || evaluations && typeof evaluations.authorityRevision === 'function' &&
    typeof evaluations.resolve === 'function' && typeof evaluations.assertSourceAccess === 'function',
  'EVALUATION_AUTHORITY_REQUIRED', 'An installed evaluation authority must resolve current exact runs and access.');

  const writer = new AsyncLocalStorage<WriterFrame>();
  const currentState = () => {
    const frame = writer.getStore();
    return frame?.active ? frame.state : store.read();
  };
  const restricted: LessonStore = {
    read() { return lessonState(currentState()); },
    update<T>(change: (state: LessonState) => T): Promise<T> {
      return store.update(state => {
        const frame: WriterFrame = { state, active: true };
        return writer.run(frame, () => {
          try {
            const draft = lessonState(state), result = change(draft);
            check(result === null || (typeof result !== 'object' && typeof result !== 'function') ||
              typeof (result as { then?: unknown }).then !== 'function',
            'ASYNC_LESSON_UPDATE', 'Lesson lifecycle callbacks must finish synchronously before publication.');
            const saved = lessonState({ ...state, lessonState: draft });
            const detachedResult = structuredClone(result);
            state.lessonState = saved;
            return detachedResult;
          } finally {
            // Child microtasks may retain AsyncLocalStorage context, but they
            // must never use a finished writer's stale authority snapshot.
            frame.active = false;
          }
        });
      });
    },
  };
  const authentic = createLessonEvidenceAuthority(currentState, evidenceResolver);
  const evidence = {
    ...authentic,
    authorityRevision: () => businessAuthorityRevision(currentState()),
  };
  return new LessonService(restricted, { evidence, targets, ...(evaluations ? { evaluations } : {}) });
}
