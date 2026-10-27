// Chausar delivery harness: the bookkeeping-cfo playbook's own tools (Bookkeeping and CFO help; Ink v2 wave 5, packages
// 5K1, 5K2). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub
// with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for
// Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type BookkeepingCfoToolName = Extract<ToolName, 'cfo.ratios' | 'cfo.scenarios' | 'collections.ladder' | 'money.checkup' | 'books.write' | 'vouchers.draft'>;

export const BOOKKEEPING_CFO_TOOLS: Readonly<Record<BookkeepingCfoToolName, Spec>> = Object.freeze({
  'cfo.ratios': notBuiltTool('cfo.ratios', 'compute', 'Days to get paid, days to pay and the cash cycle, worked out by code.'), // 5K1
  'cfo.scenarios': notBuiltTool('cfo.scenarios', 'compute', 'Cash under each scenario, worked out by code with receipts.'), // 5K1
  'collections.ladder': notBuiltTool('collections.ladder', 'compute', 'The reminders for what is owed, as drafts the client sends.'), // 5K1
  'money.checkup': notBuiltTool('money.checkup', 'compute', 'A check-up of the client\'s money, every figure a receipt.'), // 5K1
  'books.write': notBuiltTool('books.write', 'outside-write', 'Entries written to the accounting app, only the ones you approved.'), // 5K2
  'vouchers.draft': notBuiltTool('vouchers.draft', 'compute', 'Vouchers drafted for the books, for you to approve.'), // 5K2
});
