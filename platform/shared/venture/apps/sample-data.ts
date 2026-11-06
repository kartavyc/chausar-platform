// One-shot C4 task 29 (founder decision 3): an app with no data to show can run on made-up rows. This one module holds
// them, written by code and never drawn from the owner's records. The engine and the fake engine both answer from here,
// so nothing is read, summed, kept or proposed: every read answers these rows, and every tool that would write says so.
import { dayKeyPlus, formatMoney } from '../../owner-format.ts';

/** What a write, a proposal or a calculation (which keeps a receipt) answers while the app runs on sample data. */
export const NOT_IN_PREVIEW = 'Not in a preview';
export const APP_PREVIEW_ONLY = 'APP_PREVIEW_ONLY';

const CLIENTS = [
  { id: 'sample_client_1', name: 'Sample client: Asha Traders' },
  { id: 'sample_client_2', name: 'Sample client: Blue Door Cafe' },
  { id: 'sample_client_3', name: 'Sample client: Kiran Studio' },
] as const;

/** The sample rows a read tool answers, or null for a tool that would write. today: the owner's day, so a due day is near. */
export function sampleAnswer(tool: string, currency: string, today: string): Record<string, unknown> | null {
  switch (tool) {
    case 'clients_list': return { clients: CLIENTS.map(client => ({ ...client })) };
    case 'orders_list': return {
      orders: [
        { id: 'sample_order_1', clientId: CLIENTS[0].id, status: 'open', request: 'Sample order: monthly visit' },
        { id: 'sample_order_2', clientId: CLIENTS[1].id, status: 'delivered', request: 'Sample order: new menu' },
        { id: 'sample_order_3', clientId: CLIENTS[2].id, status: 'invoiced', request: 'Sample order: one shoot' },
      ],
    };
    case 'invoices_list': return {
      invoices: [
        { id: 'sample_invoice_1', number: 'SAMPLE-001', clientId: CLIENTS[0].id, status: 'issued', dueDate: dayKeyPlus(today, 7), balance: { display: formatMoney('1200000', currency), receiptId: null } },
        { id: 'sample_invoice_2', number: 'SAMPLE-002', clientId: CLIENTS[1].id, status: 'part-paid', dueDate: dayKeyPlus(today, 3), balance: { display: formatMoney('450000', currency), receiptId: null } },
        { id: 'sample_invoice_3', number: 'SAMPLE-003', clientId: CLIENTS[2].id, status: 'paid', dueDate: dayKeyPlus(today, -5), balance: { display: formatMoney('0', currency), receiptId: null } },
      ],
    };
    case 'notes_get': return { notes: {} };
    default: return null;
  }
}

/** The reads whose rows count as the app having data of its own to show. */
export const DATA_READS: ReadonlySet<string> = new Set(['clients_list', 'orders_list', 'invoices_list']);
