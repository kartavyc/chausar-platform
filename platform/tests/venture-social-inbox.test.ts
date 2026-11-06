import test from 'node:test';import assert from 'node:assert/strict';
import { importInbox, editInbox, decideReply, replyHandoff } from '../runtime/venture/playbooks/social/inbox.ts';
test('owner imported inbox binds last synced, sorts priority, assigns, drafts then requires exact owner and client approval',()=>{
 const rows=importInbox({orderId:'o1',channel:'instagram',source:'paste',importedAt:'2026-10-28T10:00:00Z',items:[{id:'one',author:'Mina',text:'Great work'},{id:'two',author:'Raj',text:'Broken order'}]});
 assert.equal(rows[0].externalId,'two');assert.equal(rows[0].syncedAt,'2026-10-28T10:00:00Z');
 const drafted=editInbox(rows[0],{reply:'Please send your order number privately.',assignee:'Asha',state:'needs-reply'});
 assert.throws(()=>replyHandoff(drafted),{code:'SOCIAL_APPROVAL_REQUIRED'});
 assert.throws(()=>decideReply(drafted,'client',true),{code:'SOCIAL_APPROVAL_REQUIRED'});
 const approved=decideReply(decideReply(drafted,'owner',true),'client',true);assert.equal(replyHandoff(approved).sent,false);
 assert.throws(()=>replyHandoff(editInbox(approved,{reply:'Changed reply'})),{code:'SOCIAL_APPROVAL_REQUIRED'});
 assert.throws(()=>replyHandoff(editInbox(approved,{state:'ignored'})),{code:'SOCIAL_APPROVAL_REQUIRED'});
});
