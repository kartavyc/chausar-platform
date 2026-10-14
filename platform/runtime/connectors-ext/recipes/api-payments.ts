import type { Decoder, SourceRecipe } from '../recipe.ts';
import { RAZORPAY_NOTICES } from '../../adapters/payments/razorpay.ts';

/**
 * Payment gateway records read by the adapters in runtime/adapters/payments. Field aliases are the
 * flattened dotted keys of the source JSON. Razorpay and Stripe amounts are already minor units;
 * Cashfree and PayU amounts are decimal rupees. Totals are the source's own where the adapter
 * declares one (a settlement or payout amount); a list with no source total needs the report total.
 */
const epoch = ['EPOCH-S-IST'] as const;

const razorpayPayments: SourceRecipe = {
  id: 'razorpay.payments', version: '1', group: 'razorpay', operation: 'payments', title: 'Razorpay payments', decoder: 'api-records',
  fields: {
    id: { from: ['id'], type: 'text', required: true },
    date: { from: ['created_at'], type: 'date', required: true, dateFormats: epoch },
    amount: { from: ['amount'], type: 'money', required: true },
    currency: { from: ['currency'], type: 'text', required: true },
    status: { from: ['status'], type: 'text', required: true },
    method: { from: ['method'], type: 'text' },
    orderId: { from: ['order_id'], type: 'text' },
    invoice: { from: ['notes.invoice'], type: 'text' },
    fee: { from: ['fee'], type: 'money' },
    tax: { from: ['tax'], type: 'money' },
    description: { from: ['description'], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'minor' },
  identity: ['id'], kind: { constant: 'payment' },
  // Created and failed payments never moved money; they are counted as excluded rows.
  exclude: { field: 'status', values: ['created', 'failed'] },
  status: { field: 'status', values: { authorized: 'authorized', captured: 'captured', refunded: 'refunded' } },
  outputs: { orderId: 'orderId', invoiceId: 'invoice', feeMinor: 'fee', taxMinor: 'tax', paymentMethod: 'method', description: 'description' },
  totals: { kind: 'report' },
  ignored: ['entity'],
  notices: [...RAZORPAY_NOTICES],
  sensitivity: 'financial',
};

const razorpaySettlements: SourceRecipe = {
  id: 'razorpay.settlements', version: '1', group: 'razorpay', operation: 'settlements', title: 'Razorpay settlements', decoder: 'api-records',
  fields: {
    id: { from: ['id'], type: 'text', required: true },
    date: { from: ['created_at'], type: 'date', required: true, dateFormats: epoch },
    amount: { from: ['amount'], type: 'money', required: true },
    fees: { from: ['fees'], type: 'money' },
    tax: { from: ['tax'], type: 'money' },
    utr: { from: ['utr'], type: 'text' },
    status: { from: ['status'], type: 'text', required: true },
  },
  measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'minor' },
  identity: ['id'], kind: { constant: 'settlement' },
  exclude: { field: 'status', values: ['failed'] },
  status: { field: 'status', values: { created: 'pending', processed: 'settled' } },
  outputs: { bankReference: 'utr', feeMinor: 'fees', taxMinor: 'tax' },
  totals: { kind: 'report' },
  ignored: ['entity'],
  notices: [...RAZORPAY_NOTICES],
  sensitivity: 'financial',
};

/** One settlement's reconciliation items, checked against the settlement's own amount. */
const razorpaySettlementRecon: SourceRecipe = {
  id: 'razorpay.settlement-recon', version: '1', group: 'razorpay', operation: 'settlement-recon', title: 'Razorpay settlement reconciliation', decoder: 'api-records',
  fields: {
    entityId: { from: ['entity_id'], type: 'text', required: true },
    entity: { from: ['entity'], type: 'text' },
    type: { from: ['type'], type: 'text', required: true },
    date: { from: ['settled_at'], type: 'date', required: true, dateFormats: epoch },
    credit: { from: ['credit'], type: 'money', required: true },
    debit: { from: ['debit'], type: 'money', required: true },
    amount: { from: ['amount'], type: 'money' },
    fee: { from: ['fee'], type: 'money' },
    tax: { from: ['tax'], type: 'money' },
    currency: { from: ['currency'], type: 'text', required: true },
    settlementId: { from: ['settlement_id'], type: 'text', required: true },
    utr: { from: ['settlement_utr'], type: 'text' },
    orderId: { from: ['order_id'], type: 'text' },
    method: { from: ['method'], type: 'text' },
    description: { from: ['description'], type: 'text' },
  },
  measure: { type: 'money', amount: { credit: 'credit', debit: 'debit' }, currency: { field: 'currency' }, unit: 'minor' },
  identity: ['entityId', 'type'],
  kind: { field: 'type', values: { payment: 'payment', refund: 'refund', adjustment: 'adjustment', transfer: 'transfer', reversal: 'reversal' } },
  // The settlement itself arrives as the first record and carries the declared amount; it is not an item.
  exclude: { field: 'entity', values: ['settlement'] },
  outputs: { orderId: 'orderId', feeMinor: 'fee', taxMinor: 'tax', bankReference: 'utr', paymentMethod: 'method', description: 'description' },
  totals: { kind: 'declared' },
  ignored: ['id', 'status', 'fees', 'utr', 'created_at'],
  notices: [...RAZORPAY_NOTICES],
  sensitivity: 'financial',
};

