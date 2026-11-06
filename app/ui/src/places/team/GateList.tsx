import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { EngineError, type AgentView } from '../../engine/types';
import { Count } from '../../parts/Figure';
import { Gate } from '../../parts/Gate';
import { Icon } from '../../parts/Icon';
import type { DeptId, IconName } from '../../parts/icons';
import s from './Team.module.css';

type GateValue = 'auto' | 'hold';

export interface GateListProps {
  agents: readonly AgentView[];
  /** `list`: the agent panel's plain rows. `flow`: D's numbered steps on inner cards (`.steps`, `.step`), for a
   *  department's playbook, each step with the agent that runs it. */
  look: 'list' | 'flow';
  /** The id of the heading that names the list. */
  labelledBy?: string | undefined;
  dept?: DeptId | undefined;
  /** The engine's answer to a change: the agent as it now stands. */
  onSaved: (agent: AgentView) => void;
  /** The engine refused because the step is on the floor: the list it came from should be read again. */
  onFloor?: (() => void) | undefined;
}

/** A step's own icon in the flow, from how it runs (the engine names no per-step icon): a lock on a floor step, a
 *  play mark on one that runs on its own, a clock on one that waits for you. */
function stepIcon(step: { floor: boolean; gate: 'auto' | 'hold' }): IconName {
  if (step.floor) return 'lock';
  return step.gate === 'auto' ? 'play' : 'clock';
}

/**
 * Each playbook step with its gate (Auto runs without asking, Hold waits for you), D's `.gate`; a floor step always
 * asks and has no switch. A switch moves when clicked and settles on the engine's answer (venture.team.gate); a
 * refusal moves it back and says why under the step. One change at a time.
 */
export function GateList({ agents, look, labelledBy, dept, onSaved, onFloor }: GateListProps) {
  const t = useT();
  const client = useEngine();
  const [pending, setPending] = useState<{ agentId: string; stepId: string; gate: GateValue } | null>(null);
  const [problem, setProblem] = useState<{ agentId: string; stepId: string; text: string } | null>(null);

  async function change(agent: AgentView, stepId: string, gate: GateValue) {
    if (pending) return;
    setProblem(null);
    setPending({ agentId: agent.id, stepId, gate });
    try {
      const reply = await client.request('venture.team.gate', { agentId: agent.id, stepId, gate });
      onSaved(reply.agent);
    } catch (error) {
      const floor = error instanceof EngineError && error.code === 'GATE_FLOOR';
      const message = error instanceof Error ? error.message : String(error);
      setProblem({ agentId: agent.id, stepId, text: floor ? t('team.gateFloor') : t('team.gateFailed', { message }) });
      if (floor) onFloor?.();
    } finally {
      setPending(null);
    }
  }

  const steps = agents.flatMap((agent) => agent.steps.map((step) => ({ agent, step })));
  const flow = look === 'flow';
  const List = flow ? 'ol' : 'ul';
  return (
    <>
    <List className={flow ? s.flow : s.steps} aria-labelledby={labelledBy}>
      {steps.map(({ agent, step }, at) => {
        const gate = pending?.agentId === agent.id && pending.stepId === step.id ? pending.gate : step.gate;
        const refused = problem?.agentId === agent.id && problem.stepId === step.id ? problem.text : null;
        const control = <Gate purpose={step.purpose} gate={gate} floor={step.floor} disabled={pending !== null} onChange={(next) => void change(agent, step.id, next)} />;
        if (!flow) {
          return (
            <li key={`${agent.id}:${step.id}`} className={s.step}>
              <span className={s.purpose}>{step.purpose}</span>
              {control}
              {refused && <p role="alert" className={s.problem}>{refused}</p>}
            </li>
          );
        }
        return (
          <li key={`${agent.id}:${step.id}`} className={s.flowStep}>
            <span className={s.stepNo} aria-hidden="true"><Count value={at + 1} /></span>
            <span className={s.stepIcon} data-dept={dept} aria-hidden="true"><Icon name={stepIcon(step)} size={16} /></span>
            <span className={s.stepText}>
              <span className={s.stepTitle}>{step.purpose}</span>
              <span className={s.stepSub}>{agent.name}</span>
            </span>
            {control}
            {refused && <p role="alert" className={s.problem}>{refused}</p>}
          </li>
        );
      })}
    </List>
    {/* W4 4J22a: Auto on a step runs it alone only at the locked posture (4J15); until that opens, it asks. */}
    <p className={s.quiet} data-auto-note="">{t('team.gate.autoNote')}</p>
    </>
  );
}
