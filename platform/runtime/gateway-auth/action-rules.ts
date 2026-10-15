/** TR-06 for actions: a member on the staff seat sees only the actions they prepared, like the facts, receipts and conversations they entered. */
import { registerActionHidden } from '../actions.ts';
import { seatOf } from '../trust-ext/core-state.ts';

registerActionHidden((state, member, action) => member.role !== 'owner' && action.createdBy !== member.id && seatOf(state, member) === 'staff');