/** Every balance transaction of one automatic payout; net amounts sum to the payout amount. */
const stripePayout: SourceRecipe = {
  id: 'stripe.payout-reconciliation', version: '1', group: 'stripe', operation: 'payout-reconciliation', title: 'Stripe payout reconciliation', decoder: 'api-records',
  fields: {
    id: { from: ['id'], type: 'text', required: true },
    object: { from: ['object'], type: 'text', required: true },
    type: { from: ['type'], type: 'text', required: true },
    date: { from: ['created'], type: 'date', required: true, dateFormats: epoch },
    net: { from: ['net'], type: 'money', required: true },
    amount: { from: ['amount'], type: 'money' },
    fee: { from: ['fee'], type: 'money' },
    currency: { from: ['currency'], type: 'text', required: true },
    source: { from: ['source'], type: 'text' },
    category: { from: ['reporting_category'], type: 'text' },
    description: { from: ['description'], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'net' }, currency: { field: 'currency' }, unit: 'minor' },
  identity: ['id'],
  kind: { field: 'type', values: { charge: 'payment', payment: 'payment', refund: 'refund', payment_refund: 'refund', payment_failure_refund: 'refund',
    adjustment: 'adjustment', stripe_fee: 'fee', application_fee: 'fee', tax_fee: 'fee', transfer: 'transfer' } },
  // The payout itself arrives as the first record and carries the declared amount.
  exclude: { field: 'object', values: ['payout'] },
  outputs: { feeMinor: 'fee', description: 'description' },
  totals: { kind: 'declared' },
  notices: ['Each Stripe payout stays in its own currency. Payouts in different currencies are imported separately.'],
  sensitivity: 'financial',
};

const cashfreeSettlements: SourceRecipe = {
  id: 'cashfree.settlements', version: '1', group: 'cashfree', operation: 'settlements', title: 'Cashfree settlements', decoder: 'api-records',
  fields: {
    id: { from: ['cf_settlement_id'], type: 'text', required: true },
    date: { from: ['settled_on'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
    amount: { from: ['amount_settled'], type: 'money', required: true },
    payments: { from: ['payment_amount'], type: 'money' },
    charge: { from: ['service_charge'], type: 'money' },
    tax: { from: ['service_tax'], type: 'money' },
    utr: { from: ['settlement_utr'], type: 'text' },
    status: { from: ['status'], type: 'text', required: true },
  },
  measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['id'], kind: { constant: 'settlement' },
  status: { field: 'status', values: { SUCCESS: 'settled', PENDING: 'pending', FAILED: 'failed' } },
  outputs: { bankReference: 'utr', feeMinor: 'charge', taxMinor: 'tax' },
  totals: { kind: 'report' },
  notices: ['Cashfree cannot be read live yet: its key pair is sent as headers the read kit does not support. Use the settlement export.'],
  sensitivity: 'financial',
};

const payuSettlement: SourceRecipe = {
  id: 'payu.settlement-details', version: '1', group: 'payu', operation: 'settlement-details', title: 'PayU settlement details', decoder: 'api-records',
  fields: {
    payuId: { from: ['payuid'], type: 'text', required: true },
    txnId: { from: ['txnid'], type: 'text' },
    date: { from: ['txndate'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
    action: { from: ['requestaction'], type: 'text', required: true },
    net: { from: ['mer_net_amount'], type: 'money', required: true },
    amount: { from: ['amount'], type: 'money' },
    fee: { from: ['mer_service_fee'], type: 'money' },
    tax: { from: ['mer_service_tax'], type: 'money' },
    utr: { from: ['mer_utr'], type: 'text' },
    mode: { from: ['mode'], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'net' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['payuId', 'action'],
  kind: { field: 'action', values: { capture: 'payment', refund: 'refund', chargeback: 'chargeback' } },
  sign: { field: 'action', negative: ['refund', 'chargeback'], positive: ['capture'] },
  outputs: { orderId: 'txnId', feeMinor: 'fee', taxMinor: 'tax', bankReference: 'utr', paymentMethod: 'mode' },
  totals: { kind: 'report' },
  notices: ['PayU cannot be read live yet: each request must be signed with the merchant salt. Use the settlement report.'],
  sensitivity: 'financial',
};

export const RECIPES: readonly SourceRecipe[] = [razorpayPayments, razorpaySettlements, razorpaySettlementRecon, stripePayout, cashfreeSettlements, payuSettlement];
export const DECODERS: readonly Decoder[] = [];
