import { EngineError } from './types';

/** A saved demo request is never a live native driver's permission waiter. */
export function rejectFakeAgentApproval(raw:unknown):never {
  if(!raw || typeof raw!=='object' || Array.isArray(raw) || ![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw new EngineError('INVALID_VENTURE_REQUEST','Send one request object.');
  const p=raw as Record<string,unknown>,keys=['runId','digest','decision'];
  // W6 6F1: an outside server question's answer may ride along; the engine checks it against the waiting question.
  if(Object.keys(p).some(key=>!keys.includes(key) && key!=='content') || keys.some(key=>!Object.hasOwn(p,key)))throw new EngineError('INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');
  if(typeof p.runId!=='string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(p.runId))throw new EngineError('INVALID_VENTURE_REQUEST','AI job must be a known identifier.');
  if(p.decision!=='approve' && p.decision!=='deny')throw new EngineError('INVALID_VENTURE_REQUEST','Approve or decline this exact AI step.');
  throw new EngineError('APPROVAL_STALE','This AI step is no longer waiting for approval. Read the current job.');
}
