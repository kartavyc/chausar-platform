import type { Pool } from 'pg';
import { Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

/** DB outbox and deterministic Temporal ID close the create/start crash window.
 * Multiple dispatchers may race; duplicate native start is reconciled. Task lifecycle
 * remains owned by Temporal, not this polling delivery adapter.
 */
export async function dispatchPending(pool:Pool,client:Client,taskQueue:string,tenantId:string) {
  const {rows}=await pool.query('SELECT investigation_id FROM chausar_core.work_outbox WHERE tenant_id=$1 AND dispatched_at IS NULL ORDER BY investigation_id',[tenantId]);
  for(const row of rows){
    try{await client.workflow.start('investigate',{taskQueue,workflowId:row.investigation_id,workflowIdReusePolicy:'REJECT_DUPLICATE',args:[{investigationId:row.investigation_id}]});}
    catch(error){if(!(error instanceof WorkflowExecutionAlreadyStartedError))throw error;}
    await pool.query('UPDATE chausar_core.work_outbox SET dispatched_at=clock_timestamp(),attempts=attempts+1 WHERE tenant_id=$1 AND investigation_id=$2 AND dispatched_at IS NULL',[tenantId,row.investigation_id]);
  }
  return rows.length;
}
