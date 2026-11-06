import { useT } from '../../text';
import type { AgentView } from '../../engine/types';
import { Count } from '../../parts/Figure';
import { Gate } from '../../parts/Gate';
import { Icon } from '../../parts/Icon';
import type { DeptId } from '../../parts/icons';
import s from './Team.module.css';
import sLocal from './GateList.module.css';

export interface GateListProps {
  agents: readonly AgentView[];
  look: 'list' | 'flow';
  labelledBy?: string;
  dept?: DeptId;
}

/** Steps remain visible as instructions. Native AI review is configured per agent in AI settings. */
export function GateList({ agents, look, labelledBy, dept }: GateListProps) {
  const t=useT(),steps=agents.flatMap(agent=>agent.steps.map(step=>({agent,step}))),flow=look==='flow',List=flow?'ol':'ul';
  return <>
    <List className={flow?s.flow:s.steps} aria-labelledby={labelledBy}>
      {steps.map(({agent,step},at)=>{
        const floor=step.floor?<Gate purpose={step.purpose} gate="hold" floor/>:null;
        return flow?<li key={`${agent.id}:${step.id}`} className={s.flowStep}>
          <span className={sLocal.stepNo} aria-hidden="true"><Count value={at+1}/></span>
          <span className={sLocal.stepIcon} data-dept={dept} aria-hidden="true"><Icon name={step.floor?'lock':'file-text'} size={16}/></span>
          <span className={sLocal.stepText}><span className={sLocal.stepTitle}>{step.purpose}</span><span className={sLocal.stepSub}>{agent.name}</span></span>
          {floor}
        </li>:<li key={`${agent.id}:${step.id}`} className={s.step}><span className={sLocal.purpose}>{step.purpose}</span>{floor}</li>;
      })}
    </List>
    <p className={s.quiet}>{t('team.review.steps')}</p>
  </>;
}
